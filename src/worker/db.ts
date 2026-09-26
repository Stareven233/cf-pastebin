/**
 * Cloudflare D1 数据库操作与表结构自动初始化
 */

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS?: Fetcher;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  ENVIRONMENT?: string;
  MAX_FILE_SIZE_BYTES?: string;
}

/**
 * 自动检查并初始化必要的数据表（轻量幂等建表）
 */
export async function ensureDatabaseTables(db: D1Database): Promise<void> {
  // 建表语句 (使用 IF NOT EXISTS，保证幂等)
  const statements = [
    `CREATE TABLE IF NOT EXISTS system_metrics (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0,
      period_key TEXT,
      updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS upload_tokens (
      id TEXT PRIMARY KEY,
      max_size_bytes INTEGER NOT NULL,
      used_size_bytes INTEGER DEFAULT 0,
      allow_permanent INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS pastes (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      text_content TEXT,
      total_size_bytes INTEGER DEFAULT 0,
      burn_after_read INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      created_by_token TEXT,
      is_deleted INTEGER DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS paste_files (
      id TEXT PRIMARY KEY,
      paste_id TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS admin_auth_attempts (
      ip TEXT PRIMARY KEY,
      failed_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pastes_slug ON pastes(slug);`,
    `CREATE INDEX IF NOT EXISTS idx_pastes_expires ON pastes(expires_at);`,
    `CREATE INDEX IF NOT EXISTS idx_paste_files_paste_id ON paste_files(paste_id);`
  ];

  await db.batch(statements.map(sql => db.prepare(sql)));
}
