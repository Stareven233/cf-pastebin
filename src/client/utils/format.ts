/**
 * 前端通用格式化与交互工具函数
 */

/**
 * 格式化字节为易读格式 (B, KB, MB, GB)
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * 格式化 ISO 日期时间字符串为本地时间
 */
export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return '永久有效';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '无效时间';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 计算剩余有效倒计时描述
 */
export function formatRemainingTime(expiresAtIso?: string | null): string {
  if (!expiresAtIso) return '永久不过期';
  const target = new Date(expiresAtIso).getTime();
  const now = Date.now();
  const diff = target - now;

  if (diff <= 0) return '已过期';

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} 天 ${hours % 24} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes % 60} 分钟`;
  }
  if (minutes > 0) {
    return `${minutes} 分钟 ${seconds % 60} 秒`;
  }
  return `${seconds} 秒后过期`;
}

/**
 * 复制文本到系统剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // 降级方案
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    textArea.remove();
    return successful;
  } catch (err) {
    console.error('Copy to clipboard failed:', err);
    return false;
  }
}
