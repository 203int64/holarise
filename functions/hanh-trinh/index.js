import { canActorViewAlbum, ensureDeepControlSchema, resolveActorContext } from "../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../_lib/media-approval-schema.js";
import {
  renderNewsCardsHtml,
  renderPublicAlbumsHtml,
  replaceMarker,
  safeJsonParse,
  serializePostRow,
} from "../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/hanh-trinh/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  await Promise.all([ensureMediaApprovalSchema(env.DB), ensureDeepControlSchema(env.DB)]);

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
              CASE WHEN COALESCE(p.web_media_key, '') LIKE 'ai-%' THEN COALESCE(NULLIF(p.web_url, ''), p.url) ELSE p.url END AS full_url,
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
  let hasPrivateAlbumRendered = false;

  if (postsRes) {
    const posts = (postsRes.results || []).map(serializePostRow);
    html = replaceMarker(html, "NEWS_LIST", renderNewsCardsHtml(posts, true));
  }

  if (albumsRes && photosRes) {
    const rawAlbums = albumsRes.results || [];
    const needsActorCheck = rawAlbums.some((a) => String(a.visibility || "public") !== "public");
    const actor = needsActorCheck ? await resolveActorContext(env, request) : null;

    const visibleAlbums = [];
    for (const a of rawAlbums) {
      const vis = String(a.visibility || "public");
      if (vis === "public") {
        visibleAlbums.push(a);
      } else if (actor && (await canActorViewAlbum(env.DB, a, actor))) {
        visibleAlbums.push(a);
        hasPrivateAlbumRendered = true;
      }
    }

    const photosByAlbum = new Map();
    for (const row of photosRes.results || []) {
      if (!photosByAlbum.has(row.album_id)) photosByAlbum.set(row.album_id, []);
      photosByAlbum.get(row.album_id).push({
        id: row.id,
        url: row.url,
        fullUrl: row.full_url || row.url,
        caption: row.caption || "",
        alt: row.alt || "",
        photographer: row.photographer || "",
      });
    }

    const albumsWithPhotos = visibleAlbums
      .map((a) => ({
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
        photos: photosByAlbum.get(a.id) || [],
      }))
      .filter((a) => a.photos.length > 0);

    if (albumsWithPhotos.length > 0) {
      html = replaceMarker(html, "D1_ALBUMS", renderPublicAlbumsHtml(albumsWithPhotos));
      const hasD1Event1511 = albumsWithPhotos.some(
        (a) => a.id === "alb-holaheart-2026-11-15" || a.eventDate === "2026-11-15"
      );
      if (hasD1Event1511) {
        html = replaceMarker(html, "STATIC_1511_GALLERY", "");
      }
    }
  }

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set(
    "Cache-Control",
    hasPrivateAlbumRendered ? "private, no-store" : "public, max-age=0, must-revalidate"
  );
  if (hasPrivateAlbumRendered) headers.set("Vary", "Cookie");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
