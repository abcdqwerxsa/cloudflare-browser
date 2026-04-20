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

  async ensureBrowser() {
    if (this.browser && this.page) return;
    if (!this.env.MYBROWSER) {
      throw new Error("Browser binding (MYBROWSER) not configured");
    }
    this.browser = await puppeteer.launch(this.env.MYBROWSER);
    this.page = await this.browser.newPage();
    this.lastActivity = Date.now();
    await this.state.storage.setAlarm(Date.now() + MAX_IDLE_MS);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "DELETE" && path === "/close") return await this.handleClose();
      if (request.method === "GET" && path === "/status") return await this.handleStatus();

      // All write operations auto-launch browser on first use
      if (request.method === "POST") {
        await this.ensureBrowser();
        this.lastActivity = Date.now();
        await this.state.storage.setAlarm(Date.now() + MAX_IDLE_MS);

        if (path === "/navigate") return await this.handleNavigate(request);
        if (path === "/screenshot") return await this.handleScreenshot(request);
        if (path === "/pdf") return await this.handlePdf(request);
        if (path === "/evaluate") return await this.handleEvaluate(request);
        if (path === "/action") return await this.handleAction(request);
        if (path === "/cookies") return await this.handleCookies(request);
        if (path === "/launch") return new Response(JSON.stringify({ status: "launched" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

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
    const result = await this.page.evaluate(new Function(expression));
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
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
    }
    return new Response(JSON.stringify({ status: "closed" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async alarm() {
    if (this.browser && Date.now() - this.lastActivity > MAX_IDLE_MS) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
    }
  }
}
