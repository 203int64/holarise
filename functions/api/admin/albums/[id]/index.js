import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../../_lib/security.js";
import { validateAlbumInput } from "../../../../_lib/validation.js";
import { serializeAlbumRow } from "../index.js";

const MEDIA_ROLES = ["super_admin", "editor", "media"];

export function serializePhotoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    albumId: row.album_id,
    mediaKey: row.media_key || "",
    url: row.url,
    caption: row.caption || "",
    alt: row.alt || "",
    photographer: row.photographer || "",
    isFeaturedHome: Boolean(row.is_featured_home),
    sortOrder: Number(row.sort_order || 0),
    uploadedBy: row.uploaded_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const album = await context.env.DB.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id) AS photo_count,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND p.is_featured_home = 1) AS featured_count
     FROM media_albums a WHERE a.id = ?`
  )
    .bind(id)
    .first();

  if (!album) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy album.");
  }

  const { results } = await context.env.DB.prepare(
    `SELECT * FROM media_photos WHERE album_id = ? ORDER BY sort_order ASC, created_at DESC LIMIT 300`
  )
    .bind(id)
    .all();

  return jsonResponse({
    ok: true,
    album: serializeAlbumRow(album),
    photos: (results || []).map(serializePhotoRow),
  });
}

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM media_albums WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy album để cập nhật.");
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  let existingFilters = [];
  try {
    existingFilters = JSON.parse(existing.filters_json || "[]");
  } catch {
    existingFilters = [];
  }

  const merged = {
    title: parsed.data.title ?? existing.title,
    slug: parsed.data.slug ?? existing.slug,
    description: parsed.data.description ?? existing.description,
    eventDate: parsed.data.eventDate ?? parsed.data.event_date ?? existing.event_date,
    dateDisplay: parsed.data.dateDisplay ?? parsed.data.date_display ?? existing.date_display,
    location: parsed.data.location ?? existing.location,
    filters: parsed.data.filters ?? existingFilters,
    driveUrl: parsed.data.driveUrl ?? parsed.data.drive_url ?? existing.drive_url,
    coverUrl: parsed.data.coverUrl ?? parsed.data.cover_url ?? existing.cover_url,
    status: parsed.data.status ?? existing.status,
    sortOrder: parsed.data.sortOrder ?? parsed.data.sort_order ?? existing.sort_order,
  };

  const checked = validateAlbumInput(merged);
  if (!checked.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin album chưa hợp lệ.", checked.fields);
  }

  const v = checked.value;
  if (v.slug !== existing.slug) {
    const dup = await context.env.DB.prepare(
      "SELECT id FROM media_albums WHERE slug = ? AND id != ?"
    )
      .bind(v.slug, id)
      .first();
    if (dup) {
      return errorResponse(409, "SLUG_EXISTS", "Đường dẫn album này đã tồn tại.", {
        slug: "Slug đã được dùng cho album khác.",
      });
    }
  }

  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `UPDATE media_albums
     SET slug = ?, title = ?, description = ?, event_date = ?, date_display = ?,
         location = ?, filters_json = ?, drive_url = ?, cover_url = ?, status = ?,
         sort_order = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      v.slug,
      v.title,
      v.description,
      v.event_date,
      v.date_display,
      v.location,
      JSON.stringify(v.filters),
      v.drive_url,
      v.cover_url,
      v.status,
      v.sort_order,
      now,
      id
    )
    .run();

  const updated = await context.env.DB.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id) AS photo_count,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND p.is_featured_home = 1) AS featured_count
     FROM media_albums a WHERE a.id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: serializeAlbumRow(updated) });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT id FROM media_albums WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy album để xóa.");
  }

  const { results: photoRows } = await context.env.DB.prepare(
    "SELECT media_key FROM media_photos WHERE album_id = ? AND media_key != ''"
  )
    .bind(id)
    .all();

  await context.env.DB.prepare("DELETE FROM media_photos WHERE album_id = ?").bind(id).run();
  await context.env.DB.prepare("DELETE FROM media_albums WHERE id = ?").bind(id).run();

  const keys = (photoRows || []).map((r) => r.media_key).filter(Boolean);
  if (context.env?.MEDIA_KV && keys.length > 0) {
    await Promise.allSettled(keys.map((k) => context.env.MEDIA_KV.delete(`media:${k}`)));
  }

  return jsonResponse({ ok: true, id, deletedKvKeys: keys.length });
}
