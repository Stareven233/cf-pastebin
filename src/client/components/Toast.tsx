/**
 * 全局轻量 Toast 提示组件
 */

import { createSignal, Show, For } from 'solid-js';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  text: string;
}

const [toasts, setToasts] = createSignal<ToastMessage[]>([]);

/**
 * 触发全局 Toast 消息
 */
export function showToast(text: string, type: ToastMessage['type'] = 'info', duration = 3500) {
  const id = Math.random().toString(36).substring(2, 9);
  setToasts(prev => [...prev, { id, type, text }]);

  setTimeout(() => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, duration);
}

export function ToastContainer() {
  return (
    <div class="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full px-4">
      <For each={toasts()}>
        {(toast) => (
          <div
            class={`pointer-events-auto flex items-center justify-between px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all duration-300 transform translate-y-0 opacity-100 ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-emerald-500/10'
                : toast.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200 shadow-rose-500/10'
                : toast.type === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-200 shadow-amber-500/10'
                : 'bg-slate-800 text-white border-slate-700 shadow-slate-900/20'
            }`}
          >
            <div class="flex items-center gap-2">
              <Show when={toast.type === 'success'}>
                <svg class="w-5 h-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </Show>
              <Show when={toast.type === 'error'}>
                <svg class="w-5 h-5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Show>
              <Show when={toast.type === 'warning'}>
                <svg class="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </Show>
              <span>{toast.text}</span>
            </div>
            <button
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              class="ml-3 text-slate-400 hover:text-slate-600 transition-colors"
            >
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
