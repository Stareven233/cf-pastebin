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

项目已提供环境变量示例模板 `.dev.vars.example`（由于 `.dev.vars` 包含敏感密钥，已在 `.gitignore` 中默认忽略）。首次开发请复制生成本地环境变量配置文件：

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 默认内容如下（开箱即用，可根据需要调整）：

```ini
# 管理员登录密码（请及时修改为高强度密码）
ADMIN_PASSWORD=admin123456

# 会话签名安全密钥（生产环境请使用任意随机高强度字符串）
SESSION_SECRET=cf-pastebin-super-secure-session-key-change-me

# 环境标识
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

执行后终端将输出数据库绑定信息。请复制生成的 `database_id`（UUID 字符串），更新至项目根目录下的 `wrangler.jsonc` 中（替换原有的占位符 `"cf_pastebin_db_id"`）：

```jsonc
  // Cloudflare D1 关系型数据库绑定 (用于元数据、Token与指标)
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cf_pastebin_db",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" // 替换为实际生成的 database_id
    }
  ],
```

> [!NOTE]
> **关于数据表初始化**：系统 Worker 具备冷启动自检能力，会在首次接收请求时自动执行幂等建表（`ensureDatabaseTables`）。若希望在部署前手动预先初始化表结构、默认指标行与索引，亦可主动执行根目录的 SQL 脚本：
> ```bash
> bun x wrangler d1 execute cf_pastebin_db --remote --file=./schema.sql
> ```

### 2. 创建 Cloudflare R2 存储桶

```bash
bun x wrangler r2 bucket create cf-pastebin-bucket
```

> [!TIP]
> **R2 与 D1 的区别**：
> R2 是 Cloudflare 的 **S3 兼容对象存储服务**（用于存放文件、音频与媒体二进制流），它以存储桶（Bucket）为管理单位，配置绑定时仅需指定 `bucket_name`，**不需要也不存在类似 D1 关系型数据库的 `database_id`** 喵！只要确保 `wrangler.jsonc` 中的 `bucket_name` 与此处创建的桶名保持一致即可。

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

部署完成后，`wrangler` 将为您输出专属访问域名（例如 `https://cf-pastebin.<your-subdomain>.workers.dev`）。

### 5. 绑定自定义域名（重要）

> [!WARNING]
> **关于 `workers.dev` 的可访问性**：
> Cloudflare 官方默认分配的 `*.workers.dev` 域名在**中国大陆网络环境下存在普遍的 DNS 污染与 SNI 阻断**，极大概率导致国内访客无法正常打开或连接超时。因此，如果您的服务面向国内用户或需要长期稳定运行，**强烈建议绑定自定义域名**。

绑定自定义域不仅能彻底解决国内网络直连可访问性，还能自动获得专属 SSL 证书，并直接享用 Cloudflare 边缘 CDN 加速、自定义 WAF 安全防护与缓存规则。

#### 配置方式（任选其一）：

- **方式 A：Cloudflare 控制台快速绑定（推荐）**
  1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)；
  2. 依次进入 **Compute (Workers) > Workers & Pages**，点击进入刚刚部署的 `cf-pastebin` 项目；
  3. 切换到 **Settings (设置)** 标签页，在左侧导航选择 **Domains & Routes (域与路由)**；
  4. 在 **Custom Domains (自定义域)** 下点击 **Add (添加)**，输入您托管在 Cloudflare 上的域名（例如 `paste.yourdomain.com`）；
  5. Cloudflare 将自动配置 DNS 解析与 SSL 证书，等待数秒即可全局生效。

- **方式 B：通过 `wrangler.jsonc` 声明路由**
  直接在项目根目录的 `wrangler.jsonc` 中增加 `routes` 属性：
  ```jsonc
  "routes": [
    {
      "pattern": "paste.yourdomain.com",
      "custom_domain": true
    }
  ]
  ```
  保存后重新执行一次 `bun x wrangler deploy` 即可完成部署与域名绑定。

---

## 🛡️ 管理员后台与安全防护

### 1. 访问管理后台

为了防止前台直接暴露管理面板引来恶意扫描与探测，系统设计了隐蔽与动态入口：

- **直接访问**：在浏览器地址栏直接输入 `/admin` 路径（例如 `https://paste.yourdomain.com/admin`）；
- **前端彩蛋快捷唤出**：在网站顶部导航栏，**连续快速点击 Logo 图标 5 次**（2 秒内），页面将弹出提示并自动跳转进入 `/admin` 登录界面；
- **登录后动态常驻**：管理员成功登录后，系统会自动保存会话，此时顶部导航栏右侧将动态常驻显示「后台管理」盾牌入口。

### 2. 多重安全防护体系

- **IP 级防爆破与频控锁定**：依托 Cloudflare D1 中的 `admin_auth_attempts` 表追踪客户端真实 IP 的认证失败记录。单个 IP **连续输错 5 次密码将强制锁定 15 分钟**，锁定期间直接拒绝认证尝试，彻底阻断字典枚举攻击；成功登录后自动清零计数；
- **HMAC-SHA256 会话签名**：基于 Web Crypto API 与环境变量中注入的 `SESSION_SECRET` 私钥派生签名，拒绝任何伪造会话；
- **严格的安全 Cookie 策略**：会话 Cookie 启用 `HttpOnly`（抵御 XSS 窃取）、`SameSite=Lax`（防御 CSRF 跨站请求伪造），并在生产环境下强制开启 `Secure`（仅限 HTTPS 传输），提供 7 天长效免密登录；
- **特权预览通道**：管理员在后台查看标记为“阅后即焚”的分享时，享有免触发销毁的特权预览通道，方便管理与审计；
- **后台永久可用与熔断兜底**：即便全站触发 95% 免费额度停机熔断线阻断外部访客上传，**管理后台仍然始终保持永久可用**，管理员可随时登录后台批量清理大文件/过期 Paste，降容后全自动解封全站。

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
