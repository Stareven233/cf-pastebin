/**
 * 分享落地展示页 (/s/:slug)
 * 支持音频在线试听、代码/纯文本查看高亮、阅后即焚警告与 Direct 直链复制
 */

import { createSignal, onMount, Show, For } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { apiGetPaste } from '../utils/api';
import { formatBytes, formatDateTime, formatRemainingTime, copyToClipboard, isCodeOrTextFile } from '../utils/format';
import { AudioPlayer } from '../components/AudioPlayer';
import { TextPreview } from '../components/TextPreview';
import { CodeFileCard } from '../components/CodeFileCard';
import { showToast } from '../components/Toast';
import type { PublicPasteView } from '../../shared/types';

export function ShareViewPage() {
  const params = useParams<{ slug: string }>();
  const [data, setData] = createSignal<PublicPasteView | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [errorCode, setErrorCode] = createSignal<string | null>(null);

  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const isAdminPreview = searchParams.get('admin_preview') === '1';

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);
    const res = await apiGetPaste(params.slug, isAdminPreview);
    setLoading(false);

    if (res.success && res.data) {
      setData(res.data);
    } else {
      setErrorMsg(res.error || '获取分享内容失败');
      setErrorCode(res.code || null);
    }
  };

  onMount(() => {
    if (params.slug) {
      loadData();
    }
  });

  const handleCopyPageUrl = async () => {
    await copyToClipboard(window.location.href);
    showToast('页面链接已复制到剪贴板喵！', 'success');
  };

  const handleCopyDirectUrl = async () => {
    const directUrl = `${window.location.origin}/d/${params.slug}`;
    await copyToClipboard(directUrl);
    showToast('Direct 直链已复制到剪贴板喵！', 'success');
  };

  return (
    <div class="max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* 加载中状态 */}
      <Show when={loading()}>
        <div class="flex flex-col items-center justify-center py-20 text-slate-400">
          <div class="w-10 h-10 border-4 border-emerald-200 border-t-brand-600 rounded-full animate-spin mb-4" />
          <p class="text-sm font-medium">正在安全提取分享内容，请稍候喵...</p>
        </div>
      </Show>

      {/* 异常错误或过期状态 */}
      <Show when={!loading() && errorMsg()}>
        <div class="bg-white rounded-3xl border border-slate-200 shadow-md p-8 text-center max-w-lg mx-auto">
          <div class="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100">
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="text-xl font-bold text-slate-800 mb-2">无法查看此分享</h3>
          <p class="text-xs text-slate-500 mb-6">{errorMsg()}</p>
          <A
            href="/"
            class="inline-block px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors"
          >
            返回首页
          </A>
        </div>
      </Show>

      {/* 正常内容呈现 */}
      <Show when={!loading() && data()}>
        <div class="space-y-6">
          {/* 管理员特权预览提示横幅 (方案B) */}
          <Show when={data()!.isAdminPreview}>
            <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-indigo-200 rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 text-indigo-950 shadow-xs">
              <div class="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <div>
                <h4 class="text-sm font-bold">管理员免焚毁特权预览</h4>
                <p class="text-xs text-indigo-800 mt-0.5">
                  主人，此查阅来自后台特权通道，不会增加访问/下载计数，也不会触发阅后即焚物理销毁喵~
                </p>
              </div>
            </div>
          </Show>

          {/* 阅后即焚警告横幅 (暖橙色醒目提醒，非管理员预览时) */}
          <Show when={data()!.burnAfterRead && !data()!.isAdminPreview}>
            <div class="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-accent-300 rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 text-accent-950 shadow-sm animate-pulse">
              <div class="w-10 h-10 rounded-xl bg-accent-500 text-white flex items-center justify-center shrink-0 shadow-md">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                </svg>
              </div>
              <div>
                <h4 class="text-sm font-bold">🔥 阅后即焚模式已激活</h4>
                <p class="text-xs text-accent-800 mt-0.5">
                  提示：分享内容已成功提取！当前页面可直接复制与下载，页面关闭、刷新或二次打开将立即彻底销毁喵！
                </p>
              </div>
            </div>
          </Show>

          {/* 头部元数据卡片 */}
          <div class="bg-white rounded-2xl border border-emerald-100/80 shadow-xs p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2 mb-1.5">
                <span class="font-mono text-xs px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-bold border border-emerald-200/60">
                  /s/{data()!.slug}
                </span>
                <span class="text-xs text-slate-400 font-medium">
                  {formatDateTime(data()!.createdAt)}
                </span>
              </div>
              <h2 class="text-xl font-bold text-slate-900 truncate">
                {data()!.title || '分享内容'}
              </h2>
            </div>

            {/* 倒计时与下载统计：移动端 3 列网格对齐，大屏弹性排列 */}
            <div class="grid grid-cols-3 gap-1.5 sm:flex sm:items-center sm:gap-3 text-xs w-full sm:w-auto">
              <div class="px-2 sm:px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium text-center sm:text-left">
                <span class="block text-[10px] text-slate-400">剩余时效</span>
                <span class="font-bold text-emerald-700 text-xs truncate block">{formatRemainingTime(data()!.expiresAt)}</span>
              </div>
              <div class="px-2 sm:px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium text-center sm:text-left">
                <span class="block text-[10px] text-slate-400">下载次数</span>
                <span class="font-bold text-slate-800 text-xs block">{data()!.downloadCount}</span>
              </div>
              <div class="px-2 sm:px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium text-center sm:text-left">
                <span class="block text-[10px] text-slate-400">总容量</span>
                <span class="font-bold text-slate-800 text-xs truncate block">{formatBytes(data()!.totalSizeBytes)}</span>
              </div>
            </div>
          </div>

          {/* 纯文本内容渲染 */}
          <Show when={data()!.textContent}>
            <div>
              <TextPreview
                content={data()!.textContent!}
                rawUrl={data()!.rawUrl || `/d/${data()!.slug}?raw=1`}
                title={data()!.title || '纯文本分享'}
              />
            </div>
          </Show>

          {/* 关联文件渲染 (针对音频特别内嵌播放器) */}
          <Show when={data()!.files && data()!.files.length > 0}>
            <div class="space-y-4">
              <h3 class="text-sm font-bold text-slate-700 flex items-center gap-2">
                <svg class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>包含的文件 ({data()!.files.length})</span>
              </h3>

              <For each={data()!.files}>
                {(f) => (
                  <Show
                    when={f.isAudio}
                    fallback={
                      <Show
                        when={isCodeOrTextFile(f.filename, f.mimeType, f.sizeBytes)}
                        fallback={
                          /* 通用二进制文件卡片 (如压缩包、可执行文件等) */
                          <div class="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 flex items-center justify-between gap-4">
                            <div class="flex items-center gap-3 min-w-0">
                              <div class="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <div class="truncate">
                                <p class="text-sm font-semibold text-slate-800 truncate">{f.filename}</p>
                                <span class="text-xs text-slate-400 font-mono">{formatBytes(f.sizeBytes)}</span>
                              </div>
                            </div>

                            <a
                              href={f.downloadUrl}
                              class="px-4 py-2 rounded-xl bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 shrink-0"
                              download={f.filename}
                            >
                              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              <span>下载文件</span>
                            </a>
                          </div>
                        }
                      >
                        {/* 代码与文本文件在线高亮预览卡片 (缺陷 5 增强：限高 480px 滚动) */}
                        <CodeFileCard
                          file={f}
                          autoExpand={data()!.files.length === 1 || f.sizeBytes <= 64 * 1024}
                        />
                      </Show>
                    }
                  >
                    {/* 音频专属播放卡片 */}
                    <AudioPlayer
                      filename={f.filename}
                      sizeBytes={f.sizeBytes}
                      audioSrc={`${f.downloadUrl}${f.downloadUrl.includes('?') ? '&' : '?'}inline=1`}
                      downloadUrl={f.downloadUrl}
                    />
                  </Show>
                )}
              </For>
            </div>
          </Show>

          {/* 底部便捷操作栏：移动端响应式网格与大屏对齐 */}
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-200">
            <div class="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <button
                onClick={handleCopyPageUrl}
                class="w-full sm:w-auto px-3 sm:px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-colors flex items-center justify-center gap-1.5"
              >
                <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>复制分享页</span>
              </button>

              <button
                onClick={handleCopyDirectUrl}
                class="w-full sm:w-auto px-3 sm:px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-colors flex items-center justify-center gap-1.5"
              >
                <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>复制直链</span>
              </button>
            </div>

            <A
              href="/upload"
              class="text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition-colors text-center sm:text-right py-1"
            >
              我要分享新内容 →
            </A>
          </div>
        </div>
      </Show>
    </div>
  );
}
