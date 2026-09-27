/**
 * 管理员身份认证、HMAC 会话签名与防暴力破解频控
 */

import { ADMIN_COOKIE_NAME, ADMIN_COOKIE_MAX_AGE } from '../shared/constants';
import type { Env } from './db';

/**
 * 获取请求客户端真实 IP
 */
export function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
         '127.0.0.1';
}

/**
 * 检查当前 IP 是否处于输错密码锁定状态
 */
export async function checkIpLock(db: D1Database, ip: string): Promise<{ locked: boolean; unlockTime?: string }> {
  const row = await db.prepare(`
    SELECT failed_attempts, locked_until
    FROM admin_auth_attempts
    WHERE ip = ?;
  `).bind(ip).first<{ failed_attempts: number; locked_until: string | null }>();

  if (!row || !row.locked_until) return { locked: false };

  const lockExpiry = new Date(row.locked_until).getTime();
  const now = Date.now();

  if (now < lockExpiry) {
    return { locked: true, unlockTime: row.locked_until };
  }

  // 锁定时间已过，自动解除锁定并重置次数
  await db.prepare(`
    UPDATE admin_auth_attempts
    SET failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
    WHERE ip = ?;
  `).bind(ip).run();

  return { locked: false };
}

/**
 * 记录登录失败次数（连续 5 次失败锁定 15 分钟）
 */
export async function recordAuthFailure(db: D1Database, ip: string): Promise<{ lockedNow: boolean; remainingAttempts: number }> {
  const nowIso = new Date().toISOString();
  // 锁定 15 分钟
  const lockUntilIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const row = await db.prepare(`
    SELECT failed_attempts
    FROM admin_auth_attempts
    WHERE ip = ?;
  `).bind(ip).first<{ failed_attempts: number }>();

  const currentAttempts = (row?.failed_attempts || 0) + 1;
  const isLocked = currentAttempts >= 5;

  await db.prepare(`
    INSERT INTO admin_auth_attempts (ip, failed_attempts, locked_until, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      failed_attempts = excluded.failed_attempts,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at;
  `).bind(ip, currentAttempts, isLocked ? lockUntilIso : null, nowIso).run();

  return {
    lockedNow: isLocked,
    remainingAttempts: Math.max(0, 5 - currentAttempts),
  };
}

/**
 * 登录成功后重置失败计数
 */
export async function clearAuthAttempts(db: D1Database, ip: string): Promise<void> {
  await db.prepare(`
    DELETE FROM admin_auth_attempts WHERE ip = ?;
  `).bind(ip).run();
}

/**
 * 基于 Web Crypto API 生成 HMAC-SHA256 签名会话 Token
 */
async function signToken(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  // 转换为十六进制字符串
  const hashHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${btoa(payload)}.${hashHex}`;
}

/**
 * 校验 HMAC-SHA256 签名会话 Token
 */
async function verifyToken(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const payloadStr = atob(parts[0]);
    const expectedToken = await signToken(payloadStr, secret);
    if (expectedToken !== token) return null;

    const data = JSON.parse(payloadStr);
    if (data.exp && Date.now() > data.exp) {
      return null; // 会话已过期
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * 从 Cookie 请求头中解析会话 Token
 */
export function getSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${ADMIN_COOKIE_NAME}=`)) {
      return cookie.substring(ADMIN_COOKIE_NAME.length + 1);
    }
  }
  return null;
}

/**
 * 创建管理员会话 Cookie
 */
export async function createAdminSessionCookie(env: Env): Promise<{ cookie: string; expiresAt: number }> {
  const secret = env.SESSION_SECRET || 'cf-pastebin-default-secret-change-in-prod';
  const expiresAt = Date.now() + ADMIN_COOKIE_MAX_AGE * 1000;
  const payload = JSON.stringify({ role: 'admin', exp: expiresAt });
  const token = await signToken(payload, secret);

  const isProd = env.ENVIRONMENT === 'production';
  // HttpOnly, SameSite=Lax, 7天过期
  const cookie = `${ADMIN_COOKIE_NAME}=${token}; Path=/; Max-Age=${ADMIN_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`;
  return { cookie, expiresAt };
}

/**
 * 校验当前请求是否具备合法的管理员会话权限
 */
export async function verifyAdminSession(request: Request, env: Env): Promise<boolean> {
  const token = getSessionCookie(request);
  if (!token) return false;

  const secret = env.SESSION_SECRET || 'cf-pastebin-default-secret-change-in-prod';
  const payload = await verifyToken(token, secret);
  return Boolean(payload && payload.role === 'admin');
}

/**
 * 生成退出登录清除 Cookie 头
 */
export function createClearSessionCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/**
 * 签发阅后即焚一次性临时读取/下载凭证 (15 分钟有效期)
 * 允许用户在打开的落地页中下载文件或复制查看，但防止被二次刷新或盗链重放
 */
export async function signReadToken(pasteId: string, slug: string, secret: string): Promise<string> {
  const payload = JSON.stringify({
    type: 'burn_read',
    pasteId,
    slug,
    exp: Date.now() + 15 * 60 * 1000, // 15 分钟有效期
  });
  return await signToken(payload, secret);
}

/**
 * 校验阅后即焚临时读取凭证的合法性与时效
 */
export async function verifyReadToken(
  token: string,
  pasteId: string,
  slug: string,
  secret: string
): Promise<boolean> {
  const payload = await verifyToken(token, secret);
  if (!payload) return false;
  return payload.type === 'burn_read' && payload.pasteId === pasteId && payload.slug === slug;
}

