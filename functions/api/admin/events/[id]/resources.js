/**
 * Event In-Kind Resources & Transparency Ledger API (`/api/admin/events/:id/resources`).
 * Implements AGENTS.md Layer 3 (In-Kind First & Open Traceability) and generates a ready-to-paste
 * markdown summary for post-event Journey recaps.
 */

import { ensureManagerSchema, logAudit } from "../../../../_lib/rbac.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../../_lib/security.js";
import { cleanStr, VALID_RESOURCE_KINDS, VALID_RESOURCE_STATUSES, validateResourceInput } from "../../../../_lib/validation.js";

const KIND_LABELS = {
  space: "Không gian đồng hành",
  books: "Sách & Tủ sách",
  plants: "Cây giống & Vật tư xanh",
  supplies: "Học cụ & Đồ dùng",
  logistics: "Hậu cần buổi gặp",
  other: "Nguồn lực khác",
};

const STATUS_LABELS = {
  pledged: "Đã cam kết",
  received: "Đã tiếp nhận",
  delivered: "Đã bàn giao",
};

function serializeResource(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind || "space",
    kindLabel: KIND_LABELS[row.kind] || row.kind,
    title: row.title || "",
    quantity: row.quantity || "",
    donorName: row.donor_name || "",
    status: row.status || "pledged",
    statusLabel: STATUS_LABELS[row.status] || row.status,
    note: row.note || "",
    recordedBy: row.recorded_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function buildTransparencyMarkdown(eventTitle, items) {
  if (!items.length) return "";
  const lines = [
    `## Minh bạch nguồn lực & Hiện vật đồng hành — ${eventTitle}`,
    ...items.map((it) => {
      const qty = it.quantity ? ` (${it.quantity})` : "";
      const donor = it.donorName ? ` — đồng hành bởi ${it.donorName}` : "";
      return `- **${it.kindLabel}:** ${it.title}${qty}${donor} · *${it.statusLabel}*`;
    }),
  ];
  return lines.join("\n");
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "events.read" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const eventId = cleanStr(context.params?.id, 100);
  const ev = await db.prepare("SELECT id, title FROM events WHERE id = ?").bind(eventId).first();
  if (!ev) return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện.");

  const { results } = await db
    .prepare("SELECT * FROM event_resources WHERE event_id = ? ORDER BY created_at DESC LIMIT 100")
    .bind(eventId)
    .all();
  const items = (results || []).map(serializeResource);

  return jsonResponse({
    ok: true,
    eventId: ev.id,
    eventTitle: ev.title,
    items,
    transparencySummary: buildTransparencyMarkdown(ev.title, items),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { permission: "events.write" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const eventId = cleanStr(context.params?.id, 100);
  const ev = await db.prepare("SELECT id, title FROM events WHERE id = ?").bind(eventId).first();
  if (!ev) return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện.");

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validateResourceInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin nguồn lực chưa hợp lệ.", validated.fields);
  }
  const v = validated.value;
  const id = `res-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO event_resources
       (id, event_id, kind, title, quantity, donor_name, status, note, recorded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, eventId, v.kind, v.title, v.quantity, v.donor_name, v.status, v.note, auth.user.name || auth.user.email, now, now)
    .run();

  await logAudit(db, auth.user, {
    action: "resource.create",
    targetType: "event_resource",
    targetId: id,
    summary: `Ghi nhận nguồn lực "${v.title}" (${v.quantity || "1 mục"}) cho sự kiện "${ev.title}"`,
    meta: { eventId, kind: v.kind, status: v.status },
  });

  const created = await db.prepare("SELECT * FROM event_resources WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializeResource(created) }, 201);
}

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context, { permission: "events.write" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const eventId = cleanStr(context.params?.id, 100);
  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const resourceId = cleanStr(parsed.data.resourceId ?? parsed.data.id, 80);
  const existing = await db
    .prepare("SELECT * FROM event_resources WHERE id = ? AND event_id = ?")
    .bind(resourceId, eventId)
    .first();
  if (!existing) return errorResponse(404, "NOT_FOUND", "Không tìm thấy mục nguồn lực.");

  const nextStatus = parsed.data.status !== undefined ? cleanStr(parsed.data.status, 24) : existing.status;
  if (!VALID_RESOURCE_STATUSES.has(nextStatus)) {
    return errorResponse(400, "VALIDATION_ERROR", "Trạng thái bàn giao không hợp lệ.");
  }
  const nextKind = parsed.data.kind !== undefined ? cleanStr(parsed.data.kind, 24) : existing.kind;
  if (!VALID_RESOURCE_KINDS.has(nextKind)) {
    return errorResponse(400, "VALIDATION_ERROR", "Phân loại hiện vật không hợp lệ.");
  }
  const title = parsed.data.title !== undefined ? cleanStr(parsed.data.title, 180) || existing.title : existing.title;
  const quantity = parsed.data.quantity !== undefined ? cleanStr(parsed.data.quantity, 80) : existing.quantity;
  const donorName =
    parsed.data.donorName !== undefined || parsed.data.donor_name !== undefined
      ? cleanStr(parsed.data.donorName ?? parsed.data.donor_name, 140)
      : existing.donor_name;
  const note = parsed.data.note !== undefined ? cleanStr(parsed.data.note, 500) : existing.note;
  const now = new Date().toISOString();

  await db
    .prepare(
      `UPDATE event_resources
       SET kind = ?, title = ?, quantity = ?, donor_name = ?, status = ?, note = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(nextKind, title, quantity, donorName, nextStatus, note, now, resourceId)
    .run();

  await logAudit(db, auth.user, {
    action: "resource.update",
    targetType: "event_resource",
    targetId: resourceId,
    summary: `Cập nhật nguồn lực "${title}" (${existing.status} → ${nextStatus})`,
  });

  const updated = await db.prepare("SELECT * FROM event_resources WHERE id = ?").bind(resourceId).first();
  return jsonResponse({ ok: true, item: serializeResource(updated) });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { permission: "events.write" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const eventId = cleanStr(context.params?.id, 100);
  const url = new URL(context.request.url);
  const resourceId = cleanStr(url.searchParams.get("resourceId"), 80);
  if (!resourceId) return errorResponse(400, "MISSING_ID", "Thiếu mã mục nguồn lực.");

  const existing = await db
    .prepare("SELECT * FROM event_resources WHERE id = ? AND event_id = ?")
    .bind(resourceId, eventId)
    .first();
  if (!existing) return errorResponse(404, "NOT_FOUND", "Không tìm thấy mục nguồn lực để xóa.");

  await db.prepare("DELETE FROM event_resources WHERE id = ?").bind(resourceId).run();
  await logAudit(db, auth.user, {
    action: "resource.delete",
    targetType: "event_resource",
    targetId: resourceId,
    summary: `Xóa mục nguồn lực "${existing.title}"`,
  });

  return jsonResponse({ ok: true, id: resourceId });
}
