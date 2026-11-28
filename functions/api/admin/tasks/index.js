import {
  DEPARTMENTS,
  ensureManagerSchema,
  logAudit,
  serializeTaskRow,
} from "../../../_lib/rbac.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr, VALID_TASK_PHASES, VALID_TASK_STATUSES, validateTaskInput } from "../../../_lib/validation.js";

function isOverdue(dueAt, status, todayIso) {
  if (!dueAt || status === "done") return false;
  return String(dueAt).slice(0, 10) < todayIso;
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "tasks.read" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const url = new URL(context.request.url);
  const eventId = cleanStr(url.searchParams.get("eventId"), 80);
  const department = cleanStr(url.searchParams.get("department"), 80);
  const status = cleanStr(url.searchParams.get("status"), 20);
  const phase = cleanStr(url.searchParams.get("phase"), 20);
  const mineOnly = url.searchParams.get("mine") === "1";

  const where = [];
  const binds = [];
  if (eventId) {
    where.push("t.event_id = ?");
    binds.push(eventId);
  }
  if (department) {
    where.push("t.department = ?");
    binds.push(department);
  }
  if (status && VALID_TASK_STATUSES.has(status)) {
    where.push("t.status = ?");
    binds.push(status);
  }
  if (phase && VALID_TASK_PHASES.has(phase)) {
    where.push("t.phase = ?");
    binds.push(phase);
  }
  if (mineOnly) {
    where.push("t.assignee_type = 'staff' AND t.assignee_id = ?");
    binds.push(auth.user.id);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [tasksRes, allCountsRes, staffRes, membersRes, eventsRes] = await Promise.all([
    db
      .prepare(
        `SELECT t.*,
                COALESCE(e.title, '') AS event_title,
                COALESCE(e.date, '') AS event_date
         FROM ops_tasks t
         LEFT JOIN events e ON e.id = t.event_id
         ${whereSql}
         ORDER BY
           CASE t.status WHEN 'done' THEN 1 ELSE 0 END ASC,
           CASE WHEN t.due_at = '' THEN 1 ELSE 0 END ASC,
           t.due_at ASC,
           CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
           t.created_at DESC
         LIMIT 300`
      )
      .bind(...binds)
      .all(),
    db
      .prepare("SELECT status, due_at, assignee_type, assignee_id FROM ops_tasks LIMIT 500")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT id, name, email, role, department FROM admin_users WHERE is_active = 1 ORDER BY name ASC LIMIT 60")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT id, name, member_code FROM members WHERE is_active = 1 ORDER BY created_at DESC LIMIT 120")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT id, title, date, kind, status, zalo_group_url FROM events ORDER BY date DESC LIMIT 60")
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const todayIso = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const counts = { all: 0, todo: 0, in_progress: 0, review: 0, done: 0, overdue: 0, mine: 0 };
  for (const row of allCountsRes.results || []) {
    counts.all += 1;
    if (row.status in counts) counts[row.status] += 1;
    if (isOverdue(row.due_at, row.status, todayIso)) counts.overdue += 1;
    if (row.assignee_type === "staff" && row.assignee_id === auth.user.id && row.status !== "done") {
      counts.mine += 1;
    }
  }

  return jsonResponse({
    ok: true,
    items: (tasksRes.results || []).map(serializeTaskRow),
    counts,
    departments: DEPARTMENTS,
    assignees: {
      staff: (staffRes.results || []).map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        department: s.department || "",
      })),
      members: (membersRes.results || []).map((m) => ({
        id: m.id,
        name: m.name,
        memberCode: m.member_code || "",
      })),
    },
    events: (eventsRes.results || []).map((e) => ({
      id: e.id,
      title: e.title,
      date: e.date,
      kind: e.kind,
      status: e.status,
      zaloGroupUrl: e.zalo_group_url || "",
    })),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { permission: "tasks.write" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validateTaskInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin nhiệm vụ chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  let assigneeName = v.assignee_name;
  if (v.assignee_type === "staff" && v.assignee_id) {
    const staff = await db.prepare("SELECT id, name FROM admin_users WHERE id = ?").bind(v.assignee_id).first();
    if (!staff) {
      return errorResponse(404, "ASSIGNEE_NOT_FOUND", "Không tìm thấy thành viên Ban được giao việc.");
    }
    assigneeName = staff.name || assigneeName;
  } else if (v.assignee_type === "member" && v.assignee_id) {
    const mem = await db.prepare("SELECT id, name FROM members WHERE id = ?").bind(v.assignee_id).first();
    if (!mem) {
      return errorResponse(404, "ASSIGNEE_NOT_FOUND", "Không tìm thấy CTV/Thành viên được giao việc.");
    }
    assigneeName = mem.name || assigneeName;
  }

  let zaloUrl = v.zalo_url;
  if (v.event_id && !zaloUrl) {
    const ev = await db.prepare("SELECT zalo_group_url FROM events WHERE id = ?").bind(v.event_id).first().catch(() => null);
    if (ev?.zalo_group_url) zaloUrl = ev.zalo_group_url;
  }

  const id = `tsk-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const completedAt = v.status === "done" ? now : "";

  await db
    .prepare(
      `INSERT INTO ops_tasks
       (id, title, description, event_id, phase, department, assignee_type, assignee_id, assignee_name,
        status, priority, due_at, zalo_url, playbook_key, created_by, created_by_name, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      v.title,
      v.description,
      v.event_id,
      v.phase,
      v.department,
      v.assignee_type,
      v.assignee_id,
      assigneeName,
      v.status,
      v.priority,
      v.due_at,
      zaloUrl,
      v.playbook_key,
      auth.user.id,
      auth.user.name || auth.user.email,
      completedAt,
      now,
      now
    )
    .run();

  await logAudit(db, auth.user, {
    action: "task.create",
    targetType: "ops_task",
    targetId: id,
    summary: `Tạo nhiệm vụ "${v.title}" (${v.department}${assigneeName ? ` → ${assigneeName}` : ""})`,
    meta: { eventId: v.event_id, department: v.department, assigneeId: v.assignee_id, status: v.status },
  });

  const created = await db
    .prepare(
      `SELECT t.*, COALESCE(e.title, '') AS event_title, COALESCE(e.date, '') AS event_date
       FROM ops_tasks t LEFT JOIN events e ON e.id = t.event_id WHERE t.id = ?`
    )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: serializeTaskRow(created) }, 201);
}
