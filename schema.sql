-- Cloudflare D1 初始数据表结构定义

-- 1. 系统指标与熔断监控表
-- 记录存储用量（字节）、当月/当日操作数与请求数
CREATE TABLE IF NOT EXISTS system_metrics (
  key TEXT PRIMARY KEY,             -- 指标键名 (r2_storage_bytes, r2_class_a_month, r2_class_b_month, worker_req_day)
  value INTEGER NOT NULL DEFAULT 0, -- 当前数值
  period_key TEXT,                  -- 周期标识 (如 '2026-09' 用于月度, '2026-09-26' 用于按日)
  updated_at TEXT NOT NULL          -- 最后更新时间 (ISO8601)
);

-- 初始化默认指标记录
INSERT OR IGNORE INTO system_metrics (key, value, period_key, updated_at) VALUES
('r2_storage_bytes', 0, NULL, datetime('now')),
('r2_class_a_month', 0, strftime('%Y-%m', 'now'), datetime('now')),
('r2_class_b_month', 0, strftime('%Y-%m', 'now'), datetime('now')),
('worker_req_day', 0, strftime('%Y-%m-%d', 'now'), datetime('now'));

-- 2. 外部访客一次性上传凭证 Token 表
CREATE TABLE IF NOT EXISTS upload_tokens (
  id TEXT PRIMARY KEY,              -- Token 唯一标识 (UUIDv4)
  max_size_bytes INTEGER NOT NULL,  -- 允许的最大总文件容量 (字节，如 52428800 代表 50MB)
  used_size_bytes INTEGER DEFAULT 0,-- 实际上传消耗的容量
  allow_permanent INTEGER DEFAULT 0,-- 是否允许该 Token 勾选永久保存 (1: 允许, 0: 禁止)
  status TEXT NOT NULL DEFAULT 'active', -- active (有效), used (已消费作废), expired (已过期)
  expires_at TEXT NOT NULL,         -- Token 自身的有效期截止时间 (ISO8601)
  created_at TEXT NOT NULL          -- Token 创建时间 (ISO8601)
);

CREATE INDEX IF NOT EXISTS idx_upload_tokens_status ON upload_tokens(status);

-- 3. 分享主体信息表 (Pastes)
CREATE TABLE IF NOT EXISTS pastes (
  id TEXT PRIMARY KEY,              -- 内部唯一 ID (UUIDv4)
  slug TEXT UNIQUE NOT NULL,        -- 对外访问短链标识 (4/8/16位随机字符)
  type TEXT NOT NULL,               -- text (纯文本), single_file (单文件), multi_file (多文件合集)
  title TEXT,                       -- 分享标题或文件备注
  text_content TEXT,                -- 纯文本内容 (存入 D1 避免消耗 R2 操作数)
  total_size_bytes INTEGER DEFAULT 0,-- 文件总字节数
  burn_after_read INTEGER DEFAULT 0,-- 是否阅后即焚 (1: 是, 0: 否)
  view_count INTEGER DEFAULT 0,     -- 网页落地页访问次数
  download_count INTEGER DEFAULT 0, -- 实际下载触发次数
  expires_at TEXT,                  -- 过期时间戳 (ISO8601, NULL 表示永久保存)
  created_at TEXT NOT NULL,         -- 创建时间 (ISO8601)
  created_by_token TEXT,            -- 来源上传 Token (若是管理员创建则为 'admin')
  is_deleted INTEGER DEFAULT 0      -- 软删除/待清理标记 (1: 已清理, 0: 正常)
);

CREATE INDEX IF NOT EXISTS idx_pastes_slug ON pastes(slug);
CREATE INDEX IF NOT EXISTS idx_pastes_expires ON pastes(expires_at);
CREATE INDEX IF NOT EXISTS idx_pastes_is_deleted ON pastes(is_deleted);

-- 4. 分享文件详情表 (Paste Files)
CREATE TABLE IF NOT EXISTS paste_files (
  id TEXT PRIMARY KEY,              -- 文件唯一 ID (UUIDv4)
  paste_id TEXT NOT NULL,           -- 关联 pastes.id
  r2_key TEXT NOT NULL,             -- R2 存储桶中的对象路径 Key
  filename TEXT NOT NULL,           -- 原始文件名
  mime_type TEXT NOT NULL,          -- 文件 MIME 类型
  size_bytes INTEGER NOT NULL,      -- 单文件字节大小
  created_at TEXT NOT NULL,         -- 上传完成时间
  FOREIGN KEY (paste_id) REFERENCES pastes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paste_files_paste_id ON paste_files(paste_id);

-- 5. 管理员登录防爆破与频控表
CREATE TABLE IF NOT EXISTS admin_auth_attempts (
  ip TEXT PRIMARY KEY,              -- 客户端 IP
  failed_attempts INTEGER DEFAULT 0,-- 失败尝试次数
  locked_until TEXT,                -- 封禁截止时间 (ISO8601, NULL 表示未锁定)
  updated_at TEXT NOT NULL          -- 最后尝试时间
);
