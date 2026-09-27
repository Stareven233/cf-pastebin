/**
 * 分享详情查询与落地页数据接口 (GET /api/paste/:slug)
 */

import { isCircuitBroken } from '../metrics';
import { deletePastePermanently } from '../cron';
import { verifyAdminSession, signReadToken } from '../auth';
import { getMimeType, isAudioFile } from '../../shared/mime';
import type { Env } from '../db';
import type { ApiResponse, PublicPasteView } from '../../shared/types';

/**
 * 获取分享落地页数据 (支持文本高亮、音频在线播放与文件信息)
 * 支持方案B：管理后台带 ?admin_preview=1 时不触发计数与销毁；公共访问正常计数并在阅后即焚时销毁
 */
export async function handleGetPaste(
  request: Request,
  env: Env,
  slug: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const isAdminPreview = url.searchParams.get('admin_preview') === '1';
  const isAdmin = await verifyAdminSession(request, env);
  const isAuthorizedAdminPreview = isAdmin && isAdminPreview;

  // 1. 非管理员特权预览时，进行 95% 熔断拦截检测
  if (!isAuthorizedAdminPreview) {
    const circuit = await isCircuitBroken(env.DB);
    if (circuit.broken) {
      return Response.json({
        success: false,
        code: 'CIRCUIT_BROKEN',
        error: `服务保护已触发：${circuit.reason}`
      } satisfies ApiResponse, { status: 503 });
    }
  }

  // 2. 根据 Slug 查询 Paste 主记录
  const paste = await env.DB.prepare(`
    SELECT
      id, slug, type, title, text_content, total_size_bytes,
      burn_after_read, view_count, download_count, expires_at,
      created_at, is_deleted
    FROM pastes
    WHERE slug = ?;
  `).bind(slug).first<{
    id: string;
    slug: string;
    type: 'text' | 'single_file' | 'multi_file';
    title: string | null;
    text_content: string | null;
    total_size_bytes: number;
    burn_after_read: number;
    view_count: number;
    download_count: number;
    expires_at: string | null;
    created_at: string;
    is_deleted: number;
  }>();

  if (!paste || paste.is_deleted === 1) {
    return Response.json({
      success: false,
      code: 'NOT_FOUND',
      error: '该分享链接不存在、已被阅后即焚销毁或已过期'
    } satisfies ApiResponse, { status: 404 });
  }

  // 3. 检查是否过期 (惰性过期判定)
  if (paste.expires_at && new Date(paste.expires_at).getTime() <= Date.now()) {
    // 异步触发物理删除
    if (ctx) {
      ctx.waitUntil(deletePastePermanently(env.DB, env.R2, paste.id));
    } else {
      await deletePastePermanently(env.DB, env.R2, paste.id);
    }

    return Response.json({
      success: false,
      code: 'EXPIRED',
      error: '该分享内容已超过有效期限并被自动清理'
    } satisfies ApiResponse, { status: 410 });
  }

  // 4. 查询关联文件列表
  const filesRows = await env.DB.prepare(`
    SELECT id, filename, mime_type, size_bytes
    FROM paste_files
    WHERE paste_id = ?
    ORDER BY created_at ASC;
  `).bind(paste.id).all<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  }>();

  const fileCount = filesRows.results?.length || 0;

  // 5. 阅后即焚凭证签发 (若为阅后即焚且非管理员特权预览，签发 15 分钟临时下载凭据)
  const secret = env.SESSION_SECRET || 'cf-pastebin-default-secret-change-in-prod';
  let readToken: string | null = null;
  if (paste.burn_after_read === 1 && !isAuthorizedAdminPreview) {
    readToken = await signReadToken(paste.id, paste.slug, secret);
  }

  // 6. 累加浏览次数与阅后即焚标记 (方案B：非特权预览时正常计数并销毁)
  if (!isAuthorizedAdminPreview) {
    await env.DB.prepare(`
      UPDATE pastes SET view_count = view_count + 1 WHERE id = ?;
    `).bind(paste.id).run();

    if (paste.burn_after_read === 1) {
      // 立即标记软删除：确保页面刷新或二次打开立即返回 404 (阅后即焚)
      await env.DB.prepare(`
        UPDATE pastes SET is_deleted = 1 WHERE id = ?;
      `).bind(paste.id).run();

      // 若为纯文本且无任何关联文件，直接在后台排队彻底物理销毁
      if (paste.type === 'text' || fileCount === 0) {
        if (ctx) {
          ctx.waitUntil(deletePastePermanently(env.DB, env.R2, paste.id));
        } else {
          await deletePastePermanently(env.DB, env.R2, paste.id);
        }
      }
    }
  }

  // 7. 组装文件下载与流媒体链接 (带上 read_token 或 admin_preview 授权标记)
  const files = (filesRows.results || []).map(f => {
    const resolvedMime = getMimeType(f.filename, f.mime_type);
    const isAudio = isAudioFile(f.filename, resolvedMime);

    let downloadUrl = `/d/${paste.slug}/${f.id}`;
    if (isAuthorizedAdminPreview) {
      downloadUrl += '?admin_preview=1';
    } else if (readToken) {
      downloadUrl += `?read_token=${encodeURIComponent(readToken)}`;
    }

    return {
      id: f.id,
      filename: f.filename,
      mimeType: resolvedMime,
      sizeBytes: f.size_bytes,
      downloadUrl,
      isAudio,
    };
  });

  let rawUrl = `/d/${paste.slug}?raw=1`;
  if (isAuthorizedAdminPreview) {
    rawUrl += '&admin_preview=1';
  } else if (readToken) {
    rawUrl += `&read_token=${encodeURIComponent(readToken)}`;
  }

  const viewData: PublicPasteView = {
    id: paste.id,
    slug: paste.slug,
    type: paste.type,
    title: paste.title,
    textContent: paste.text_content,
    files,
    totalSizeBytes: paste.total_size_bytes,
    burnAfterRead: paste.burn_after_read === 1,
    viewCount: paste.view_count + (isAuthorizedAdminPreview ? 0 : 1),
    downloadCount: paste.download_count,
    expiresAt: paste.expires_at,
    createdAt: paste.created_at,
    isExpired: false,
    rawUrl,
    isAdminPreview: isAuthorizedAdminPreview,
  };

  const responseHeaders: Record<string, string> = {};
  if (paste.burn_after_read === 1) {
    responseHeaders['Cache-Control'] = 'no-store, no-cache, must-revalidate';
  }

  return Response.json({
    success: true,
    data: viewData,
  } satisfies ApiResponse<PublicPasteView>, {
    headers: responseHeaders,
  });
}
