import { trashDriveFile } from "../../../_lib/drive.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";
import { serializePhotoRow } from "../albums/[id]/index.js";

const MEDIA_ROLES = ["super_admin", "editor", "media"];

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM media_photos WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy ảnh.");
  }

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const caption =
    parsed.data.caption !== undefined ? cleanStr(parsed.data.caption, 300) : existing.caption;
  const alt =
    parsed.data.alt !== undefined
      ? cleanStr(parsed.data.alt, 240) || caption || existing.alt
      : caption && existing.alt === existing.caption
        ? caption
        : existing.alt;
  const photographer =
    parsed.data.photographer !== undefined
      ? cleanStr(parsed.data.photographer, 100)
      : existing.photographer;
  const isFeaturedHome =
    parsed.data.isFeaturedHome !== undefined || parsed.data.is_featured_home !== undefined
      ? (parsed.data.isFeaturedHome ?? parsed.data.is_featured_home) ? 1 : 0
      : existing.is_featured_home;
  const sortOrder =
    parsed.data.sortOrder !== undefined || parsed.data.sort_order !== undefined
      ? Math.trunc(Number(parsed.data.sortOrder ?? parsed.data.sort_order) || 0)
      : existing.sort_order;
  const setAsCover = Boolean(parsed.data.setAsCover);

  const now = new Date().toISOString();
  const stmts = [
    context.env.DB.prepare(
      `UPDATE media_photos
       SET caption = ?, alt = ?, photographer = ?, is_featured_home = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).bind(caption, alt, photographer, isFeaturedHome, sortOrder, now, id),
  ];

  if (setAsCover) {
    stmts.push(
      context.env.DB.prepare(
        "UPDATE media_albums SET cover_url = ?, updated_at = ? WHERE id = ?"
      ).bind(existing.url, now, existing.album_id)
    );
  }

  await context.env.DB.batch(stmts);
  const updated = await context.env.DB.prepare("SELECT * FROM media_photos WHERE id = ?")
    .bind(id)
    .first();

  return jsonResponse({
    ok: true,
    item: serializePhotoRow(updated),
    albumCoverUpdated: setAsCover,
  });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM media_photos WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy ảnh để xóa.");
  }

  await context.env.DB.prepare("DELETE FROM media_photos WHERE id = ?").bind(id).run();

  if (existing.media_key) {
    if (existing.media_key.startsWith("drive:")) {
      await trashDriveFile(context.env, existing.media_key.slice(6)).catch(() => {});
    } else if (context.env?.MEDIA_KV) {
      await context.env.MEDIA_KV.delete(`media:${existing.media_key}`).catch(() => {});
    }
  }

  // If this photo was the album's cover, fallback to the next available photo
  const album = await context.env.DB.prepare(
    "SELECT id, cover_url FROM media_albums WHERE id = ?"
  )
    .bind(existing.album_id)
    .first();
  if (album && album.cover_url === existing.url) {
    const nextPhoto = await context.env.DB.prepare(
      "SELECT url FROM media_photos WHERE album_id = ? ORDER BY sort_order ASC, created_at DESC LIMIT 1"
    )
      .bind(existing.album_id)
      .first();
    await context.env.DB.prepare(
      "UPDATE media_albums SET cover_url = ?, updated_at = ? WHERE id = ?"
    )
      .bind(nextPhoto?.url || "", new Date().toISOString(), existing.album_id)
      .run();
  }

  return jsonResponse({
    ok: true,
    id,
    deletedKvKey: existing.media_key || "",
  });
}
