import { defineConfig, loadEnv } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export default defineConfig(({ mode }) => {
  // 加载本地环境变量 (.env, .env.local 等)
  const env = loadEnv(mode, process.cwd(), '');

  let adminPath = env.VITE_ADMIN_PATH || process.env.VITE_ADMIN_PATH;

  // 若未手动配置管理后台路径，则自动生成不可预测的高强度随机字符串作为默认入口（防扫描爆破）
  if (!adminPath) {
    const randomSuffix = crypto.randomBytes(4).toString('hex'); // 8位随机十六进制字符
    adminPath = `/adm_${randomSuffix}`;

    // 自动持久化写入本地 .env 文件，避免多次构建或开发重启导致路径意外漂移
    const envFile = path.resolve(process.cwd(), '.env');
    try {
      if (fs.existsSync(envFile)) {
        const content = fs.readFileSync(envFile, 'utf-8');
        if (!content.includes('VITE_ADMIN_PATH=')) {
          fs.appendFileSync(
            envFile,
            `\n# 管理后台安全入口自定义路径 (系统自动初次生成，可随时手动修改)\nVITE_ADMIN_PATH=${adminPath}\n`
          );
        }
      } else {
        fs.writeFileSync(
          envFile,
          `# 管理后台安全入口自定义路径 (系统自动初次生成，可随时手动修改)\nVITE_ADMIN_PATH=${adminPath}\n`
        );
      }
    } catch (err) {
      console.warn('⚠️ 自动持久化 .env 文件失败:', err);
    }
  }

  // 规范化路径：确保以 / 开头且不以 / 结尾
  adminPath = '/' + adminPath.replace(/^\/+|\/+$/g, '');

  console.log('\x1b[32m%s\x1b[0m', `🛡️  [Security] 管理后台安全入口路径: ${adminPath}`);

  return {
    plugins: [solidPlugin()],
    define: {
      'import.meta.env.VITE_ADMIN_PATH': JSON.stringify(adminPath),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/d': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
