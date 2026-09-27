# 🗂️ CF Pastebin

<p align="center">
  <strong>基于 Cloudflare 全家桶构建的轻量、安全、现代化全栈云剪贴板与临时文件分享系统</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Runtime-Bun-f472b6?logo=bun&logoColor=white" alt="Bun" />
  <img src="https://img.shields.io/badge/Language-TypeScript-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Frontend-SolidJS-446b9e?logo=solid&logoColor=white" alt="SolidJS" />
  <img src="https://img.shields.io/badge/Styling-TailwindCSS_v4-38bdf8?logo=tailwindcss&logoColor=white" alt="TailwindCSS" />
  <img src="https://img.shields.io/badge/Backend-Cloudflare_Workers-f38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Database-Cloudflare_D1-f38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1" />
  <img src="https://img.shields.io/badge/Storage-Cloudflare_R2-f38020?logo=cloudflare&logoColor=white" alt="Cloudflare R2" />
  <img src="https://img.shields.io/badge/License-MIT-emerald?style=flat" alt="License" />
</p>

---

## ✨ 核心特性

- 🚀 **全栈 Serverless 架构**：前端基于 SolidJS + TailwindCSS，后端单体运行于 Cloudflare Workers (Static Assets) 边缘运行时，全球毫秒级冷启动与响应。
- 🎵 **在线多媒体试听与流播放**：自研现代 HTML5 音频播放器，原生支持 **HTTP Range (206 Partial Content)** 分片流式解码，支持进度拖拽、音量微调、时长解析、直链一键复制与本地下载。
- 💻 **代码与文本高亮预览**：针对代码及纯文本文件提供行号显示、自适应语法标签与限高滚动卡片，支持直接查看 Raw 原文。
- 🔥 **阅后即焚（Burn After Read）**：访客开屏即焚（二次刷新或二次访问立即 404）；为当前会话安全签发 15 分钟 HMAC 签名凭据（`read_token`），保障流畅试听与下载，超时自动物理清理。
- 🎫 **一次性配额 Token 上传通道**：支持管理员签发带自定义时效与配额上限（如 10MB、25MB）的临时上传凭证与链接，一经提交立即作废，杜绝公网被恶意刷盘。
- 🛡️ **双阶免费额度熔断保护体系**：
  - **80% 水位预警**：管理端仪表盘亮起黄色告警，全站功能保持可用；
  - **95% 熔断红线**：前台访客服务自动阻断，**管理后台始终永久可用**，管理员清理文件降容后全自动解封，严防产生 Cloudflare 任何超额扣费。
- 🧹 **Cron 定时物理清理**：接入 Cloudflare Cron Triggers，每小时自动轮询物理清除过期 Paste 与 R2 孤儿文件，同步校准 D1 存储指标。
- 👑 **特权管理端**：支持免密长效 Cookie 会话、最大 100MB 单文件物理直传极限、数据大盘统计与**免焚毁特权预览通道**。

---

## 🛠️ 技术栈总览

| 模块 | 技术方案 | 说明 |
| :--- | :--- | :--- |
| **包管理 / 运行** | [Bun](https://bun.sh/) | 超高速 JavaScript/TypeScript 运行时与依赖管理 |
| **前端框架** | [SolidJS](https://www.solidjs.com/) | 极致性能的细粒度响应式前端框架 |
| **路由系统** | [@solidjs/router](https://github.com/solidjs/solid-router) | 声明式轻量单页路由 |
| **CSS 样式** | [TailwindCSS](https://tailwindcss.com/) | 原子化样式与现代化渐变卡片视觉设计 |
| **后端运行** | [Cloudflare Workers](https://workers.cloudflare.com/) | 边缘无服务器函数 (支持 Static Assets 托管) |
| **元数据存储** | [Cloudflare D1](https://developers.cloudflare.com/d1/) | 边缘关系型 SQLite 数据库 |
| **对象存储** | [Cloudflare R2](https://developers.cloudflare.com/r2/) | S3 兼容且免出网流量费的对象存储桶 |
| **定时调度** | Cloudflare Cron Triggers | 定时触发全量过期与焚毁资源物理销毁 |

---

## 🚀 本地开发与调试

### 1. 克隆项目并安装依赖

```bash
git clone git@github.com:Stareven233/cf-pastebin.git
cd cf-pastebin
bun install
```

### 2. 配置本地仿真环境变量

项目根目录包含 `.dev.vars`，默认开箱即用：

```ini
ADMIN_PASSWORD=admin123456
SESSION_SECRET=cf-pastebin-local-dev-secret-key-32bytes-secure
ENVIRONMENT=development
```

### 3. 运行本地开发与仿真服务

```bash
# 构建前端静态产物
bun run build:client

# 启动 Worker 边缘仿真（自动模拟 D1、R2 与静态资源托管）
bun x wrangler dev
```

访问终端输出的本地地址（通常为 `http://localhost:8787`）。

---

## ☁️ 生产环境一键部署

### 1. 创建 Cloudflare D1 数据库

```bash
bun x wrangler d1 create cf_pastebin_db
```

执行后将输出类似如下的数据库配置信息：
```jsonc
[[d1_databases]]
binding = "DB"
database_name = "cf_pastebin_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
请将该 `database_id` 填入根目录下的 `wrangler.jsonc` 中。

### 2. 创建 Cloudflare R2 存储桶

```bash
bun x wrangler r2 bucket create cf-pastebin-bucket
```

### 3. 设置生产环境管理员密码与签名密钥

```bash
# 设置后台管理面板登录密码 (请务必使用强密码)
bun x wrangler secret put ADMIN_PASSWORD

# 设置会话签名私钥 (任意 32 位以上随机安全字符串)
bun x wrangler secret put SESSION_SECRET
```

### 4. 构建并一键发布至边缘网络

```bash
# 1. 编译前端单页应用
bun run build:client

# 2. 发布 Worker + Static Assets + Crons 到 Cloudflare 全球边缘节点
bun x wrangler deploy
```

部署完成后，`wrangler` 将为您输出专属访问域名（例如 `https://cf-pastebin.<your-subdomain>.workers.dev`）喵！

---

## 🔒 运维与容量管理

### 免费额度边界参考（Cloudflare Free Tier）

| 指标项 | 免费额度上限 | 80% 警戒线 | 95% 停机熔断线 |
| :--- | :--- | :--- | :--- |
| **R2 存储空间** | 10 GB | 8 GB | 9.5 GB |
| **R2 Class A 操作** | 1,000,000 次/月 | 800,000 次 | 950,000 次 |
| **R2 Class B 操作** | 10,000,000 次/月 | 8,000,000 次 | 9,500,000 次 |
| **Worker 请求数** | 100,000 次/天 | 80,000 次 | 95,000 次 |

> [!TIP]
> 当存储空间触发 95% 熔断时，前台将暂时拒绝新上传以保护额度。管理员登录后台后直接批量删除过期/超大分享，存储总容量回落至 95% 以下后，全站服务将全自动恢复。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 开源协议。
