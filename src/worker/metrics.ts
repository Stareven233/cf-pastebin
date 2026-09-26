/**
 * Cloudflare 免费配额监控、累加统计与双阶熔断算法
 */

import { CLOUDFLARE_FREE_LIMITS, QUOTA_THRESHOLDS } from '../shared/constants';
import type { QuotaOverview } from '../shared/types';

/**
 * 获取当前年月 (UTC: YYYY-MM) 与当日 (UTC: YYYY-MM-DD)
 */
function getPeriodKeys() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return {
    monthKey: `${year}-${month}`,
    dayKey: `${year}-${month}-${day}`,
    isoNow: now.toISOString(),
  };
}

/**
 * 累加指定指标计数，自动按周期归零重置
 */
export async function incrementMetric(
  db: D1Database,
  metricKey: 'r2_class_a_month' | 'r2_class_b_month' | 'worker_req_day',
  delta = 1
): Promise<void> {
  const { monthKey, dayKey, isoNow } = getPeriodKeys();
  const currentPeriod = metricKey === 'worker_req_day' ? dayKey : monthKey;

  // 使用 SQLite UPSERT：如果周期已变，重置 value 为 delta；否则累加
  const sql = `
    INSERT INTO system_metrics (key, value, period_key, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = CASE
        WHEN period_key = excluded.period_key THEN value + excluded.value
        ELSE excluded.value
      END,
      period_key = excluded.period_key,
      updated_at = excluded.updated_at;
  `;

  await db.prepare(sql).bind(metricKey, delta, currentPeriod, isoNow).run();
}

/**
 * 增减 R2 存储字节数
 */
export async function adjustStorageBytes(db: D1Database, deltaBytes: number): Promise<void> {
  const now = new Date().toISOString();
  const sql = `
    INSERT INTO system_metrics (key, value, period_key, updated_at)
    VALUES ('r2_storage_bytes', MAX(0, ?), NULL, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = MAX(0, value + excluded.value),
      updated_at = excluded.updated_at;
  `;
  await db.prepare(sql).bind(deltaBytes, now).run();
}

/**
 * 重新校准 R2 存储空间实际大小 (通过 D1 中未删除文件总和计算)
 */
export async function recalculateStorageBytes(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    SELECT COALESCE(SUM(total_size_bytes), 0) AS total
    FROM pastes
    WHERE is_deleted = 0;
  `).first<{ total: number }>();

  const totalBytes = result?.total || 0;
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO system_metrics (key, value, period_key, updated_at)
    VALUES ('r2_storage_bytes', ?, NULL, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
  `).bind(totalBytes, now).run();

  return totalBytes;
}

/**
 * 获取当前所有额度的实时概览与熔断状态
 */
export async function getQuotaOverview(db: D1Database): Promise<QuotaOverview> {
  const { monthKey, dayKey } = getPeriodKeys();
  const rows = await db.prepare(`SELECT key, value, period_key FROM system_metrics`).all<{
    key: string;
    value: number;
    period_key: string | null;
  }>();

  const metricsMap = new Map<string, { value: number; period_key: string | null }>();
  for (const row of rows.results || []) {
    metricsMap.set(row.key, row);
  }

  // 1. 存储大小 (字节)
  const storageUsed = Math.max(0, metricsMap.get('r2_storage_bytes')?.value || 0);
  const storageMax = CLOUDFLARE_FREE_LIMITS.STORAGE_BYTES;
  const storagePercent = Math.min(100, Math.round((storageUsed / storageMax) * 10000) / 100);

  // 2. R2 Class A (月度操作数)
  const classARow = metricsMap.get('r2_class_a_month');
  const classAUsed = classARow?.period_key === monthKey ? classARow.value : 0;
  const classAMax = CLOUDFLARE_FREE_LIMITS.R2_CLASS_A_MONTHLY;
  const classAPercent = Math.min(100, Math.round((classAUsed / classAMax) * 10000) / 100);

  // 3. R2 Class B (月度操作数)
  const classBRow = metricsMap.get('r2_class_b_month');
  const classBUsed = classBRow?.period_key === monthKey ? classBRow.value : 0;
  const classBMax = CLOUDFLARE_FREE_LIMITS.R2_CLASS_B_MONTHLY;
  const classBPercent = Math.min(100, Math.round((classBUsed / classBMax) * 10000) / 100);

  // 4. Worker 每日请求数
  const reqRow = metricsMap.get('worker_req_day');
  const reqUsed = reqRow?.period_key === dayKey ? reqRow.value : 0;
  const reqMax = CLOUDFLARE_FREE_LIMITS.WORKER_REQUESTS_DAILY;
  const reqPercent = Math.min(100, Math.round((reqUsed / reqMax) * 10000) / 100);

  // 判定警戒线 (>=80%) 与 熔断线 (>=95%)
  const checkStatus = (used: number, max: number) => {
    const ratio = used / max;
    return {
      isWarning: ratio >= QUOTA_THRESHOLDS.WARNING_RATIO,
      isCritical: ratio >= QUOTA_THRESHOLDS.CRITICAL_RATIO,
    };
  };

  const st = checkStatus(storageUsed, storageMax);
  const ca = checkStatus(classAUsed, classAMax);
  const cb = checkStatus(classBUsed, classBMax);
  const rq = checkStatus(reqUsed, reqMax);

  let status: 'normal' | 'warning' | 'circuit_broken' = 'normal';
  let brokenReason: string | undefined;

  if (st.isCritical || ca.isCritical || cb.isCritical || rq.isCritical) {
    status = 'circuit_broken';
    const reasons: string[] = [];
    if (st.isCritical) reasons.push(`R2 存储空间已达 ${storagePercent}% (超过 95% 安全熔断线)`);
    if (ca.isCritical) reasons.push(`本月 R2 Class A 写入操作已达 ${classAPercent}%`);
    if (cb.isCritical) reasons.push(`本月 R2 Class B 读取操作已达 ${classBPercent}%`);
    if (rq.isCritical) reasons.push(`今日 Worker API 请求量已达 ${reqPercent}%`);
    brokenReason = reasons.join('；');
  } else if (st.isWarning || ca.isWarning || cb.isWarning || rq.isWarning) {
    status = 'warning';
  }

  return {
    storage: {
      usedBytes: storageUsed,
      maxBytes: storageMax,
      percent: storagePercent,
      ...st,
    },
    r2ClassA: {
      used: classAUsed,
      max: classAMax,
      percent: classAPercent,
      ...ca,
    },
    r2ClassB: {
      used: classBUsed,
      max: classBMax,
      percent: classBPercent,
      ...cb,
    },
    workerReqs: {
      used: reqUsed,
      max: reqMax,
      percent: reqPercent,
      ...rq,
    },
    status,
    brokenReason,
  };
}

/**
 * 快速检查前台是否触发 95% 熔断拦截
 */
export async function isCircuitBroken(db: D1Database): Promise<{ broken: boolean; reason?: string }> {
  const overview = await getQuotaOverview(db);
  if (overview.status === 'circuit_broken') {
    return { broken: true, reason: overview.brokenReason };
  }
  return { broken: false };
}
