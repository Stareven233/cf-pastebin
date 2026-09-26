/**
 * 定时任务与过期资源物理清理器
 */

import { adjustStorageBytes, recalculateStorageBytes, incrementMetric } from './metrics';
import type { Env } from './db';

/**
 * 物理清理指定 Paste 的所有关联文件与数据库数据
 */
export async function deletePastePermanently(
  db: D1Database,
  r2: R2Bucket,
  pasteId: string
): Promise<{ deletedBytes: number; deletedFilesCount: number }> {
  // 1. 获取关联的全部 R2 文件列表
  const files = await db.prepare(`
    SELECT id, r2_key, size_bytes
    FROM paste_files
    WHERE paste_id = ?;
  `).bind(pasteId).all<{ id: string; r2_key: string; size_bytes: number }>();

  let deletedBytes = 0;
  let deletedFilesCount = 0;

  // 2. 从 R2 物理删除对象
  if (files.results && files.results.length > 0) {
    const keysToDelete = files.results.map(f => f.r2_key);
    try {
      await r2.delete(keysToDelete);
      // 记录 R2 操作数
      await incrementMetric(db, 'r2_class_a_month', keysToDelete.length);
    } catch (err) {
      console.error(`R2 delete keys failed:`, err);
    }

    for (const f of files.results) {
      deletedBytes += f.size_bytes;
      deletedFilesCount++;
    }
  }

  // 3. 从 D1 中物理删除或软删除标记
  await db.batch([
    db.prepare(`DELETE FROM paste_files WHERE paste_id = ?;`).bind(pasteId),
    db.prepare(`
      UPDATE pastes
      SET is_deleted = 1, text_content = NULL, total_size_bytes = 0
      WHERE id = ?;
    `).bind(pasteId)
  ]);

  // 4. 原子扣减系统存储指标
  if (deletedBytes > 0) {
    await adjustStorageBytes(db, -deletedBytes);
  }

  return { deletedBytes, deletedFilesCount };
}

/**
 * 定时扫描并清理全量过期分享与过期 Token (Cron Trigger 执行入口)
 */
export async function runCronCleanup(env: Env): Promise<{
  expiredPastesCount: number;
  totalFreedBytes: number;
  expiredTokensCount: number;
}> {
  const { DB, R2 } = env;
  const nowIso = new Date().toISOString();

  // 1. 查找所有已过期且尚未清理的 pastes
  const expiredPastes = await DB.prepare(`
    SELECT id, slug, total_size_bytes
    FROM pastes
    WHERE expires_at IS NOT NULL
      AND expires_at <= ?
      AND is_deleted = 0;
  `).bind(nowIso).all<{ id: string; slug: string; total_size_bytes: number }>();

  let expiredPastesCount = 0;
  let totalFreedBytes = 0;

  if (expiredPastes.results && expiredPastes.results.length > 0) {
    for (const paste of expiredPastes.results) {
      const res = await deletePastePermanently(DB, R2, paste.id);
      expiredPastesCount++;
      totalFreedBytes += res.deletedBytes;
    }
  }

  // 2. 更新超时未使用的 upload_tokens 为 expired 状态
  const tokenUpdateResult = await DB.prepare(`
    UPDATE upload_tokens
    SET status = 'expired'
    WHERE status = 'active'
      AND expires_at <= ?;
  `).bind(nowIso).run();

  const expiredTokensCount = tokenUpdateResult.meta.changes || 0;

  // 3. 重新校准存储总量，确保精准一致
  await recalculateStorageBytes(DB);

  return {
    expiredPastesCount,
    totalFreedBytes,
    expiredTokensCount,
  };
}
