import {
  ensureManagerSchema,
  logAudit,
  roleHasPermission,
  serializeTaskRow,
} from "../../../_lib/rbac.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import {
  cleanStr,
  isSafeExternalHttpsUrl,
  VALID_TASK_PHASES,
  VALID_TASK_PRIORITIES,
  VALID_TASK_STATUSES,
} from "../../../_lib/validation.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context, { permission: ["tasks.write", "tasks.update_own"] });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const id = cleanStr(context.params?.id, 80);
  const existing = await db.prepare("SELECT * FROM ops_tasks WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy nhiệm vụ.");
  }

  const canFullWrite = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "tasks.write", auth.isSoleAdmin);
  const isOwnTask = existing.assignee_type === "staff" && existing.assignee_id === auth.user.id;
  if (!canFullWrite && !isOwnTask) {
    return errorResponse(
      403,
      "FORBIDDEN",
      "Bạn chỉ có thể cập nhật trạng thái những nhiệm vụ được giao trực tiếp cho mình."
    );
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const nextStatus = d.status !== undefined ? cleanStr(d.status, 20) : existing.status;
  if (!VALID_TASK_STATUSES.has(nextStatus)) {
    return errorResponse(400, "VALIDATION_ERROR", "Trạng thái nhiệm vụ không hợp lệ.");
  }

  let title = existing.title;
  let description = existing.description;
  let eventId = existing.event_id;
  let phase = existing.phase;
  let department = existing.department;
  let assigneeType = existing.assignee_type;
  let assigneeId = existing.assignee_id;
  let assigneeName = existing.assignee_name;
  let priority = existing.priority;
  let dueAt = existing.due_at;
  let zaloUrl = existing.zalo_url;

  if (canFullWrite) {
    if (d.title !== undefined) {
      const t = cleanStr(d.title, 200);
      if (t.length < 3) return errorResponse(400, "VALIDATION_ERROR", "Tên nhiệm vụ cần ít nhất 3 ký tự.");
      title = t;
    }
    if (d.description !== undefined) description = cleanStr(d.description, 1500);
    if (d.eventId !== undefined || d.event_id !== undefined) {
      eventId = cleanStr(d.eventId ?? d.event_id, 80);
    }
    if (d.phase !== undefined) {
      const p = cleanStr(d.phase, 20);
      if (!VALID_TASK_PHASES.has(p)) return errorResponse(400, "VALIDATION_ERROR", "Giai đoạn không hợp lệ.");
      phase = p;
    }
    if (d.department !== undefined) department = cleanStr(d.department, 80) || existing.department;
    if (d.priority !== undefined) {
      const pr = cleanStr(d.priority, 20);
      if (!VALID_TASK_PRIORITIES.has(pr)) return errorResponse(400, "VALIDATION_ERROR", "Mức ưu tiên không hợp lệ.");
      priority = pr;
    }
    if (d.dueAt !== undefined || d.due_at !== undefined) {
      const rawDue = cleanStr(d.dueAt ?? d.due_at, 40);
      if (rawDue && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(rawDue)) {
        return errorResponse(400, "VALIDATION_ERROR", "Hạn chót không đúng định dạng YYYY-MM-DD.");
      }
      dueAt = rawDue;
    }
    if (d.zaloUrl !== undefined || d.zalo_url !== undefined) {
      const rawZ = cleanStr(d.zaloUrl ?? d.zalo_url, 500);
      if (rawZ && !isSafeExternalHttpsUrl(rawZ)) {
        return errorResponse(400, "VALIDATION_ERROR", "Link Nhóm Zalo phải bắt đầu bằng https://.");
      }
      zaloUrl = rawZ;
    }
    if (d.assigneeType !== undefined || d.assignee_type !== undefined) {
      const nextType = cleanStr(d.assigneeType ?? d.assignee_type, 20) || "unassigned";
      if (!["unassigned", "staff", "member"].includes(nextType)) {
        return errorResponse(400, "VALIDATION_ERROR", "Loại người nhận việc không hợp lệ.");
      }
      assigneeType = nextType;
      if (assigneeType === "unassigned") {
        assigneeId = "";
        assigneeName = "";
      } else {
        assigneeId = cleanStr(d.assigneeId ?? d.assignee_id, 80);
        assigneeName = cleanStr(d.assigneeName ?? d.assignee_name, 120);
        if (assigneeType === "staff" && assigneeId) {
          const st = await db.prepare("SELECT name FROM admin_users WHERE id = ?").bind(assigneeId).first();
          if (st?.name) assigneeName = st.name;
        } else if (assigneeType === "member" && assigneeId) {
          const mem = await db.prepare("SELECT name FROM members WHERE id = ?").bind(assigneeId).first();
          if (mem?.name) assigneeName = mem.name;
        }
      }
    }
  }

  const now = new Date().toISOString();
  const completedAt = nextStatus === "done" ? existing.completed_at || now : "";

  await db
    .prepare(
      `UPDATE ops_tasks
       SET title = ?, description = ?, event_id = ?, phase = ?, department = ?,
           assignee_type = ?, assignee_id = ?, assignee_name = ?,
           status = ?, priority = ?, due_at = ?, zalo_url = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      title,
      description,
      eventId,
      phase,
      department,
      assigneeType,
      assigneeId,
      assigneeName,
      nextStatus,
      priority,
      dueAt,
      zaloUrl,
      completedAt,
      now,
      id
    )
    .run();

  await logAudit(db, auth.user, {
    action: "task.update",
    targetType: "ops_task",
    targetId: id,
    summary: `Cập nhật nhiệm vụ "${title}" (${existing.status} → ${nextStatus})`,
    meta: { fromStatus: existing.status, toStatus: nextStatus, assigneeId, department },
  });

  const updated = await db
    .prepare(
      `SELECT t.*, COALESCE(e.title, '') AS event_title, COALESCE(e.date, '') AS event_date, COALESCE(e.slug, '') AS event_slug
       FROM ops_tasks t LEFT JOIN events e ON e.id = t.event_id WHERE t.id = ?`
    )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: serializeTaskRow(updated) });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { permission: "tasks.write" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const id = cleanStr(context.params?.id, 80);
  const existing = await db.prepare("SELECT id, title FROM ops_tasks WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy nhiệm vụ để xóa.");
  }

  await db.prepare("DELETE FROM ops_tasks WHERE id = ?").bind(id).run();
  await logAudit(db, auth.user, {
    action: "task.delete",
    targetType: "ops_task",
    targetId: id,
    summary: `Xóa nhiệm vụ "${existing.title}"`,
  });

  return jsonResponse({ ok: true, id });
}
