import {
  renderJoinEventOptionsHtml,
  replaceMarker,
  serializeEventRow,
} from "../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/tham-gia/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  const [assetRes, upcomingRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      "SELECT * FROM events WHERE kind = 'upcoming' AND status = 'published' ORDER BY sort_order ASC, date ASC, created_at DESC LIMIT 20"
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok || !upcomingRes) {
    return assetRes;
  }

  const upcoming = (upcomingRes.results || []).map(serializeEventRow);

  let html = await assetRes.text();
  html = replaceMarker(html, "JOIN_EVENTS", renderJoinEventOptionsHtml(upcoming));

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
