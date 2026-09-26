/**
 * 前端 API 交互与流式上传封装
 */

import type { ApiResponse, PublicPasteView, QuotaOverview, AdminPasteListItem, UploadToken } from '../../shared/types';

/**
 * 封装通用 Fetch 请求
 */
export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Accept': 'application/json',
        ...(init?.headers || {}),
      },
    });

    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        success: false,
        error: data?.error || `网络请求错误 (状态码: ${res.status})`,
        code: data?.code,
      };
    }

    return data as ApiResponse<T>;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || '网络连接异常，请检查网络喵',
    };
  }
}

/**
 * 流式直传单个二进制文件至 R2 并提供平滑进度条
 */
export function uploadFileWithProgress(
  file: File,
  token?: string,
  onProgress?: (percent: number, loaded: number, total: number) => void
): Promise<{
  fileId: string;
  r2Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const encodedName = encodeURIComponent(file.name);
    const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
    const url = `/api/upload/direct?filename=${encodedName}&size=${file.size}${tokenQuery}`;

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    // 监听原生上传进度
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(percent, event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res: ApiResponse = JSON.parse(xhr.responseText);
          if (res.success && res.data) {
            resolve(res.data);
          } else {
            reject(new Error(res.error || '上传响应解析失败'));
          }
        } catch (e: any) {
          reject(new Error(`响应格式错误: ${e.message}`));
        }
      } else {
        try {
          const errRes = JSON.parse(xhr.responseText);
          reject(new Error(errRes.error || `上传失败 (HTTP ${xhr.status})`));
        } catch {
          reject(new Error(`上传失败 (HTTP ${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('网络传输发生异常'));
    xhr.onabort = () => reject(new Error('上传已取消'));

    // 发送二进制文件
    xhr.send(file);
  });
}

/**
 * 校验并获取 Token 状态
 */
export function apiGetTokenInfo(token: string) {
  return fetchJson<{
    tokenId: string;
    maxSizeBytes: number;
    usedSizeBytes: number;
    remainingBytes: number;
    allowPermanent: boolean;
    expiresAt: string;
  }>(`/api/upload/token-info?token=${encodeURIComponent(token)}`);
}

/**
 * 完成并提交分享生成短链
 */
export function apiCompleteUpload(payload: {
  token?: string;
  title?: string;
  textContent?: string;
  files?: Array<{ r2Key: string; filename: string; mimeType: string; sizeBytes: number }>;
  slugLength?: 4 | 8 | 16;
  durationSeconds?: number;
  burnAfterRead?: boolean;
  isPermanent?: boolean;
}) {
  return fetchJson<{
    pasteId: string;
    slug: string;
    shareUrl: string;
    directUrl: string;
    expiresAt: string | null;
    burnAfterRead: boolean;
  }>('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * 获取分享落地页数据
 */
export function apiGetPaste(slug: string) {
  return fetchJson<PublicPasteView>(`/api/paste/${encodeURIComponent(slug)}`);
}

/**
 * 管理员登录
 */
export function apiAdminLogin(password: string) {
  return fetchJson('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

/**
 * 管理员登出
 */
export function apiAdminLogout() {
  return fetchJson('/api/admin/logout', { method: 'POST' });
}

/**
 * 检查管理员登录状态
 */
export function apiAdminMe() {
  return fetchJson<{ isAdmin: boolean }>('/api/admin/me');
}

/**
 * 获取管理员仪表盘数据
 */
export function apiAdminDashboard() {
  return fetchJson<{
    quota: QuotaOverview;
    stats: {
      totalPastes: number;
      totalFiles: number;
      activeTokens: number;
    };
  }>('/api/admin/dashboard');
}

/**
 * 获取所有分享列表
 */
export function apiAdminListPastes() {
  return fetchJson<AdminPasteListItem[]>('/api/admin/pastes');
}

/**
 * 删除指定分享
 */
export function apiAdminDeletePaste(id: string) {
  return fetchJson(`/api/admin/pastes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * 获取上传 Token 列表
 */
export function apiAdminListTokens() {
  return fetchJson<UploadToken[]>('/api/admin/tokens');
}

/**
 * 创建新上传 Token
 */
export function apiAdminCreateToken(options: {
  maxSizeBytes: number;
  durationHours: number;
  allowPermanent: boolean;
}) {
  return fetchJson<{
    tokenId: string;
    uploadUrl: string;
    maxSizeBytes: number;
    allowPermanent: boolean;
    expiresAt: string;
    createdAt: string;
  }>('/api/admin/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
}

/**
 * 作废上传 Token
 */
export function apiAdminRevokeToken(id: string) {
  return fetchJson(`/api/admin/tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * 重新校准存储总量
 */
export function apiAdminRecalibrate() {
  return fetchJson<{ totalBytes: number }>('/api/admin/recalibrate', {
    method: 'POST',
  });
}
