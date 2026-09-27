/**
 * 访客带 Token 凭证上传页面 (/upload?token=...)
 * 支持多文件拖拽 (单个音频/文件 <= 25MB)、纯文本输入、平滑上传进度条与阅后即焚配置
 */

import { createSignal, onMount, Show, For, createMemo } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { formatBytes, formatRemainingTime, copyToClipboard } from '../utils/format';
import { apiGetTokenInfo, uploadFileWithProgress, apiCompleteUpload } from '../utils/api';
import { showToast } from '../components/Toast';
import { MAX_SINGLE_FILE_SIZE, EXPIRATION_PRESETS } from '../../shared/constants';

interface PendingFile {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number;
  uploadedR2Key?: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  errorMessage?: string;
}

export function UploadPage() {
  const [searchParams, setSearchParams] = useSearchParams<{ token?: string }>();
  const token = () => searchParams.token || '';

  // 手动输入 Token 的状态
  const [inputToken, setInputToken] = createSignal('');

  // Token 凭证信息
  const [tokenInfo, setTokenInfo] = createSignal<{
    tokenId: string;
    maxSizeBytes: number;
    usedSizeBytes: number;
    remainingBytes: number;
    allowPermanent: boolean;
    expiresAt: string;
  } | null>(null);

  const [isLoadingToken, setIsLoadingToken] = createSignal(false);
  const [tokenError, setTokenError] = createSignal<string | null>(null);

  // 上传表单数据
  const [pendingFiles, setPendingFiles] = createSignal<PendingFile[]>([]);
  const [textContent, setTextContent] = createSignal('');
  const [pasteTitle, setPasteTitle] = createSignal('');
  const [slugLength, setSlugLength] = createSignal<4 | 8 | 16>(4);
  const [selectedDuration, setSelectedDuration] = createSignal<number>(86400); // 默认 1 天
  const [isPermanent, setIsPermanent] = createSignal(false);
  const [burnAfterRead, setBurnAfterRead] = createSignal(false);

  // 整体上传状态
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [overallProgress, setOverallProgress] = createSignal(0);
  const [currentStepText, setCurrentStepText] = createSignal('');

  // 上传成功结果
  const [createdResult, setCreatedResult] = createSignal<{
    slug: string;
    shareUrl: string;
    directUrl: string;
    expiresAt: string | null;
    burnAfterRead: boolean;
  } | null>(null);

  // 计算当前待上传文件的总字节大小
  const totalFilesSizeBytes = createMemo(() => {
    return pendingFiles().reduce((acc, cur) => acc + cur.size, 0);
  });

  // 检查是否超出该 Token 剩余配额
  const isOverQuota = createMemo(() => {
    const info = tokenInfo();
    if (!info) return false;
    return totalFilesSizeBytes() > info.remainingBytes;
  });

  // 加载并校验 Token
  const loadToken = async (tokenStr: string) => {
    if (!tokenStr) return;
    setIsLoadingToken(true);
    setTokenError(null);

    const res = await apiGetTokenInfo(tokenStr);
    setIsLoadingToken(false);

    if (res.success && res.data) {
      setTokenInfo(res.data);
    } else {
      setTokenInfo(null);
      setTokenError(res.error || '上传凭证无效或已作废');
    }
  };

  onMount(() => {
    if (token()) {
      loadToken(token());
    }
  });

  // 处理文件拖拽与添加
  const handleAddFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const newItems: PendingFile[] = [];
    const info = tokenInfo();

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];

      // 单文件 25MB 限制
      if (file.size > MAX_SINGLE_FILE_SIZE) {
        showToast(`文件 "${file.name}" 大小超过 25MB 限制，已跳过`, 'warning');
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

    setPendingFiles(prev => [...prev, ...newItems]);
  };

  const removeFile = (id: string) => {
    if (isSubmitting()) return;
    setPendingFiles(prev => prev.filter(f => f.id !== id));
  };

  // 提交并生成分享
  const handleSubmit = async () => {
    const files = pendingFiles();
    const text = textContent().trim();

    if (files.length === 0 && !text) {
      showToast('请至少添加一个文件或输入一段文本喵', 'warning');
      return;
    }

    if (isOverQuota()) {
      showToast('所选文件总大小超出当前凭证的配额上限喵！', 'error');
      return;
    }

    setIsSubmitting(true);
    setOverallProgress(0);

    const uploadedResults: Array<{ r2Key: string; filename: string; mimeType: string; sizeBytes: number }> = [];

    try {
      // 1. 逐个流式上传文件到 R2
      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        setCurrentStepText(`正在上传 (${i + 1}/${files.length}): ${item.name}`);

        // 更新状态为上传中
        setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'uploading' } : f));

        const res = await uploadFileWithProgress(
          item.file,
          token(),
          (percent) => {
            setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, progress: percent } : f));
            // 估算总进度
            const completedRatio = (i + percent / 100) / (files.length || 1);
            setOverallProgress(Math.round(completedRatio * 90));
          }
        );

        uploadedResults.push({
          r2Key: res.r2Key,
          filename: res.filename,
          mimeType: res.mimeType,
          sizeBytes: res.sizeBytes,
        });

        setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', progress: 100 } : f));
      }

      // 2. 全部文件直传完成，请求完成入库
      setCurrentStepText('文件已就绪，正在生成专属分享链接...');
      setOverallProgress(95);

      const completeRes = await apiCompleteUpload({
        token: token(),
        title: pasteTitle().trim() || undefined,
        textContent: text || undefined,
        files: uploadedResults,
        slugLength: slugLength(),
        durationSeconds: selectedDuration(),
        isPermanent: isPermanent(),
        burnAfterRead: burnAfterRead(),
      });

      if (!completeRes.success || !completeRes.data) {
        throw new Error(completeRes.error || '创建分享记录失败');
      }

      setOverallProgress(100);
      setCreatedResult(completeRes.data);
      showToast('分享创建成功！此 Token 已自动作废喵~', 'success');

    } catch (err: any) {
      console.error('Upload failed:', err);
      showToast(err.message || '上传过程中发生错误', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div class="max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* 标题说明区 */}
      <div class="text-center mb-8">
        <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          私密分享与文件暂存
        </h1>
        <p class="mt-2 text-xs sm:text-sm text-slate-500 max-w-lg mx-auto">
          基于 Cloudflare 边缘计算与 R2 对象存储，支持单文件 25MB 内音频/附件与纯文本，安全合规、用完即焚喵
        </p>
      </div>

      {/* 状态 1：未携带 Token 或 Token 无效时，提供输入框引导 */}
      <Show when={!tokenInfo()}>
        <div class="bg-white rounded-3xl border border-emerald-100 shadow-md p-6 sm:p-8 max-w-xl mx-auto text-center">
          <div class="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4 border border-emerald-100">
            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h3 class="text-lg font-bold text-slate-800 mb-2">需要专属上传凭证</h3>
          <p class="text-xs text-slate-500 mb-6">
            本站仅面向站长自身与获授权的少数好友。请使用管理员派发给您的专属上传链接，或在下方输入 Token 密钥喵~
          </p>

          <Show when={tokenError()}>
            <div class="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {tokenError()}
            </div>
          </Show>

          <div class="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="请输入上传 Token (如 UUID)"
              value={inputToken()}
              onInput={(e) => setInputToken(e.currentTarget.value)}
              class="grow px-4 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 font-mono"
            />
            <button
              onClick={() => {
                if (!inputToken().trim()) return;
                setSearchParams({ token: inputToken().trim() });
                loadToken(inputToken().trim());
              }}
              disabled={isLoadingToken()}
              class="px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-500 text-white font-semibold text-sm shadow-md shadow-accent-600/20 transition-all disabled:opacity-50 shrink-0"
            >
              {isLoadingToken() ? '校验中...' : '开始上传'}
            </button>
          </div>
        </div>
      </Show>

      {/* 状态 2：Token 校验通过，呈现完整上传与配置工作台 */}
      <Show when={tokenInfo() && !createdResult()}>
        <div class="space-y-6">
          {/* Token 配额状态横幅 */}
          <div class="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-200/80 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
            <div class="flex items-center gap-3.5">
              <div class="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-bold text-slate-800">上传凭证授权中</h4>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-medium">
                    一次性生效
                  </span>
                </div>
                <p class="text-xs text-slate-500 mt-0.5">
                  可用配额：<span class="font-semibold text-slate-800">{formatBytes(tokenInfo()!.remainingBytes)}</span>
                  {' '}• 有效期倒计时：<span class="font-semibold text-emerald-700">{formatRemainingTime(tokenInfo()!.expiresAt)}</span>
                </p>
              </div>
            </div>

            <div class="text-right text-xs text-slate-500">
              已选文件：<span class="font-mono font-bold text-slate-800">{formatBytes(totalFilesSizeBytes())}</span>
              <div class="w-32 h-2 bg-slate-200 rounded-full mt-1.5 overflow-hidden ml-auto">
                <div
                  class={`h-full rounded-full transition-all ${
                    isOverQuota() ? 'bg-rose-500' : 'bg-brand-600'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.round((totalFilesSizeBytes() / (tokenInfo()!.remainingBytes || 1)) * 100))}%`
                  }}
                />
              </div>
            </div>
          </div>

          {/* 配额超出警告 */}
          <Show when={isOverQuota()}>
            <div class="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center gap-2">
              <svg class="w-4 h-4 shrink-0 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>待上传文件总大小已超出当前 Token 剩余配额，请删除部分文件后再提交喵！</span>
            </div>
          </Show>

          {/* 核心工作区：文件拖拽与文本编辑 */}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 左侧：文件拖拽上传区 */}
            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 flex flex-col justify-between">
              <div>
                <h3 class="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <svg class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span>添加文件 (单文件 ≤ 25MB)</span>
                </h3>

                {/* 拖拽放置盒 */}
                <label class="relative flex flex-col items-center justify-center border-2 border-dashed border-emerald-300/80 hover:border-emerald-500 rounded-xl p-6 cursor-pointer bg-emerald-50/20 hover:bg-emerald-50/50 transition-colors group">
                  <input
                    type="file"
                    multiple
                    disabled={isSubmitting()}
                    onChange={(e) => handleAddFiles(e.currentTarget.files)}
                    class="sr-only"
                  />
                  <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <p class="text-xs font-semibold text-slate-700">点击选择或拖拽音频/文件到此处</p>
                  <p class="text-[11px] text-slate-400 mt-1">支持 MP3, WAV, FLAC, M4A, 压缩包及其他格式</p>
                </label>

                {/* 待上传文件清单 */}
                <div class="mt-4 space-y-2 max-h-48 overflow-y-auto">
                  <For each={pendingFiles()}>
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
                            onClick={() => removeFile(item.id)}
                            disabled={isSubmitting()}
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
              </div>
            </div>

            {/* 右侧：纯文本内容粘贴 */}
            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 flex flex-col justify-between">
              <div>
                <h3 class="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <svg class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>附加或单独粘贴文本</span>
                </h3>
                <textarea
                  rows={8}
                  placeholder="在此直接粘贴代码、笔记或备忘内容 (可选)..."
                  value={textContent()}
                  onInput={(e) => setTextContent(e.currentTarget.value)}
                  disabled={isSubmitting()}
                  class="w-full p-3 text-xs sm:text-sm font-mono rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none bg-slate-50/50"
                />
              </div>

              <div class="mt-2 text-right text-[11px] text-slate-400 font-mono">
                {textContent().length} 个字符
              </div>
            </div>
          </div>

          {/* 分享选项与策略配置面板 */}
          <div class="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
            <h3 class="text-sm font-bold text-slate-800">分享参数设定</h3>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              {/* 短链长度选择 */}
              <div>
                <label class="block font-semibold text-slate-700 mb-1.5">短链字符长度</label>
                <div class="grid grid-cols-3 gap-1.5">
                  <For each={[4, 8, 16] as const}>
                    {(len) => (
                      <button
                        type="button"
                        onClick={() => setSlugLength(len)}
                        class={`py-2 text-center rounded-xl border font-mono font-medium transition-all ${
                          slugLength() === len
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-400 ring-2 ring-emerald-500/20 font-bold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {len} 位
                      </button>
                    )}
                  </For>
                </div>
                <p class="text-[10px] text-slate-400 mt-1">系统全自动生成，防爆破枚举</p>
              </div>

              {/* 有效期设定 */}
              <div>
                <label class="block font-semibold text-slate-700 mb-1.5">自动过期时限</label>
                <select
                  value={isPermanent() ? -1 : selectedDuration()}
                  onChange={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (val === -1) {
                      setIsPermanent(true);
                    } else {
                      setIsPermanent(false);
                      setSelectedDuration(val);
                    }
                  }}
                  class="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-brand-500/30"
                >
                  <For each={EXPIRATION_PRESETS}>
                    {(preset) => <option value={preset.value}>{preset.label}</option>}
                  </For>
                  <Show when={tokenInfo()?.allowPermanent}>
                    <option value={-1}>永久有效 (管理员特权)</option>
                  </Show>
                </select>
                <p class="text-[10px] text-slate-400 mt-1">超期自动物理删除 R2 文件释放容量</p>
              </div>

              {/* 阅后即焚开关 (活力暖橙强调) */}
              <div>
                <label class="block font-semibold text-slate-700 mb-1.5">阅后即焚</label>
                <label class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={burnAfterRead()}
                    onChange={(e) => setBurnAfterRead(e.currentTarget.checked)}
                    class="w-4 h-4 text-accent-600 rounded-sm focus:ring-accent-500 accent-accent-600"
                  />
                  <span class="font-medium text-slate-800">开启阅后即焚</span>
                </label>
                <p class="text-[10px] text-accent-700 mt-1 font-medium">首次下载后立即永久物理销毁</p>
              </div>
            </div>
          </div>

          {/* 进度条与提交按钮 */}
          <Show when={isSubmitting()}>
            <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl">
              <div class="flex justify-between text-xs font-semibold text-emerald-800 mb-1.5">
                <span>{currentStepText()}</span>
                <span>{overallProgress()}%</span>
              </div>
              <div class="w-full h-2.5 bg-emerald-200 rounded-full overflow-hidden">
                <div
                  class="h-full bg-brand-600 transition-all duration-300"
                  style={{ width: `${overallProgress()}%` }}
                />
              </div>
            </div>
          </Show>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting() || isOverQuota() || (pendingFiles().length === 0 && !textContent().trim())}
            class="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-accent-600 to-amber-500 hover:from-accent-500 hover:to-amber-400 text-white font-bold text-base shadow-lg shadow-accent-600/25 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSubmitting() ? '正在上传并生成分享...' : '立即生成分享短链 (消耗此 Token)'}
          </button>
        </div>
      </Show>

      {/* 状态 3：上传成功，展示生成结果与已作废提示 */}
      <Show when={createdResult()}>
        <div class="bg-white rounded-3xl border border-emerald-200 shadow-xl p-6 sm:p-8 max-w-xl mx-auto text-center space-y-6">
          <div class="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <h3 class="text-2xl font-bold text-slate-900">分享已成功生成！</h3>
            <p class="text-xs text-slate-500 mt-1">
              本次使用的一次性 Token 已永久作废喵。您现在可以复制短链派发给好友：
            </p>
          </div>

          {/* 短链卡片 */}
          <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 text-left">
            <div>
              <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">网页落地页 (可在线播放/预览)</span>
              <div class="flex items-center gap-2 mt-1 min-w-0">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}${createdResult()!.shareUrl}`}
                  class="grow min-w-0 px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-xl select-all"
                />
                <button
                  onClick={async () => {
                    await copyToClipboard(`${window.location.origin}${createdResult()!.shareUrl}`);
                    showToast('落地页链接已复制到剪贴板喵！', 'success');
                  }}
                  class="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shrink-0 transition-colors"
                >
                  复制
                </button>
              </div>
            </div>

            <div>
              <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Direct 直链 (直接下载/命令行)</span>
              <div class="flex items-center gap-2 mt-1 min-w-0">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}${createdResult()!.directUrl}`}
                  class="grow min-w-0 px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-xl select-all"
                />
                <button
                  onClick={async () => {
                    await copyToClipboard(`${window.location.origin}${createdResult()!.directUrl}`);
                    showToast('直链已复制到剪贴板喵！', 'success');
                  }}
                  class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold shrink-0 transition-colors"
                >
                  复制
                </button>
              </div>
            </div>
          </div>

          <div class="pt-2 flex justify-center gap-3">
            <a
              href={createdResult()!.shareUrl}
              target="_blank"
              class="px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold transition-all shadow-md shadow-accent-600/20"
            >
              立即查看落地页 →
            </a>
          </div>
        </div>
      </Show>
    </div>
  );
}
