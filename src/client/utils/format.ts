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

/**
 * 常见代码与文本文件扩展名集合
 */
const CODE_AND_TEXT_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'json5',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'py', 'pyw', 'java', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'cs',
  'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'scala', 'r', 'dart', 'lua',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'md', 'markdown', 'txt',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'xml', 'svg', 'env', 'dockerfile',
  'makefile', 'cmake', 'log', 'csv', 'tsv', 'diff', 'patch'
]);

/**
 * 常见特殊纯文本文件名集合 (无后缀或以点开头)
 */
const SPECIAL_TEXT_FILENAMES = new Set([
  'dockerfile', 'makefile', 'cmakelists.txt', 'license', 'readme',
  'gemfile', 'procfile', 'vagrantfile', '.gitignore', '.env', '.dockerignore'
]);

/**
 * 最大支持在线加载预览的代码文件体积：2MB
 */
export const MAX_CODE_PREVIEW_SIZE = 2 * 1024 * 1024;

/**
 * 智能判定某个文件是否为代码或纯文本文件 (支持在线高亮预览)
 */
export function isCodeOrTextFile(filename: string, mimeType?: string, sizeBytes?: number): boolean {
  if (sizeBytes !== undefined && sizeBytes > MAX_CODE_PREVIEW_SIZE) {
    return false;
  }

  const lowerName = filename.toLowerCase();

  // 1. 特殊文本文件名判定
  if (SPECIAL_TEXT_FILENAMES.has(lowerName)) {
    return true;
  }

  // 2. 文件扩展名后缀判定
  const parts = lowerName.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()!;
    if (CODE_AND_TEXT_EXTENSIONS.has(ext)) {
      return true;
    }
  }

  // 3. MIME 类型判定
  if (mimeType) {
    const lowerMime = mimeType.toLowerCase();
    if (
      lowerMime.startsWith('text/') ||
      lowerMime.includes('json') ||
      lowerMime.includes('javascript') ||
      lowerMime.includes('typescript') ||
      lowerMime.includes('xml') ||
      lowerMime.includes('yaml')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 根据文件名获取可读的代码语言标识 (如 JavaScript, Python, Markdown 等)
 */
export function getFileLanguageLabel(filename: string): string {
  const lowerName = filename.toLowerCase();
  const ext = lowerName.split('.').pop() || '';

  const languageMap: Record<string, string> = {
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    ts: 'TypeScript',
    tsx: 'TypeScript JSX',
    jsx: 'React JSX',
    json: 'JSON',
    json5: 'JSON5',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sass: 'Sass',
    less: 'Less',
    vue: 'Vue',
    svelte: 'Svelte',
    py: 'Python',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    h: 'C Header',
    hpp: 'C++ Header',
    cs: 'C#',
    go: 'Go',
    rs: 'Rust',
    php: 'PHP',
    rb: 'Ruby',
    swift: 'Swift',
    kt: 'Kotlin',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Bash',
    ps1: 'PowerShell',
    md: 'Markdown',
    txt: 'Plain Text',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    svg: 'SVG Vector',
    dockerfile: 'Dockerfile',
  };

  return languageMap[ext] || (ext ? ext.toUpperCase() : 'Code');
}
