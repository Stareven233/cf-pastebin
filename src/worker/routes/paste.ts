/**
 * 分享详情查询与落地页数据接口 (GET /api/paste/:slug)
 */

import { isCircuitBroken } from '../metrics';
import { deletePastePermanently } from '../cron';
import { verifyAdminSession } from '../auth';
import type { Env } from '../db';
import type { ApiResponse, PublicPasteView } from '../../shared/types';

/**
 * 获取分享落地页数据 (支持文本高亮、音频在线播放与文件信息)
 */
export async function handleGetPaste(
  request: Request,
  env: Env,
  slug: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const isAdmin = await verifyAdminSession(request, env);

  // 1. 非管理员访问时，进行 95% 熔断拦截检测
  if (!isAdmin) {
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
      error: '该分享链接不存在或已被删除'
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

  // 5. 累加落地页浏览次数 (非管理员访问时)
  if (!isAdmin) {
    await env.DB.prepare(`
      UPDATE pastes SET view_count = view_count + 1 WHERE id = ?;
    `).bind(paste.id).run();
  }

  const files = (filesRows.results || []).map(f => {
    const isAudio = f.mime_type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(f.filename);

    return {
      id: f.id,
      filename: f.filename,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      downloadUrl: `/d/${paste.slug}/${f.id}`,
      isAudio,
    };
  });

  const viewData: PublicPasteView = {
    id: paste.id,
    slug: paste.slug,
    type: paste.type,
    title: paste.title,
    textContent: paste.text_content,
    files,
    totalSizeBytes: paste.total_size_bytes,
    burnAfterRead: paste.burn_after_read === 1,
    viewCount: paste.view_count + (isAdmin ? 0 : 1),
    downloadCount: paste.download_count,
    expiresAt: paste.expires_at,
    createdAt: paste.created_at,
    isExpired: false,
  };

  return Response.json({
    success: true,
    data: viewData,
  } satisfies ApiResponse<PublicPasteView>);
}
