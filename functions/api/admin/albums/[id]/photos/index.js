import { resolveActorContext } from "../../../../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../../../../_lib/media-approval-schema.js";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  verifyCsrfOrigin,
} from "../../../../../_lib/security.js";
import { validatePhotoInput } from "../../../../../_lib/validation.js";
import { serializePhotoRow } from "../index.js";

const MEDIA_ROLES = ["super_admin", "editor", "media"];
const APPROVER_ROLES = new Set(["super_admin", "editor"]);
const MAX_BATCH_PHOTOS = 500;
const SAFE_KV_KEY_RE = /^[a-zA-Z0-9._-]{6,96}$/;
const SAFE_KV_URL_RE = /^\/api\/media\/[a-zA-Z0-9._-]{6,96}$/;

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: MEDIA_ROLES });
  let ngvMember = null;
  if (!auth.ok) {
    if (!verifyCsrfOrigin(context.request)) {
      return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
    }
    const actor = await resolveActorContext(context.env, context.request);
    if (!actor.isMediaContributor || !actor.member) return auth.response;
    ngvMember = actor.member;
  }

  await ensureMediaApprovalSchema(context.env.DB);

  const albumId = String(context.params?.id || "");
  const album = await context.env.DB.prepare(
    "SELECT id, cover_url FROM media_albums WHERE id = ?"
  )
    .bind(albumId)
    .first();
  if (!album) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy album để thêm ảnh/video.");
  }

  const parsed = await readJsonBody(context.request, 512 * 1024);
  if (!parsed.ok) return parsed.response;

  const rawList = Array.isArray(parsed.data.photos) ? parsed.data.photos : [parsed.data];
  if (rawList.length === 0) {
    return errorResponse(400, "EMPTY_PHOTOS", "Danh sách ảnh/video cần thêm đang trống.");
  }
  if (rawList.length > MAX_BATCH_PHOTOS) {
    return errorResponse(400, "BATCH_TOO_LARGE", `Mỗi yêu cầu chỉ hỗ trợ tối đa ${MAX_BATCH_PHOTOS} mục.`);
  }

  const validated = [];
  for (let i = 0; i < rawList.length; i++) {
    const check = validatePhotoInput(rawList[i] || {});
    if (!check.ok) {
      return errorResponse(400, "VALIDATION_ERROR", `Mục thứ ${i + 1} chưa hợp lệ.`, check.fields);
    }
    validated.push(check.value);
  }

  const maxRow = await context.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM media_photos WHERE album_id = ?"
  )
    .bind(albumId)
    .first();
  let nextSort = Number(maxRow?.max_sort || 0) + 1;

  const canApproveDirectly = !ngvMember && APPROVER_ROLES.has(auth.user?.role);
  const uploadedBy = ngvMember
    ? ngvMember.email || ngvMember.phone_display || ngvMember.member_code || ngvMember.id
    : auth.user.email;
  const contributorMemberId = ngvMember ? ngvMember.id : "";
  const sourceKind = ngvMember ? "ngv_upload" : "team";
  const now = new Date().toISOString();
  const inserted = [];
  const stmts = [];

  for (let i = 0; i < validated.length; i++) {
    const p = validated[i];
    const rawItem = rawList[i] || {};
    const id = `pho-${crypto.randomUUID().slice(0, 12)}`;
    const sortOrder = p.sort_order > 0 ? p.sort_order : nextSort++;
    // NGV & CTV ('media') uploads ALWAYS enter 'pending' until Admin approves.
    const approvalStatus = canApproveDirectly
      ? (rawItem.approvalStatus === "pending" ? "pending" : "approved")
      : "pending";
    const isFeaturedHome = approvalStatus === "approved" ? p.is_featured_home : 0;
    const approvedBy = approvalStatus === "approved" ? uploadedBy : "";
    const approvedAt = approvalStatus === "approved" ? now : "";
    const photographer = p.photographer || (ngvMember ? ngvMember.name || "NGV HolaRise" : "");

    const mediaType =
      rawItem.mediaType === "video" || /[?&]kind=video\b|\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(String(p.url || ""))
        ? "video"
        : "image";
    const rawWebUrl = String(rawItem.webUrl || rawItem.web_url || "").trim();
    const rawWebKey = String(rawItem.webMediaKey || rawItem.web_media_key || "").trim();
    const webUrl = mediaType === "image" && SAFE_KV_URL_RE.test(rawWebUrl) ? rawWebUrl : "";
    const webMediaKey = webUrl && SAFE_KV_KEY_RE.test(rawWebKey) ? rawWebKey : "";
    stmts.push(
      context.env.DB.prepare(
        `INSERT INTO media_photos (
           id, album_id, media_key, url, caption, alt, photographer,
           is_featured_home, sort_order, uploaded_by, contributor_member_id, source_kind, media_type,
           approval_status, web_url, web_media_key, approved_by, approved_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        albumId,
        p.media_key,
        p.url,
        p.caption,
        p.alt,
        photographer,
        isFeaturedHome,
        sortOrder,
        uploadedBy,
        contributorMemberId,
        sourceKind,
        mediaType,
        approvalStatus,
        webUrl,
        webMediaKey,
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
      web_url: webUrl,
      web_media_key: webMediaKey,
      approval_status: approvalStatus,
      approved_by: approvedBy,
      approved_at: approvedAt,
      caption: p.caption,
      alt: p.alt,
      photographer,
      is_featured_home: isFeaturedHome,
      sort_order: sortOrder,
      uploaded_by: uploadedBy,
      contributor_member_id: contributorMemberId,
      source_kind: sourceKind,
      media_type: mediaType,
      created_at: now,
      updated_at: now,
    });
  }

  const firstApproved = inserted.find((p) => p.approval_status === "approved" && p.media_type !== "video");
  const nextCoverUrl = firstApproved ? firstApproved.web_url || firstApproved.url : "";
  if (!album.cover_url && nextCoverUrl) {
    stmts.push(
      context.env.DB.prepare(
        "UPDATE media_albums SET cover_url = ?, updated_at = ? WHERE id = ?"
      ).bind(nextCoverUrl, now, albumId)
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
      coverUrl: album.cover_url || nextCoverUrl,
    },
    201
  );
}
