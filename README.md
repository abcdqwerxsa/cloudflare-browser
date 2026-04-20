# Browser Run Toolkit

基于 [Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/) 的浏览器即服务工具，提供前端 UI 和后端 API，支持远程调用。

**在线演示：** `https://browser-run-toolkit.jeanpaul20020519.workers.dev`

## 功能特性

### 快捷操作（无状态）
一次性 HTTP 请求，代理到 Cloudflare Browser Rendering API：

| 操作 | 端点 | 说明 |
|------|------|------|
| 截图 | `POST /api/screenshot` | 网页截图（PNG） |
| PDF | `POST /api/pdf` | 生成网页 PDF |
| Markdown | `POST /api/markdown` | 提取页面为 Markdown |
| AI / JSON | `POST /api/json` | 通过 AI 提示词提取结构化 JSON |
| 爬取 | `POST /api/scrape` | 按 CSS 选择器爬取页面元素 |
| 链接 | `POST /api/links` | 提取页面所有链接 |
| 内容 | `POST /api/content` | 获取页面内容 |
| 快照 | `POST /api/snapshot` | 获取 DOM 快照 |

### 爬虫（异步）
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/crawl` | POST | 启动爬虫任务 |
| `/api/crawl/:jobId` | GET | 查询爬虫状态 |
| `/api/crawl/:jobId` | DELETE | 取消爬虫任务 |

### 持久会话（有状态）
通过 Durable Objects 保持浏览器实例，跨请求保持状态：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/session` | POST | 创建新会话 |
| `/api/session/:id` | GET | 查询会话状态 |
| `/api/session/:id/navigate` | POST | 导航到指定 URL |
| `/api/session/:id/screenshot` | POST | 截图 |
| `/api/session/:id/pdf` | POST | 生成 PDF |
| `/api/session/:id/evaluate` | POST | 执行 JavaScript |
| `/api/session/:id/action` | POST | 点击、填充、输入、等待 |
| `/api/session/:id/cookies` | POST | 设置 Cookie |
| `/api/session/:id` | DELETE | 关闭会话 |

会话在 60 秒无操作后自动关闭。

## 架构

```
                    ┌───────────────────────────────┐
                    │        Cloudflare Worker        │
                    │                                 │
  浏览器 ────────► │  /          → 前端 UI            │
                    │  /api/*    → 认证中间件           │
                    │     ├── 快捷操作  → CF API 代理  │
                    │     ├── 爬虫      → CF API 代理  │
                    │     └── 会话      → DO 实例      │
                    │                                 │
                    │  Durable Object (BrowserSessionDO)
                    │     └── Puppeteer 浏览器实例      │
                    └─────────────────────────────────┘
```

**混合架构：**
- 快捷操作 & 爬虫 → 代理到 Cloudflare Browser Rendering API（Worker 内无浏览器）
- 持久会话 → 通过 `@cloudflare/puppeteer` 在 Durable Object 中运行浏览器（首次操作时懒加载启动）

## 部署

### 前置要求

- Node.js 18+
- Cloudflare 账户（需 Workers 付费计划，Browser Rendering 依赖）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（`npm install -g wrangler`）

### 部署步骤

```bash
git clone https://github.com/abcdqwerxsa/cloudflare-browser.git
cd cloudflare-browser
npm install

# 登录 Cloudflare
npx wrangler login

# 设置密钥
npx wrangler secret put API_KEYS          # 自定义 API 密钥，多个用逗号分隔
npx wrangler secret put CF_ACCOUNT_ID     # Cloudflare 账户 ID
npx wrangler secret put CF_API_TOKEN      # Cloudflare API Token（需 Browser Rendering 权限）

# 部署
npx wrangler deploy
```

### wrangler.toml

```toml
name = "browser-run-toolkit"
main = "src/index.js"
compatibility_date = "2026-04-20"
compatibility_flags = ["nodejs_compat"]

[browser]
binding = "MYBROWSER"

[durable_objects]
bindings = [
  { name = "BROWSER_SESSIONS", class_name = "BrowserSessionDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["BrowserSessionDO"]
```

## API 使用

所有 `/api/*` 端点需要通过 `Authorization: Bearer <密钥>` 请求头认证。

### 示例：网页截图

```bash
curl -X POST https://your-worker.workers.dev/api/screenshot \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","screenshotOptions":{"fullPage":true}}' \
  --output screenshot.png
```

### 示例：AI JSON 提取

```bash
curl -X POST https://your-worker.workers.dev/api/json \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product",
    "prompt": "提取商品名称、价格和描述"
  }'
```

### 示例：爬虫

```bash
# 启动爬虫
curl -X POST https://your-worker.workers.dev/api/crawl \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","limit":10,"depth":2}'

# 查询状态
curl https://your-worker.workers.dev/api/crawl/<jobId> \
  -H "Authorization: Bearer your-api-key"
```

### 示例：持久会话

```bash
# 创建会话（即时返回，浏览器在首次操作时启动）
curl -X POST https://your-worker.workers.dev/api/session \
  -H "Authorization: Bearer your-api-key"

# 导航
curl -X POST https://your-worker.workers.dev/api/session/<id>/navigate \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# 截图
curl -X POST https://your-worker.workers.dev/api/session/<id>/screenshot \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{}' --output shot.png

# 执行 JS
curl -X POST https://your-worker.workers.dev/api/session/<id>/evaluate \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"expression":"document.title"}'

# 关闭会话
curl -X DELETE https://your-worker.workers.dev/api/session/<id> \
  -H "Authorization: Bearer your-api-key"
```

## 项目结构

```
src/
├── index.js          # Worker 入口，路由分发
├── auth.js           # API 密钥认证
├── quick-actions.js  # 代理到 Browser Rendering API
├── crawl.js          # 爬虫任务管理
├── sessions.js       # 会话路由到 Durable Object
├── browser-do.js     # Durable Object：浏览器生命周期与操作
└── frontend/
    └── index.html    # 深色主题前端 UI
```

## 许可证

MIT
