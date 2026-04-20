# Browser Run Toolkit - Design Spec

## Overview

A Cloudflare Workers project that wraps Browser Run capabilities into a team-shared web service with a lightweight frontend UI and backend API for remote calls.

## Architecture: Hybrid Mode

Two browser interaction modes coexist in a single Worker, distinguished by route prefix:

```
User Request → Worker (auth + rate limiting) → Route dispatch
  ├── /api/* (quick actions) → Proxy to Browser Run Quick Actions API
  ├── /api/session/*         → Puppeteer + Durable Objects
  └── /                      → Static frontend HTML
```

## API Routes

### Quick Actions Proxy

All endpoints proxy to `https://api.cloudflare.com/client/v4/accounts/{accountId}/browser-rendering/{endpoint}`.

| Method | Route | Browser Run Endpoint |
|--------|-------|---------------------|
| POST | `/api/screenshot` | `/screenshot` |
| POST | `/api/pdf` | `/pdf` |
| POST | `/api/markdown` | `/markdown` |
| POST | `/api/json` | `/json` |
| POST | `/api/scrape` | `/scrape` |
| POST | `/api/links` | `/links` |
| POST | `/api/content` | `/content` |
| POST | `/api/snapshot` | `/snapshot` |
| POST | `/api/crawl` | `/crawl` (initiate) |
| GET | `/api/crawl/:jobId` | `/crawl/:jobId` (results) |
| DELETE | `/api/crawl/:jobId` | `/crawl/:jobId` (cancel) |

Quick Actions request body is passed through to Browser Run API. The Worker adds authentication (account ID + API token from environment variables) and returns the response.

### Browser Sessions (Puppeteer + Durable Objects)

| Method | Route | Function |
|--------|-------|----------|
| POST | `/api/session` | Create browser session, returns sessionId |
| POST | `/api/session/:id/navigate` | Navigate to URL |
| POST | `/api/session/:id/screenshot` | Take screenshot within session |
| POST | `/api/session/:id/pdf` | Generate PDF within session |
| POST | `/api/session/:id/evaluate` | Execute JavaScript |
| POST | `/api/session/:id/action` | Generic action (click/fill/type) |
| GET | `/api/session/:id` | Get session status |
| DELETE | `/api/session/:id` | Close session |

## Authentication

- All `/api/*` requests require `Authorization: Bearer <API_KEY>` header or `?token=<API_KEY>` query param.
- API Keys stored in Worker environment variable `API_KEYS` (comma-separated for multiple team members).
- Configured in `wrangler.toml` as secrets.

## Frontend UI

Single-page lightweight tool with tab navigation. Pure HTML/CSS/JS, no framework, embedded in Worker response.

### Layout

- Top bar: title + API key input (saved to localStorage)
- Tab bar: Screenshot | PDF | Markdown | JSON | Scraper | Links | Content | Snapshot | Crawl | Session
- Main area: URL input + tab-specific options + execute button
- Result area: image preview / PDF download / text display / crawl status

### Tab-specific options

- **Screenshot**: fullPage toggle, viewport size, CSS selector, clip region
- **PDF**: format (A4/Letter), landscape, margins, header/footer
- **Markdown**: (none, just URL)
- **JSON**: AI prompt, JSON schema
- **Scraper**: CSS selectors (array input)
- **Links**: visibleOnly, excludeExternal
- **Content**: (none, just URL)
- **Snapshot**: (none, just URL)
- **Crawl**: limit, depth, include/exclude patterns, formats
- **Session**: create session → navigate → action → close workflow

### Common advanced options (collapsible)

- Viewport: width/height
- Custom JS injection
- Custom CSS injection
- Authentication cookies
- Custom User-Agent
- Custom fonts
- Wait for selector

## Project Structure

```
cloudflare-browser/
├── wrangler.toml           # Workers config (bindings, secrets)
├── package.json
├── src/
│   ├── index.js            # Worker entry, route dispatch
│   ├── auth.js             # API Key auth middleware
│   ├── quick-actions.js    # Quick Actions proxy (9 endpoints)
│   ├── sessions.js         # Browser Session API routes
│   ├── browser-do.js       # Durable Object: browser session manager
│   ├── crawl.js            # Crawl task management
│   └── frontend/
│       └── index.html      # Single-page UI (CSS/JS inlined)
```

## Durable Object: BrowserSessionDO

Each DO instance = one browser session, identified by unique ID.

### State

- `browser`: Puppeteer.Browser instance
- `page`: Puppeteer.Page instance
- `lastActivity`: timestamp of last operation
- `maxIdle`: 60000ms (auto-close after 60s inactivity)

### Methods

- `POST /launch` → Start browser via `puppeteer.launch(env.MYBROWSER)`
- `POST /navigate` → `page.goto(url, options)`
- `POST /screenshot` → `page.screenshot(options)`
- `POST /pdf` → `page.pdf(options)`
- `POST /evaluate` → `page.evaluate(expression)`
- `POST /action` → `{ type: "click"|"fill"|"type"|"wait", selector, value }`
- `POST /cookies` → `page.setCookie(cookies)`
- `GET /status` → Return session state and last activity time
- `DELETE /close` → `browser.close()`

### Lifecycle

1. Created via `POST /api/session` → generates unique ID → instantiates DO
2. Operations update `lastActivity` and schedule alarm
3. Alarm fires when `now - lastActivity > maxIdle` → auto-closes browser
4. Explicit `DELETE /close` → closes browser immediately

## Wrangler Configuration

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

# Secrets (set via `wrangler secret put`):
# - CF_ACCOUNT_ID: Cloudflare account ID
# - CF_API_TOKEN: Browser Rendering API token
# - API_KEYS: Comma-separated team API keys
```

## Error Handling

- Browser Run API errors forwarded with appropriate HTTP status
- DO session errors return 404 for unknown session IDs
- Timeout errors from Browser Run (60s limit) return 504
- Invalid API key returns 401

## Rate Limiting

- Browser Run enforces its own rate limits (Free: 1 req/10s, Paid: 10 req/s)
- Worker-level: optional simple counter per API key using DO or KV for abuse prevention

## Future Considerations (Out of Scope for V1)

- Usage analytics dashboard
- API key management UI
- Webhook notifications for crawl completion
- Session recording playback
