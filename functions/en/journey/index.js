import { canActorViewAlbum, ensureDeepControlSchema, resolveActorContext } from "../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../_lib/media-approval-schema.js";
import {
  renderNewsCardsHtml,
  renderPublicAlbumsHtml,
  replaceMarker,
  safeJsonParse,
  serializePostRow,
} from "../../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/en/journey/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  await Promise.all([ensureMediaApprovalSchema(env.DB), ensureDeepControlSchema(env.DB)]);
  const actor = await resolveActorContext(env, request);

  const [assetRes, postsRes, albumsRes, photosRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      "SELECT * FROM posts WHERE status = 'published' ORDER BY date DESC, created_at DESC LIMIT 60"
    )
      .all()
      .catch(() => null),
    env.DB.prepare(
      `SELECT * FROM media_albums
       WHERE status = 'published'
       ORDER BY sort_order ASC, event_date DESC, created_at DESC
       LIMIT 60`
    )
      .all()
      .catch(() => null),
    env.DB.prepare(
      `SELECT p.id, p.album_id, COALESCE(NULLIF(p.web_url, ''), p.url) AS url,
              p.caption, p.alt, p.photographer
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE a.status = 'published'
         AND COALESCE(p.approval_status, 'approved') = 'approved'
       ORDER BY p.sort_order ASC, p.created_at DESC
       LIMIT 600`
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok) {
    return assetRes;
  }

  let html = await assetRes.text();

  // Only replace static EN stories if D1 contains posts beyond the 2 pre-translated seed stories
  if (postsRes) {
    const posts = (postsRes.results || []).map(serializePostRow);
    const seedSlugs = new Set(["tinh-yeu-thuong-cua-me", "holaheart-musicspace"]);
    const hasExtraDynamicPosts = posts.some((p) => !seedSlugs.has(p.slug));
    if (hasExtraDynamicPosts) {
      html = replaceMarker(html, "NEWS_LIST", renderNewsCardsHtml(posts, true, "en"));
    }
  }

  let renderedRestricted = false;
  if (albumsRes && photosRes) {
    const photosByAlbum = new Map();
    for (const row of photosRes.results || []) {
      if (!photosByAlbum.has(row.album_id)) photosByAlbum.set(row.album_id, []);
      photosByAlbum.get(row.album_id).push({
        id: row.id,
        url: row.url,
        caption: row.caption || "",
        alt: row.alt || "",
        photographer: row.photographer || "",
      });
    }

    const visibleAlbums = [];
    for (const a of albumsRes.results || []) {
      const photos = photosByAlbum.get(a.id) || [];
      if (photos.length === 0) continue;
      const vis = String(a.visibility || "public").toLowerCase();
      if (vis !== "public") {
        const allowed = await canActorViewAlbum(env.DB, a, actor);
        if (!allowed) continue;
        renderedRestricted = true;
      }
      visibleAlbums.push({
        id: a.id,
        slug: a.slug,
        title: a.title,
        description: a.description || "",
        eventDate: a.event_date || "",
        dateDisplay: a.date_display || "",
        location: a.location || "",
        filters: safeJsonParse(a.filters_json, []),
        driveUrl: a.drive_url || "",
        coverUrl: a.cover_url || "",
        photos,
      });
    }

    if (visibleAlbums.length > 0) {
      html = replaceMarker(html, "D1_ALBUMS", renderPublicAlbumsHtml(visibleAlbums, "en"));
      const hasD1Event1511 = visibleAlbums.some(
        (a) => a.id === "alb-holaheart-2026-11-15" || a.eventDate === "2026-11-15"
      );
      if (hasD1Event1511) {
        html = replaceMarker(html, "STATIC_1511_GALLERY", "");
      }
    }
  }

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", renderedRestricted ? "private, no-store" : "public, max-age=0, must-revalidate");
  headers.set("Vary", "Cookie");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
