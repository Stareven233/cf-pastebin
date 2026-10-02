/**
 * SolidJS 主应用程序与路由架构
 */

import { Router, Route } from '@solidjs/router';
import { A } from '@solidjs/router';
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
      <footer class="flex flex-row items-baseline max-w-7xl mx-auto border-t border-emerald-100/60 bg-white/50 backdrop-blur-xs py-4 text-center text-xs text-slate-400">
        <p class="px-2 flex flex-col sm:flex-row font-medium text-slate-500">
            pastebin由"paste"（粘贴）和"bin"（容器）组合而来，允许用户将任意文本/代码/文件上传到服务器，保存内容并生成唯一链接，获得该链接的人可以在浏览器中查看完整内容，无需注册账号
        </p>
        <span class='bg-emerald-50 text-emerald-700 hover:bg-emerald-200 rounded-md  border-emerald-200/50 font-medium p-1'><A href='https://space.bilibili.com/1610042298'>@獭栖八雫</A></span>
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
