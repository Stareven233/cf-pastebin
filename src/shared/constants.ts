/**
 * 系统通用常量与 Cloudflare 免费配额边界
 */

// Cloudflare 免费计划严格配额指标
export const CLOUDFLARE_FREE_LIMITS = {
  // R2 对象存储空间：10 GB (以字节计)
  STORAGE_BYTES: 10 * 1024 * 1024 * 1024,
  // R2 Class A 操作 (写/创建/列举)：1,000,000 次/月
  R2_CLASS_A_MONTHLY: 1_000_000,
  // R2 Class B 操作 (读/下载)：10,000,000 次/月
  R2_CLASS_B_MONTHLY: 10_000_000,
  // Worker / API 请求数：100,000 次/天
  WORKER_REQUESTS_DAILY: 100_000,
} as const;

// 熔断安全阈值百分比
export const QUOTA_THRESHOLDS = {
  WARNING_RATIO: 0.80,   // 80%：管理后台亮起黄色警告，系统功能保持可用
  CRITICAL_RATIO: 0.95,  // 95%：前台停服熔断，管理端保持可用可清理
} as const;

// 单文件大小上限：25MB
export const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024;

// Base62 字符集 (用于随机生成 4/8/16 位不可预测的短链 Slug)
export const BASE62_CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 预设过期时限 (秒)
export const EXPIRATION_PRESETS = [
  { label: '1 小时', value: 3600 },
  { label: '1 天 (默认)', value: 86400 },
  { label: '7 天', value: 604800 },
] as const;

// 管理员会话 Cookie 名称
export const ADMIN_COOKIE_NAME = 'cf_pastebin_session';
export const ADMIN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 天免密 (秒)
