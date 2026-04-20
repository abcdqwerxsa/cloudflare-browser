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
