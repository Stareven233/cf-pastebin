/**
 * 顶部导航栏组件 (清新绿 + 活力暖橙风格)
 */

import { createSignal, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { apiAdminMe } from '../utils/api';
import { ADMIN_PATH } from '../config';

export function Navbar() {
  // 当前是否为管理员已登录状态
  const [isAdmin, setIsAdmin] = createSignal(false);

  // 挂载时动态探测管理员登录态
  onMount(async () => {
    try {
      const res = await apiAdminMe();
      if (res.success && res.data?.isAdmin) {
        setIsAdmin(true);
      }
    } catch {
      // 忽略探针异常
    }
  });

  return (
    <header class="sticky top-0 z-40 w-full backdrop-blur-md bg-white/80 border-b border-emerald-100/60 shadow-xs transition-all">
      <div class="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
        {/* Logo 区域 */}
        <A
          href="/"
          class="flex items-center gap-2 sm:gap-3 group focus:outline-hidden select-none"
        >
          <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform shrink-0">
            <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" stroke-width="2.2" />
            </svg>
          </div>
          <div class="flex items-center">
            <span class="text-base sm:text-lg font-bold bg-gradient-to-r from-emerald-800 to-emerald-600 bg-clip-text text-transparent">
              CF Pastebin
            </span>
            <span class="hidden md:inline-block ml-2 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50 font-medium">
              Private & Ephemeral
            </span>
          </div>
        </A>

        {/* 右侧导航操作：移动端紧凑适配与动态入口展示 */}
        <div class="flex items-center gap-1.5 sm:gap-3">
          <A
            href="/upload"
            class="text-xs sm:text-sm font-medium text-slate-600 hover:text-emerald-700 transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-emerald-50"
          >
            凭证上传
          </A>

          {/* 仅在当前用户已登录管理员时，才在前台动态呈现管理入口，防止被恶意探测爆破 */}
          <Show when={isAdmin()}>
            <A
              href={ADMIN_PATH}
              class="flex items-center gap-1 text-xs sm:text-sm font-semibold text-emerald-800 bg-emerald-100/80 hover:bg-emerald-200/80 px-2.5 sm:px-3.5 py-1.5 rounded-xl transition-all shadow-xs border border-emerald-200/60"
            >
              <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>后台管理</span>
            </A>
          </Show>
        </div>
      </div>
    </header>
  );
}
