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
    const action = path.startsWith("/api/") ? path.slice(5) : null;
    if (request.method === "POST" && action && QUICK_ACTIONS.includes(action)) {
      const body = await request.json();
      return proxyQuickAction(action, body, env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Crawl: POST /api/crawl
    if (request.method === "POST" && path === "/api/crawl") {
      const body = await request.json();
      return startCrawl(body, env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Crawl: GET /api/crawl/:jobId
    const crawlMatch = path.match(/^\/api\/crawl\/([0-9a-f-]+)$/);
    if (request.method === "GET" && crawlMatch) {
      return getCrawlStatus(crawlMatch[1], url.searchParams.toString(), env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Crawl: DELETE /api/crawl/:jobId
    if (request.method === "DELETE" && crawlMatch) {
      return cancelCrawl(crawlMatch[1], env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    }

    // Session routes: /api/session/*
    if (path.startsWith("/api/session")) {
      return handleSessionRequest(request, path, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
