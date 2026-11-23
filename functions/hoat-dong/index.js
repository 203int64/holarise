import {
  renderPublicAlbumsHtml,
  replaceMarker,
  safeJsonParse,
} from "../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/hoat-dong/index.html", request.url), {
    method: "GET",
  });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS
      ? env.ASSETS.fetch(staticAssetReq)
      : new Response("Not Found", { status: 404 });
  }

  const [assetRes, albumsRes, photosRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare(
      `SELECT * FROM media_albums
       WHERE status = 'published'
       ORDER BY sort_order ASC, event_date DESC, created_at DESC
       LIMIT 60`
    )
      .all()
      .catch(() => null),
    env.DB.prepare(
      `SELECT p.*
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE a.status = 'published'
       ORDER BY p.sort_order ASC, p.created_at DESC
       LIMIT 600`
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok || !albumsRes || !photosRes) {
    return assetRes;
  }

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

  const albumsWithPhotos = (albumsRes.results || [])
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

  if (albumsWithPhotos.length === 0) {
    return assetRes;
  }

  let html = await assetRes.text();
  html = replaceMarker(html, "ACTIVITIES_GALLERY", renderPublicAlbumsHtml(albumsWithPhotos));

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
