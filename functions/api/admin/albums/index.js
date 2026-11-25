import {
  buildEventFolderName,
  ensureCategorySubfolder,
  isDriveConfigured,
} from "../../../_lib/drive.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { validateAlbumInput } from "../../../_lib/validation.js";

const MEDIA_ROLES = ["super_admin", "editor", "media"];

function safeParseFilters(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function serializeAlbumRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description || "",
    eventDate: row.event_date || "",
    dateDisplay: row.date_display || "",
    location: row.location || "",
    filters: safeParseFilters(row.filters_json),
    driveUrl: row.drive_url || "",
    coverUrl: row.cover_url || "",
    status: row.status || "published",
    sortOrder: Number(row.sort_order || 0),
    photoCount: Number(row.photo_count || 0),
    featuredCount: Number(row.featured_count || 0),
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  const { results } = await context.env.DB.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id) AS photo_count,
            (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND p.is_featured_home = 1) AS featured_count
     FROM media_albums a
     ORDER BY a.sort_order ASC, a.event_date DESC, a.created_at DESC
     LIMIT 200`
  ).all();

  const rows = results || [];
  if (isDriveConfigured(context.env)) {
    let provisioned = 0;
    for (const row of rows) {
      if (row.drive_url || provisioned >= 3) continue;
      provisioned += 1;
      try {
        const folderName = buildEventFolderName({
          eventDate: row.event_date,
          title: row.title,
          fallback: row.slug,
        });
        const folder = await ensureCategorySubfolder(context.env, {
          category: "album",
          subfolder: folderName,
        });
        if (folder?.folderUrl) {
          row.drive_url = folder.folderUrl;
          await context.env.DB.prepare(
            "UPDATE media_albums SET drive_url = ?, updated_at = ? WHERE id = ?"
          )
            .bind(folder.folderUrl, new Date().toISOString(), row.id)
            .run();
        }
      } catch {
        // Best-effort: never block listing albums
      }
    }
  }

  return jsonResponse({
    ok: true,
    items: rows.map(serializeAlbumRow),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const checked = validateAlbumInput(parsed.data);
  if (!checked.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin album chưa hợp lệ.", checked.fields);
  }

  const v = checked.value;
  let slug = v.slug;
  const dup = await context.env.DB.prepare("SELECT id FROM media_albums WHERE slug = ?").bind(slug).first();
  if (dup) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const id = `alb-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  let driveUrl = v.drive_url;
  if (!driveUrl && isDriveConfigured(context.env)) {
    try {
      const folderName = buildEventFolderName({
        eventDate: v.event_date,
        title: v.title,
        fallback: slug,
      });
      const folder = await ensureCategorySubfolder(context.env, {
        category: "album",
        subfolder: folderName,
      });
      if (folder?.folderUrl) driveUrl = folder.folderUrl;
    } catch {
      // Best-effort: never block album creation if Drive is temporarily unavailable
    }
  }

  await context.env.DB.prepare(
    `INSERT INTO media_albums (
       id, slug, title, description, event_date, date_display, location,
       filters_json, drive_url, cover_url, status, sort_order, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      slug,
      v.title,
      v.description,
      v.event_date,
      v.date_display,
      v.location,
      JSON.stringify(v.filters),
      driveUrl,
      v.cover_url,
      v.status,
      v.sort_order,
      auth.user.email,
      now,
      now
    )
    .run();

  const created = await context.env.DB.prepare(
    `SELECT a.*, 0 AS photo_count, 0 AS featured_count FROM media_albums a WHERE a.id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: serializeAlbumRow(created) }, 201);
}
