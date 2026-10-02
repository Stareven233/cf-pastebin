/**
 * SolidJS 主应用程序与路由架构
 */

import { Router, Route } from '@solidjs/router';
import type { RouteSectionProps } from '@solidjs/router';
import { Navbar } from './components/Navbar';
import { ToastContainer } from './components/Toast';
import { UploadPage } from './pages/UploadPage';
import { ShareViewPage } from './pages/ShareViewPage';
import { AdminPage } from './pages/AdminPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ADMIN_PATH } from './config';

/**
 * 全局应用顶层布局组件
 * 将 Navbar 与通用布局置于 Router 提供的上下文内，确保 <A> 及路由原语正常运作
 */
function RootLayout(props: RouteSectionProps) {
  return (
    <div class="min-h-screen flex flex-col bg-slate-50 bg-mesh-pattern text-slate-800">
      <Navbar />

      <main class="grow">
        {props.children}
      </main>

      {/* 极简清新页脚 */}
      <footer class="border-t border-emerald-100/60 bg-white/50 backdrop-blur-xs py-6 text-center text-xs text-slate-400">
        <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p class="font-medium text-slate-500">
            Pastebin
          </p>
          <p class="flex items-center gap-2">
            私密分享 • 阅后即焚 • 自动清理
          </p>
        </div>
      </footer>

      {/* 全局消息提示容器 */}
      <ToastContainer />
    </div>
  );
}

export function App() {
  return (
    <Router root={RootLayout}>
      <Route path="/" component={UploadPage} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/s/:slug" component={ShareViewPage} />
      <Route path={ADMIN_PATH} component={AdminPage} />
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
