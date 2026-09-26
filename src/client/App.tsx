/**
 * SolidJS 主应用程序与路由架构
 */

import { Router, Route } from '@solidjs/router';
import { Navbar } from './components/Navbar';
import { ToastContainer } from './components/Toast';
import { UploadPage } from './pages/UploadPage';
import { ShareViewPage } from './pages/ShareViewPage';
import { AdminPage } from './pages/AdminPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <div class="min-h-screen flex flex-col bg-slate-50 bg-mesh-pattern text-slate-800">
      <Navbar />

      <main class="grow">
        <Router>
          <Route path="/" component={UploadPage} />
          <Route path="/upload" component={UploadPage} />
          <Route path="/s/:slug" component={ShareViewPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="*404" component={NotFoundPage} />
        </Router>
      </main>

      {/* 极简清新页脚 */}
      <footer class="border-t border-emerald-100/60 bg-white/50 backdrop-blur-xs py-6 text-center text-xs text-slate-400">
        <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p class="font-medium text-slate-500">
            CF Pastebin • 零成本私密资源分享系统
          </p>
          <p class="flex items-center gap-2">
            <span>运行于 Cloudflare 免费配额层</span>
            <span>•</span>
            <span class="text-emerald-700 font-semibold">阅后即焚 & 自动物理清理</span>
          </p>
        </div>
      </footer>

      {/* 全局消息提示容器 */}
      <ToastContainer />
    </div>
  );
}
