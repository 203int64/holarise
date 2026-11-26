import {
  buildEventFolderName,
  ensureCategorySubfolder,
  isDriveConfigured,
  trashDriveFile,
} from "../../../../_lib/drive.js";
import { ensureDeepControlSchema, resolveActorContext, VALID_ALBUM_VISIBILITIES } from "../../../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../../../_lib/media-approval-schema.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../../_lib/security.js";
import { validateAlbumInput } from "../../../../_lib/validation.js";
import { serializeAlbumRow } from "../index.js";

const MEDIA_ROLES = ["super_admin", "editor", "media"];

export function serializePhotoRow(row) {
  if (!row) return null;
  const approvalStatus = row.approval_status || "approved";
  const webUrl = row.web_url || "";
  return {
    id: row.id,
    albumId: row.album_id,
    mediaKey: row.media_key || "",
    url: row.url,
    webUrl,
    webMediaKey: row.web_media_key || "",
    displayUrl: webUrl || row.url,
    approvalStatus,
    approvedBy: row.approved_by || "",
    approvedAt: row.approved_at || "",
    caption: row.caption || "",
    alt: row.alt || "",
    photographer: row.photographer || "",
    isFeaturedHome: Boolean(row.is_featured_home),
    sortOrder: Number(row.sort_order || 0),
    uploadedBy: row.uploaded_by || "",
    contributorMemberId: row.contributor_member_id || "",
    sourceKind: row.source_kind || (row.contributor_member_id ? "member_contribution" : "team"),
    drivePath: row.drive_path || "",
    mediaType:
      row.media_type === "video" || /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(row.url || ""))
        ? "video"
        : "image",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  let viewerOnly = false;
  if (!auth.ok) {
    const actor = await resolveActorContext(context.env, context.request);
    if (!actor.isMediaViewer) return auth.response;
    viewerOnly = true;
  }

  await Promise.all([
    ensureMediaApprovalSchema(context.env.DB),
    ensureDeepControlSchema(context.env.DB),
  ]);

  const id = String(context.params?.id || "");
  const album = await context.env.DB.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id) AS photo_count,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND COALESCE(p.approval_status, 'approved') = 'approved') AS approved_count,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND p.approval_status = 'pending') AS pending_count,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND p.is_featured_home = 1 AND COALESCE(p.approval_status, 'approved') = 'approved') AS featured_count
     FROM media_albums a WHERE a.id = ?`
  )
    .bind(id)
    .first();

  if (!album || (viewerOnly && album.status !== "published")) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy album.");
  }

  // Lazy auto-provision Drive folder for pre-existing albums (e.g. 15/11) that lack drive_url
  if (!viewerOnly && !album.drive_url && isDriveConfigured(context.env)) {
    try {
      const folderName = buildEventFolderName({
        eventDate: album.event_date,
        title: album.title,
        fallback: album.slug,
      });
      const folder = await ensureCategorySubfolder(context.env, {
        category: "album",
        subfolder: folderName,
      });
      if (folder?.folderUrl) {
        album.drive_url = folder.folderUrl;
        await context.env.DB.prepare(
          "UPDATE media_albums SET drive_url = ?, updated_at = ? WHERE id = ?"
        )
          .bind(folder.folderUrl, new Date().toISOString(), id)
          .run();
      }
    } catch {
      // Best-effort: never block opening album workspace
    }
  }

  const photosSql = viewerOnly
    ? "SELECT * FROM media_photos WHERE album_id = ? AND COALESCE(approval_status, 'approved') = 'approved' ORDER BY sort_order ASC, created_at DESC LIMIT 300"
    : "SELECT * FROM media_photos WHERE album_id = ? ORDER BY sort_order ASC, created_at DESC LIMIT 300";
  const { results } = await context.env.DB.prepare(photosSql).bind(id).all();

  return jsonResponse({
    ok: true,
    viewerOnly,
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

  const nextVisibility =
    parsed.data.visibility !== undefined
      ? String(parsed.data.visibility || "").trim().toLowerCase()
      : String(existing.visibility || "public");
  if (!VALID_ALBUM_VISIBILITIES.has(nextVisibility)) {
    return errorResponse(400, "INVALID_VISIBILITY", "Chế độ quyền xem album không hợp lệ.");
  }

  await ensureDeepControlSchema(context.env.DB);
  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `UPDATE media_albums
     SET slug = ?, title = ?, description = ?, event_date = ?, date_display = ?,
         location = ?, filters_json = ?, drive_url = ?, cover_url = ?, status = ?,
         visibility = ?, sort_order = ?, updated_at = ?
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
      nextVisibility,
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

  await ensureMediaApprovalSchema(context.env.DB);
  const { results: photoRows } = await context.env.DB.prepare(
    "SELECT media_key, web_media_key FROM media_photos WHERE album_id = ?"
  )
    .bind(id)
    .all();

  await context.env.DB.prepare("DELETE FROM media_photos WHERE album_id = ?").bind(id).run();
  await context.env.DB.prepare("DELETE FROM media_albums WHERE id = ?").bind(id).run();

  const keys = (photoRows || []).map((r) => r.media_key).filter(Boolean);
  const webKeys = (photoRows || []).map((r) => r.web_media_key).filter(Boolean);
  const driveIds = keys.filter((k) => k.startsWith("drive:")).map((k) => k.slice(6));
  const kvKeys = [...keys.filter((k) => !k.startsWith("drive:")), ...webKeys];
  if (context.env?.MEDIA_KV && kvKeys.length > 0) {
    await Promise.allSettled(kvKeys.map((k) => context.env.MEDIA_KV.delete(`media:${k}`)));
  }
  if (driveIds.length > 0) {
    await Promise.allSettled(driveIds.map((fileId) => trashDriveFile(context.env, fileId)));
  }

  return jsonResponse({ ok: true, id, deletedKvKeys: kvKeys.length, trashedDriveFiles: driveIds.length });
}
