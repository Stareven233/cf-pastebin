/**
 * 直链下载与多媒体音频流传输处理 (GET /d/:slug 和 GET /d/:slug/:fileId)
 */

import { incrementMetric, isCircuitBroken } from '../metrics';
import { deletePastePermanently } from '../cron';
import { verifyAdminSession, verifyReadToken } from '../auth';
import type { Env } from '../db';

/**
 * 处理文件与文本直链下载 / 音频流播放
 * 方案B：管理特权预览带 ?admin_preview=1 时不触发计数与销毁；公共下载正常统计，且支持阅后即焚凭证校验与销毁
 */
export async function handleDownloadFile(
  request: Request,
  env: Env,
  slug: string,
  fileId?: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const isInline = url.searchParams.get('inline') === '1';
  const isRaw = url.searchParams.get('raw') === '1';
  const isAdminPreview = url.searchParams.get('admin_preview') === '1';
  const isAdmin = await verifyAdminSession(request, env);
  const isAuthorizedAdminPreview = isAdmin && isAdminPreview;

  // 1. 非管理员特权预览时执行熔断检查
  if (!isAuthorizedAdminPreview) {
    const circuit = await isCircuitBroken(env.DB);
    if (circuit.broken) {
      return new Response(`503 额度保护停服中: ${circuit.reason}`, { status: 503 });
    }
  }

  // 2. 查询主分享记录
  const paste = await env.DB.prepare(`
    SELECT id, slug, type, title, text_content, burn_after_read, expires_at, is_deleted
    FROM pastes
    WHERE slug = ?;
  `).bind(slug).first<{
    id: string;
    slug: string;
    type: 'text' | 'single_file' | 'multi_file';
    title: string | null;
    text_content: string | null;
    burn_after_read: number;
    expires_at: string | null;
    is_deleted: number;
  }>();

  if (!paste) {
    return new Response('404 该分享不存在或已过期销毁', { status: 404 });
  }

  // 如果主记录已被标记软删除 (如阅后即焚落地页已被首次阅读访问)
  if (paste.is_deleted === 1) {
    // 验证是否携带由落地页首次安全签发的 read_token 临时读取凭证
    const readToken = url.searchParams.get('read_token');
    const secret = env.SESSION_SECRET || 'cf-pastebin-default-secret-change-in-prod';
    const isTokenValid = readToken && await verifyReadToken(readToken, paste.id, paste.slug, secret);

    if (!isTokenValid) {
      return new Response('404 该分享已被阅读焚毁或已失效', { status: 404 });
    }
  }

  // 3. 检查过期状态
  if (paste.expires_at && new Date(paste.expires_at).getTime() <= Date.now()) {
    if (ctx) {
      ctx.waitUntil(deletePastePermanently(env.DB, env.R2, paste.id));
    } else {
      await deletePastePermanently(env.DB, env.R2, paste.id);
    }
    return new Response('410 分享内容已超期销毁', { status: 410 });
  }

  // 4. 纯文本直出 (若为文本类型或请求带 ?raw=1)
  if (paste.type === 'text' || (isRaw && paste.text_content)) {
    // 累加下载次数 (非管理员特权预览时真实累加)
    if (!isAuthorizedAdminPreview) {
      await env.DB.prepare(`UPDATE pastes SET download_count = download_count + 1 WHERE id = ?;`).bind(paste.id).run();
      // 若为阅后即焚，在访客直链读取后立即彻底销毁
      if (paste.burn_after_read === 1) {
        if (ctx) ctx.waitUntil(deletePastePermanently(env.DB, env.R2, paste.id));
        else await deletePastePermanently(env.DB, env.R2, paste.id);
      }
    }

    return new Response(paste.text_content || '', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    });
  }

  // 5. 文件下载/流式传输
  let fileRecord: {
    id: string;
    r2_key: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  } | null = null;

  if (fileId) {
    // 按指定 fileId 精准查找
    fileRecord = await env.DB.prepare(`
      SELECT id, r2_key, filename, mime_type, size_bytes
      FROM paste_files
      WHERE paste_id = ? AND id = ?;
    `).bind(paste.id, fileId).first();
  } else {
    // 单文件模式默认取第一条记录
    fileRecord = await env.DB.prepare(`
      SELECT id, r2_key, filename, mime_type, size_bytes
      FROM paste_files
      WHERE paste_id = ?
      LIMIT 1;
    `).bind(paste.id).first();
  }

  if (!fileRecord) {
    return new Response('404 未找到对应的关联文件', { status: 404 });
  }

  // 6. 从 R2 提取对象
  const r2Object = await env.R2.get(fileRecord.r2_key);
  if (!r2Object) {
    return new Response('404 存储对象不存在或已被清理', { status: 404 });
  }

  // 记录 R2 Class B 读取操作
  await incrementMetric(env.DB, 'r2_class_b_month', 1);

  // 7. 累加下载计数与阅后即焚销毁处理 (非特权预览时)
  if (!isAuthorizedAdminPreview) {
    await env.DB.prepare(`
      UPDATE pastes SET download_count = download_count + 1 WHERE id = ?;
    `).bind(paste.id).run();

    // 如果设置了阅后即焚，本次下载后异步彻底清理 R2 和 D1 数据
    if (paste.burn_after_read === 1) {
      if (ctx) {
        ctx.waitUntil(deletePastePermanently(env.DB, env.R2, paste.id));
      } else {
        await deletePastePermanently(env.DB, env.R2, paste.id);
      }
    }
  }

  // 8. 构造下载/播放响应头
  const headers = new Headers();
  r2Object.writeHttpMetadata(headers);
  if (fileRecord.mime_type) {
    let contentType = fileRecord.mime_type;
    // 若为内联预览且属于纯文本/代码，确保携带 UTF-8 编码，避免中文注释乱码
    if (isInline && (contentType === 'application/octet-stream' || contentType.startsWith('text/') || contentType.includes('javascript') || contentType.includes('json'))) {
      if (!contentType.includes('charset')) {
        contentType = `${contentType}; charset=utf-8`;
      }
    }
    headers.set('Content-Type', contentType);
  } else if (isInline) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
  }
  headers.set('etag', r2Object.httpEtag);
  headers.set('Content-Length', String(fileRecord.size_bytes));

  const encodedFilename = encodeURIComponent(fileRecord.filename);
  const dispositionType = isInline ? 'inline' : 'attachment';
  headers.set('Content-Disposition', `${dispositionType}; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);

  if (paste.burn_after_read === 1 || isAuthorizedAdminPreview) {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  } else {
    headers.set('Cache-Control', 'public, max-age=3600');
  }

  return new Response(r2Object.body, { headers });
}
