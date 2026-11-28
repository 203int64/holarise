import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../../_lib/security.js";
import { cleanStr, VALID_REG_STATUSES } from "../../../../_lib/validation.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context, { permission: "registrations.write" });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy đơn đăng ký.");
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const nextStatus =
    parsed.data.status !== undefined ? cleanStr(parsed.data.status, 20) : existing.status;
  if (!VALID_REG_STATUSES.has(nextStatus)) {
    return errorResponse(400, "VALIDATION_ERROR", "Trạng thái không hợp lệ.", {
      status: "Chỉ chấp nhận: new, contacted, attended, cancelled.",
    });
  }

  const nextNote =
    parsed.data.admin_note !== undefined || parsed.data.adminNote !== undefined
      ? cleanStr(parsed.data.admin_note ?? parsed.data.adminNote, 1000)
      : existing.admin_note;

  const now = new Date().toISOString();
  await context.env.DB.prepare(
    "UPDATE registrations SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?"
  )
    .bind(nextStatus, nextNote, now, id)
    .run();

  const updated = await context.env.DB.prepare(
    `SELECT id, source, event_id, activity_title, full_name, phone, email, role, organization, note,
            status, admin_note, sync_status, sync_error, created_at, updated_at
     FROM registrations WHERE id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: updated });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const res = await context.env.DB.prepare("DELETE FROM registrations WHERE id = ?").bind(id).run();
  if (Number(res?.meta?.changes || 0) === 0) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy đơn đăng ký để xóa.");
  }
  return jsonResponse({ ok: true, id });
}
