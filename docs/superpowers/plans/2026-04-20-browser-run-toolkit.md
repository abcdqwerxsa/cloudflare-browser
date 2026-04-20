# Browser Run Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Workers service that proxies Browser Run Quick Actions and provides Puppeteer-based persistent sessions via Durable Objects, with a lightweight frontend UI.

**Architecture:** Single Worker handles routing — `/api/*` for Quick Actions proxy and `/api/session/*` for Durable Object-backed browser sessions. Frontend is inlined HTML served on `/`. Authentication via shared API keys.

**Tech Stack:** Cloudflare Workers, @cloudflare/puppeteer, Durable Objects, vanilla HTML/CSS/JS

---

## File Map

| File | Responsibility |
|------|---------------|
| `wrangler.toml` | Worker config, bindings, DO migration |
| `package.json` | Dependencies |
| `src/index.js` | Worker entry, route dispatch, serve frontend |
| `src/auth.js` | API key validation middleware |
| `src/quick-actions.js` | Proxy all 9 Quick Actions to Browser Run API |
| `src/sessions.js` | Route session requests to Durable Objects |
| `src/browser-do.js` | Durable Object class for persistent browser sessions |
| `src/crawl.js` | Crawl task create/status/cancel logic |
| `src/frontend/index.html` | Single-page UI with all tabs |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "browser-run-toolkit",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^4"
  },
  "dependencies": {
    "@cloudflare/puppeteer": "^0.0.14"
  }
}
```

- [ ] **Step 2: Create wrangler.toml**

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

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules` created, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json wrangler.toml
git commit -m "chore: scaffold project with wrangler and dependencies"
```

---

### Task 2: Auth Middleware

**Files:**
- Create: `src/auth.js`

- [ ] **Step 1: Write src/auth.js**

```js
/**
 * Validate API key from Authorization header or ?token= query param.
 * Returns { valid: true } or { valid: false, response: Response }.
 */
export function authenticate(request, apiKeys) {
  if (!apiKeys) {
    return { valid: false, response: new Response("Server misconfigured: no API keys", { status: 500 }) };
  }

  const keys = apiKeys.split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    return { valid: false, response: new Response("Server misconfigured: empty API keys", { status: 500 }) };
  }

  // Check Authorization: Bearer <key>
  const authHeader = request.headers.get("Authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && keys.includes(bearerMatch[1])) {
    return { valid: true };
  }

  // Check ?token=<key>
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token && keys.includes(token)) {
    return { valid: true };
  }

  return { valid: false, response: new Response("Unauthorized", { status: 401 }) };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth.js
git commit -m "feat: add API key authentication middleware"
```

---

### Task 3: Quick Actions Proxy

**Files:**
- Create: `src/quick-actions.js`

- [ ] **Step 1: Write src/quick-actions.js**

This module proxies requests to Browser Run Quick Actions API. It receives the already-parsed request body from the router and forwards it.

```js
const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Map of our endpoint names to Browser Run endpoint paths.
 */
const ENDPOINT_MAP = {
  screenshot: "screenshot",
  pdf: "pdf",
  markdown: "markdown",
  json: "json",
  scrape: "scrape",
  links: "links",
  content: "content",
  snapshot: "snapshot",
};

/**
 * Proxy a Quick Action request to Browser Run API.
 * @param {string} action - One of the keys in ENDPOINT_MAP
 * @param {object} body - Request body to forward
 * @param {string} accountId - Cloudflare account ID
 * @param {string} apiToken - Browser Rendering API token
 * @returns {Response}
 */
export async function proxyQuickAction(action, body, accountId, apiToken) {
  const endpoint = ENDPOINT_MAP[action];
  if (!endpoint) {
    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = `${CF_API_BASE}/${accountId}/browser-rendering/${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // For screenshot and pdf, response is binary — pass through directly
  if (action === "screenshot" || action === "pdf") {
    const contentType = action === "screenshot" ? "image/png" : "application/pdf";
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "X-Browser-Ms-Used": response.headers.get("X-Browser-Ms-Used") || "",
      },
    });
  }

  // For other actions, response is JSON — pass through
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "X-Browser-Ms-Used": response.headers.get("X-Browser-Ms-Used") || "",
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/quick-actions.js
git commit -m "feat: add Quick Actions proxy to Browser Run API"
```

---

### Task 4: Crawl Task Manager

**Files:**
- Create: `src/crawl.js`

- [ ] **Step 1: Write src/crawl.js**

Handles the 3 crawl operations: initiate (POST), get status (GET), cancel (DELETE).

```js
const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Initiate a crawl job.
 */
export async function startCrawl(body, accountId, apiToken) {
  const url = `${CF_API_BASE}/${accountId}/browser-rendering/crawl`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return forwardResponse(response);
}

/**
 * Get crawl job status/results.
 */
export async function getCrawlStatus(jobId, query, accountId, apiToken) {
  let url = `${CF_API_BASE}/${accountId}/browser-rendering/crawl/${jobId}`;
  if (query) url += `?${query}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  return forwardResponse(response);
}

/**
 * Cancel a crawl job.
 */
export async function cancelCrawl(jobId, accountId, apiToken) {
  const url = `${CF_API_BASE}/${accountId}/browser-rendering/crawl/${jobId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  return forwardResponse(response);
}

function forwardResponse(response) {
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/crawl.js
git commit -m "feat: add crawl task manager (start/status/cancel)"
```

---

### Task 5: Durable Object — BrowserSessionDO

**Files:**
- Create: `src/browser-do.js`

- [ ] **Step 1: Write src/browser-do.js**

```js
import puppeteer from "@cloudflare/puppeteer";

const MAX_IDLE_MS = 60_000;

export class BrowserSessionDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.browser = null;
    this.page = null;
    this.lastActivity = Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "POST" && path === "/launch") {
        return await this.handleLaunch();
      }

      // All other operations require a running browser
      if (!this.browser) {
        return new Response(JSON.stringify({ error: "Browser not launched" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      this.lastActivity = Date.now();
      await this.state.storage.setAlarm(MAX_IDLE_MS);

      if (request.method === "POST" && path === "/navigate") return await this.handleNavigate(request);
      if (request.method === "POST" && path === "/screenshot") return await this.handleScreenshot(request);
      if (request.method === "POST" && path === "/pdf") return await this.handlePdf(request);
      if (request.method === "POST" && path === "/evaluate") return await this.handleEvaluate(request);
      if (request.method === "POST" && path === "/action") return await this.handleAction(request);
      if (request.method === "POST" && path === "/cookies") return await this.handleCookies(request);
      if (request.method === "GET" && path === "/status") return await this.handleStatus();
      if (request.method === "DELETE" && path === "/close") return await this.handleClose();

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  async handleLaunch() {
    if (this.browser) {
      await this.browser.close();
    }
    this.browser = await puppeteer.launch(this.env.MYBROWSER);
    this.page = await this.browser.newPage();
    this.lastActivity = Date.now();
    await this.state.storage.setAlarm(MAX_IDLE_MS);
    return new Response(JSON.stringify({ status: "launched" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleNavigate(request) {
    const { url, options } = await request.json();
    await this.page.goto(url, options || { waitUntil: "domcontentloaded" });
    return new Response(JSON.stringify({ status: "navigated", url }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleScreenshot(request) {
    const { options } = await request.json();
    const img = await this.page.screenshot(options || {});
    return new Response(img, {
      headers: { "Content-Type": "image/png" },
    });
  }

  async handlePdf(request) {
    const { options } = await request.json();
    const pdf = await this.page.pdf(options || {});
    return new Response(pdf, {
      headers: { "Content-Type": "application/pdf" },
    });
  }

  async handleEvaluate(request) {
    const { expression } = await request.json();
    const result = await this.page.evaluate(expression);
    return new Response(JSON.stringify({ result }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleAction(request) {
    const { type, selector, value } = await request.json();
    switch (type) {
      case "click":
        await this.page.click(selector);
        break;
      case "fill":
        await this.page.$eval(selector, (el, v) => { el.value = v; }, value);
        break;
      case "type":
        await this.page.type(selector, value);
        break;
      case "wait":
        await this.page.waitForSelector(selector, { timeout: 30000 });
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action type: ${type}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
    }
    return new Response(JSON.stringify({ status: "ok", type }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleCookies(request) {
    const { cookies } = await request.json();
    await this.page.setCookie(...cookies);
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleStatus() {
    return new Response(JSON.stringify({
      status: this.browser ? "active" : "inactive",
      lastActivity: this.lastActivity,
      url: this.page ? this.page.url() : null,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleClose() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
    return new Response(JSON.stringify({ status: "closed" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async alarm() {
    if (this.browser && Date.now() - this.lastActivity > MAX_IDLE_MS) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/browser-do.js
git commit -m "feat: add BrowserSessionDO with Puppeteer session management"
```

---

### Task 6: Session Router

**Files:**
- Create: `src/sessions.js`

- [ ] **Step 1: Write src/sessions.js**

Routes HTTP requests to the appropriate Durable Object instance.

```js
/**
 * Generate a unique session ID.
 */
function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * Route session API requests to Durable Object instances.
 */
export async function handleSessionRequest(request, path, env) {
  const idPattern = /^\/api\/session\/([0-9a-f-]+)(\/.*)?$/;

  // POST /api/session — create new session
  if (request.method === "POST" && path === "/api/session") {
    const sessionId = generateSessionId();
    const doId = env.BROWSER_SESSIONS.idFromName(sessionId);
    const stub = env.BROWSER_SESSIONS.get(doId);

    const doResponse = await stub.fetch(new Request(new URL("/launch", request.url), {
      method: "POST",
    }));

    const result = await doResponse.json();
    return new Response(JSON.stringify({ sessionId, ...result }), {
      status: doResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Match /api/session/:id or /api/session/:id/:action
  const match = path.match(idPattern);
  if (!match) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionId = match[1];
  const subPath = match[2] || "";
  const doId = env.BROWSER_SESSIONS.idFromName(sessionId);
  const stub = env.BROWSER_SESSIONS.get(doId);

  // GET /api/session/:id — status
  if (request.method === "GET" && subPath === "") {
    return stub.fetch(new Request(new URL("/status", request.url)));
  }

  // DELETE /api/session/:id — close
  if (request.method === "DELETE" && subPath === "") {
    return stub.fetch(new Request(new URL("/close", request.url), { method: "DELETE" }));
  }

  // POST /api/session/:id/:action — forward to DO
  // /navigate, /screenshot, /pdf, /evaluate, /action, /cookies
  if (request.method === "POST" && subPath !== "") {
    return stub.fetch(new Request(new URL(subPath, request.url), {
      method: "POST",
      headers: request.headers,
      body: request.body,
    }));
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sessions.js
git commit -m "feat: add session router for Durable Object dispatch"
```

---

### Task 7: Frontend UI

**Files:**
- Create: `src/frontend/index.html`

- [ ] **Step 1: Write src/frontend/index.html**

This is a large single file with all HTML, CSS, and JS inlined. The UI has:
- API key input (top bar, saved to localStorage)
- Tab bar for all 10 functions
- Per-tab options panels
- Common advanced options (collapsible)
- Result display area
- Session management panel

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Browser Run Toolkit</title>
<style>
  :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --accent: #3b82f6; --accent-hover: #2563eb; --success: #22c55e; --error: #ef4444; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 960px; margin: 0 auto; padding: 16px; }

  /* Top bar */
  .topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
  .topbar h1 { font-size: 18px; font-weight: 600; }
  .topbar input { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; width: 320px; font-size: 13px; }

  /* Tabs */
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; }
  .tab { padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); transition: all .15s; }
  .tab:hover { color: var(--text); border-color: var(--accent); }
  .tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }

  /* Form */
  .form-group { margin-bottom: 12px; }
  .form-group label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .form-group input, .form-group textarea, .form-group select { width: 100%; background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; font-size: 14px; }
  .form-group textarea { font-family: monospace; min-height: 60px; resize: vertical; }
  .form-row { display: flex; gap: 12px; }
  .form-row .form-group { flex: 1; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; }
  .checkbox-row input[type="checkbox"] { accent-color: var(--accent); }

  /* Advanced toggle */
  .advanced-toggle { cursor: pointer; color: var(--muted); font-size: 12px; margin-bottom: 8px; user-select: none; }
  .advanced-toggle:hover { color: var(--text); }
  .advanced { display: none; }
  .advanced.open { display: block; }

  /* Button */
  .btn { padding: 10px 24px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; transition: background .15s; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
  .btn-danger { background: var(--error); color: #fff; }
  .btn-danger:hover { opacity: .9; }

  /* Result */
  .result { margin-top: 20px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; min-height: 80px; }
  .result img { max-width: 100%; border-radius: 4px; }
  .result pre { white-space: pre-wrap; word-break: break-all; font-size: 13px; max-height: 500px; overflow-y: auto; }
  .result .loading { color: var(--muted); }

  /* Session panel */
  .session-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .session-panel .session-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .session-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .session-actions input { background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 4px; font-size: 13px; }
  .session-actions .btn { padding: 6px 14px; font-size: 13px; }
</style>
</head>
<body>
<div class="container">
  <div class="topbar">
    <h1>Browser Run Toolkit</h1>
    <input type="password" id="apiKey" placeholder="Enter API Key (saved locally)" />
  </div>

  <div class="tabs" id="tabBar"></div>

  <div id="tabContent"></div>

  <div class="result" id="result">
    <span class="loading">Enter a URL and click Execute.</span>
  </div>
</div>

<script>
// ---- Config ----
const TABS = [
  { id: "screenshot", label: "Screenshot", fields: ["url"] },
  { id: "pdf", label: "PDF", fields: ["url"] },
  { id: "markdown", label: "Markdown", fields: ["url"] },
  { id: "json", label: "JSON", fields: ["url"] },
  { id: "scrape", label: "Scraper", fields: ["url"] },
  { id: "links", label: "Links", fields: ["url"] },
  { id: "content", label: "Content", fields: ["url"] },
  { id: "snapshot", label: "Snapshot", fields: ["url"] },
  { id: "crawl", label: "Crawl", fields: ["url"] },
  { id: "session", label: "Session", fields: [] },
];

let activeTab = "screenshot";
let activeSessionId = null;

// ---- Init ----
const apiKeyEl = document.getElementById("apiKey");
apiKeyEl.value = localStorage.getItem("brt_api_key") || "";
apiKeyEl.addEventListener("input", () => localStorage.setItem("brt_api_key", apiKeyEl.value));

const tabBar = document.getElementById("tabBar");
const tabContent = document.getElementById("tabContent");
const resultEl = document.getElementById("result");

TABS.forEach(t => {
  const btn = document.createElement("div");
  btn.className = "tab" + (t.id === activeTab ? " active" : "");
  btn.textContent = t.label;
  btn.onclick = () => switchTab(t.id);
  btn.dataset.id = t.id;
  tabBar.appendChild(btn);
});

function switchTab(id) {
  activeTab = id;
  tabBar.querySelectorAll(".tab").forEach(el => el.classList.toggle("active", el.dataset.id === id));
  renderTabContent();
  resultEl.innerHTML = '<span class="loading">Enter a URL and click Execute.</span>';
}

function renderTabContent() {
  if (activeTab === "session") { renderSessionPanel(); return; }
  tabContent.innerHTML = renderForm();
}

// ---- Forms per tab ----
function renderForm() {
  const t = activeTab;
  let html = '';

  // URL input
  html += `<div class="form-group"><label>URL</label><input id="inputUrl" type="url" placeholder="https://example.com" /></div>`;

  // Tab-specific options
  if (t === "screenshot") {
    html += `
      <div class="form-row">
        <div class="form-group checkbox-row"><input type="checkbox" id="optFullPage" checked /><label for="optFullPage">Full page</label></div>
        <div class="form-group"><label>Selector</label><input id="optSelector" placeholder="CSS selector (optional)" /></div>
      </div>`;
  }
  if (t === "pdf") {
    html += `
      <div class="form-row">
        <div class="form-group"><label>Format</label><select id="optFormat"><option value="A4">A4</option><option value="Letter">Letter</option></select></div>
        <div class="form-group checkbox-row"><input type="checkbox" id="optLandscape" /><label for="optLandscape">Landscape</label></div>
        <div class="form-group checkbox-row"><input type="checkbox" id="optPrintBg" checked /><label for="optPrintBg">Print background</label></div>
      </div>`;
  }
  if (t === "json") {
    html += `
      <div class="form-group"><label>AI Prompt</label><textarea id="optPrompt" placeholder="Extract product name, price, and description"></textarea></div>
      <div class="form-group"><label>JSON Schema (optional)</label><textarea id="optSchema" placeholder='{"type":"object","properties":{...}}'></textarea></div>`;
  }
  if (t === "scrape") {
    html += `<div class="form-group"><label>CSS Selectors (comma-separated)</label><input id="optSelectors" placeholder="h1, .price, a[href]" /></div>`;
  }
  if (t === "links") {
    html += `
      <div class="form-row">
        <div class="form-group checkbox-row"><input type="checkbox" id="optVisibleOnly" /><label for="optVisibleOnly">Visible only</label></div>
        <div class="form-group checkbox-row"><input type="checkbox" id="optExcludeExt" /><label for="optExcludeExt">Exclude external</label></div>
      </div>`;
  }
  if (t === "crawl") {
    html += `
      <div class="form-row">
        <div class="form-group"><label>Max pages</label><input id="optLimit" type="number" value="10" /></div>
        <div class="form-group"><label>Depth</label><input id="optDepth" type="number" value="1" /></div>
      </div>
      <div class="form-group"><label>Include patterns (comma-separated)</label><input id="optInclude" placeholder="/docs/**" /></div>
      <div class="form-group"><label>Exclude patterns (comma-separated)</label><input id="optExclude" placeholder="/admin/**" /></div>
      <div class="form-group"><label>Formats</label><select id="optFormats" multiple><option value="html" selected>HTML</option><option value="markdown">Markdown</option><option value="json">JSON</option></select></div>`;
  }

  // Advanced options
  html += `
    <div class="advanced-toggle" onclick="this.nextElementSibling.classList.toggle('open')">▶ Advanced Options</div>
    <div class="advanced">
      <div class="form-row">
        <div class="form-group"><label>Viewport Width</label><input id="advWidth" type="number" value="1280" /></div>
        <div class="form-group"><label>Viewport Height</label><input id="advHeight" type="number" value="800" /></div>
      </div>
      <div class="form-group"><label>Wait for selector</label><input id="advWaitSelector" placeholder="CSS selector to wait for" /></div>
      <div class="form-group"><label>Custom JS</label><textarea id="advJs" placeholder="document.querySelector('.btn').click()"></textarea></div>
      <div class="form-group"><label>Custom CSS</label><textarea id="advCss" placeholder="body { font-size: 16px; }"></textarea></div>
      <div class="form-group"><label>Cookie string</label><input id="advCookies" placeholder="name=val; name2=val2" /></div>
      <div class="form-group"><label>User-Agent</label><input id="advUA" placeholder="Custom user agent" /></div>
    </div>`;

  html += `<button class="btn btn-primary" onclick="execute()" style="margin-top:12px">Execute</button>`;
  return html;
}

// ---- Session panel ----
function renderSessionPanel() {
  tabContent.innerHTML = `
    <div class="session-panel">
      <div class="session-header">
        <strong>Session: ${activeSessionId || 'None'}</strong>
        ${activeSessionId ? '<button class="btn btn-danger" onclick="closeSession()">Close</button>' : '<button class="btn btn-primary" onclick="createSession()">Create Session</button>'}
      </div>
      ${activeSessionId ? `
        <div class="form-group"><label>Navigate to URL</label><input id="sessionUrl" placeholder="https://example.com" /></div>
        <div class="session-actions">
          <button class="btn btn-primary" onclick="sessionNavigate()">Navigate</button>
          <button class="btn btn-primary" onclick="sessionScreenshot()">Screenshot</button>
          <button class="btn btn-primary" onclick="sessionPdf()">PDF</button>
        </div>
        <div class="form-group" style="margin-top:12px"><label>Evaluate JS</label><textarea id="sessionJs" placeholder="document.title"></textarea></div>
        <div class="session-actions">
          <button class="btn btn-primary" onclick="sessionEvaluate()">Evaluate</button>
          <button class="btn btn-primary" onclick="sessionStatus()">Status</button>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label>Action</label>
          <div class="session-actions">
            <select id="sessionActionType"><option value="click">Click</option><option value="fill">Fill</option><option value="type">Type</option><option value="wait">Wait</option></select>
            <input id="sessionSelector" placeholder="CSS selector" style="width:200px" />
            <input id="sessionValue" placeholder="Value (for fill/type)" style="width:200px" />
            <button class="btn btn-primary" onclick="sessionAction()">Run</button>
          </div>
        </div>
      ` : '<p style="color:var(--muted)">Create a session to start a persistent browser.</p>'}
    </div>`;
}

async function apiFetch(path, options = {}) {
  const key = apiKeyEl.value;
  const headers = { ...(options.headers || {}), "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  const resp = await fetch(path, { ...options, headers });
  return resp;
}

function getAdvancedOptions() {
  const opts = {};
  const w = document.getElementById("advWidth");
  const h = document.getElementById("advHeight");
  if (w && h) opts.viewport = { width: parseInt(w.value) || 1280, height: parseInt(h.value) || 800 };
  const ws = document.getElementById("advWaitSelector");
  if (ws && ws.value) opts.waitForSelector = { selector: ws.value, timeout: 10000 };
  const js = document.getElementById("advJs");
  if (js && js.value) opts.addScriptTag = [{ content: js.value }];
  const css = document.getElementById("advCss");
  if (css && css.value) opts.addStyleTag = [{ content: css.value }];
  const cookies = document.getElementById("advCookies");
  if (cookies && cookies.value) {
    opts.cookies = cookies.value.split(";").map(c => { const [n, ...v] = c.trim().split("="); return { name: n, value: v.join("="), domain: "" }; });
  }
  const ua = document.getElementById("advUA");
  if (ua && ua.value) opts.userAgent = ua.value;
  return opts;
}

// ---- Execute Quick Actions ----
async function execute() {
  if (activeTab === "session") return;
  const url = document.getElementById("inputUrl")?.value;
  if (!url) { resultEl.innerHTML = "Please enter a URL."; return; }

  const body = { url, ...getAdvancedOptions() };

  // Tab-specific params
  if (activeTab === "screenshot") {
    body.screenshotOptions = {};
    const fp = document.getElementById("optFullPage");
    if (fp) body.screenshotOptions.fullPage = fp.checked;
    const sel = document.getElementById("optSelector");
    if (sel && sel.value) body.screenshotOptions.selector = sel.value;
  }
  if (activeTab === "pdf") {
    body.pdfOptions = {};
    const fmt = document.getElementById("optFormat");
    if (fmt) body.pdfOptions.format = fmt.value;
    const ls = document.getElementById("optLandscape");
    if (ls) body.pdfOptions.landscape = ls.checked;
    const pb = document.getElementById("optPrintBg");
    if (pb) body.pdfOptions.printBackground = pb.checked;
  }
  if (activeTab === "json") {
    const p = document.getElementById("optPrompt");
    if (p && p.value) body.prompt = p.value;
    const s = document.getElementById("optSchema");
    if (s && s.value) body.response_format = { type: "json_schema", schema: JSON.parse(s.value) };
  }
  if (activeTab === "scrape") {
    const s = document.getElementById("optSelectors");
    if (s && s.value) body.elements = s.value.split(",").map(sel => ({ selector: sel.trim() }));
  }
  if (activeTab === "links") {
    const v = document.getElementById("optVisibleOnly");
    if (v) body.visibleLinksOnly = v.checked;
    const e = document.getElementById("optExcludeExt");
    if (e) body.excludeExternalLinks = e.checked;
  }
  if (activeTab === "crawl") {
    const lim = document.getElementById("optLimit");
    if (lim) body.limit = parseInt(lim.value) || 10;
    const dep = document.getElementById("optDepth");
    if (dep) body.depth = parseInt(dep.value) || 1;
    const inc = document.getElementById("optInclude");
    if (inc && inc.value) { body.options = body.options || {}; body.options.includePatterns = inc.value.split(",").map(s => s.trim()); }
    const exc = document.getElementById("optExclude");
    if (exc && exc.value) { body.options = body.options || {}; body.options.excludePatterns = exc.value.split(",").map(s => s.trim()); }
    const fmts = document.getElementById("optFormats");
    if (fmts) body.formats = Array.from(fmts.selectedOptions).map(o => o.value);
  }

  resultEl.innerHTML = '<span class="loading">Loading...</span>';
  try {
    const resp = await apiFetch(`/api/${activeTab}`, { method: "POST", body: JSON.stringify(body) });
    await displayResult(resp, activeTab);
  } catch (err) {
    resultEl.innerHTML = `<span style="color:var(--error)">Error: ${err.message}</span>`;
  }
}

async function displayResult(resp, tab) {
  const ct = resp.headers.get("Content-Type") || "";
  if (ct.includes("image")) {
    const blob = await resp.blob();
    resultEl.innerHTML = `<img src="${URL.createObjectURL(blob)}" />`;
  } else if (ct.includes("pdf")) {
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "output.pdf";
    a.textContent = "Download PDF";
    resultEl.innerHTML = "";
    resultEl.appendChild(a);
  } else {
    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      resultEl.innerHTML = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
    } catch {
      resultEl.innerHTML = `<pre>${text}</pre>`;
    }
  }
}

// ---- Session actions ----
async function createSession() {
  resultEl.innerHTML = '<span class="loading">Creating session...</span>';
  const resp = await apiFetch("/api/session", { method: "POST" });
  const data = await resp.json();
  if (resp.ok) {
    activeSessionId = data.sessionId;
    renderSessionPanel();
    resultEl.innerHTML = `<pre>Session created: ${activeSessionId}</pre>`;
  } else {
    resultEl.innerHTML = `<span style="color:var(--error)">Error: ${JSON.stringify(data)}</span>`;
  }
}

async function closeSession() {
  if (!activeSessionId) return;
  await apiFetch(`/api/session/${activeSessionId}`, { method: "DELETE" });
  activeSessionId = null;
  renderSessionPanel();
  resultEl.innerHTML = "Session closed.";
}

async function sessionNavigate() {
  const url = document.getElementById("sessionUrl").value;
  resultEl.innerHTML = '<span class="loading">Navigating...</span>';
  const resp = await apiFetch(`/api/session/${activeSessionId}/navigate`, { method: "POST", body: JSON.stringify({ url }) });
  resultEl.innerHTML = `<pre>${await resp.text()}</pre>`;
}

async function sessionScreenshot() {
  resultEl.innerHTML = '<span class="loading">Taking screenshot...</span>';
  const resp = await apiFetch(`/api/session/${activeSessionId}/screenshot`, { method: "POST", body: JSON.stringify({}) });
  await displayResult(resp, "screenshot");
}

async function sessionPdf() {
  resultEl.innerHTML = '<span class="loading">Generating PDF...</span>';
  const resp = await apiFetch(`/api/session/${activeSessionId}/pdf`, { method: "POST", body: JSON.stringify({}) });
  await displayResult(resp, "pdf");
}

async function sessionEvaluate() {
  const expression = document.getElementById("sessionJs").value;
  resultEl.innerHTML = '<span class="loading">Evaluating...</span>';
  const resp = await apiFetch(`/api/session/${activeSessionId}/evaluate`, { method: "POST", body: JSON.stringify({ expression }) });
  resultEl.innerHTML = `<pre>${await resp.text()}</pre>`;
}

async function sessionAction() {
  const type = document.getElementById("sessionActionType").value;
  const selector = document.getElementById("sessionSelector").value;
  const value = document.getElementById("sessionValue").value;
  resultEl.innerHTML = '<span class="loading">Running action...</span>';
  const resp = await apiFetch(`/api/session/${activeSessionId}/action`, { method: "POST", body: JSON.stringify({ type, selector, value }) });
  resultEl.innerHTML = `<pre>${await resp.text()}</pre>`;
}

async function sessionStatus() {
  const resp = await apiFetch(`/api/session/${activeSessionId}`);
  resultEl.innerHTML = `<pre>${await resp.text()}</pre>`;
}

// ---- Boot ----
renderTabContent();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/index.html
git commit -m "feat: add single-page frontend UI with all tabs"
```

---

### Task 8: Worker Entry — Route Dispatch

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: Write src/index.js**

Ties together auth, quick actions, crawl, sessions, and frontend.

```js
import { authenticate } from "./auth";
import { proxyQuickAction } from "./quick-actions";
import { startCrawl, getCrawlStatus, cancelCrawl } from "./crawl";
import { handleSessionRequest } from "./sessions";
import { BrowserSessionDO } from "./browser-do";
import frontendHtml from "./frontend/index.html" with { type: "text" };

export { BrowserSessionDO };

const QUICK_ACTIONS = ["screenshot", "pdf", "markdown", "json", "scrape", "links", "content", "snapshot"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Serve frontend
    if (path === "/" || path === "/index.html") {
      return new Response(frontendHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Auth required for all /api/* routes
    const auth = authenticate(request, env.API_KEYS);
    if (!auth.valid) return auth.response;

    // Quick Actions: POST /api/:action
    if (request.method === "POST" && QUICK_ACTIONS.includes(path.slice(5))) {
      const action = path.slice(5);
      const body = await request.json();
      return proxyQuickAction(action, body, env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Crawl: POST /api/crawl
    if (request.method === "POST" && path === "/api/crawl") {
      const body = await request.json();
      return startCrawl(body, env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Crawl: GET /api/crawl/:jobId
    const crawlGetMatch = path.match(/^\/api\/crawl\/([0-9a-f-]+)$/);
    if (request.method === "GET" && crawlGetMatch) {
      return getCrawlStatus(crawlGetMatch[1], url.searchParams.toString(), env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Crawl: DELETE /api/crawl/:jobId
    if (request.method === "DELETE" && crawlGetMatch) {
      return cancelCrawl(crawlGetMatch[1], env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Session routes: /api/session/*
    if (path.startsWith("/api/session")) {
      return handleSessionRequest(request, path, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/index.js
git commit -m "feat: add Worker entry with route dispatch"
```

---

### Task 9: Verify Build & Dev Server

**Files:**
- Modify: `wrangler.toml` (add `[assets]` if needed)
- Modify: `package.json` (adjust scripts if needed)

- [ ] **Step 1: Run wrangler dev to verify the worker compiles**

Run: `npx wrangler dev`
Expected: Worker starts on localhost, no compilation errors.

- [ ] **Step 2: Test frontend loads**

Open `http://localhost:8787/` in browser or curl:
```bash
curl -s http://localhost:8787/ | head -5
```
Expected: HTML content returned.

- [ ] **Step 3: Test auth rejection**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/api/screenshot
```
Expected: `401`

- [ ] **Step 4: Set secrets for testing**

```bash
echo "test-key" | npx wrangler secret put API_KEYS
echo "<your-account-id>" | npx wrangler secret put CF_ACCOUNT_ID
echo "<your-api-token>" | npx wrangler secret put CF_API_TOKEN
```

- [ ] **Step 5: Test a Quick Action end-to-end**

```bash
curl -X POST http://localhost:8787/api/markdown \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```
Expected: JSON with markdown content.

- [ ] **Step 6: Commit any fixes**

If any issues were found and fixed, commit them.

---

### Task 10: Deploy

**Files:** None (deployment only)

- [ ] **Step 1: Set production secrets**

```bash
echo "<prod-api-keys>" | npx wrangler secret put API_KEYS
echo "<prod-account-id>" | npx wrangler secret put CF_ACCOUNT_ID
echo "<prod-api-token>" | npx wrangler secret put CF_API_TOKEN
```

- [ ] **Step 2: Deploy**

Run: `npx wrangler deploy`
Expected: Worker deployed to `https://browser-run-toolkit.<subdomain>.workers.dev`

- [ ] **Step 3: Verify production**

```bash
curl -s https://browser-run-toolkit.<subdomain>.workers.dev/ | head -5
```
Expected: HTML content returned.
