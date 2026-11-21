/**
 * Public immutable image endpoint backed by Cloudflare KV + Edge Cache.
 * Serves uploaded CMS photos at /api/media/<id> (JPEG/PNG/WebP).
 */

const SAFE_ID_RE = /^[a-zA-Z0-9._-]{6,96}$/;

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = String(params?.id || "");
  if (!SAFE_ID_RE.test(id)) {
    return new Response("Not Found", { status: 404 });
  }
  if (!env?.MEDIA_KV) {
    return new Response("Media store unavailable", { status: 503 });
  }

  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }

  const { value, metadata } = await env.MEDIA_KV.getWithMetadata(`media:${id}`, {
    type: "arrayBuffer",
  });
  if (!value) {
    return new Response("Not Found", { status: 404 });
  }

  const contentType = metadata?.contentType || "image/jpeg";
  const response = new Response(value, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });

  if (cache && typeof context.waitUntil === "function") {
    context.waitUntil(cache.put(request, response.clone()));
  }
  return response;
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
