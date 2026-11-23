import {
  buildEventsJsonLd,
  renderHeroUpcomingBar,
  renderHorizontalGalleryHtml,
  renderWorkshopsHtml,
  replaceMarker,
  serializeEventRow,
} from "./_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  const [assetRes, dbRes, featuredRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      "SELECT * FROM events WHERE kind = 'upcoming' AND status = 'published' ORDER BY sort_order ASC, date ASC, created_at DESC LIMIT 20"
    )
      .all()
      .catch(() => null),
    env.DB.prepare(
      `SELECT p.url, p.caption, p.alt, p.photographer, a.title AS album_title
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE a.status = 'published' AND p.is_featured_home = 1
       ORDER BY p.sort_order ASC, p.created_at DESC
       LIMIT 12`
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok || !dbRes) {
    return assetRes;
  }

  const upcoming = (dbRes.results || []).map(serializeEventRow);
  let html = await assetRes.text();
  html = replaceMarker(html, "HERO_UPCOMING_BAR", renderHeroUpcomingBar(upcoming));
  html = replaceMarker(html, "UPCOMING_WORKSHOPS", renderWorkshopsHtml(upcoming));
  html = replaceMarker(html, "EVENTS_JSON_LD", buildEventsJsonLd(upcoming.slice(0, 1)));

  let homePhotos = (featuredRes?.results || []).map((r) => ({
    url: r.url,
    caption: r.caption || "",
    alt: r.alt || "",
    photographer: r.photographer || "",
    albumTitle: r.album_title || "",
  }));

  if (homePhotos.length === 0 && featuredRes) {
    const latestRes = await env.DB.prepare(
      `SELECT p.url, p.caption, p.alt, p.photographer, a.title AS album_title
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE a.status = 'published'
       ORDER BY p.created_at DESC
       LIMIT 8`
    )
      .all()
      .catch(() => null);
    homePhotos = (latestRes?.results || []).map((r) => ({
      url: r.url,
      caption: r.caption || "",
      alt: r.alt || "",
      photographer: r.photographer || "",
      albumTitle: r.album_title || "",
    }));
  }

  if (homePhotos.length > 0) {
    html = replaceMarker(html, "HORIZONTAL_GALLERY", renderHorizontalGalleryHtml(homePhotos));
  }

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
