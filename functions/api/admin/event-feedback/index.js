import {
  ensureEventFeedbackSchema,
  jsonResponse,
  requireAdmin,
} from "../../../_lib/security.js";
import {
  VALID_EVENT_FEEDBACK_CATEGORIES,
  VALID_EVENT_FEEDBACK_STATUSES,
  cleanStr,
} from "../../../_lib/validation.js";

const FEEDBACK_ADMIN_ROLES = ["super_admin", "editor"];

export function serializeAdminEventFeedback(row) {
  if (!row) return null;
  const isAnonymous = Number(row.is_anonymous || 0) === 1;
  return {
    id: row.id,
    eventId: row.event_id || "",
    eventSlug: row.event_slug || "",
    eventTitle: row.event_title || row.event_slug || "Sự kiện HolaRise",
    category: row.category || "cai-thien",
    content: row.content || "",
    authorName: isAnonymous ? "Ẩn danh" : row.author_name || "Ẩn danh",
    authorContact: isAnonymous ? "" : row.author_contact || "",
    memberId: isAnonymous ? "" : row.member_id || "",
    isAnonymous,
    status: row.status || "new",
    adminNote: row.admin_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const { env, request } = context;
  await ensureEventFeedbackSchema(env.DB);

  const url = new URL(request.url);
  const eventId = cleanStr(url.searchParams.get("eventId"), 120);
  const category = cleanStr(url.searchParams.get("category"), 32).toLowerCase();
  const status = cleanStr(url.searchParams.get("status"), 24).toLowerCase();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);

  const clauses = [];
  const binds = [];
  if (eventId) {
    clauses.push("(event_id = ? OR event_slug = ?)");
    binds.push(eventId, eventId);
  }
  if (VALID_EVENT_FEEDBACK_CATEGORIES.has(category)) {
    clauses.push("category = ?");
    binds.push(category);
  }
  if (VALID_EVENT_FEEDBACK_STATUSES.has(status)) {
    clauses.push("status = ?");
    binds.push(status);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [listRes, countsRes, eventsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM event_feedbacks
       ${whereSql}
       ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'read' THEN 1 ELSE 2 END, created_at DESC
       LIMIT ?`
    )
      .bind(...binds, limit)
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare("SELECT status, COUNT(*) AS cnt FROM event_feedbacks GROUP BY status")
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT event_id, event_slug, event_title, COUNT(*) AS cnt
       FROM event_feedbacks
       WHERE event_id != '' OR event_slug != ''
       GROUP BY event_id, event_slug, event_title
       ORDER BY MAX(created_at) DESC
       LIMIT 60`
    )
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const counts = { new: 0, read: 0, resolved: 0 };
  for (const c of countsRes.results || []) {
    if (c.status in counts) counts[c.status] = Number(c.cnt || 0);
  }

  return jsonResponse({
    ok: true,
    items: (listRes.results || []).map(serializeAdminEventFeedback),
    counts,
    events: (eventsRes.results || []).map((e) => ({
      eventId: e.event_id || e.event_slug,
      eventSlug: e.event_slug || "",
      eventTitle: e.event_title || e.event_slug || e.event_id,
      count: Number(e.cnt || 0),
    })),
  });
}
