/**
 * 管理员后台工作台页面 (/admin)
 * 包含：安全认证登录、免费配额实时仪表盘、主人自用自由上传区、全量分享查阅与物理删除、一次性 Token 派发与作废
 */

import { createSignal, onMount, Show, For, createMemo } from 'solid-js';
import {
  apiAdminLogin,
  apiAdminLogout,
  apiAdminMe,
  apiAdminDashboard,
  apiAdminListPastes,
  apiAdminDeletePaste,
  apiAdminListTokens,
  apiAdminCreateToken,
  apiAdminRevokeToken,
  apiAdminRecalibrate,
  uploadFileWithProgress,
  apiCompleteUpload,
} from '../utils/api';
import { formatBytes, formatDateTime, formatRemainingTime, copyToClipboard } from '../utils/format';
import { QuotaGauge } from '../components/QuotaGauge';
import { showToast } from '../components/Toast';
import { MAX_SINGLE_FILE_SIZE, MAX_ADMIN_FILE_SIZE, EXPIRATION_PRESETS } from '../../shared/constants';
import type { QuotaOverview, AdminPasteListItem, UploadToken } from '../../shared/types';

// 管理员自用上传队列项类型
interface AdminPendingFile {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
}

export function AdminPage() {
  // 认证状态
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [isCheckingAuth, setIsCheckingAuth] = createSignal(true);
  const [passwordInput, setPasswordInput] = createSignal('');
  const [isLoggingIn, setIsLoggingIn] = createSignal(false);
  const [loginError, setLoginError] = createSignal<string | null>(null);

  // Tab 选项卡：'dashboard' (仪表盘与自用上传) | 'pastes' (分享查删) | 'tokens' (Token派发)
  const [activeTab, setActiveTab] = createSignal<'dashboard' | 'pastes' | 'tokens'>('dashboard');

  // 仪表盘数据
  const [dashboardData, setDashboardData] = createSignal<{
    quota: QuotaOverview;
    stats: { totalPastes: number; totalFiles: number; activeTokens: number };
  } | null>(null);

  // 分享列表数据
  const [pastesList, setPastesList] = createSignal<AdminPasteListItem[]>([]);
  const [isLoadingPastes, setIsLoadingPastes] = createSignal(false);
  const [pasteSearchQuery, setPasteSearchQuery] = createSignal('');

  // Token 列表数据
  const [tokensList, setTokensList] = createSignal<UploadToken[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = createSignal(false);

  // 新建 Token 表单
  const [newTokenQuotaMB, setNewTokenQuotaMB] = createSignal(25);
  const [newTokenHours, setNewTokenHours] = createSignal(24);
  const [newTokenAllowPermanent, setNewTokenAllowPermanent] = createSignal(false);
  const [createdTokenUrl, setCreatedTokenUrl] = createSignal<string | null>(null);
  const [isCreatingToken, setIsCreatingToken] = createSignal(false);

  // 管理员自用上传面板状态 (缺陷 1 升级：支持多文件追加、拖拽、单项删除与进度追踪)
  const [adminFiles, setAdminFiles] = createSignal<AdminPendingFile[]>([]);
  const [adminTitle, setAdminTitle] = createSignal('');
  const [adminText, setAdminText] = createSignal('');
  const [adminSlugLen, setAdminSlugLen] = createSignal<4 | 8 | 16>(4);
  const [adminDuration, setAdminDuration] = createSignal(86400);
  const [adminPermanent, setAdminPermanent] = createSignal(false);
  const [adminBurn, setAdminBurn] = createSignal(false);
  const [isAdminUploading, setIsAdminUploading] = createSignal(false);
  const [adminUploadProgress, setAdminUploadProgress] = createSignal(0);
  const [adminCurrentStepText, setAdminCurrentStepText] = createSignal('');
  const [adminCreatedResult, setAdminCreatedResult] = createSignal<{
    slug: string;
    shareUrl: string;
    directUrl: string;
  } | null>(null);

  // 计算管理员待上传文件的总字节大小
  const adminTotalFilesSizeBytes = createMemo(() => {
    return adminFiles().reduce((acc, cur) => acc + cur.size, 0);
  });

  // 检查管理员身份
  const checkAuth = async () => {
    setIsCheckingAuth(true);
    const res = await apiAdminMe();
    setIsCheckingAuth(false);
    if (res.success && res.data?.isAdmin) {
      setIsAdmin(true);
      loadDashboard();
      loadPastes();
      loadTokens();
    } else {
      setIsAdmin(false);
    }
  };

  onMount(() => {
    checkAuth();
  });

  // 登录动作
  const handleLogin = async (e: Event) => {
    e.preventDefault();
    if (!passwordInput()) return;
    setIsLoggingIn(true);
    setLoginError(null);

    const res = await apiAdminLogin(passwordInput());
    setIsLoggingIn(false);

    if (res.success) {
      setIsAdmin(true);
      showToast('欢迎主人喵！已安全载入管理面板', 'success');
      loadDashboard();
      loadPastes();
      loadTokens();
    } else {
      setLoginError(res.error || '密码错误喵');
    }
  };

  // 退出登录
  const handleLogout = async () => {
    await apiAdminLogout();
    setIsAdmin(false);
    showToast('已安全退出后台喵', 'info');
  };

  // 加载数据
  const loadDashboard = async () => {
    const res = await apiAdminDashboard();
    if (res.success && res.data) {
      setDashboardData(res.data);
    }
  };

  const loadPastes = async () => {
    setIsLoadingPastes(true);
    const res = await apiAdminListPastes();
    setIsLoadingPastes(false);
    if (res.success && res.data) {
      setPastesList(res.data);
    }
  };

  const loadTokens = async () => {
    setIsLoadingTokens(true);
    const res = await apiAdminListTokens();
    setIsLoadingTokens(false);
    if (res.success && res.data) {
      setTokensList(res.data);
    }
  };

  // 删除分享
  const handleDeletePaste = async (id: string, slug: string) => {
    if (!confirm(`确认要彻底物理删除短链 /s/${slug} 及其所有文件吗喵？此操作无法撤销！`)) {
      return;
    }
    const res = await apiAdminDeletePaste(id);
    if (res.success) {
      showToast(res.message || '已成功清理并释放空间喵', 'success');
      loadPastes();
      loadDashboard();
    } else {
      showToast(res.error || '删除失败', 'error');
    }
  };

  // 创建新 Token
  const handleCreateToken = async () => {
    setIsCreatingToken(true);
    setCreatedTokenUrl(null);

    const res = await apiAdminCreateToken({
      maxSizeBytes: newTokenQuotaMB() * 1024 * 1024,
      durationHours: newTokenHours(),
      allowPermanent: newTokenAllowPermanent(),
    });
    setIsCreatingToken(false);

    if (res.success && res.data) {
      setCreatedTokenUrl(res.data.uploadUrl);
      showToast('上传凭证已生成喵！', 'success');
      loadTokens();
    } else {
      showToast(res.error || '创建 Token 失败', 'error');
    }
  };

  // 作废 Token
  const handleRevokeToken = async (id: string) => {
    if (!confirm('确定要作废该上传凭证吗喵？')) return;
    const res = await apiAdminRevokeToken(id);
    if (res.success) {
      showToast('Token 已成功作废喵', 'success');
      loadTokens();
    }
  };

  // 存储重新校准
  // 存储重新校准
  const handleRecalibrate = async () => {
    const res = await apiAdminRecalibrate();
    if (res.success) {
      showToast(res.message || '校准完成喵', 'success');
      loadDashboard();
    }
  };

  // 管理员自用上传：处理多文件追加与拖拽 (支持单文件最高 100MB 物理极限)
  const handleAdminAddFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const newItems: AdminPendingFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      // 单文件上限：100MB (Cloudflare Workers 原生 HTTP 直传物理上限)
      if (file.size > MAX_ADMIN_FILE_SIZE) {
        showToast(`文件 "${file.name}" 大小超过 100MB 上限，已跳过喵`, 'warning');
        continue;
      }
      newItems.push({
        id: Math.random().toString(36).substring(2, 9),
        file,
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'pending',
      });
    }

    setAdminFiles(prev => [...prev, ...newItems]);
  };

  // 管理员自用上传：单项删除待上传文件
  const handleAdminRemoveFile = (id: string) => {
    if (isAdminUploading()) return;
    setAdminFiles(prev => prev.filter(f => f.id !== id));
  };

  // 管理员自用上传提交
  const handleAdminSelfUpload = async () => {
    const files = adminFiles();
    const text = adminText().trim();

    if (files.length === 0 && !text) {
      showToast('请至少添加一个文件或输入一段文本喵', 'warning');
      return;
    }

    setIsAdminUploading(true);
    setAdminUploadProgress(0);
    setAdminCreatedResult(null);

    try {
      const uploadedResults: Array<{ r2Key: string; filename: string; mimeType: string; sizeBytes: number }> = [];

      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        setAdminCurrentStepText(`正在上传 (${i + 1}/${files.length}): ${item.name}`);
        setAdminFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'uploading' } : f));

        const res = await uploadFileWithProgress(item.file, undefined, (percent) => {
          setAdminFiles(prev => prev.map(f => f.id === item.id ? { ...f, progress: percent } : f));
          const overall = Math.round(((i + percent / 100) / (files.length || 1)) * 90);
          setAdminUploadProgress(overall);
        });

        uploadedResults.push({
          r2Key: res.r2Key,
          filename: res.filename,
          mimeType: res.mimeType,
          sizeBytes: res.sizeBytes,
        });

        setAdminFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', progress: 100 } : f));
      }

      setAdminCurrentStepText('正在生成专属分享链接...');
      setAdminUploadProgress(95);

      const completeRes = await apiCompleteUpload({
        title: adminTitle().trim() || (files.length > 0 ? files[0].name : '管理员自用分享'),
        textContent: text || undefined,
        files: uploadedResults,
        slugLength: adminSlugLen(),
        durationSeconds: adminDuration(),
        isPermanent: adminPermanent(),
        burnAfterRead: adminBurn(),
      });

      if (!completeRes.success || !completeRes.data) {
        throw new Error(completeRes.error || '创建自用分享失败');
      }

      setAdminUploadProgress(100);
      setAdminCreatedResult({
        slug: completeRes.data.slug,
        shareUrl: completeRes.data.shareUrl,
        directUrl: completeRes.data.directUrl,
      });
      showToast('自用分享创建成功喵！短链已生成', 'success');
      setAdminFiles([]);
      setAdminTitle('');
      setAdminText('');
      loadPastes();
      loadDashboard();

    } catch (err: any) {
      showToast(err.message || '自用上传失败', 'error');
    } finally {
      setIsAdminUploading(false);
    }
  };

  // 过滤后的 Pastes 列表
  const filteredPastes = createMemo(() => {
    const q = pasteSearchQuery().toLowerCase().trim();
    if (!q) return pastesList();
    return pastesList().filter(p =>
      p.slug.toLowerCase().includes(q) ||
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.files && p.files.some(f => f.filename.toLowerCase().includes(q)))
    );
  });

  return (
    <div class="max-w-6xl mx-auto px-4 py-8 sm:py-12">
      {/* 状态 1：加载认证中 */}
      <Show when={isCheckingAuth()}>
        <div class="flex justify-center py-20 text-slate-400">
          <div class="w-8 h-8 border-4 border-emerald-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      </Show>

      {/* 状态 2：未登录，展示高雅管理密码登录表单 */}
      <Show when={!isCheckingAuth() && !isAdmin()}>
        <div class="max-w-md mx-auto bg-white rounded-3xl border border-emerald-100 shadow-xl p-8 text-center">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-600 to-emerald-400 text-white flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-600/20">
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 class="text-2xl font-bold text-slate-900 mb-1">管理后台安全入口</h2>
          <p class="text-xs text-slate-500 mb-6">请输入管理员密码验证身份喵~</p>

          <Show when={loginError()}>
            <div class="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {loginError()}
            </div>
          </Show>

          <form onSubmit={handleLogin} class="space-y-4 text-left">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">管理员密码</label>
              <input
                type="password"
                placeholder="••••••••••••"
                value={passwordInput()}
                onInput={(e) => setPasswordInput(e.currentTarget.value)}
                class="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn()}
              class="w-full py-3 rounded-xl bg-gradient-to-r from-brand-600 to-emerald-600 hover:from-brand-500 hover:to-emerald-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50"
            >
              {isLoggingIn() ? '正在校验...' : '登录管理后台'}
            </button>
          </form>
        </div>
      </Show>

      {/* 状态 3：已登录，展示完整管理员工作台 */}
      <Show when={!isCheckingAuth() && isAdmin()}>
        <div class="space-y-6">
          {/* 顶部管理员头部 */}
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-emerald-100 p-5 shadow-xs">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                主人
              </div>
              <div>
                <h1 class="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <span>控制台工作区</span>
                  <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                    在线中
                  </span>
                </h1>
                <p class="text-xs text-slate-500">
                  全站运行在 Cloudflare 免费层边界内，实时保护额度安全喵
                </p>
              </div>
            </div>

            {/* 快捷操作 */}
            <div class="flex items-center gap-2">
              <button
                onClick={handleRecalibrate}
                class="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5"
                title="重新统计并校准实际存储"
              >
                <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>校准容量</span>
              </button>

              <button
                onClick={handleLogout}
                class="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold transition-colors"
              >
                退出登录
              </button>
            </div>
          </div>

          {/* 熔断状态警示横幅 (>=95% 时触发) */}
          <Show when={dashboardData()?.quota.status === 'circuit_broken'}>
            <div class="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5 text-rose-950">
              <div class="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 class="text-sm font-bold text-rose-900">⚠️ 系统已触发 95% 安全熔断保护！</h3>
                <p class="text-xs text-rose-700 mt-0.5">
                  熔断原因：{dashboardData()?.quota.brokenReason}。
                  前台访客服务已暂停。若为存储空间超限，请在下方列表删除部分过期或大文件，容量释放降回 95% 以下后系统将自动恢复喵！
                </p>
              </div>
            </div>
          </Show>

          {/* 80% 警戒黄色横幅 */}
          <Show when={dashboardData()?.quota.status === 'warning'}>
            <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-amber-900">
              <svg class="w-5 h-5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span class="text-xs font-medium">
                部分配额使用率已达 80% 警戒水位，系统仍可正常使用，请关注存储占用情况喵。
              </span>
            </div>
          </Show>

          {/* 选项卡导航：移动端等宽网格自适应，大屏弹性排列 */}
          <div class="grid grid-cols-3 gap-1.5 sm:flex sm:items-center sm:gap-2 border-b border-slate-200 pb-2">
            <button
              onClick={() => setActiveTab('dashboard')}
              class={`px-2 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all text-center ${
                activeTab() === 'dashboard'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              📊 概览与上传
            </button>
            <button
              onClick={() => { setActiveTab('pastes'); loadPastes(); }}
              class={`px-2 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all text-center ${
                activeTab() === 'pastes'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              📁 分享 ({pastesList().length})
            </button>
            <button
              onClick={() => { setActiveTab('tokens'); loadTokens(); }}
              class={`px-2 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all text-center ${
                activeTab() === 'tokens'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              🔑 凭证 ({tokensList().length})
            </button>
          </div>

          {/* Tab 1: 仪表盘与自用上传 */}
          <Show when={activeTab() === 'dashboard'}>
            <div class="space-y-6">
              {/* 配额 4 宫格 */}
              <Show when={dashboardData()}>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <QuotaGauge
                    title="R2 存储空间 (10GB)"
                    usedLabel={formatBytes(dashboardData()!.quota.storage.usedBytes)}
                    maxLabel={formatBytes(dashboardData()!.quota.storage.maxBytes)}
                    percent={dashboardData()!.quota.storage.percent}
                    isWarning={dashboardData()!.quota.storage.isWarning}
                    isCritical={dashboardData()!.quota.storage.isCritical}
                    unitDesc="超出 95% 停服，清理后立即恢复"
                  />
                  <QuotaGauge
                    title="R2 Class A (月写入)"
                    usedLabel={dashboardData()!.quota.r2ClassA.used.toLocaleString()}
                    maxLabel="1,000,000"
                    percent={dashboardData()!.quota.r2ClassA.percent}
                    isWarning={dashboardData()!.quota.r2ClassA.isWarning}
                    isCritical={dashboardData()!.quota.r2ClassA.isCritical}
                    unitDesc="每月 1 日 00:00 UTC 自动重置"
                  />
                  <QuotaGauge
                    title="R2 Class B (月读取)"
                    usedLabel={dashboardData()!.quota.r2ClassB.used.toLocaleString()}
                    maxLabel="10,000,000"
                    percent={dashboardData()!.quota.r2ClassB.percent}
                    isWarning={dashboardData()!.quota.r2ClassB.isWarning}
                    isCritical={dashboardData()!.quota.r2ClassB.isCritical}
                    unitDesc="包含音频在线试听与附件下载"
                  />
                  <QuotaGauge
                    title="Worker 请求 (每日)"
                    usedLabel={dashboardData()!.quota.workerReqs.used.toLocaleString()}
                    maxLabel="100,000"
                    percent={dashboardData()!.quota.workerReqs.percent}
                    isWarning={dashboardData()!.quota.workerReqs.isWarning}
                    isCritical={dashboardData()!.quota.workerReqs.isCritical}
                    unitDesc="每日 00:00 UTC 自动清零重置"
                  />
                </div>
              </Show>

              {/* 主人自用自由上传区 (专为主人生产品质体验设计) */}
              <div class="bg-white rounded-3xl border border-emerald-100 shadow-md p-6 sm:p-8 space-y-6">
                <div class="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <span class="w-3 h-3 rounded-full bg-accent-500" />
                      <span>主人自用专属上传通道</span>
                    </h3>
                    <p class="text-xs text-slate-500 mt-0.5">
                      无需任何 Token 凭证，单文件 100MB 内自由上传，支持多文件拖拽追加与多端自适应喵~
                    </p>
                  </div>
                  <span class="text-xs font-mono px-3 py-1 rounded-xl bg-accent-50 text-accent-800 border border-accent-200 font-semibold">
                    Admin Access (Max 100MB)
                  </span>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* 左侧：文件拖拽上传区 */}
                  <div>
                    <div class="flex items-center justify-between mb-2">
                      <label class="block text-xs font-bold text-slate-700">添加音频/文件 (单文件 ≤ 100MB)</label>
                      <Show when={adminFiles().length > 0}>
                        <span class="text-[11px] font-mono text-emerald-700 font-semibold">
                          已选 {adminFiles().length} 个，共 {formatBytes(adminTotalFilesSizeBytes())}
                        </span>
                      </Show>
                    </div>

                    {/* 拖拽放置盒 */}
                    <label
                      class="relative flex flex-col items-center justify-center border-2 border-dashed border-emerald-300 rounded-2xl p-6 cursor-pointer bg-emerald-50/20 hover:bg-emerald-50/50 transition-colors group"
                      ondragover={(e) => { e.preventDefault(); }}
                      ondrop={(e) => {
                        e.preventDefault();
                        handleAdminAddFiles(e.dataTransfer?.files || null);
                      }}
                    >
                      <input
                        type="file"
                        multiple
                        disabled={isAdminUploading()}
                        onChange={(e) => {
                          handleAdminAddFiles(e.currentTarget.files);
                          e.currentTarget.value = '';
                        }}
                        class="sr-only"
                      />
                      <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <span class="text-xs font-semibold text-slate-700">点击选择或拖拽文件到此处</span>
                      <span class="text-[11px] text-slate-400 mt-1">支持音频、文档、压缩包等，可多次追加选择</span>
                    </label>

                    {/* 待上传文件清单 */}
                    <Show when={adminFiles().length > 0}>
                      <div class="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
                        <For each={adminFiles()}>
                          {(item) => (
                            <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                              <div class="truncate mr-2 min-w-0">
                                <p class="font-medium text-slate-800 truncate" title={item.name}>
                                  {item.name}
                                </p>
                                <span class="text-[10px] text-slate-400 font-mono">
                                  {formatBytes(item.size)}
                                </span>
                              </div>

                              <div class="flex items-center gap-2 shrink-0">
                                <Show when={item.status === 'uploading'}>
                                  <span class="text-[10px] font-mono text-brand-600 font-bold">{item.progress}%</span>
                                </Show>
                                <Show when={item.status === 'done'}>
                                  <span class="text-[10px] text-emerald-600 font-semibold">就绪</span>
                                </Show>
                                <button
                                  onClick={() => handleAdminRemoveFile(item.id)}
                                  disabled={isAdminUploading()}
                                  class="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                                  title="移除"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* 右侧：标题与纯文本内容 */}
                  <div class="space-y-3">
                    <div>
                      <label class="block text-xs font-bold text-slate-700 mb-1.5">分享标题 (可选)</label>
                      <input
                        type="text"
                        placeholder="留空则自动以首个文件名作为标题..."
                        value={adminTitle()}
                        onInput={(e) => setAdminTitle(e.currentTarget.value)}
                        disabled={isAdminUploading()}
                        class="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30 bg-slate-50/50"
                      />
                    </div>

                    <div>
                      <label class="block text-xs font-bold text-slate-700 mb-1.5">文本内容 (可选)</label>
                      <textarea
                        rows={5}
                        placeholder="直接输入或粘贴文本内容..."
                        value={adminText()}
                        onInput={(e) => setAdminText(e.currentTarget.value)}
                        disabled={isAdminUploading()}
                        class="w-full p-3 text-xs font-mono rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30 bg-slate-50/50 resize-none"
                      />
                      <div class="mt-1 text-right text-[11px] text-slate-400 font-mono">
                        {adminText().length} 个字符
                      </div>
                    </div>
                  </div>
                </div>

                {/* 选项配置 */}
                <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs pt-2">
                  <div>
                    <label class="block font-semibold text-slate-700 mb-1">短链长度</label>
                    <select
                      value={adminSlugLen()}
                      onChange={(e) => setAdminSlugLen(parseInt(e.currentTarget.value, 10) as any)}
                      disabled={isAdminUploading()}
                      class="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50"
                    >
                      <option value={4}>4 位 (默认)</option>
                      <option value={8}>8 位 (高防爆破)</option>
                      <option value={16}>16 位 (超长熵)</option>
                    </select>
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-700 mb-1">有效时长</label>
                    <select
                      value={adminPermanent() ? -1 : adminDuration()}
                      onChange={(e) => {
                        const val = parseInt(e.currentTarget.value, 10);
                        if (val === -1) setAdminPermanent(true);
                        else {
                          setAdminPermanent(false);
                          setAdminDuration(val);
                        }
                      }}
                      disabled={isAdminUploading()}
                      class="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50"
                    >
                      <option value={3600}>1 小时</option>
                      <option value={86400}>1 天 (默认)</option>
                      <option value={604800}>7 天</option>
                      <option value={-1}>永久有效 (管理员特权)</option>
                    </select>
                  </div>

                  <div class="flex items-center pt-5">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={adminBurn()}
                        onChange={(e) => setAdminBurn(e.currentTarget.checked)}
                        disabled={isAdminUploading()}
                        class="w-4 h-4 text-accent-600 rounded-sm focus:ring-accent-500 accent-accent-600"
                      />
                      <span class="font-medium text-slate-800">阅后即焚</span>
                    </label>
                  </div>

                  <div class="flex items-center pt-3">
                    <button
                      onClick={handleAdminSelfUpload}
                      disabled={isAdminUploading() || (adminFiles().length === 0 && !adminText().trim())}
                      class="w-full py-2.5 px-4 rounded-xl bg-accent-600 hover:bg-accent-500 text-white font-bold text-xs shadow-md shadow-accent-600/20 transition-all disabled:opacity-50"
                    >
                      {isAdminUploading() ? '发布中...' : '发布自用分享'}
                    </button>
                  </div>
                </div>

                {/* 上传进度条 */}
                <Show when={isAdminUploading()}>
                  <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl">
                    <div class="flex justify-between text-xs font-semibold text-emerald-800 mb-1.5">
                      <span>{adminCurrentStepText()}</span>
                      <span>{adminUploadProgress()}%</span>
                    </div>
                    <div class="w-full h-2 bg-emerald-200 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-brand-600 transition-all duration-300"
                        style={{ width: `${adminUploadProgress()}%` }}
                      />
                    </div>
                  </div>
                </Show>

                {/* 发布成功结果直达 */}
                <Show when={adminCreatedResult()}>
                  <div class="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-4">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold">
                          ✓
                        </div>
                        <div>
                          <p class="text-xs font-bold text-emerald-900">自用分享发布成功喵！</p>
                          <p class="text-xs text-emerald-700">短链已生成，您可以直接分享给好友或立即打开查看：</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setAdminCreatedResult(null)}
                        class="text-xs text-slate-400 hover:text-slate-600"
                      >
                        ✕ 关闭
                      </button>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div class="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between gap-2">
                        <div class="truncate min-w-0">
                          <span class="text-[10px] text-slate-400 block">落地页链接</span>
                          <span class="font-mono text-emerald-800 truncate block">
                            {window.location.origin}{adminCreatedResult()!.shareUrl}
                          </span>
                        </div>
                        <button
                          onClick={async () => {
                            await copyToClipboard(`${window.location.origin}${adminCreatedResult()!.shareUrl}`);
                            showToast('落地页链接已复制喵！', 'success');
                          }}
                          class="px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[11px] font-semibold shrink-0"
                        >
                          复制
                        </button>
                      </div>

                      <div class="p-2.5 bg-white rounded-xl border border-emerald-200 flex items-center justify-between gap-2">
                        <div class="truncate min-w-0">
                          <span class="text-[10px] text-slate-400 block">直链 Direct URL</span>
                          <span class="font-mono text-emerald-800 truncate block">
                            {window.location.origin}{adminCreatedResult()!.directUrl}
                          </span>
                        </div>
                        <button
                          onClick={async () => {
                            await copyToClipboard(`${window.location.origin}${adminCreatedResult()!.directUrl}`);
                            showToast('直链已复制喵！', 'success');
                          }}
                          class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold shrink-0"
                        >
                          复制
                        </button>
                      </div>
                    </div>

                    <div class="flex justify-end gap-2 pt-1">
                      <a
                        href={adminCreatedResult()!.shareUrl}
                        target="_blank"
                        class="px-4 py-2 rounded-xl bg-accent-600 hover:bg-accent-500 text-white text-xs font-semibold shadow-xs"
                      >
                        立即打开落地页 →
                      </a>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* Tab 2: 分享列表与查删 */}
          <Show when={activeTab() === 'pastes'}>
            <div class="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 space-y-4">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 class="text-base font-bold text-slate-800">全量分享资源清单</h3>
                  <p class="text-xs text-slate-500">查阅所有活跃分享，随时手动彻底删除释放 R2 容量空间喵</p>
                </div>
                <input
                  type="text"
                  placeholder="搜索短链 Slug、文件名..."
                  value={pasteSearchQuery()}
                  onInput={(e) => setPasteSearchQuery(e.currentTarget.value)}
                  class="px-3.5 py-1.5 text-xs rounded-xl border border-slate-200 w-full sm:w-64"
                />
              </div>

                {/* 移动端卡片列表视图 (md:hidden) */}
                <div class="md:hidden space-y-3">
                  <For each={filteredPastes()} fallback={
                    <div class="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl">
                      {isLoadingPastes() ? '正在拉取数据喵...' : '暂无分享记录'}
                    </div>
                  }>
                    {(item) => (
                      <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3 text-xs">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex items-center gap-2 truncate">
                            <span class="font-mono font-bold text-emerald-800 text-sm">
                              /s/{item.slug}
                            </span>
                            <span class="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-mono text-[10px] text-slate-600 shrink-0">
                              {item.type}
                            </span>
                            <Show when={item.burn_after_read === 1}>
                              <span class="px-1.5 py-0.5 rounded-sm bg-accent-100 text-accent-800 font-bold text-[10px] shrink-0">
                                阅后即焚
                              </span>
                            </Show>
                          </div>

                          <span class="text-[11px] font-mono text-slate-400 shrink-0">
                            {formatBytes(item.total_size_bytes)}
                          </span>
                        </div>

                        <p class="font-semibold text-slate-800 text-xs line-clamp-1" title={item.title || ''}>
                          {item.title || (item.files.length > 0 ? item.files[0].filename : '纯文本分享')}
                        </p>

                        <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-white p-2.5 rounded-xl border border-slate-100">
                          <div>
                            <span class="text-slate-400 block">到期时效</span>
                            <span class="font-medium text-emerald-700">{formatRemainingTime(item.expires_at)}</span>
                          </div>
                          <div>
                            <span class="text-slate-400 block">下载 / 浏览</span>
                            <span class="font-mono font-bold text-slate-700">{item.download_count} / {item.view_count}</span>
                          </div>
                        </div>

                        <div class="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                          <a
                            href={`/s/${item.slug}?admin_preview=1`}
                            target="_blank"
                            class="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 font-semibold text-xs"
                          >
                            查阅
                          </a>
                          <button
                            onClick={async () => {
                              await copyToClipboard(`${window.location.origin}/s/${item.slug}`);
                              showToast('公共分享链接已复制喵！', 'success');
                            }}
                            class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-xs"
                          >
                            复制链接
                          </button>
                          <button
                            onClick={() => handleDeletePaste(item.id, item.slug)}
                            class="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 font-semibold text-xs"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>

                {/* PC/平板标准表格 (hidden md:block) */}
                <div class="hidden md:block overflow-x-auto">
                  <table class="w-full text-left text-xs text-slate-600">
                    <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th class="p-3">短链 Slug</th>
                        <th class="p-3">标题 / 文件名</th>
                        <th class="p-3">类型</th>
                        <th class="p-3">体积</th>
                        <th class="p-3">创建时间</th>
                        <th class="p-3">到期状态</th>
                        <th class="p-3">下载/浏览</th>
                        <th class="p-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <For each={filteredPastes()} fallback={
                        <tr>
                          <td colspan={8} class="p-8 text-center text-slate-400">
                            {isLoadingPastes() ? '正在拉取数据喵...' : '暂无分享记录'}
                          </td>
                        </tr>
                      }>
                        {(item) => (
                          <tr class="hover:bg-slate-50/80 transition-colors">
                            <td class="p-3 font-mono font-bold text-emerald-800">
                              /s/{item.slug}
                            </td>
                            <td class="p-3 max-w-[200px] truncate" title={item.title || ''}>
                              {item.title || (item.files.length > 0 ? item.files[0].filename : '文本')}
                            </td>
                            <td class="p-3">
                              <span class="px-2 py-0.5 rounded-md bg-slate-100 font-mono text-[10px]">
                                {item.type}
                              </span>
                            </td>
                            <td class="p-3 font-mono">{formatBytes(item.total_size_bytes)}</td>
                            <td class="p-3 text-slate-400">{formatDateTime(item.created_at)}</td>
                            <td class="p-3">
                              <span class="font-medium text-emerald-700">
                                {formatRemainingTime(item.expires_at)}
                              </span>
                              <Show when={item.burn_after_read === 1}>
                                <span class="ml-1 px-1.5 py-0.5 rounded-sm bg-accent-100 text-accent-800 text-[10px]">
                                  焚
                                </span>
                              </Show>
                            </td>
                            <td class="p-3 font-mono text-slate-500">
                              {item.download_count} / {item.view_count}
                            </td>
                            <td class="p-3 text-right space-x-1.5 shrink-0">
                              <a
                                href={`/s/${item.slug}?admin_preview=1`}
                                target="_blank"
                                class="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-semibold"
                                title="管理特权查阅：不计入浏览/下载统计，不触发阅后即焚"
                              >
                                查阅
                              </a>
                              <button
                                onClick={async () => {
                                  await copyToClipboard(`${window.location.origin}/s/${item.slug}`);
                                  showToast('公共分享链接已复制喵！', 'success');
                                }}
                                class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold"
                                title="复制标准公共分享链接 (可测试真实访问统计与阅后即焚)"
                              >
                                复制
                              </button>
                              <button
                                onClick={() => handleDeletePaste(item.id, item.slug)}
                                class="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold"
                              >
                                彻底删除
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
            </div>
          </Show>

          {/* Tab 3: 上传 Token 派发管理 */}
          <Show when={activeTab() === 'tokens'}>
            <div class="space-y-6">
              {/* 生成新 Token 卡片 */}
              <div class="bg-white rounded-3xl border border-emerald-100 shadow-xs p-6 space-y-4">
                <h3 class="text-base font-bold text-slate-800">生成一次性上传 Token</h3>
                <p class="text-xs text-slate-500">
                  生成专属上传链接派发给外人，外人可在配额内自由上传多个音频或文本，点击分享后该 Token 立即失效作废喵。
                </p>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label class="block font-semibold text-slate-700 mb-1">允许总文件容量 (MB)</label>
                    <input
                      type="number"
                      min={1}
                      max={1024}
                      value={newTokenQuotaMB()}
                      onInput={(e) => setNewTokenQuotaMB(parseInt(e.currentTarget.value, 10) || 25)}
                      class="w-full py-2 px-3 rounded-xl border border-slate-200"
                    />
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-700 mb-1">Token 有效期 (小时)</label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={newTokenHours()}
                      onInput={(e) => setNewTokenHours(parseInt(e.currentTarget.value, 10) || 24)}
                      class="w-full py-2 px-3 rounded-xl border border-slate-200"
                    />
                  </div>

                  <div class="flex items-center pt-5">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newTokenAllowPermanent()}
                        onChange={(e) => setNewTokenAllowPermanent(e.currentTarget.checked)}
                        class="w-4 h-4 text-emerald-600 rounded-sm focus:ring-emerald-500 accent-emerald-600"
                      />
                      <span class="font-medium text-slate-800">允许其选择永久有效</span>
                    </label>
                  </div>
                </div>

                <button
                  onClick={handleCreateToken}
                  disabled={isCreatingToken()}
                  class="py-2.5 px-5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-600/20 transition-all disabled:opacity-50"
                >
                  {isCreatingToken() ? '正在生成...' : '立即生成上传 URL 凭证'}
                </button>

                <Show when={createdTokenUrl()}>
                  <div class="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-4">
                    <input
                      type="text"
                      readOnly
                      value={createdTokenUrl()!}
                      class="grow px-3 py-2 text-xs font-mono bg-white border border-emerald-200 rounded-xl select-all"
                    />
                    <button
                      onClick={async () => {
                        await copyToClipboard(createdTokenUrl()!);
                        showToast('Token 链接已复制到剪贴板喵！', 'success');
                      }}
                      class="px-4 py-2 rounded-xl bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold shrink-0 transition-colors"
                    >
                      复制链接
                    </button>
                  </div>
                </Show>
              </div>

              {/* Token 列表 (缺陷 4 界面层修复 & 缺陷 6 移动端卡片视图) */}
              <div class="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-4 sm:p-6 space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-bold text-slate-800">历史 Token 凭证清单</h3>
                    <p class="text-xs text-slate-500 mt-0.5">随时复制专属上传链接派发好友，查看配额与实际消耗喵</p>
                  </div>
                  <span class="text-xs font-mono text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                    共 {tokensList().length} 个
                  </span>
                </div>

                {/* 移动端卡片列表视图 (md:hidden) */}
                <div class="md:hidden space-y-3">
                  <For each={tokensList()} fallback={
                    <div class="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl">
                      {isLoadingTokens() ? '正在拉取 Token 列表喵...' : '暂无 Token 记录'}
                    </div>
                  }>
                    {(t) => (
                      <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3 text-xs">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex items-center gap-2 truncate">
                            <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                              t.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : t.status === 'used'
                                ? 'bg-slate-200 text-slate-700'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {t.status === 'active' ? '有效' : t.status === 'used' ? '已使用作废' : '已过期'}
                            </span>
                            <span class="font-mono font-bold text-slate-800 truncate" title={t.id}>
                              {t.id.substring(0, 13)}...
                            </span>
                          </div>
                          <button
                            onClick={async () => {
                              await copyToClipboard(t.id);
                              showToast('Token 密钥已复制喵！', 'success');
                            }}
                            class="text-[11px] text-brand-600 hover:text-brand-700 font-semibold shrink-0"
                          >
                            复制ID
                          </button>
                        </div>

                        <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-white p-3 rounded-xl border border-slate-100">
                          <div>
                            <span class="text-slate-400 block">配额上限</span>
                            <span class="font-mono font-semibold">{formatBytes(t.max_size_bytes)}</span>
                          </div>
                          <div>
                            <span class="text-slate-400 block">实际消耗</span>
                            <span class="font-mono font-semibold text-emerald-700">{formatBytes(t.used_size_bytes)}</span>
                          </div>
                          <div class="col-span-2 pt-1 border-t border-slate-50">
                            <span class="text-slate-400 block">到期时效</span>
                            <span class="font-medium text-slate-700">{formatRemainingTime(t.expires_at)}</span>
                            <span class="text-[10px] text-slate-400 font-mono ml-1">({formatDateTime(t.expires_at)})</span>
                          </div>
                        </div>

                        <div class="flex items-center justify-end gap-2 pt-1">
                          <button
                            onClick={async () => {
                              const uploadUrl = `${window.location.origin}/upload?token=${t.id}`;
                              await copyToClipboard(uploadUrl);
                              showToast('上传专属链接已复制到剪贴板喵！', 'success');
                            }}
                            class="px-3 py-1.5 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 font-semibold text-xs transition-colors"
                          >
                            复制专属链接
                          </button>
                          <Show when={t.status === 'active'}>
                            <button
                              onClick={() => handleRevokeToken(t.id)}
                              class="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs transition-colors"
                            >
                              作废
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>

                {/* PC/平板标准增强表格 (hidden md:block) */}
                <div class="hidden md:block overflow-x-auto">
                  <table class="w-full text-left text-xs text-slate-600">
                    <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th class="p-3">Token 凭证 ID</th>
                        <th class="p-3">配额大小</th>
                        <th class="p-3">实际消耗</th>
                        <th class="p-3">状态</th>
                        <th class="p-3">有效期截止</th>
                        <th class="p-3">创建时间</th>
                        <th class="p-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <For each={tokensList()} fallback={
                        <tr>
                          <td colspan={7} class="p-8 text-center text-slate-400">
                            {isLoadingTokens() ? '正在拉取 Token 列表喵...' : '暂无 Token 记录'}
                          </td>
                        </tr>
                      }>
                        {(t) => (
                          <tr class="hover:bg-slate-50/80 transition-colors">
                            <td class="p-3">
                              <div class="flex items-center gap-1.5">
                                <span class="font-mono font-semibold text-slate-800" title={t.id}>
                                  {t.id.substring(0, 10)}...
                                </span>
                                <button
                                  onClick={async () => {
                                    await copyToClipboard(t.id);
                                    showToast('Token 完整密钥已复制喵！', 'success');
                                  }}
                                  class="text-slate-400 hover:text-emerald-700 p-0.5 transition-colors"
                                  title={`点击复制完整 Token: ${t.id}`}
                                >
                                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                            <td class="p-3 font-mono font-medium">{formatBytes(t.max_size_bytes)}</td>
                            <td class="p-3 font-mono font-semibold text-emerald-800">{formatBytes(t.used_size_bytes)}</td>
                            <td class="p-3">
                              <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                t.status === 'active'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : t.status === 'used'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-rose-100 text-rose-800'
                              }`}>
                                {t.status === 'active' ? '有效' : t.status === 'used' ? '已使用作废' : '已过期'}
                              </span>
                            </td>
                            <td class="p-3 text-slate-500">
                              <span class="block">{formatRemainingTime(t.expires_at)}</span>
                              <span class="text-[10px] text-slate-400">{formatDateTime(t.expires_at)}</span>
                            </td>
                            <td class="p-3 text-slate-400 font-mono text-[11px]">{formatDateTime(t.created_at)}</td>
                            <td class="p-3 text-right space-x-1.5 shrink-0">
                              <button
                                onClick={async () => {
                                  const uploadUrl = `${window.location.origin}/upload?token=${t.id}`;
                                  await copyToClipboard(uploadUrl);
                                  showToast('专属上传链接已复制喵！可直接发给好友', 'success');
                                }}
                                class="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-semibold"
                                title="复制专属上传链接"
                              >
                                复制链接
                              </button>
                              <button
                                onClick={async () => {
                                  await copyToClipboard(t.id);
                                  showToast('Token 密钥已复制喵！', 'success');
                                }}
                                class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold"
                                title="复制 Token ID 密钥"
                              >
                                复制ID
                              </button>
                              <Show when={t.status === 'active'}>
                                <button
                                  onClick={() => handleRevokeToken(t.id)}
                                  class="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold"
                                >
                                  作废
                                </button>
                              </Show>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
