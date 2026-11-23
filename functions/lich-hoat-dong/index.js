import {
  buildEventsJsonLd,
  renderPastWorkshopsHtml,
  renderScheduleUpcomingContentHtml,
  replaceMarker,
  splitEventsByDate,
} from "../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/lich-hoat-dong/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  const [assetRes, eventsRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      "SELECT * FROM events WHERE status = 'published' ORDER BY sort_order ASC, date ASC, created_at DESC LIMIT 80"
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok || !eventsRes) {
    return assetRes;
  }

  const { upcoming, past } = splitEventsByDate(eventsRes.results || []);

  let html = await assetRes.text();
  html = replaceMarker(html, "SCHEDULE_UPCOMING", renderScheduleUpcomingContentHtml(upcoming));
  html = replaceMarker(html, "PAST_WORKSHOPS", renderPastWorkshopsHtml(past));
  html = replaceMarker(html, "EVENTS_JSON_LD", buildEventsJsonLd(upcoming));

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
