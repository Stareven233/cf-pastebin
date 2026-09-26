/**
 * 免费配额计算与双阶熔断算法测试
 */

import { describe, it, expect } from 'bun:test';
import { getQuotaOverview } from '../src/worker/metrics';
import { CLOUDFLARE_FREE_LIMITS } from '../src/shared/constants';

describe('Quota and Circuit Breaker Logic Tests', () => {
  // 构建 Mock D1 数据库实例
  function createMockDb(metrics: Record<string, { value: number; period_key: string | null }>) {
    return {
      prepare(query: string) {
        return {
          async all() {
            const results = Object.entries(metrics).map(([key, val]) => ({
              key,
              value: val.value,
              period_key: val.period_key,
            }));
            return { results };
          },
          async first() {
            return null;
          },
          bind() {
            return this;
          },
        };
      },
    } as any;
  }

  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const dayKey = `${monthKey}-${String(now.getUTCDate()).padStart(2, '0')}`;

  it('should report normal status when usage is below 80%', async () => {
    const mockDb = createMockDb({
      r2_storage_bytes: { value: 1024 * 1024 * 1024, period_key: null }, // 1GB (10%)
      r2_class_a_month: { value: 10000, period_key: monthKey },
      r2_class_b_month: { value: 50000, period_key: monthKey },
      worker_req_day: { value: 1000, period_key: dayKey },
    });

    const overview = await getQuotaOverview(mockDb);
    expect(overview.status).toBe('normal');
    expect(overview.storage.isWarning).toBe(false);
    expect(overview.storage.isCritical).toBe(false);
  });

  it('should trigger warning (80%) when storage reaches 8GB', async () => {
    const mockDb = createMockDb({
      r2_storage_bytes: { value: Math.floor(CLOUDFLARE_FREE_LIMITS.STORAGE_BYTES * 0.82), period_key: null }, // 82%
      r2_class_a_month: { value: 1000, period_key: monthKey },
      r2_class_b_month: { value: 2000, period_key: monthKey },
      worker_req_day: { value: 500, period_key: dayKey },
    });

    const overview = await getQuotaOverview(mockDb);
    expect(overview.status).toBe('warning');
    expect(overview.storage.isWarning).toBe(true);
    expect(overview.storage.isCritical).toBe(false);
  });

  it('should trigger circuit broken (95%) when any metric hits critical threshold', async () => {
    const mockDb = createMockDb({
      r2_storage_bytes: { value: Math.floor(CLOUDFLARE_FREE_LIMITS.STORAGE_BYTES * 0.96), period_key: null }, // 96%
      r2_class_a_month: { value: 1000, period_key: monthKey },
      r2_class_b_month: { value: 2000, period_key: monthKey },
      worker_req_day: { value: 500, period_key: dayKey },
    });

    const overview = await getQuotaOverview(mockDb);
    expect(overview.status).toBe('circuit_broken');
    expect(overview.storage.isCritical).toBe(true);
    expect(overview.brokenReason).toContain('R2 存储空间已达');
  });

  it('should trigger circuit broken when daily worker requests reach 95%', async () => {
    const mockDb = createMockDb({
      r2_storage_bytes: { value: 1024, period_key: null },
      r2_class_a_month: { value: 1000, period_key: monthKey },
      r2_class_b_month: { value: 2000, period_key: monthKey },
      worker_req_day: { value: 96000, period_key: dayKey }, // 96% of 100,000
    });

    const overview = await getQuotaOverview(mockDb);
    expect(overview.status).toBe('circuit_broken');
    expect(overview.workerReqs.isCritical).toBe(true);
    expect(overview.brokenReason).toContain('今日 Worker API 请求量已达');
  });
});
