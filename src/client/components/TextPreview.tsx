/**
 * 纯文本与代码高亮/行号预览组件
 */

import { createSignal, For } from 'solid-js';
import { copyToClipboard } from '../utils/format';
import { showToast } from './Toast';

export interface TextPreviewProps {
  content: string;
  rawUrl?: string;
  title?: string;
}

export function TextPreview(props: TextPreviewProps) {
  const [wrapLines, setWrapLines] = createSignal(true);
  const lines = () => (props.content || '').split('\n');

  const handleDownload = () => {
    const blob = new Blob([props.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${props.title || 'paste'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('文本已成功下载喵！', 'success');
  };

  const handleCopy = async () => {
    const success = await copyToClipboard(props.content);
    if (success) {
      showToast('文本内容已成功复制到剪贴板喵！', 'success');
    } else {
      showToast('复制失败，请手动选择复制', 'error');
    }
  };

  return (
    <div class="w-full bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden transition-all">
      {/* 顶部操作工具栏 */}
      <div class="flex items-center justify-between px-4 py-3 bg-slate-950/70 border-b border-slate-800/80 text-xs">
        <div class="flex items-center gap-3">
          <div class="flex gap-1.5">
            <div class="w-3 h-3 rounded-full bg-rose-500/80" />
            <div class="w-3 h-3 rounded-full bg-amber-500/80" />
            <div class="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <span class="text-slate-400 font-mono">
            {props.title || '纯文本'} • {lines().length} 行 • {props.content.length} 字符
          </span>
        </div>

        <div class="flex items-center gap-2">
          {/* 自动换行开关 */}
          <button
            onClick={() => setWrapLines(!wrapLines())}
            class={`px-2.5 py-1 rounded-md font-medium transition-colors ${
              wrapLines()
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="切换自动换行"
          >
            换行: {wrapLines() ? '开' : '关'}
          </button>

          {/* 下载文本文件 */}
          <button
            onClick={handleDownload}
            class="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            title="下载为 .txt 纯文本文件"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>下载</span>
          </button>

          {/* Raw 查看链接 */}
          {props.rawUrl && (
            <a
              href={props.rawUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              Raw
            </a>
          )}

          {/* 复制按钮 (暖橙高光) */}
          <button
            onClick={handleCopy}
            class="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent-600 hover:bg-accent-500 text-white font-medium transition-all shadow-xs"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            <span>复制代码</span>
          </button>
        </div>
      </div>

      {/* 文本内容与行号 */}
      <div class="p-4 font-mono text-sm leading-relaxed overflow-x-auto max-h-[650px] overflow-y-auto">
        <div class="flex">
          {/* 行号栏 */}
          <div class="select-none text-slate-600 text-right pr-4 shrink-0 font-mono text-xs leading-relaxed border-r border-slate-800">
            <For each={lines()}>
              {(_, index) => <div>{index() + 1}</div>}
            </For>
          </div>

          {/* 正文 */}
          <pre class={`pl-4 text-slate-200 grow font-mono text-xs sm:text-sm ${
            wrapLines() ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
          }`}>
            {props.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
