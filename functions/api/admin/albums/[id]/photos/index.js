import { ensureMediaApprovalSchema } from "../../../../../_lib/media-approval-schema.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../../../_lib/security.js";
import { validatePhotoInput } from "../../../../../_lib/validation.js";
import { serializePhotoRow } from "../index.js";

const MEDIA_ROLES = ["super_admin", "editor", "media"];
const APPROVER_ROLES = new Set(["super_admin", "editor"]);
const MAX_BATCH_PHOTOS = 30;

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  if (!auth.ok) return auth.response;

  await ensureMediaApprovalSchema(context.env.DB);

  const albumId = String(context.params?.id || "");
  const album = await context.env.DB.prepare(
    "SELECT id, cover_url FROM media_albums WHERE id = ?"
  )
    .bind(albumId)
    .first();
  if (!album) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy album để thêm ảnh.");
  }

  const parsed = await readJsonBody(context.request, 128 * 1024);
  if (!parsed.ok) return parsed.response;

  const rawList = Array.isArray(parsed.data.photos) ? parsed.data.photos : [parsed.data];
  if (rawList.length === 0) {
    return errorResponse(400, "EMPTY_PHOTOS", "Danh sách ảnh cần thêm đang trống.");
  }
  if (rawList.length > MAX_BATCH_PHOTOS) {
    return errorResponse(400, "BATCH_TOO_LARGE", `Mỗi lượt chỉ hỗ trợ tối đa ${MAX_BATCH_PHOTOS} ảnh.`);
  }

  const validated = [];
  for (let i = 0; i < rawList.length; i++) {
    const check = validatePhotoInput(rawList[i] || {});
    if (!check.ok) {
      return errorResponse(400, "VALIDATION_ERROR", `Ảnh thứ ${i + 1} chưa hợp lệ.`, check.fields);
    }
    validated.push(check.value);
  }

  const maxRow = await context.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM media_photos WHERE album_id = ?"
  )
    .bind(albumId)
    .first();
  let nextSort = Number(maxRow?.max_sort || 0) + 1;

  const canApproveDirectly = APPROVER_ROLES.has(auth.user.role);
  const now = new Date().toISOString();
  const inserted = [];
  const stmts = [];

  for (let i = 0; i < validated.length; i++) {
    const p = validated[i];
    const rawItem = rawList[i] || {};
    const id = `pho-${crypto.randomUUID().slice(0, 12)}`;
    const sortOrder = p.sort_order > 0 ? p.sort_order : nextSort++;
    // CTV ('media') uploads always enter 'pending' until an Admin approves & compresses for web.
    const approvalStatus = canApproveDirectly
      ? (rawItem.approvalStatus === "pending" ? "pending" : "approved")
      : "pending";
    const isFeaturedHome = approvalStatus === "approved" ? p.is_featured_home : 0;
    const approvedBy = approvalStatus === "approved" ? auth.user.email : "";
    const approvedAt = approvalStatus === "approved" ? now : "";

    stmts.push(
      context.env.DB.prepare(
        `INSERT INTO media_photos (
           id, album_id, media_key, url, caption, alt, photographer,
           is_featured_home, sort_order, uploaded_by,
           approval_status, web_url, web_media_key, approved_by, approved_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?)`
      ).bind(
        id,
        albumId,
        p.media_key,
        p.url,
        p.caption,
        p.alt,
        p.photographer,
        isFeaturedHome,
        sortOrder,
        auth.user.email,
        approvalStatus,
        approvedBy,
        approvedAt,
        now,
        now
      )
    );
    inserted.push({
      id,
      album_id: albumId,
      media_key: p.media_key,
      url: p.url,
      web_url: "",
      web_media_key: "",
      approval_status: approvalStatus,
      approved_by: approvedBy,
      approved_at: approvedAt,
      caption: p.caption,
      alt: p.alt,
      photographer: p.photographer,
      is_featured_home: isFeaturedHome,
      sort_order: sortOrder,
      uploaded_by: auth.user.email,
      created_at: now,
      updated_at: now,
    });
  }

  const firstApproved = inserted.find((p) => p.approval_status === "approved");
  if (!album.cover_url && firstApproved) {
    stmts.push(
      context.env.DB.prepare(
        "UPDATE media_albums SET cover_url = ?, updated_at = ? WHERE id = ?"
      ).bind(firstApproved.url, now, albumId)
    );
  } else {
    stmts.push(
      context.env.DB.prepare("UPDATE media_albums SET updated_at = ? WHERE id = ?").bind(now, albumId)
    );
  }

  await context.env.DB.batch(stmts);

  return jsonResponse(
    {
      ok: true,
      items: inserted.map(serializePhotoRow),
      coverUrl: album.cover_url || firstApproved?.url || "",
    },
    201
  );
}
