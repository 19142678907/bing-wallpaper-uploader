# 技术文档

本文档面向维护者和二次开发者，说明 `bing-wallpaper-uploader` 的运行模型、模块边界、接口契约和常见维护点。

## 1. 项目定位

`bing-wallpaper-uploader` 是一个运行在 Cloudflare Workers 上的自动化任务：

1. 从 Bing Wallpaper API 获取壁纸元数据。
2. 按配置拼接指定分辨率的图片 URL。
3. 下载图片二进制数据。
4. 通过 Cloudflare ImgBed 上传图片。
5. 支持 Cron 自动触发，也支持 HTTP 手动触发。

项目核心目标是保持 Worker 入口轻量，把具体业务拆到 `src/modules` 中，方便后续替换存储端、增加通知、接入数据库或扩展调度策略。

## 2. 技术栈

| 类别 | 技术 |
| --- | --- |
| Runtime | Cloudflare Workers |
| 语言 | TypeScript |
| 本地/部署工具 | Wrangler |
| 包管理 | npm |
| 外部数据源 | Bing HPImageArchive API |
| 上传目标 | Cloudflare ImgBed |
| 静态检查 | TypeScript, ESLint |

## 3. 目录结构

```text
bing-wallpaper-uploader/
|-- src/
|   |-- index.ts           # Worker 入口，处理 HTTP 请求和 Cron 触发
|   |-- types/
|   |   `-- index.ts       # 共享类型定义
|   `-- modules/
|       |-- config.ts      # 环境变量读取和校验
|       |-- bing.ts        # Bing API 客户端和图片下载
|       |-- upload.ts      # ImgBed 上传客户端
|       |-- scheduler.ts   # 业务流程编排
|       `-- utils.ts       # 日志、错误类型、文件名生成等工具
|-- wrangler.toml          # Worker 名称、入口、Cron、限制等配置
|-- package.json           # npm 脚本和依赖
|-- tsconfig.json          # TypeScript 编译配置
|-- .eslintrc.cjs          # ESLint 配置
|-- README.md              # 用户使用说明
`-- TECHNICAL.md           # 本技术文档
```

## 4. 运行入口

入口文件是 `src/index.ts`，默认导出 Cloudflare Worker handler。

### 4.1 Cron 触发

`scheduled(event, env, ctx)` 由 Cloudflare Cron Trigger 调用。

流程：

1. 创建 `Scheduler`。
2. 调用 `scheduler.runDailyUpload()`。
3. 通过 `ctx.waitUntil()` 让异步任务在事件生命周期内完成。
4. 输出成功或失败日志。

Cron 表达式配置在 `wrangler.toml`：

```toml
[triggers]
crons = ["0 8 * * *"]
```

当前配置表示每天 UTC 08:00 执行，对北京时间是 16:00。

### 4.2 HTTP 触发

`fetch(request, env)` 负责处理手动触发接口。

路由表：

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/` | GET | 健康检查 |
| `/health` | GET | 健康检查 |
| `/upload` | POST | 上传今天的壁纸 |
| `/upload/multi?days=7` | GET | 上传最近 N 天壁纸，范围 1 到 8 |
| `/upload/date?daysAgo=1` | GET | 上传 N 天前壁纸，范围 0 到 7 |
| 任意路径 | OPTIONS | CORS 预检 |

未知路径返回 404，并附带可用 endpoint 列表。

注意：当前 HTTP 手动触发接口（`/upload`、`/upload/multi`、`/upload/date`）均需要 `TRIGGER_TOKEN` 鉴权。请求头需携带 `Authorization: Bearer <token>`。健康检查接口（`/`、`/health`）无需鉴权。

## 5. 核心数据流

### 5.1 每日上传

对应方法：`Scheduler.runDailyUpload()`

```text
Cron 或 POST /upload
  -> Scheduler.runDailyUpload()
  -> BingClient.fetchWallpaper()
  -> BingClient.buildImageUrl()
  -> BingClient.downloadImage()
  -> ImgBedClient.upload()
  -> 返回上传后的图片 URL
```

失败处理：

- 任一步抛错都会被 `runDailyUpload()` 捕获。
- 返回 `{ success: false, error }`。
- HTTP 触发时返回 500。
- Cron 触发时写入错误日志。

### 5.2 多日上传

对应方法：`Scheduler.runMultiDayUpload(days)`

```text
GET /upload/multi?days=N
  -> BingClient.fetchMultipleWallpapers()
  -> 逐张下载图片
  -> ImgBedClient.uploadMultiple()
  -> 按输入顺序返回每张图片的结果
```

`days` 最大值是 8，这是 Bing API 单次返回图片数量的限制。

多日上传会保留每张图片的成功或失败结果，避免某张失败后出现日期和 URL 错位。

### 5.3 指定日期上传

对应方法：`Scheduler.runSpecificDateUpload(daysAgo)`

`daysAgo` 语义：

| 值 | 含义 |
| --- | --- |
| `0` | 今天 |
| `1` | 昨天 |
| `7` | 7 天前 |

有效范围是 0 到 7。

## 6. 模块说明

### 6.1 `Config`

文件：`src/modules/config.ts`

职责：

- 读取 Worker 环境变量。
- 校验必填配置。
- 提供 Bing 和 ImgBed 的配置对象。
- 校验 `BING_RESOLUTION` 是否在允许范围内。

必填变量：

| 变量 | 用途 |
| --- | --- |
| `IMG_BED_URL` | ImgBed 实例根地址 |
| `IMG_BED_AUTH_CODE` | ImgBed 上传认证码 |

可选变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `IMG_BED_CHANNEL` | `telegram` | ImgBed 上传通道 |
| `BING_MARKET` | `en-US` | Bing 地区市场 |
| `BING_RESOLUTION` | `1920x1080` | 图片分辨率 |
| `LOG_LEVEL` | `info` | 日志级别 |

允许的 `BING_RESOLUTION`：

- `1920x1080`
- `UHD`
- `3840x2160`
- `2560x1440`

### 6.2 `BingClient`

文件：`src/modules/bing.ts`

职责：

- 调用 Bing `HPImageArchive.aspx` 获取壁纸元数据。
- 根据 `urlbase` 和分辨率拼接实际图片地址。
- 下载图片为 `ArrayBuffer`。
- 对网络请求执行指数退避重试。

Bing API 请求格式：

```text
https://www.bing.com/HPImageArchive.aspx?format=js&idx={idx}&n={n}&mkt={mkt}
```

关键参数：

| 参数 | 说明 |
| --- | --- |
| `idx` | 从今天往前偏移的天数 |
| `n` | 返回图片数量，最大 8 |
| `mkt` | 地区市场，如 `en-US`、`zh-CN` |

### 6.3 `ImgBedClient`

文件：`src/modules/upload.ts`

职责：

- 构建 ImgBed 上传 URL。
- 使用 `FormData` 以 `file` 字段上传图片。
- 解析 ImgBed 返回结果。
- 对上传失败执行重试。
- 上传多张图片时保留每张图片的结果。

上传 URL 规则：

- `IMG_BED_URL` 可以配置为 `https://example.com`。
- 如果误配置成 `https://example.com/upload`，客户端会自动归一化，避免拼成 `/upload/upload`。
- 实际上传地址固定为 `{baseUrl}/upload`。

会附加的查询参数包括：

| 参数 | 来源 |
| --- | --- |
| `authCode` | `IMG_BED_AUTH_CODE` |
| `uploadChannel` | `IMG_BED_CHANNEL` |
| `uploadFolder` | 固定为 `bing-wallpapers` |
| `autoRetry` | 固定为 `true` |

上传失败重试策略：

- 默认最多重试 3 次。
- 初始延迟 1000ms。
- 每次失败后延迟翻倍。
- 401 和 403 不重试，因为通常是认证或权限错误。

### 6.4 `Scheduler`

文件：`src/modules/scheduler.ts`

职责：

- 编排完整业务流程。
- 将 Bing 元数据、图片下载、ImgBed 上传串起来。
- 把异常转换为稳定的返回结构。

对外方法：

| 方法 | 说明 |
| --- | --- |
| `runDailyUpload()` | 上传今天的壁纸 |
| `runMultiDayUpload(days)` | 上传最近 N 天壁纸 |
| `runSpecificDateUpload(daysAgo)` | 上传指定偏移日期的壁纸 |

### 6.5 `utils`

文件：`src/modules/utils.ts`

包含：

- `Logger`：按日志级别输出结构化上下文。
- `RetryError`：请求重试耗尽。
- `UploadError`：上传失败。
- `FetchError`：请求失败。
- `formatDate()`：格式化日期为 `YYYYMMDD`。
- `parseBingDate()`：解析 Bing 日期。
- `generateFilename()`：生成上传文件名。

文件名格式：

```text
bing_{startdate}_{title}_{resolution}.jpg
```

标题会移除非字母数字字符并替换为下划线。

## 7. HTTP 响应契约

### 7.1 健康检查

请求：

```bash
curl https://your-worker.workers.dev/health
```

响应：

```json
{
  "status": "ok",
  "timestamp": "2026-01-20T12:00:00.000Z",
  "message": "Bing Wallpaper Uploader Worker is running"
}
```

### 7.2 上传今天壁纸

请求：

```bash
curl -X POST https://your-worker.workers.dev/upload
```

成功响应：

```json
{
  "success": true,
  "timestamp": "2026-01-20T12:00:00.000Z",
  "imageUrl": "https://your-imgbed.com/file/abc123",
  "error": null
}
```

失败响应：

```json
{
  "success": false,
  "timestamp": "2026-01-20T12:00:00.000Z",
  "error": "Missing required environment variables: IMG_BED_AUTH_CODE"
}
```

### 7.3 上传多日壁纸

请求：

```bash
curl "https://your-worker.workers.dev/upload/multi?days=3"
```

响应：

```json
{
  "success": true,
  "timestamp": "2026-01-20T12:00:00.000Z",
  "days": 3,
  "results": [
    {
      "date": "20260120",
      "imageUrl": "https://your-imgbed.com/file/abc123"
    }
  ]
}
```

如果部分图片上传失败，对应项会包含 `error` 字段，并且整体 `success` 为 `false`。

## 8. 配置和密钥

本地开发使用 `.dev.vars`：

```bash
cp .example.env .dev.vars
```

生产环境使用 Wrangler secrets：

```bash
wrangler secret put IMG_BED_URL
wrangler secret put IMG_BED_AUTH_CODE
wrangler secret put IMG_BED_CHANNEL
```

可选非敏感变量可以放在 `wrangler.toml` 的 `[vars]` 中：

```toml
[vars]
LOG_LEVEL = "info"
BING_MARKET = "en-US"
BING_RESOLUTION = "1920x1080"
```

不要把 `.dev.vars`、真实 token、认证码提交到 Git。

## 9. 本地开发和验证

安装依赖：

```bash
npm install
```

启动本地 Worker：

```bash
npm run dev
```

静态检查：

```bash
npm run lint
npm run type-check
```

构建：

```bash
npm run build
```

Wrangler 打包 dry run：

```bash
npx wrangler deploy --dry-run --outdir .\dist-worker
```

在 PowerShell 执行策略限制 `npm.ps1` 时，可以使用：

```powershell
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
```

## 10. 部署流程

1. 确认 `wrangler.toml` 中的 `name` 和 Cron 配置。
2. 设置生产 secrets。
3. 运行 `npm run type-check` 和 `npm run build`。
4. 运行 `npm run deploy`。

常用命令：

```bash
npm run deploy
npm run deploy:production
```

## 11. 错误处理策略

| 场景 | 行为 |
| --- | --- |
| 缺少必填环境变量 | 初始化 `Scheduler` 时抛错 |
| `BING_RESOLUTION` 非法 | 初始化配置时抛错 |
| Bing API 返回非 2xx | 抛出 `FetchError` |
| Bing API 无图片 | 抛出普通 `Error` |
| 图片下载失败 | 抛出 `FetchError` |
| ImgBed 上传失败 | 抛出 `UploadError` |
| 401 或 403 上传失败 | 不重试 |
| 其他上传失败 | 指数退避重试 |
| 多日上传部分失败 | 返回每项结果，整体 `success` 为 `false` |

## 12. 扩展建议

### 12.1 手动触发鉴权（已实现）

`/upload`、`/upload/multi`、`/upload/date` 已支持 `TRIGGER_TOKEN` 鉴权。可以新增 `TRIGGER_TOKEN`：

1. 在 `Env` 中增加 `TRIGGER_TOKEN?: string`。
2. 在 `fetch()` 中读取 `Authorization` 或查询参数。
3. 对上传类 endpoint 执行校验。
4. 健康检查保持公开。

### 12.2 增加上传结果持久化

可以接入 Cloudflare D1 或 KV：

1. 在 `wrangler.toml` 中添加 binding。
2. 新增 `src/modules/database.ts`。
3. 在 `Scheduler` 上传成功后写入日期、标题、原图 URL、上传 URL。
4. 重复触发时先查询当天是否已上传，实现幂等。

### 12.3 增加通知

可以新增 `src/modules/webhook.ts`：

1. 上传成功后发送 webhook。
2. 上传失败后发送错误摘要。
3. 多日上传时汇总成功和失败数量。

## 13. 已知限制

- 当前没有持久化记录，重复触发可能重复上传。
- HTTP 手动触发接口默认公开，需要生产环境自行加鉴权或访问控制。
- 多日上传会下载并上传多张图片，可能更容易触及 Worker CPU、请求时长或上游限流。
- ImgBed 返回格式目前按数组格式解析，若 ImgBed API 版本变更，需要同步调整 `ImgBedUploadResponse`。
