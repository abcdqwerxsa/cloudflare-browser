# Browser Run Toolkit

A Cloudflare Workers service that wraps [Browser Run](https://developers.cloudflare.com/browser-run/) capabilities into a web service with both a frontend UI and backend API for remote calls.

**Live Demo:** `https://browser-run-toolkit.jeanpaul20020519.workers.dev`

## Features

### Quick Actions (Stateless)
One-shot HTTP endpoints that proxy to Cloudflare Browser Rendering API:

| Action | Endpoint | Description |
|--------|----------|-------------|
| Screenshot | `POST /api/screenshot` | Capture page screenshot (PNG) |
| PDF | `POST /api/pdf` | Generate page PDF |
| Markdown | `POST /api/markdown` | Extract page as Markdown |
| AI / JSON | `POST /api/json` | Extract structured JSON with AI prompt |
| Scraper | `POST /api/scrape` | Scrape elements by CSS selectors |
| Links | `POST /api/links` | Extract all links from page |
| Content | `POST /api/content` | Get page content |
| Snapshot | `POST /api/snapshot` | Get DOM snapshot |

### Crawl (Async)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/crawl` | POST | Start a crawl job |
| `/api/crawl/:jobId` | GET | Poll crawl status |
| `/api/crawl/:jobId` | DELETE | Cancel a crawl |

### Sessions (Stateful)
Persistent browser instances via Durable Objects with state preserved across requests:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Create a new session |
| `/api/session/:id` | GET | Get session status |
| `/api/session/:id/navigate` | POST | Navigate to URL |
| `/api/session/:id/screenshot` | POST | Take screenshot |
| `/api/session/:id/pdf` | POST | Generate PDF |
| `/api/session/:id/evaluate` | POST | Evaluate JavaScript |
| `/api/session/:id/action` | POST | Click, fill, type, or wait |
| `/api/session/:id/cookies` | POST | Set cookies |
| `/api/session/:id` | DELETE | Close session |

Sessions auto-close after 60 seconds of inactivity.

## Architecture

```
                    ┌──────────────────────────────┐
                    │        Cloudflare Worker       │
                    │                                │
  Browser ───────► │  /          → Frontend UI       │
                    │  /api/*    → Auth middleware     │
                    │     ├── Quick Actions → CF API  │
                    │     ├── Crawl        → CF API  │
                    │     └── Sessions     → DO stub │
                    │                                  │
                    │  Durable Object (BrowserSessionDO)
                    │     └── Puppeteer browser instance
                    └──────────────────────────────────┘
```

**Hybrid approach:**
- Quick Actions & Crawl → proxy to Cloudflare Browser Rendering API (no browser in Worker)
- Sessions → Puppeteer via `@cloudflare/puppeteer` in Durable Objects (lazy launch on first operation)

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers Paid plan (required for Browser Rendering)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

### Deploy

```bash
git clone https://github.com/abcdqwerxsa/cloudflare-browser.git
cd cloudflare-browser
npm install

# Login to Cloudflare
npx wrangler login

# Set secrets
npx wrangler secret put API_KEYS          # Your custom API key(s), comma-separated
npx wrangler secret put CF_ACCOUNT_ID     # Your Cloudflare Account ID
npx wrangler secret put CF_API_TOKEN      # Cloudflare API token with Browser Rendering access

# Deploy
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

## API Usage

All `/api/*` endpoints require authentication via `Authorization: Bearer <key>` header.

### Example: Screenshot

```bash
curl -X POST https://your-worker.workers.dev/api/screenshot \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","screenshotOptions":{"fullPage":true}}' \
  --output screenshot.png
```

### Example: AI JSON Extraction

```bash
curl -X POST https://your-worker.workers.dev/api/json \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product",
    "prompt": "Extract product name, price, and description"
  }'
```

### Example: Crawl

```bash
# Start crawl
curl -X POST https://your-worker.workers.dev/api/crawl \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","limit":10,"depth":2}'

# Check status
curl https://your-worker.workers.dev/api/crawl/<jobId> \
  -H "Authorization: Bearer your-api-key"
```

### Example: Session

```bash
# Create session (instant, browser launches on first operation)
curl -X POST https://your-worker.workers.dev/api/session \
  -H "Authorization: Bearer your-api-key"

# Navigate
curl -X POST https://your-worker.workers.dev/api/session/<id>/navigate \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# Take screenshot
curl -X POST https://your-worker.workers.dev/api/session/<id>/screenshot \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{}' --output shot.png

# Evaluate JS
curl -X POST https://your-worker.workers.dev/api/session/<id>/evaluate \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"expression":"document.title"}'

# Close session
curl -X DELETE https://your-worker.workers.dev/api/session/<id> \
  -H "Authorization: Bearer your-api-key"
```

## Project Structure

```
src/
├── index.js          # Worker entry point, route dispatch
├── auth.js           # API key authentication
├── quick-actions.js  # Proxy to Browser Rendering API
├── crawl.js          # Crawl job management
├── sessions.js       # Session routing to Durable Objects
├── browser-do.js     # Durable Object: browser lifecycle & operations
└── frontend/
    └── index.html    # Dark-themed frontend UI
```

## License

MIT
