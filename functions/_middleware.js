/**
 * Global Pages Functions middleware:
 * - Blocks direct external access to internal SSR templates (/_templates/*)
 * - Ensures consistent baseline security headers on dynamic Function responses.
 */

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname === "/_templates" || url.pathname.startsWith("/_templates/")) {
    return new Response("Not Found", { status: 404 });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("X-Frame-Options")) {
    headers.set("X-Frame-Options", "SAMEORIGIN");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
