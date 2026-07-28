# Bing Wallpaper Uploader

> 使用 Cloudflare Workers 自动获取 Bing 每日壁纸，并上传至 Cloudflare ImgBed。

支持定时归档、手动补传和可选的 D1 去重，适合构建个人壁纸库或图片同步任务。

## 功能

- **自动上传**：按 Cron 获取并上传当天 Bing 壁纸。
- **手动补传**：支持上传今天、最近 1–8 天或指定偏移日期的壁纸。
- **可配置来源**：选择 Bing 市场和图片分辨率。
- **可靠传输**：下载与上传失败自动重试；批量任务保留逐项结果。
- **可选幂等性**：配置 D1 后，同一日期的壁纸不会重复上传。
- **受保护接口**：所有上传端点都需要 `TRIGGER_TOKEN`。

## 工作流程

```text
Cron / HTTP 请求
      │
      ▼
Cloudflare Worker → Bing Wallpaper API → 下载图片 → Cloudflare ImgBed
      │
      └── 可选：D1 记录上传日期，防止重复上传
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

PowerShell 若阻止运行 `npm.ps1`，请使用：

```powershell
npm.cmd install
```

### 2. 配置本地变量

复制示例文件：

```bash
cp .example.env .dev.vars
```

编辑 `.dev.vars`：

```env
IMG_BED_URL=https://your-imgbed-domain.example
IMG_BED_AUTH_CODE=your_auth_code
IMG_BED_CHANNEL=telegram
TRIGGER_TOKEN=replace_with_a_long_random_token
BING_MARKET=en-US
BING_RESOLUTION=1920x1080
LOG_LEVEL=info
```

> 不要提交 `.dev.vars` 或任何密钥。

### 3. 本地运行

```bash
npm run dev
```

检查服务：

```bash
curl http://localhost:8787/health
```

手动上传当天壁纸：

```bash
curl -X POST http://localhost:8787/upload \
  -H "Authorization: Bearer your_trigger_token"
```

## 部署

### 配置生产密钥

```bash
wrangler secret put IMG_BED_URL
wrangler secret put IMG_BED_AUTH_CODE
wrangler secret put TRIGGER_TOKEN
```

可选配置：

```bash
wrangler secret put IMG_BED_CHANNEL
```

### 部署 Worker

```bash
npm run deploy
```

默认 Cron 为 `0 8 * * *`，即每天 UTC 08:00（北京时间 16:00）。在 [wrangler.toml](./wrangler.toml) 中修改它。

### 可选：启用 D1 去重

创建数据库：

```bash
wrangler d1 create bing-wallpaper-db
```

将命令输出的 ID 填入 `wrangler.toml` 中已注释的 `[[d1_databases]]` 配置。Worker 会在每个预热实例中仅初始化一次表结构；也可以预先执行：

```bash
wrangler d1 execute bing-wallpaper-db --command "CREATE TABLE IF NOT EXISTS uploaded_wallpapers (date TEXT PRIMARY KEY, url TEXT NOT NULL, uploaded_at INTEGER NOT NULL);"
```

## HTTP API

除健康检查外，所有接口都要求：

```text
Authorization: Bearer <TRIGGER_TOKEN>
```

| Endpoint | Method | 说明 |
| --- | --- | --- |
| `/`、`/health` | `GET` | 健康检查，无需认证 |
| `/upload` | `POST` | 上传当天壁纸 |
| `/upload/multi` | `POST` | 上传最近多天壁纸，`days` 范围为 1–8 |
| `/upload/date` | `POST` | 上传指定日期，`daysAgo` 范围为 0–7 |

### 批量上传

```bash
curl -X POST "https://your-worker.workers.dev/upload/multi" \
  -H "Authorization: Bearer your_trigger_token" \
  -H "Content-Type: application/json" \
  -d '{"days": 7}'
```

### 上传指定日期

```bash
curl -X POST "https://your-worker.workers.dev/upload/date" \
  -H "Authorization: Bearer your_trigger_token" \
  -H "Content-Type: application/json" \
  -d '{"daysAgo": 1}'
```

`daysAgo: 0` 表示当天，`1` 表示昨天。

## 配置参考

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `IMG_BED_URL` | 是 | — | ImgBed 服务根地址 |
| `IMG_BED_AUTH_CODE` | 是 | — | ImgBed 上传认证码 |
| `TRIGGER_TOKEN` | 是（手动接口） | — | 手动上传接口的认证令牌 |
| `IMG_BED_CHANNEL` | 否 | `telegram` | `telegram`、`cfr2`、`s3`、`discord` 或 `huggingface` |
| `BING_MARKET` | 否 | `en-US` | Bing 市场，例如 `zh-CN`、`ja-JP` |
| `BING_RESOLUTION` | 否 | `1920x1080` | `1920x1080`、`UHD`、`3840x2160` 或 `2560x1440` |
| `LOG_LEVEL` | 否 | `info` | `debug`、`info`、`warn` 或 `error` |

## 开发

```bash
npm test
npm run type-check
npm run lint
npm run build
```

PowerShell 可将 `npm` 替换为 `npm.cmd`。

项目结构与实现细节见 [TECHNICAL.md](./TECHNICAL.md)。

## 安全建议

- 使用高熵、独立的 `TRIGGER_TOKEN`，并仅通过 Wrangler secrets 保存。
- 不要在日志、Issue 或 README 中暴露 `IMG_BED_AUTH_CODE`。
- 如需进一步限制访问，可通过 Cloudflare Access 或 WAF 设置来源限制。

## 许可证

MIT
