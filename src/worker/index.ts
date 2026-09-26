/**
 * Cloudflare Worker 主入口
 * 统一处理 API 路由调度、Cron 定时清理触发、Static Assets 前端静态资产回退
 */

import { ensureDatabaseTables, type Env } from './db';
import { incrementMetric } from './metrics';
import { runCronCleanup } from './cron';
import { handleGetTokenInfo, handleDirectFileUpload, handleCompleteUpload } from './routes/upload';
import { handleGetPaste } from './routes/paste';
import { handleDownloadFile } from './routes/file';
import {
  handleAdminLogin,
  handleAdminLogout,
  handleAdminMe,
  handleAdminDashboard,
  handleAdminListPastes,
  handleAdminDeletePaste,
  handleAdminListTokens,
  handleAdminCreateToken,
  handleAdminRevokeToken,
  handleAdminRecalibrate,
} from './routes/admin';

// 幂等数据库初始化标记
let dbInitialized = false;

export default {
  /**
   * HTTP 请求调度主入口
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    // 1. 确保 D1 基础表结构已初始化 (只在 Worker 冷启动后首次执行一次)
    if (!dbInitialized) {
      try {
        await ensureDatabaseTables(env.DB);
        dbInitialized = true;
      } catch (err) {
        console.error('Failed to auto-init tables:', err);
      }
    }

    // 2. 统计每日 Worker API 请求次数 (静态资源请求通常直接由边缘缓存处理不触发此计费)
    if (pathname.startsWith('/api') || pathname.startsWith('/d/')) {
      ctx.waitUntil(incrementMetric(env.DB, 'worker_req_day', 1));
    }

    // 3. API 路由调度分发
    // --- 上传相关 ---
    if (pathname === '/api/upload/token-info' && method === 'GET') {
      return handleGetTokenInfo(request, env);
    }
    if (pathname === '/api/upload/direct' && method === 'POST') {
      return handleDirectFileUpload(request, env);
    }
    if (pathname === '/api/upload/complete' && method === 'POST') {
      return handleCompleteUpload(request, env);
    }

    // --- 分享数据查看相关 ---
    if (pathname.startsWith('/api/paste/') && method === 'GET') {
      const slug = pathname.replace('/api/paste/', '').trim();
      return handleGetPaste(request, env, slug, ctx);
    }

    // --- 直链下载与多媒体流 ---
    if (pathname.startsWith('/d/') && method === 'GET') {
      const parts = pathname.replace('/d/', '').split('/').filter(Boolean);
      const slug = parts[0];
      const fileId = parts[1];
      if (slug) {
        return handleDownloadFile(request, env, slug, fileId, ctx);
      }
    }

    // --- 管理员后台 API ---
    if (pathname === '/api/admin/login' && method === 'POST') {
      return handleAdminLogin(request, env);
    }
    if (pathname === '/api/admin/logout' && method === 'POST') {
      return handleAdminLogout();
    }
    if (pathname === '/api/admin/me' && method === 'GET') {
      return handleAdminMe(request, env);
    }
    if (pathname === '/api/admin/dashboard' && method === 'GET') {
      return handleAdminDashboard(request, env);
    }
    if (pathname === '/api/admin/pastes' && method === 'GET') {
      return handleAdminListPastes(request, env);
    }
    if (pathname.startsWith('/api/admin/pastes/') && method === 'DELETE') {
      const id = pathname.replace('/api/admin/pastes/', '').trim();
      return handleAdminDeletePaste(request, env, id);
    }
    if (pathname === '/api/admin/tokens' && method === 'GET') {
      return handleAdminListTokens(request, env);
    }
    if (pathname === '/api/admin/tokens' && method === 'POST') {
      return handleAdminCreateToken(request, env);
    }
    if (pathname.startsWith('/api/admin/tokens/') && method === 'DELETE') {
      const id = pathname.replace('/api/admin/tokens/', '').trim();
      return handleAdminRevokeToken(request, env, id);
    }
    if (pathname === '/api/admin/recalibrate' && method === 'POST') {
      return handleAdminRecalibrate(request, env);
    }

    // 4. 前端静态单页应用资源回退 (Cloudflare Workers with Static Assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('404 Not Found', { status: 404 });
  },

  /**
   * Cloudflare Cron Trigger 定时调度入口 (每小时执行一次自动扫描清理)
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const res = await runCronCleanup(env);
          console.log(`[Cron] Cleanup completed: ${res.expiredPastesCount} pastes deleted, ${(res.totalFreedBytes / 1024 / 1024).toFixed(2)} MB freed, ${res.expiredTokensCount} tokens expired.`);
        } catch (err) {
          console.error('[Cron] Cleanup failed:', err);
        }
      })()
    );
  }
};
