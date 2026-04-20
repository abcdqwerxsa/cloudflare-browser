const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

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

  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "X-Browser-Ms-Used": response.headers.get("X-Browser-Ms-Used") || "",
    },
  });
}
