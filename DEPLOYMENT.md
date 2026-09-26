# CF Pastebin 部署与运维指南

本项目基于 **Bun + TypeScript + SolidJS + TailwindCSS** 全栈架构，通过 **Cloudflare Workers with Static Assets** 模式单体一体化部署，底层强绑定 **Cloudflare D1** 关系型数据库与 **Cloudflare R2** 对象存储桶，并原生接入 **Crons 定时调度器**。

---

## 1. 本地开发与仿真调试

### 1.1 依赖安装
```bash
bun install
```

### 1.2 本地环境变量
项目根目录自带 `.dev.vars`（默认初始管理员密码为 `admin123456`）：
```ini
ADMIN_PASSWORD=admin123456
SESSION_SECRET=cf-pastebin-local-dev-secret-key-32bytes-secure
ENVIRONMENT=development
```

### 1.3 启动本地开发服务
1. **构建前端产物**：
```bash
bun run build
```

2. **启动 Cloudflare Worker 本地仿真（自动模拟 D1、R2 与 Assets）**：
```bash
bun x wrangler dev
```
启动后终端将输出访问地址（通常为 `http://localhost:8787`）。

3. **运行全量自动化测试套件**：
```bash
bun test
```

---

## 2. Cloudflare 生产环境一键部署

### 2.1 创建 Cloudflare D1 数据库
在 Cloudflare 终端或仪表盘执行：
```bash
bun x wrangler d1 create cf_pastebin_db
```
执行后将输出类似如下配置：
```jsonc
[[d1_databases]]
binding = "DB"
database_name = "cf_pastebin_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
请将该 `database_id` 填入根目录下的 `wrangler.jsonc` 中。

### 2.2 创建 Cloudflare R2 存储桶
```bash
bun x wrangler r2 bucket create cf-pastebin-bucket
```

### 2.3 设置生产环境管理员密码与密钥
```bash
# 设置管理员控制台登录密码 (请使用高强度密码)
bun x wrangler secret put ADMIN_PASSWORD

# 设置会话签名私钥 (任意 32 字符以上随机字符串)
bun x wrangler secret put SESSION_SECRET
```

### 2.4 构建并一键发布
```bash
# 1. 编译前端静态单页资源
bun run build

# 2. 部署 Worker + Static Assets + Crons 到 Cloudflare 全球边缘节点
bun x wrangler deploy
```

---

## 3. 功能特性与运维注意事项

### 3.1 免费额度双阶熔断防护体系
系统内置实时用量守护算法，杜绝任何超额产生扣费：
- **80% 警戒水位**：管理后台显示黄色预警卡片，系统所有功能保持正常可用；
- **95% 熔断安全红线**：前台访客服务立即停止（提示明确超限原因），**管理后台始终保持永久可用**；
- **自动恢复机制**：若是存储空间达到 95%，管理员在后台删除过期或大文件使容量降回 95% 以下后，前台全自动恢复。

### 3.2 定时物理清理 (Cron Trigger)
`wrangler.jsonc` 内置 `[triggers] crons = ["0 * * * *"]`：
- 每小时整点触发 Worker 后台扫描已过期分享；
- 批量调用 R2 `bucket.delete(keys)` 彻底抹除物理对象；
- 同步扣减 D1 存储总容量并校准指标。

### 3.3 一次性上传 Token 生命周期
- 每一个由管理端签发的外人上传 URL 仅允许提交 1 次；
- 外人在设定的容量配额（如 50MB）范围内可添加多个音频或文本；
- 点击生成短链后，该 Token 立即永久失效，防止二次滥用。
