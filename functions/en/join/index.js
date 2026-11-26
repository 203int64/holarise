import {
  renderJoinEventsSectionHtml,
  replaceMarker,
  splitEventsByDate,
} from "../../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/en/join/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  const [assetRes, eventsRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      "SELECT * FROM events WHERE status = 'published' ORDER BY sort_order ASC, date ASC, created_at DESC LIMIT 60"
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok || !eventsRes) {
    return assetRes;
  }

  const { upcoming } = splitEventsByDate(eventsRes.results || []);

  let html = await assetRes.text();
  html = replaceMarker(html, "JOIN_EVENTS_SECTION", renderJoinEventsSectionHtml(upcoming, "en"));

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
