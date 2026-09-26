/**
 * 404 页面不存在组件
 */

import { A } from '@solidjs/router';

export function NotFoundPage() {
  return (
    <div class="max-w-md mx-auto px-4 py-20 text-center">
      <div class="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4 border border-emerald-100 font-mono text-2xl font-bold">
        404
      </div>
      <h2 class="text-xl font-bold text-slate-800 mb-2">页面不存在或已销毁</h2>
      <p class="text-xs text-slate-500 mb-6">
        您访问的链接可能已超期自动删除，或者短链地址有误喵~
      </p>
      <A
        href="/"
        class="inline-block px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold transition-all shadow-md shadow-accent-600/20"
      >
        返回主页
      </A>
    </div>
  );
}
