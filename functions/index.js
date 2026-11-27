import { ensureDeepControlSchema } from "./_lib/media-access.js";
import { ensureMediaApprovalSchema } from "./_lib/media-approval-schema.js";
import {
  applySiteVisualsSsr,
  buildEventsJsonLd,
  parsePartnersJson,
  renderHeroLivePillHtml,
  renderHeroVoiceCardHtml,
  renderHomeUpcomingSectionHtml,
  renderHorizontalGalleryHtml,
  renderPartnersStripHtml,
  renderPublicTestimonialsHtml,
  replaceMarker,
  splitEventsByDate,
} from "./_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  await Promise.all([ensureMediaApprovalSchema(env.DB), ensureDeepControlSchema(env.DB)]);

  const [assetRes, eventsRes, featuredRes, partnersRow, visualsRow, testimonialsRes, heroReflectionsRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      "SELECT * FROM events WHERE status = 'published' ORDER BY sort_order ASC, date ASC, created_at DESC LIMIT 60"
    )
      .all()
      .catch(() => null),
    env.DB.prepare(
      `SELECT COALESCE(NULLIF(p.web_url, ''), p.url) AS url,
              CASE WHEN COALESCE(p.web_media_key, '') LIKE 'ai-%' THEN COALESCE(NULLIF(p.web_url, ''), p.url) ELSE p.url END AS full_url,
              p.caption, p.alt, p.photographer, a.title AS album_title
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE a.status = 'published'
         AND COALESCE(a.visibility, 'public') = 'public'
         AND COALESCE(p.approval_status, 'approved') = 'approved'
         AND p.is_featured_home = 1
       ORDER BY p.sort_order ASC, p.created_at DESC
       LIMIT 12`
    )
      .all()
      .catch(() => null),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'partners_json'")
      .first()
      .catch(() => null),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'site_visuals_json'")
      .first()
      .catch(() => null),
    env.DB.prepare(
      `SELECT id, activity_slug, author_name, author_role, author_org, pull_quote, content, photo_url, heart_count
       FROM community_testimonials
       WHERE status = 'approved' AND is_featured_home = 1
       ORDER BY created_at DESC
       LIMIT 6`
    )
      .all()
      .catch(() => null),
    env.DB.prepare(
      `SELECT r.id, r.activity_slug, r.pull_quote, r.content, r.mood, r.heart_count,
              m.name AS author_name, m.organization AS author_org, m.avatar_url AS author_avatar_url
       FROM activity_reflections r
       JOIN members m ON m.id = r.member_id
       WHERE r.status = 'approved'
       ORDER BY r.created_at DESC
       LIMIT 5`
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok || !eventsRes) {
    return assetRes;
  }

  const { upcoming, past } = splitEventsByDate(eventsRes.results || []);
  const partners = parsePartnersJson(partnersRow?.value || "[]");
  const heroVoices = [
    ...(heroReflectionsRes?.results || []),
    ...(testimonialsRes?.results || []),
  ];

  let html = await assetRes.text();
  html = replaceMarker(html, "HERO_LIVE_PILL", renderHeroLivePillHtml(upcoming, past, "vi"));
  html = replaceMarker(html, "HERO_VOICE_CARD", renderHeroVoiceCardHtml({ voices: heroVoices, past, lang: "vi" }));
  html = replaceMarker(html, "HOME_UPCOMING_SECTION", renderHomeUpcomingSectionHtml(upcoming));
  html = replaceMarker(html, "EVENTS_JSON_LD", buildEventsJsonLd(upcoming.slice(0, 1)));
  if (partnersRow) {
    html = replaceMarker(html, "PARTNERS_STRIP", renderPartnersStripHtml(partners));
  }
  if (visualsRow?.value) {
    html = applySiteVisualsSsr(html, visualsRow.value);
  }
  if (testimonialsRes?.results?.length) {
    html = replaceMarker(html, "TESTIMONIALS", renderPublicTestimonialsHtml(testimonialsRes.results));
  }

  let homePhotos = (featuredRes?.results || []).map((r) => ({
    url: r.url,
    fullUrl: r.full_url || r.url,
    caption: r.caption || "",
    alt: r.alt || "",
    photographer: r.photographer || "",
    albumTitle: r.album_title || "",
  }));

  if (homePhotos.length === 0 && featuredRes) {
    const latestRes = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(p.web_url, ''), p.url) AS url,
              CASE WHEN COALESCE(p.web_media_key, '') LIKE 'ai-%' THEN COALESCE(NULLIF(p.web_url, ''), p.url) ELSE p.url END AS full_url,
              p.caption, p.alt, p.photographer, a.title AS album_title
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE a.status = 'published'
         AND COALESCE(a.visibility, 'public') = 'public'
         AND COALESCE(p.approval_status, 'approved') = 'approved'
       ORDER BY p.created_at DESC
       LIMIT 8`
    )
      .all()
      .catch(() => null);
    homePhotos = (latestRes?.results || []).map((r) => ({
      url: r.url,
      fullUrl: r.full_url || r.url,
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
