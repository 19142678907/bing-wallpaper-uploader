# Bing Wallpaper Uploader

基于 Cloudflare Workers �?Bing 每日壁纸自动上传器。它会定时获�?Bing 每日壁纸，下载指定分辨率图片，并上传�?Cloudflare ImgBed�?
适合用来搭建个人壁纸归档、自动图床同步、每日图片推送前置任务，或者作�?Cloudflare Workers 自动化任务的 TypeScript 示例项目�?
## 功能特�?
- 自动获取 Bing 每日壁纸
- 支持 Cron 定时执行
- 支持 HTTP 手动触发
- 支持上传今天、最近多天、指定日期偏移的壁纸
- 支持多个 Bing 市场区域，例�?`en-US`、`zh-CN`、`ja-JP`
- 支持多种分辨率：`1920x1080`、`UHD`、`3840x2160`、`2560x1440`
- 上传失败自动重试
- 多日上传保留单张成功或失败结�?- 使用 TypeScript 编写，模块边界清晰，方便扩展

## 工作流程

```text
Cloudflare Cron / HTTP Request
  -> Worker entry
  -> Scheduler
  -> Bing Wallpaper API
  -> Download image
  -> Cloudflare ImgBed upload
  -> Return uploaded image URL
```

## 项目结构

```text
bing-wallpaper-uploader/
|-- src/
|   |-- index.ts           # Cloudflare Worker 入口
|   |-- types/
|   |   `-- index.ts       # 类型定义
|   `-- modules/
|       |-- config.ts      # 配置读取和校�?|       |-- bing.ts        # Bing API 客户�?|       |-- upload.ts      # ImgBed 上传客户�?|       |-- scheduler.ts   # 上传流程编排
|       `-- utils.ts       # 日志、错误类型、工具函�?|-- wrangler.toml          # Cloudflare Worker 配置
|-- TECHNICAL.md           # 技术文�?|-- package.json
`-- README.md
```

更多实现细节�?[TECHNICAL.md](./TECHNICAL.md)�?
## 环境要求

- Node.js 18 或更高版�?- npm
- Cloudflare 账号
- Cloudflare ImgBed 实例
- Wrangler CLI，项目依赖中已包�?
## 快速开�?
### 1. 安装依赖

```bash
npm install
```

�?Windows PowerShell 中如果遇�?`npm.ps1` 执行策略限制，可以使用：

```powershell
npm.cmd install
```

### 2. 配置本地环境变量

复制示例配置�?
```bash
cp .example.env .dev.vars
```

编辑 `.dev.vars`�?
```env
IMG_BED_URL=https://your-imgbed-domain.com
IMG_BED_AUTH_CODE=your_auth_code_here
IMG_BED_CHANNEL=telegram
BING_MARKET=en-US
BING_RESOLUTION=1920x1080
LOG_LEVEL=info
```

不要�?`.dev.vars` 提交�?Git�?
### 3. 本地运行

```bash
npm run dev
```

默认本地地址通常是：

```text
http://localhost:8787
```

测试健康检查：

```bash
curl http://localhost:8787/health
```

手动上传今天的壁纸：

```bash
curl -X POST http://localhost:8787/upload \
  -H "Authorization: Bearer your_secure_token_here"
```

**注意**：`/upload`、`/upload/multi` 和 `/upload/date` 端点需要 TRIGGER_TOKEN 鉴权。在 `.dev.vars` 中设置 `TRIGGER_TOKEN`，请求时通过 `Authorization: Bearer <token>` 头传递。

## 部署�?Cloudflare Workers

### 1. 设置生产密钥

```bash
wrangler secret put IMG_BED_URL
wrangler secret put IMG_BED_AUTH_CODE
```

可选：

```bash
wrangler secret put IMG_BED_CHANNEL
```

也可以使用项目脚本：

```bash
npm run secret:upload
npm run secret:auth
npm run secret:channel
```

### 2. 配置 Cron

`wrangler.toml` 中默认配置：

```toml
[triggers]
crons = ["0 8 * * *"]
```

表示每天 UTC 08:00 执行，也就是北京时间 16:00�?
常见 Cron 示例�?
| 表达�?| 含义 |
| --- | --- |
| `0 8 * * *` | 每天 UTC 08:00 |
| `0 0 * * *` | 每天 UTC 00:00 |
| `0 */12 * * *` | �?12 小时 |
| `0 0 * * 1` | 每周一 UTC 00:00 |

### 3. 部署

```bash
npm run deploy
```

如果使用 production 环境�?
```bash
npm run deploy:production
```

## 环境变量

| 变量 | 必填 | 默认�?| 说明 |
| --- | --- | --- | --- |
| `IMG_BED_URL` | �?| - | Cloudflare ImgBed 根地址 |
| `IMG_BED_AUTH_CODE` | �?| - | ImgBed 上传认证�?|
| `IMG_BED_CHANNEL` | �?| `telegram` | 上传通道，可�?`telegram`、`cfr2`、`s3`、`discord`、`huggingface` |
| `BING_MARKET` | �?| `en-US` | Bing 市场区域 |
| `BING_RESOLUTION` | �?| `1920x1080` | 壁纸分辨�?|
| `LOG_LEVEL` | �?| `info` | 日志级别，可�?`debug`、`info`、`warn`、`error` |

`BING_RESOLUTION` 支持�?
- `1920x1080`
- `UHD`
- `3840x2160`
- `2560x1440`

## HTTP API

部署后，Worker 提供以下接口�?
| Endpoint | Method | 说明 |
| --- | --- | --- |
| `/` | GET | 健康检�?|
| `/health` | GET | 健康检�?|
| `/upload` | POST | 上传今天的壁�?|
| `/upload/multi?days=7` | GET | 上传最�?N 天壁纸，范围 1 �?8 |
| `/upload/date?daysAgo=1` | GET | 上传 N 天前壁纸，范�?0 �?7 |

### 健康检�?
```bash
curl https://your-worker.workers.dev/health
```

响应示例�?
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T12:00:00.000Z",
  "message": "Bing Wallpaper Uploader Worker is running"
}
```

### 上传今天的壁�?
```bash
curl -X POST https://your-worker.workers.dev/upload \
  -H "Authorization: Bearer your_secure_token_here"
```

`/upload`、`/upload/multi` 和 `/upload/date` 需要 TRIGGER_TOKEN 鉴权。`/health` 和 `/` 无需鉴权。

响应示例�?
```json
{
  "success": true,
  "timestamp": "2026-01-20T12:00:00.000Z",
  "imageUrl": "https://your-imgbed.com/file/abc123",
  "error": null
}
```

### 上传最近多天壁�?
```bash
curl -X POST "https://your-worker.workers.dev/upload/multi" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secure_token_here" \
  -d '{"days": 7}'
```

### 上传指定日期偏移的壁�?
```bash
curl -X POST "https://your-worker.workers.dev/upload/date" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secure_token_here" \
  -d '{"daysAgo": 1}'
```

`daysAgo=1` 表示昨天，`daysAgo=0` 表示今天�?
## 开发命�?
| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地 Worker |
| `npm run build` | 编译 TypeScript |
| `npm run type-check` | 仅做类型检�?|
| `npm run lint` | 运行 ESLint |
| `npm run lint:fix` | 自动修复可修复的 lint 问题 |
| `npm run format` | 使用 Prettier 格式�?|
| `npm run deploy` | 部署 Worker |
| `npm run deploy:production` | 部署�?production 环境 |

Windows PowerShell 可使�?`npm.cmd`�?
```powershell
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
```

## 安全说明

当前 HTTP 手动触发接口没有额外鉴权。部署到公网后，任何能访�?Worker URL 的人都可以调�?`/upload`、`/upload/multi`、`/upload/date`�?
如果用于生产环境，建议至少选择一种保护方式：

- �?Cloudflare Zero Trust 中限制访�?- 增加自定�?`TRIGGER_TOKEN`
- 只保�?Cron 触发，关闭或限制手动触发接口
- �?Cloudflare WAF �?Access Rules 中限制来�?
同时注意�?
- 不要提交 `.dev.vars`
- 不要�?`IMG_BED_AUTH_CODE` 写入 README、issue 或日�?- 部署前检�?Git 状态，避免提交本地产物

## 故障排查

### PowerShell 无法执行 npm

如果看到类似错误�?
```text
npm.ps1 cannot be loaded because running scripts is disabled
```

可以改用�?
```powershell
npm.cmd run dev
```

### 缺少环境变量

如果响应里出现：

```text
Missing required environment variables
```

检�?`.dev.vars` �?Wrangler secrets 是否设置了：

- `IMG_BED_URL`
- `IMG_BED_AUTH_CODE`

### 分辨率配置错�?
如果出现�?
```text
Invalid BING_RESOLUTION
```

请确�?`BING_RESOLUTION` 是以下值之一�?
- `1920x1080`
- `UHD`
- `3840x2160`
- `2560x1440`

### 上传失败

重点检查：

- `IMG_BED_URL` 是否能访�?- `IMG_BED_AUTH_CODE` 是否正确
- `IMG_BED_CHANNEL` 是否被你�?ImgBed 实例支持
- ImgBed 实例是否有可用的后端存储通道

## 后续扩展

可以继续扩展�?
- 上传成功后发�?webhook 通知
- 使用 D1 �?KV 记录上传历史
- 增加重复上传检�?- 给手动触发接口增加鉴�?- 增加更多图片来源
- 增加 GitHub Actions 自动部署

## 许可�?
MIT License
