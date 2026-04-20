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

  const authHeader = request.headers.get("Authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && keys.includes(bearerMatch[1])) {
    return { valid: true };
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token && keys.includes(token)) {
    return { valid: true };
  }

  return { valid: false, response: new Response("Unauthorized", { status: 401 }) };
}
