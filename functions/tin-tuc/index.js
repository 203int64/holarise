import { renderNewsCardsHtml, replaceMarker, serializePostRow } from "../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/tin-tuc/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  const [assetRes, dbRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      "SELECT * FROM posts WHERE status = 'published' ORDER BY date DESC, created_at DESC LIMIT 60"
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok || !dbRes) {
    return assetRes;
  }

  const posts = (dbRes.results || []).map(serializePostRow);
  let html = await assetRes.text();
  html = replaceMarker(html, "NEWS_LIST", renderNewsCardsHtml(posts, true));

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
