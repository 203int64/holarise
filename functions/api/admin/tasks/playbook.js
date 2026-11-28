import {
  ensureManagerSchema,
  EVENT_PLAYBOOK_STEPS,
  logAudit,
  serializeTaskRow,
} from "../../../_lib/rbac.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";

function shiftIsoDate(isoDate, offsetDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return dt.toISOString().slice(0, 10);
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { permission: "tasks.write" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const eventId = cleanStr(parsed.data.eventId ?? parsed.data.event_id, 80);
  if (!eventId) {
    return errorResponse(400, "MISSING_EVENT", "Vui lòng chọn sự kiện cần tạo bộ nhiệm vụ mẫu.");
  }

  const event = await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first();
  if (!event) {
    return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const existingRes = await db
    .prepare("SELECT playbook_key FROM ops_tasks WHERE event_id = ? AND playbook_key != ''")
    .bind(eventId)
    .all();
  const existingKeys = new Set((existingRes.results || []).map((r) => r.playbook_key));

  const now = new Date().toISOString();
  const createdIds = [];
  let skippedCount = 0;

  for (const step of EVENT_PLAYBOOK_STEPS) {
    if (existingKeys.has(step.key)) {
      skippedCount += 1;
      continue;
    }
    const id = `tsk-${crypto.randomUUID().slice(0, 12)}`;
    const dueAt = shiftIsoDate(event.date, step.offsetDays);
    await db
      .prepare(
        `INSERT INTO ops_tasks
         (id, title, description, event_id, phase, department, assignee_type, assignee_id, assignee_name,
          status, priority, due_at, zalo_url, playbook_key, created_by, created_by_name, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'unassigned', '', '', 'todo', ?, ?, ?, ?, ?, ?, '', ?, ?)`
      )
      .bind(
        id,
        step.title,
        step.description,
        event.id,
        step.phase,
        step.department,
        step.priority,
        dueAt,
        event.zalo_group_url || "",
        step.key,
        auth.user.id,
        auth.user.name || auth.user.email,
        now,
        now
      )
      .run();
    createdIds.push(id);
  }

  await logAudit(db, auth.user, {
    action: "task.playbook_generated",
    targetType: "event",
    targetId: event.id,
    summary: `Tạo bộ nhiệm vụ mẫu (${createdIds.length} việc mới) cho sự kiện "${event.title}"`,
    meta: { createdCount: createdIds.length, skippedCount },
  });

  const { results } = await db
    .prepare(
      `SELECT t.*, COALESCE(e.title, '') AS event_title, COALESCE(e.date, '') AS event_date, COALESCE(e.slug, '') AS event_slug
       FROM ops_tasks t LEFT JOIN events e ON e.id = t.event_id
       WHERE t.event_id = ?
       ORDER BY CASE t.phase WHEN 'before' THEN 0 WHEN 'during' THEN 1 WHEN 'after' THEN 2 ELSE 3 END ASC, t.due_at ASC`
    )
    .bind(event.id)
    .all();

  return jsonResponse(
    {
      ok: true,
      eventId: event.id,
      eventTitle: event.title,
      createdCount: createdIds.length,
      skippedCount,
      items: (results || []).map(serializeTaskRow),
    },
    createdIds.length > 0 ? 201 : 200
  );
}
