/**
 * 代码与文本文件卡片组件
 * 支持在线按需拉取预览、行号展示、限高 480px 滚动、一键复制与本地快速下载
 */

import { createSignal, onMount, Show } from 'solid-js';
import { formatBytes, getFileLanguageLabel } from '../utils/format';
import { TextPreview } from './TextPreview';
import { showToast } from './Toast';

export interface CodeFileCardProps {
  file: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string;
  };
  autoExpand?: boolean;
}

export function CodeFileCard(props: CodeFileCardProps) {
  // 是否展开代码预览
  const [expanded, setExpanded] = createSignal(props.autoExpand ?? false);
  // 已加载的代码文本内容
  const [codeContent, setCodeContent] = createSignal<string | null>(null);
  // 加载状态与错误信息
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const languageLabel = () => getFileLanguageLabel(props.file.filename);

  // 拉取代码文件的文本内容
  const fetchContent = async () => {
    if (codeContent() !== null || loading()) return;
    setLoading(true);
    setError(null);

    try {
      // 拼接 inline=1 请求头，使后端返回 inline disposition
      const inlineUrl = props.file.downloadUrl.includes('?')
        ? `${props.file.downloadUrl}&inline=1`
        : `${props.file.downloadUrl}?inline=1`;

      const res = await fetch(inlineUrl);
      if (!res.ok) {
        throw new Error(`加载代码失败 (HTTP ${res.status})`);
      }
      const text = await res.text();
      setCodeContent(text);
    } catch (err: any) {
      console.error('Failed to load code file content:', err);
      setError(err.message || '加载代码内容失败喵');
    } finally {
      setLoading(false);
    }
  };

  // 若配置了自动展开，组件挂载时即刻拉取
  onMount(() => {
    if (props.autoExpand) {
      fetchContent();
    }
  });

  // 展开 / 折叠切换
  const handleToggle = () => {
    const next = !expanded();
    setExpanded(next);
    if (next && codeContent() === null) {
      fetchContent();
    }
  };

  // 下载文件：若前端已拉取文本内容，直接利用 Blob 下载 (避免阅后即焚二次下载 404 或重复消耗 Worker 额度)
  const handleDownloadFile = () => {
    const text = codeContent();
    if (text !== null) {
      const blob = new Blob([text], { type: props.file.mimeType || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = props.file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('文件已开始下载喵！', 'success');
    } else {
      // 未加载内容时，通过原生 a 标签触发后端直链下载
      const a = document.createElement('a');
      a.href = props.file.downloadUrl;
      a.download = props.file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div class="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden transition-all">
      {/* 头部元数据栏 */}
      <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60 border-b border-slate-100">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            {/* 代码文件图标 */}
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <div class="truncate">
            <div class="flex items-center gap-2">
              <p class="text-sm font-semibold text-slate-800 truncate" title={props.file.filename}>
                {props.file.filename}
              </p>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-100/70 text-emerald-800 font-semibold shrink-0">
                {languageLabel()}
              </span>
            </div>
            <span class="text-xs text-slate-400 font-mono">
              {formatBytes(props.file.sizeBytes)}
            </span>
          </div>
        </div>

        {/* 头部操作按钮组 */}
        <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          {/* 展开 / 收起代码按钮 */}
          <button
            onClick={handleToggle}
            class={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
              expanded()
                ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80'
            }`}
          >
            <svg
              class={`w-3.5 h-3.5 transition-transform duration-200 ${expanded() ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            <span>{expanded() ? '收起代码' : '查看代码'}</span>
          </button>

          {/* 下载文件按钮 */}
          <button
            onClick={handleDownloadFile}
            class="px-3.5 py-1.5 rounded-xl bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            title="下载到本地"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>下载</span>
          </button>
        </div>
      </div>

      {/* 展开的代码预览区 (限制最大高度 480px 并支持纵向滚动) */}
      <Show when={expanded()}>
        <div class="p-3 bg-slate-950">
          <Show when={loading()}>
            <div class="flex items-center justify-center py-12 text-slate-400 gap-2">
              <div class="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <span class="text-xs font-mono">正在拉取代码内容喵...</span>
            </div>
          </Show>

          <Show when={error()}>
            <div class="p-4 bg-rose-950/40 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-center justify-between">
              <span>{error()}</span>
              <button
                onClick={fetchContent}
                class="px-2.5 py-1 rounded-lg bg-rose-800/60 hover:bg-rose-700 text-white text-xs font-medium"
              >
                重试
              </button>
            </div>
          </Show>

          <Show when={codeContent() !== null && !loading()}>
            <TextPreview
              content={codeContent()!}
              title={props.file.filename}
              language={languageLabel()}
              rawUrl={props.file.downloadUrl}
              maxHeightClass="max-h-[480px]"
              onDownload={handleDownloadFile}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
