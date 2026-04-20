/**
 * Route session API requests to Durable Object instances.
 */
export async function handleSessionRequest(request, path, env) {
  const idPattern = /^\/api\/session\/([0-9a-f-]+)(\/.*)?$/;

  // POST /api/session — create new session
  if (request.method === "POST" && path === "/api/session") {
    const sessionId = crypto.randomUUID();
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

  if (request.method === "GET" && subPath === "") {
    return stub.fetch(new Request(new URL("/status", request.url)));
  }

  if (request.method === "DELETE" && subPath === "") {
    return stub.fetch(new Request(new URL("/close", request.url), { method: "DELETE" }));
  }

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
