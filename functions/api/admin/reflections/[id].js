import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { VALID_REFLECTION_STATUSES, cleanStr } from "../../../_lib/validation.js";
import { serializeAdminReflection } from "./index.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "").trim();
  const existing = await context.env.DB.prepare("SELECT * FROM activity_reflections WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy lưu bút.");
  }

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const nextStatus = parsed.data.status !== undefined
    ? cleanStr(parsed.data.status, 24).toLowerCase()
    : existing.status;

  if (!VALID_REFLECTION_STATUSES.has(nextStatus)) {
    return errorResponse(400, "INVALID_STATUS", "Trạng thái duyệt chỉ nhận 'pending', 'approved' hoặc 'rejected'.");
  }

  const adminNote = parsed.data.adminNote !== undefined || parsed.data.admin_note !== undefined
    ? cleanStr(parsed.data.adminNote ?? parsed.data.admin_note, 400)
    : existing.admin_note;

  const now = new Date().toISOString();
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

  return jsonResponse({
    ok: true,
    item: serializeAdminReflection(updated),
  });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "").trim();
  const existing = await context.env.DB.prepare(
    "SELECT id, photo_media_key FROM activity_reflections WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy lưu bút để xóa.");
  }

  await context.env.DB.prepare("DELETE FROM activity_reflections WHERE id = ?").bind(id).run();

  if (existing.photo_media_key && context.env?.MEDIA_KV?.delete) {
    await context.env.MEDIA_KV.delete(`media:${existing.photo_media_key}`).catch(() => null);
  }

  return jsonResponse({ ok: true, id });
}
