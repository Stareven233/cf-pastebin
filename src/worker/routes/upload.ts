/**
 * 文件与文本上传相关 API 路由处理
 */

import { MAX_SINGLE_FILE_SIZE } from '../../shared/constants';
import { isCircuitBroken, adjustStorageBytes, incrementMetric } from '../metrics';
import { verifyAdminSession } from '../auth';
import { generateUniqueSlug } from '../slug';
import type { Env } from '../db';
import type { ApiResponse } from '../../shared/types';

/**
 * 校验并获取 Token 状态信息 (GET /api/upload/token-info?token=xxx)
 */
export async function handleGetTokenInfo(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return Response.json({ success: false, error: '缺少上传凭证 Token' } satisfies ApiResponse, { status: 400 });
  }

  // 1. 检查全站额度是否处于 95% 熔断状态
  const circuit = await isCircuitBroken(env.DB);
  if (circuit.broken) {
    return Response.json({
      success: false,
      code: 'CIRCUIT_BROKEN',
      error: `服务保护已触发：${circuit.reason}`
    } satisfies ApiResponse, { status: 503 });
  }

  // 2. 查询 Token 记录
  const row = await env.DB.prepare(`
    SELECT id, max_size_bytes, used_size_bytes, allow_permanent, status, expires_at
    FROM upload_tokens
    WHERE id = ?;
  `).bind(token).first<{
    id: string;
    max_size_bytes: number;
    used_size_bytes: number;
    allow_permanent: number;
    status: string;
    expires_at: string;
  }>();

  if (!row) {
    return Response.json({ success: false, error: '上传凭证不存在或无效' } satisfies ApiResponse, { status: 404 });
  }

  if (row.status === 'used') {
    return Response.json({ success: false, error: '此上传凭证已被使用并作废' } satisfies ApiResponse, { status: 410 });
  }

  if (row.status === 'expired' || new Date(row.expires_at).getTime() < Date.now()) {
    // 标记为过期
    await env.DB.prepare(`UPDATE upload_tokens SET status = 'expired' WHERE id = ?;`).bind(token).run();
    return Response.json({ success: false, error: '此上传凭证已过期' } satisfies ApiResponse, { status: 410 });
  }

  const remainingBytes = Math.max(0, row.max_size_bytes - (row.used_size_bytes || 0));

  return Response.json({
    success: true,
    data: {
      tokenId: row.id,
      maxSizeBytes: row.max_size_bytes,
      usedSizeBytes: row.used_size_bytes,
      remainingBytes,
      allowPermanent: row.allow_permanent === 1,
      expiresAt: row.expires_at,
    }
  } satisfies ApiResponse);
}

/**
 * 二进制文件流式直接存入 R2 (POST /api/upload/direct)
 * 客户端带平滑进度条直接上送数据流
 */
export async function handleDirectFileUpload(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const filename = decodeURIComponent(url.searchParams.get('filename') || 'untitled.bin');
  const sizeParam = parseInt(url.searchParams.get('size') || '0', 10);
  const mimeType = request.headers.get('content-type') || 'application/octet-stream';

  // 1. 熔断检查
  const circuit = await isCircuitBroken(env.DB);
  if (circuit.broken) {
    return Response.json({
      success: false,
      code: 'CIRCUIT_BROKEN',
      error: `免费额度保护生效中：${circuit.reason}`
    } satisfies ApiResponse, { status: 503 });
  }

  // 2. 鉴权：优先 Token 消费模式（无论客户端是否已登录管理员，带 Token 均优先校验并核验配额）
  let tokenInfo: { id: string; max_size_bytes: number; used_size_bytes: number } | null = null;

  if (token) {
    const row = await env.DB.prepare(`
      SELECT id, max_size_bytes, used_size_bytes, status, expires_at
      FROM upload_tokens
      WHERE id = ?;
    `).bind(token).first<{
      id: string;
      max_size_bytes: number;
      used_size_bytes: number;
      status: string;
      expires_at: string;
    }>();

    if (!row) {
      return Response.json({ success: false, error: '上传凭证不存在或无效' } satisfies ApiResponse, { status: 404 });
    }

    if (row.status === 'used') {
      return Response.json({ success: false, error: '此上传凭证已被使用并作废' } satisfies ApiResponse, { status: 410 });
    }

    if (row.status === 'expired' || new Date(row.expires_at).getTime() < Date.now()) {
      await env.DB.prepare(`UPDATE upload_tokens SET status = 'expired' WHERE id = ?;`).bind(token).run();
      return Response.json({ success: false, error: '此上传凭证已过期' } satisfies ApiResponse, { status: 410 });
    }

    tokenInfo = row;
  } else {
    // 未携带 Token 时，必须为合法管理员自用通道
    const isAdmin = await verifyAdminSession(request, env);
    if (!isAdmin) {
      return Response.json({ success: false, error: '无上传权限，缺少 Token 凭证' } satisfies ApiResponse, { status: 401 });
    }
  }

  // 3. 单文件大小上限校验 (<= 25MB)
  if (sizeParam > MAX_SINGLE_FILE_SIZE) {
    return Response.json({
      success: false,
      error: `单个文件大小不得超过 25MB (当前为 ${(sizeParam / (1024 * 1024)).toFixed(2)} MB)`
    } satisfies ApiResponse, { status: 400 });
  }

  // 4. Token 配额校验
  if (tokenInfo && (sizeParam > tokenInfo.max_size_bytes)) {
    return Response.json({
      success: false,
      error: `文件大小超出了此 Token 允许的最大配额 (${(tokenInfo.max_size_bytes / (1024 * 1024)).toFixed(2)} MB)`
    } satisfies ApiResponse, { status: 400 });
  }

  // 5. 将二进制流直接写入 R2
  const fileId = crypto.randomUUID();
  const safeFilename = filename.replace(/[^\w\u4e00-\u9fa5\.\-\_\s]/g, '_');
  const r2Key = `files/${fileId}/${safeFilename}`;

  if (!request.body) {
    return Response.json({ success: false, error: '上传内容为空' } satisfies ApiResponse, { status: 400 });
  }

  try {
    await env.R2.put(r2Key, request.body, {
      httpMetadata: {
        contentType: mimeType,
      },
      customMetadata: {
        originalFilename: encodeURIComponent(filename),
        uploadedAt: new Date().toISOString(),
      }
    });

    // 记录 R2 Class A 写入操作
    await incrementMetric(env.DB, 'r2_class_a_month', 1);

    return Response.json({
      success: true,
      data: {
        fileId,
        r2Key,
        filename,
        mimeType,
        sizeBytes: sizeParam,
      }
    } satisfies ApiResponse);
  } catch (err: any) {
    console.error('Failed to put file into R2:', err);
    return Response.json({
      success: false,
      error: `文件写入存储桶失败: ${err.message || '未知错误'}`
    } satisfies ApiResponse, { status: 500 });
  }
}

/**
 * 完成并提交分享生成短链 (POST /api/upload/complete)
 * 将暂存的文件和文本元数据写入 D1，并作废一次性 Token
 */
export async function handleCompleteUpload(request: Request, env: Env): Promise<Response> {
  // 1. 熔断检查
  const circuit = await isCircuitBroken(env.DB);
  if (circuit.broken) {
    return Response.json({
      success: false,
      code: 'CIRCUIT_BROKEN',
      error: `免费额度保护生效中：${circuit.reason}`
    } satisfies ApiResponse, { status: 503 });
  }

  let body: {
    token?: string;
    title?: string;
    textContent?: string;
    files?: Array<{ r2Key: string; filename: string; mimeType: string; sizeBytes: number }>;
    slugLength?: 4 | 8 | 16;
    durationSeconds?: number;
    burnAfterRead?: boolean;
    isPermanent?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '请求数据格式错误' } satisfies ApiResponse, { status: 400 });
  }

  const {
    token,
    title = '',
    textContent = '',
    files = [],
    slugLength = 4,
    durationSeconds = 86400, // 默认 1 天
    burnAfterRead = false,
    isPermanent = false,
  } = body;

  // 必须至少包含文件或文本
  if (files.length === 0 && (!textContent || textContent.trim().length === 0)) {
    return Response.json({ success: false, error: '请至少添加一个文件或输入一段文本内容' } satisfies ApiResponse, { status: 400 });
  }

  let tokenId: string | null = null;
  let canBePermanent = false;
  let tokenConsumedBytes = 0;

  // 2. 鉴权与 Token 状态核查：优先消费 Token（即使客户端带有管理员 Cookie，也必须严格核验并核销 Token）
  if (token) {
    const tokenRow = await env.DB.prepare(`
      SELECT id, max_size_bytes, allow_permanent, status, expires_at
      FROM upload_tokens
      WHERE id = ?;
    `).bind(token).first<{
      id: string;
      max_size_bytes: number;
      allow_permanent: number;
      status: string;
      expires_at: string;
    }>();

    if (!tokenRow) {
      return Response.json({ success: false, error: '上传凭证不存在或无效' } satisfies ApiResponse, { status: 404 });
    }

    if (tokenRow.status === 'used') {
      return Response.json({ success: false, error: '此上传凭证已被使用并作废' } satisfies ApiResponse, { status: 410 });
    }

    if (tokenRow.status === 'expired' || new Date(tokenRow.expires_at).getTime() < Date.now()) {
      await env.DB.prepare(`UPDATE upload_tokens SET status = 'expired' WHERE id = ?;`).bind(token).run();
      return Response.json({ success: false, error: '此上传凭证已过期' } satisfies ApiResponse, { status: 410 });
    }

    // 计算总消耗容量：包括文件总大小和纯文本 UTF-8 字节长度（缺陷 4 修复）
    const totalFilesSize = files.reduce((acc, cur) => acc + (cur.sizeBytes || 0), 0);
    const textSizeBytes = textContent ? new TextEncoder().encode(textContent.trim()).length : 0;
    tokenConsumedBytes = totalFilesSize + textSizeBytes;

    if (tokenConsumedBytes > tokenRow.max_size_bytes) {
      return Response.json({
        success: false,
        error: `上传内容总大小 (${(tokenConsumedBytes / 1024 / 1024).toFixed(2)} MB) 超出了该凭证允许的最大配额 (${(tokenRow.max_size_bytes / 1024 / 1024).toFixed(2)} MB)`
      } satisfies ApiResponse, { status: 400 });
    }

    tokenId = tokenRow.id;
    canBePermanent = tokenRow.allow_permanent === 1;
  } else {
    // 未带 Token 模式：校验管理员会话
    const isAdmin = await verifyAdminSession(request, env);
    if (!isAdmin) {
      return Response.json({ success: false, error: '缺少有效的上传 Token 凭证' } satisfies ApiResponse, { status: 401 });
    }
    canBePermanent = true;
    tokenId = null;
  }

  // 3. 计算过期时间
  let expiresAtIso: string | null = null;
  if (isPermanent && canBePermanent) {
    expiresAtIso = null;
  } else {
    const validDuration = Math.max(60, Number(durationSeconds) || 86400);
    expiresAtIso = new Date(Date.now() + validDuration * 1000).toISOString();
  }

  // 4. 生成唯一短链 Slug
  const length = [4, 8, 16].includes(slugLength) ? slugLength : 4;
  const slug = await generateUniqueSlug(env.DB, length as 4 | 8 | 16);

  // 5. 判定分享形态
  let pasteType: 'text' | 'single_file' | 'multi_file' = 'text';
  if (files.length === 1 && (!textContent || textContent.trim().length === 0)) {
    pasteType = 'single_file';
  } else if (files.length > 0) {
    pasteType = 'multi_file';
  }

  const pasteId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const totalSizeBytes = files.reduce((acc, cur) => acc + (cur.sizeBytes || 0), 0);

  // 6. 事务性入库 (写入 pastes 表、文件表、累计存储字节、失效 Token)
  const statements: D1PreparedStatement[] = [];

  // 插入 paste 主记录
  statements.push(
    env.DB.prepare(`
      INSERT INTO pastes (
        id, slug, type, title, text_content, total_size_bytes,
        burn_after_read, view_count, download_count, expires_at,
        created_at, created_by_token, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 0);
    `).bind(
      pasteId,
      slug,
      pasteType,
      title || (files.length === 1 ? files[0].filename : (pasteType === 'text' ? '文本分享' : '文件分享')),
      textContent ? textContent.trim() : null,
      totalSizeBytes,
      burnAfterRead ? 1 : 0,
      expiresAtIso,
      nowIso,
      tokenId || 'admin'
    )
  );

  // 插入文件详情记录
  for (const f of files) {
    const fileRecordId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(`
        INSERT INTO paste_files (id, paste_id, r2_key, filename, mime_type, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `).bind(
        fileRecordId,
        pasteId,
        f.r2Key,
        f.filename,
        f.mimeType || 'application/octet-stream',
        f.sizeBytes,
        nowIso
      )
    );
  }

  // 作废一次性 Token (状态设为 used，记录实际消耗总容量：文件 + 文本)
  if (tokenId) {
    statements.push(
      env.DB.prepare(`
        UPDATE upload_tokens
        SET status = 'used', used_size_bytes = ?
        WHERE id = ?;
      `).bind(tokenConsumedBytes, tokenId)
    );
  }

  await env.DB.batch(statements);

  // 7. 累加 R2 存储总占用
  if (totalSizeBytes > 0) {
    await adjustStorageBytes(env.DB, totalSizeBytes);
  }

  return Response.json({
    success: true,
    data: {
      pasteId,
      slug,
      shareUrl: `/s/${slug}`,
      directUrl: `/d/${slug}`,
      expiresAt: expiresAtIso,
      burnAfterRead: !!burnAfterRead,
    }
  } satisfies ApiResponse);
}
