/**
 * 全局统一的 MIME 类型映射与文件媒体类型推断工具
 */

// 常见音频文件后缀与规范 MIME 映射表
const AUDIO_MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  weba: 'audio/webm',
  webm: 'audio/webm',
  mid: 'audio/midi',
  midi: 'audio/midi',
  wma: 'audio/x-ms-wma',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  mp4a: 'audio/mp4',
};

// 常见视频文件后缀与规范 MIME 映射表
const VIDEO_MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
};

// 常见图片文件后缀与规范 MIME 映射表
const IMAGE_MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

// 常见代码/文本文件后缀与规范 MIME 映射表
const TEXT_MIME_MAP: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  json5: 'application/json',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  csv: 'text/csv',
  pdf: 'application/pdf',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

/**
 * 根据文件名扩展名和可能已存在的原始 MIME，推导最准确规范的 MIME 媒体类型
 * 彻底解决操作系统（如 Windows）上传 flac/ogg/opus/m4a 等媒体时缺失系统 MIME 导致 application/octet-stream 的问题
 */
export function getMimeType(filename: string, fallbackMime?: string | null): string {
  const parts = filename.toLowerCase().split('.');
  const ext = parts.length > 1 ? parts.pop()! : '';

  if (ext) {
    if (AUDIO_MIME_MAP[ext]) return AUDIO_MIME_MAP[ext];
    if (VIDEO_MIME_MAP[ext]) return VIDEO_MIME_MAP[ext];
    if (IMAGE_MIME_MAP[ext]) return IMAGE_MIME_MAP[ext];
    if (TEXT_MIME_MAP[ext]) return TEXT_MIME_MAP[ext];
  }

  if (fallbackMime && fallbackMime !== 'application/octet-stream' && fallbackMime.trim() !== '') {
    return fallbackMime;
  }

  return 'application/octet-stream';
}

/**
 * 判断是否为受支持的音频文件（供落地页专属播放器渲染）
 */
export function isAudioFile(filename: string, mimeType?: string | null): boolean {
  if (mimeType && mimeType.startsWith('audio/')) {
    return true;
  }
  const resolved = getMimeType(filename, mimeType);
  if (resolved.startsWith('audio/')) {
    return true;
  }
  return /\.(mp3|wav|wave|ogg|oga|opus|flac|m4a|aac|weba|mid|midi|wma|aif|aiff)$/i.test(filename);
}
