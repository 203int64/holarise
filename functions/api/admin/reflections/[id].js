import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import {
  VALID_REFLECTION_STATUSES,
  cleanStr,
  extractMediaKeyFromUrl,
  isSafeMediaUrl,
  slugifyVi,
} from "../../../_lib/validation.js";
import { ensureCommunityTestimonialsTable, serializeAdminReflection } from "./index.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  await ensureCommunityTestimonialsTable(context.env.DB);

  const id = String(context.params?.id || "").trim();
  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};
  const now = new Date().toISOString();

  // Check community_testimonials first
  const commRow = await context.env.DB.prepare("SELECT * FROM community_testimonials WHERE id = ?")
    .bind(id)
    .first()
    .catch(() => null);

  if (commRow) {
    const nextStatus = d.status !== undefined ? cleanStr(d.status, 24).toLowerCase() : commRow.status;
    if (!VALID_REFLECTION_STATUSES.has(nextStatus)) {
      return errorResponse(400, "INVALID_STATUS", "Trạng thái duyệt chỉ nhận 'pending', 'approved' hoặc 'rejected'.");
    }
    const nextAuthor = d.authorName !== undefined ? cleanStr(d.authorName, 120) : commRow.author_name;
    const nextRole =
      d.participantRole !== undefined || d.authorRole !== undefined
        ? cleanStr(d.participantRole ?? d.authorRole, 80)
        : commRow.author_role;
    const nextOrg = d.authorOrg !== undefined ? cleanStr(d.authorOrg, 160) : commRow.author_org;
    const nextSlug =
      d.activitySlug !== undefined
        ? cleanStr(d.activitySlug, 120)
          ? slugifyVi(d.activitySlug)
          : ""
        : commRow.activity_slug;
    const nextQuote = d.pullQuote !== undefined ? cleanStr(d.pullQuote, 180) : commRow.pull_quote;
    const nextContent = d.content !== undefined ? cleanStr(d.content, 1500) : commRow.content;
    const nextFeatured =
      d.isFeaturedHome !== undefined || d.is_featured_home !== undefined
        ? Boolean(d.isFeaturedHome ?? d.is_featured_home) ? 1 : 0
        : Number(commRow.is_featured_home || 0);
    let nextPhotoUrl = commRow.photo_url || "";
    let nextPhotoKey = commRow.photo_media_key || "";
    if (d.photoUrl !== undefined || d.photo_url !== undefined) {
      const rawUrl = cleanStr(d.photoUrl ?? d.photo_url, 500);
      if (rawUrl && !isSafeMediaUrl(rawUrl)) {
        return errorResponse(400, "VALIDATION_ERROR", "Đường dẫn ảnh không hợp lệ.");
      }
      nextPhotoUrl = rawUrl;
      nextPhotoKey = rawUrl ? extractMediaKeyFromUrl(rawUrl) : "";
    }

    await context.env.DB.prepare(
      `UPDATE community_testimonials
       SET activity_slug = ?, author_name = ?, author_role = ?, author_org = ?,
           pull_quote = ?, content = ?, photo_url = ?, photo_media_key = ?,
           is_featured_home = ?, status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        nextSlug,
        nextAuthor,
        nextRole,
        nextOrg,
        nextQuote,
        nextContent,
        nextPhotoUrl,
        nextPhotoKey,
        nextFeatured,
        nextStatus,
        auth.user.email,
        now,
        now,
        id
      )
      .run();

    const updated = await context.env.DB.prepare("SELECT * FROM community_testimonials WHERE id = ?").bind(id).first();
    return jsonResponse({ ok: true, item: serializeAdminReflection(updated, "community") });
  }

  // Fallback to legacy activity_reflections
  const existing = await context.env.DB.prepare("SELECT * FROM activity_reflections WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy cảm nhận.");
  }

  const nextStatus = d.status !== undefined ? cleanStr(d.status, 24).toLowerCase() : existing.status;
  if (!VALID_REFLECTION_STATUSES.has(nextStatus)) {
    return errorResponse(400, "INVALID_STATUS", "Trạng thái duyệt chỉ nhận 'pending', 'approved' hoặc 'rejected'.");
  }

  const adminNote =
    d.adminNote !== undefined || d.admin_note !== undefined
      ? cleanStr(d.adminNote ?? d.admin_note, 400)
      : existing.admin_note;

  await context.env.DB.prepare(
    `UPDATE activity_reflections
     SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(nextStatus, adminNote, auth.user.email, now, now, id)
    .run();

  const updated = await context.env.DB.prepare(
    `SELECT r.*,
            m.name AS author_name,
            m.email AS author_email,
            m.phone_display AS author_phone,
            m.organization AS author_org,
            m.member_code AS author_member_code,
            m.avatar_url AS author_avatar_url
     FROM activity_reflections r
     LEFT JOIN members m ON m.id = r.member_id
     WHERE r.id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: serializeAdminReflection(updated, "member") });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  await ensureCommunityTestimonialsTable(context.env.DB);
  const id = String(context.params?.id || "").trim();

  const commRow = await context.env.DB.prepare(
    "SELECT id, photo_media_key FROM community_testimonials WHERE id = ?"
  )
    .bind(id)
    .first()
    .catch(() => null);

  if (commRow) {
    await context.env.DB.prepare("DELETE FROM community_testimonials WHERE id = ?").bind(id).run();
    if (commRow.photo_media_key && context.env?.MEDIA_KV?.delete) {
      await context.env.MEDIA_KV.delete(`media:${commRow.photo_media_key}`).catch(() => null);
    }
    return jsonResponse({ ok: true, id });
  }

  const existing = await context.env.DB.prepare(
    "SELECT id, photo_media_key FROM activity_reflections WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy cảm nhận để xóa.");
  }

  await context.env.DB.prepare("DELETE FROM activity_reflections WHERE id = ?").bind(id).run();
  if (existing.photo_media_key && context.env?.MEDIA_KV?.delete) {
    await context.env.MEDIA_KV.delete(`media:${existing.photo_media_key}`).catch(() => null);
  }

  return jsonResponse({ ok: true, id });
}
