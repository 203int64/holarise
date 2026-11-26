import {
  ensureEventFeedbackSchema,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireAdmin,
} from "../../../_lib/security.js";
import { VALID_EVENT_FEEDBACK_STATUSES, cleanStr } from "../../../_lib/validation.js";
import { serializeAdminEventFeedback } from "./index.js";

const FEEDBACK_ADMIN_ROLES = ["super_admin", "editor"];

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const { env, request, params } = context;
  await ensureEventFeedbackSchema(env.DB);

  const id = String(params?.id || "").trim();
  const existing = await env.DB.prepare("SELECT * FROM event_feedbacks WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy góp ý sự kiện.");
  }

  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};

  const nextStatus =
    d.status !== undefined ? cleanStr(d.status, 24).toLowerCase() : existing.status;
  if (!VALID_EVENT_FEEDBACK_STATUSES.has(nextStatus)) {
    return errorResponse(400, "INVALID_STATUS", "Trạng thái góp ý chỉ nhận 'new', 'read' hoặc 'resolved'.");
  }
  const adminNote =
    d.adminNote !== undefined || d.admin_note !== undefined
      ? cleanStr(d.adminNote ?? d.admin_note, 500)
      : existing.admin_note;

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE event_feedbacks SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?"
  )
    .bind(nextStatus, adminNote, now, id)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM event_feedbacks WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializeAdminEventFeedback(updated) });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const { env, params } = context;
  await ensureEventFeedbackSchema(env.DB);
  const id = String(params?.id || "").trim();
  const existing = await env.DB.prepare("SELECT id FROM event_feedbacks WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy góp ý để xóa.");
  }
  await env.DB.prepare("DELETE FROM event_feedbacks WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true, id });
}
