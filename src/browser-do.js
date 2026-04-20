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
