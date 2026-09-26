/**
 * 管理员后台专用 API 路由集合
 * 涵盖：认证登录、配额仪表盘、分享列表查删、一次性上传 Token 派发与作废
 */

import {
  getClientIp,
  checkIpLock,
  recordAuthFailure,
  clearAuthAttempts,
  createAdminSessionCookie,
  verifyAdminSession,
  createClearSessionCookie,
} from '../auth';
import { getQuotaOverview, recalculateStorageBytes } from '../metrics';
import { deletePastePermanently } from '../cron';
import type { Env } from '../db';
import type { ApiResponse, AdminPasteListItem, UploadToken } from '../../shared/types';

/**
 * 管理员登录 (POST /api/admin/login)
 */
export async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  const ip = getClientIp(request);

  // 1. 检查防爆破 IP 锁定
  const lock = await checkIpLock(env.DB, ip);
  if (lock.locked) {
    return Response.json({
      success: false,
      error: `密码连续输错过多，IP 已被临时锁定至 ${new Date(lock.unlockTime!).toLocaleTimeString('zh-CN')}，请稍后再试喵`
    } satisfies ApiResponse, { status: 429 });
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '请求数据格式错误' } satisfies ApiResponse, { status: 400 });
  }

  const { password } = body;
  const configuredPassword = env.ADMIN_PASSWORD || 'admin123456';

  if (!password || password !== configuredPassword) {
    const failure = await recordAuthFailure(env.DB, ip);
    if (failure.lockedNow) {
      return Response.json({
        success: false,
        error: '密码错误且连续失败达 5 次，IP 已被临时锁定 15 分钟喵！'
      } satisfies ApiResponse, { status: 429 });
    }
    return Response.json({
      success: false,
      error: `管理员密码错误，剩余尝试次数：${failure.remainingAttempts} 次喵`
    } satisfies ApiResponse, { status: 401 });
  }

  // 2. 登录成功，清除该 IP 历史失败记录
  await clearAuthAttempts(env.DB, ip);

  // 3. 签发 HttpOnly 签名 Cookie
  const { cookie } = await createAdminSessionCookie(env);

  return Response.json({
    success: true,
    message: '登录成功喵',
  } satisfies ApiResponse, {
    headers: {
      'Set-Cookie': cookie,
    }
  });
}

/**
 * 退出登录 (POST /api/admin/logout)
 */
export async function handleAdminLogout(): Promise<Response> {
  return Response.json({
    success: true,
    message: '已安全退出登录喵',
  } satisfies ApiResponse, {
    headers: {
      'Set-Cookie': createClearSessionCookie(),
    }
  });
}

/**
 * 检查当前管理员登录状态 (GET /api/admin/me)
 */
export async function handleAdminMe(request: Request, env: Env): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  return Response.json({
    success: true,
    data: { isAdmin },
  } satisfies ApiResponse);
}

/**
 * 获取配额仪表盘概览与综合统计 (GET /api/admin/dashboard)
 */
export async function handleAdminDashboard(request: Request, env: Env): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ success: false, error: '未授权访问' } satisfies ApiResponse, { status: 401 });
  }

  const quota = await getQuotaOverview(env.DB);

  // 统计数据
  const stats = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) as count FROM pastes WHERE is_deleted = 0;`),
    env.DB.prepare(`SELECT COUNT(*) as count FROM paste_files;`),
    env.DB.prepare(`SELECT COUNT(*) as count FROM upload_tokens WHERE status = 'active';`),
  ]);

  const totalPastes = (stats[0].results?.[0] as any)?.count || 0;
  const totalFiles = (stats[1].results?.[0] as any)?.count || 0;
  const activeTokens = (stats[2].results?.[0] as any)?.count || 0;

  return Response.json({
    success: true,
    data: {
      quota,
      stats: {
        totalPastes,
        totalFiles,
        activeTokens,
      }
    }
  } satisfies ApiResponse);
}

/**
 * 获取全量分享列表 (GET /api/admin/pastes)
 */
export async function handleAdminListPastes(request: Request, env: Env): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ success: false, error: '未授权访问' } satisfies ApiResponse, { status: 401 });
  }

  // 查出所有未软删除的 pastes
  const pastesRows = await env.DB.prepare(`
    SELECT
      id, slug, type, title, text_content, total_size_bytes,
      burn_after_read, view_count, download_count, expires_at,
      created_at, created_by_token, is_deleted
    FROM pastes
    WHERE is_deleted = 0
    ORDER BY created_at DESC;
  `).all<any>();

  // 查出全部文件信息映射
  const filesRows = await env.DB.prepare(`
    SELECT id, paste_id, r2_key, filename, mime_type, size_bytes, created_at
    FROM paste_files;
  `).all<any>();

  const filesByPasteId = new Map<string, any[]>();
  for (const f of filesRows.results || []) {
    if (!filesByPasteId.has(f.paste_id)) {
      filesByPasteId.set(f.paste_id, []);
    }
    filesByPasteId.get(f.paste_id)!.push(f);
  }

  const list: AdminPasteListItem[] = (pastesRows.results || []).map(p => ({
    ...p,
    files: filesByPasteId.get(p.id) || [],
  }));

  return Response.json({
    success: true,
    data: list,
  } satisfies ApiResponse<AdminPasteListItem[]>);
}

/**
 * 手动永久删除分享与 R2 文件 (DELETE /api/admin/pastes/:id)
 */
export async function handleAdminDeletePaste(
  request: Request,
  env: Env,
  pasteId: string
): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ success: false, error: '未授权访问' } satisfies ApiResponse, { status: 401 });
  }

  const result = await deletePastePermanently(env.DB, env.R2, pasteId);

  return Response.json({
    success: true,
    message: `已彻底删除分享及关联的 ${result.deletedFilesCount} 个文件，释放 ${(result.deletedBytes / (1024 * 1024)).toFixed(2)} MB 空间喵`,
    data: result,
  } satisfies ApiResponse);
}

/**
 * 获取上传 Token 列表 (GET /api/admin/tokens)
 */
export async function handleAdminListTokens(request: Request, env: Env): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ success: false, error: '未授权访问' } satisfies ApiResponse, { status: 401 });
  }

  const rows = await env.DB.prepare(`
    SELECT id, max_size_bytes, used_size_bytes, allow_permanent, status, expires_at, created_at
    FROM upload_tokens
    ORDER BY created_at DESC;
  `).all<UploadToken>();

  return Response.json({
    success: true,
    data: rows.results || [],
  } satisfies ApiResponse<UploadToken[]>);
}

/**
 * 生成新的一次性上传 Token (POST /api/admin/tokens)
 */
export async function handleAdminCreateToken(request: Request, env: Env): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ success: false, error: '未授权访问' } satisfies ApiResponse, { status: 401 });
  }

  let body: {
    maxSizeBytes?: number;
    durationHours?: number;
    allowPermanent?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '请求数据格式错误' } satisfies ApiResponse, { status: 400 });
  }

  const maxSizeBytes = Math.max(1024 * 1024, Number(body.maxSizeBytes) || (25 * 1024 * 1024)); // 默认 25MB
  const durationHours = Math.max(1, Number(body.durationHours) || 24); // 默认 24 小时
  const allowPermanent = body.allowPermanent === true ? 1 : 0;

  const tokenId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000).toISOString();
  const createdAt = now.toISOString();

  await env.DB.prepare(`
    INSERT INTO upload_tokens (
      id, max_size_bytes, used_size_bytes, allow_permanent, status, expires_at, created_at
    ) VALUES (?, ?, 0, ?, 'active', ?, ?);
  `).bind(tokenId, maxSizeBytes, allowPermanent, expiresAt, createdAt).run();

  const url = new URL(request.url);
  const uploadUrl = `${url.origin}/upload?token=${tokenId}`;

  return Response.json({
    success: true,
    data: {
      tokenId,
      uploadUrl,
      maxSizeBytes,
      allowPermanent: allowPermanent === 1,
      expiresAt,
      createdAt,
    }
  } satisfies ApiResponse);
}

/**
 * 撤销或作废上传 Token (DELETE /api/admin/tokens/:id)
 */
export async function handleAdminRevokeToken(
  request: Request,
  env: Env,
  tokenId: string
): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ success: false, error: '未授权访问' } satisfies ApiResponse, { status: 401 });
  }

  await env.DB.prepare(`
    UPDATE upload_tokens SET status = 'expired' WHERE id = ?;
  `).bind(tokenId).run();

  return Response.json({
    success: true,
    message: '该上传凭证已成功作废喵',
  } satisfies ApiResponse);
}

/**
 * 重新校准存储总量 (POST /api/admin/recalibrate)
 */
export async function handleAdminRecalibrate(request: Request, env: Env): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ success: false, error: '未授权访问' } satisfies ApiResponse, { status: 401 });
  }

  const bytes = await recalculateStorageBytes(env.DB);
  return Response.json({
    success: true,
    message: `校准完成，当前未清理文件总占用为 ${(bytes / 1024 / 1024).toFixed(2)} MB 喵`,
    data: { totalBytes: bytes },
  } satisfies ApiResponse);
}
