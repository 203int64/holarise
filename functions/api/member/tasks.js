import { ensureManagerSchema, logAudit, serializeTaskRow } from "../../_lib/rbac.js";
import {
  errorResponse,
  getSessionMember,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr, VALID_TASK_STATUSES } from "../../_lib/validation.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  const member = await getSessionMember(env.DB, request);
  if (!member) {
    return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên Hola.");
  }

  await ensureManagerSchema(env.DB);
  const [tasksRes, capsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT t.*, COALESCE(e.title, '') AS event_title, COALESCE(e.date, '') AS event_date
       FROM ops_tasks t
       LEFT JOIN events e ON e.id = t.event_id
       WHERE t.assignee_type = 'member' AND t.assignee_id = ?
       ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END ASC, CASE WHEN t.due_at = '' THEN 1 ELSE 0 END ASC, t.due_at ASC, t.created_at DESC
       LIMIT 60`
    )
      .bind(member.id)
      .all(),
    env.DB.prepare(
      `SELECT capability, scope_id, status, created_at
       FROM member_capabilities
       WHERE member_id = ? AND status IN ('active', 'expired')`
    )
      .bind(member.id)
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const items = (tasksRes.results || []).map(serializeTaskRow);
  const completedTasks = items.filter((t) => t.status === "done").length;
  const servedEventIds = new Set();
  for (const t of items) {
    if (t.status === "done" && t.eventId) servedEventIds.add(t.eventId);
  }
  const roleCountMap = {};
  for (const c of capsRes.results || []) {
    if (c.capability === "event.checkin" || c.capability === "event.companion") {
      if (c.scope_id) servedEventIds.add(c.scope_id);
    }
    roleCountMap[c.capability] = (roleCountMap[c.capability] || 0) + 1;
  }

  return jsonResponse({
    ok: true,
    items,
    serviceRecord: {
      completedTasks,
      openTasks: items.length - completedTasks,
      eventsServed: servedEventIds.size,
      rolesCount: roleCountMap,
    },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }
  const member = await getSessionMember(env.DB, request);
  if (!member) {
    return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên Hola.");
  }

  const parsed = await readJsonBody(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;

  const taskId = cleanStr(parsed.data.taskId ?? parsed.data.id, 80);
  const status = cleanStr(parsed.data.status, 20);
  if (!taskId || !VALID_TASK_STATUSES.has(status)) {
    return errorResponse(400, "VALIDATION_ERROR", "Mã nhiệm vụ hoặc trạng thái không hợp lệ.");
  }

  await ensureManagerSchema(env.DB);
  const existing = await env.DB.prepare(
    "SELECT * FROM ops_tasks WHERE id = ? AND assignee_type = 'member' AND assignee_id = ?"
  )
    .bind(taskId, member.id)
    .first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy nhiệm vụ được giao cho bạn.");
  }

  const now = new Date().toISOString();
  const completedAt = status === "done" ? existing.completed_at || now : "";

  await env.DB.prepare("UPDATE ops_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?")
    .bind(status, completedAt, now, taskId)
    .run();

  await logAudit(
    env.DB,
    { id: member.id, email: member.email || member.member_code, name: member.name, role: "ctv_member" },
    {
      action: "member.task_update",
      targetType: "ops_task",
      targetId: taskId,
      summary: `CTV ${member.name} cập nhật nhiệm vụ "${existing.title}" (${existing.status} → ${status})`,
      meta: { fromStatus: existing.status, toStatus: status },
    }
  );

  const updated = await env.DB.prepare(
    `SELECT t.*, COALESCE(e.title, '') AS event_title, COALESCE(e.date, '') AS event_date
     FROM ops_tasks t LEFT JOIN events e ON e.id = t.event_id WHERE t.id = ?`
  )
    .bind(taskId)
    .first();

  return jsonResponse({ ok: true, item: serializeTaskRow(updated) });
}
