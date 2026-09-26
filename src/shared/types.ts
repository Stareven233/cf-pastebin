/**
 * 前后端通用类型定义与数据结构
 */

// 系统额度指标项定义
export interface SystemMetricRecord {
  key: string;
  value: number;
  period_key: string | null;
  updated_at: string;
}

// 额度监控概览
export interface QuotaOverview {
  storage: {
    usedBytes: number;
    maxBytes: number;
    percent: number;
    isWarning: boolean; // >= 80%
    isCritical: boolean; // >= 95%
  };
  r2ClassA: {
    used: number;
    max: number;
    percent: number;
    isWarning: boolean;
    isCritical: boolean;
  };
  r2ClassB: {
    used: number;
    max: number;
    percent: number;
    isWarning: boolean;
    isCritical: boolean;
  };
  workerReqs: {
    used: number;
    max: number;
    percent: number;
    isWarning: boolean;
    isCritical: boolean;
  };
  status: 'normal' | 'warning' | 'circuit_broken';
  brokenReason?: string;
}

// 一次性上传 Token 实体
export interface UploadToken {
  id: string;
  max_size_bytes: number;
  used_size_bytes: number;
  allow_permanent: number;
  status: 'active' | 'used' | 'expired';
  expires_at: string;
  created_at: string;
}

// 单个上传文件详情
export interface PasteFileItem {
  id: string;
  paste_id: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

// 分享主体实体 (数据库记录)
export interface PasteEntity {
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
  created_by_token: string | null;
  is_deleted: number;
}

// 落地页向访客公开的分享视图数据
export interface PublicPasteView {
  id: string;
  slug: string;
  type: 'text' | 'single_file' | 'multi_file';
  title: string | null;
  textContent?: string | null;
  files: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string;
    isAudio: boolean;
  }>;
  totalSizeBytes: number;
  burnAfterRead: boolean;
  viewCount: number;
  downloadCount: number;
  expiresAt: string | null;
  createdAt: string;
  isExpired: boolean;
}

// 管理员视图下的分享列表项
export interface AdminPasteListItem extends PasteEntity {
  files: PasteFileItem[];
}

// 统一标准 API 响应格式
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}
