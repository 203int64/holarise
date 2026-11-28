import { ensureChatAndCapabilitySchema } from "../../_lib/capabilities.js";
import { ensureMediaApprovalSchema } from "../../_lib/media-approval-schema.js";
import {
  ensureManagerSchema,
  roleHasPermission,
  serializeTaskRow,
} from "../../_lib/rbac.js";
import { serializeEventRow, splitEventsByDate } from "../../_lib/render.js";
import { jsonResponse, requireAdmin } from "../../_lib/security.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "timeline.read" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await Promise.all([
    ensureManagerSchema(db),
    ensureMediaApprovalSchema(db).catch(() => null),
    ensureChatAndCapabilitySchema(db).catch(() => null),
  ]);

  const canPosts = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "posts.read", auth.isSoleAdmin);
  const canMedia = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "media.read", auth.isSoleAdmin);
  const canRef = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "reflections.read", auth.isSoleAdmin);
  const canInbox = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "inbox.read", auth.isSoleAdmin);

  const [eventsRes, tasksRes, pendingPostsRes, pendingPhotosRow, pendingRefRow, unreadChatRow] = await Promise.all([
    db
      .prepare("SELECT * FROM events ORDER BY date ASC, sort_order ASC LIMIT 60")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT t.*, COALESCE(e.title, '') AS event_title, COALESCE(e.date, '') AS event_date
         FROM ops_tasks t
         LEFT JOIN events e ON e.id = t.event_id
         ORDER BY CASE WHEN t.due_at = '' THEN 1 ELSE 0 END ASC, t.due_at ASC, t.created_at DESC
         LIMIT 250`
      )
      .all()
      .catch(() => ({ results: [] })),
    canPosts
      ? db
          .prepare(
            "SELECT id, title, slug, category, status, author, submitted_by, updated_at FROM posts WHERE status = 'pending_review' ORDER BY updated_at DESC LIMIT 20"
          )
          .all()
          .catch(() => ({ results: [] }))
      : Promise.resolve({ results: [] }),
    canMedia
      ? db
          .prepare("SELECT COUNT(*) AS cnt FROM media_photos WHERE approval_status = 'pending'")
          .first()
          .catch(() => ({ cnt: 0 }))
      : Promise.resolve({ cnt: 0 }),
    canRef
      ? db
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM activity_reflections WHERE status = 'pending') +
               (SELECT COUNT(*) FROM community_testimonials WHERE status = 'pending') AS cnt`
          )
          .first()
          .catch(() => ({ cnt: 0 }))
      : Promise.resolve({ cnt: 0 }),
    canInbox
      ? db
          .prepare("SELECT COUNT(*) AS cnt FROM chat_threads WHERE unread_admin > 0")
          .first()
          .catch(() => ({ cnt: 0 }))
      : Promise.resolve({ cnt: 0 }),
  ]);

  const todayIso = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tasks = (tasksRes.results || []).map(serializeTaskRow);
  const tasksByEvent = new Map();
  for (const t of tasks) {
    if (!t.eventId) continue;
    if (!tasksByEvent.has(t.eventId)) tasksByEvent.set(t.eventId, []);
    tasksByEvent.get(t.eventId).push(t);
  }

  const serializedEvents = (eventsRes.results || []).map((row) => serializeEventRow(row));
  const { upcoming, past } = splitEventsByDate(serializedEvents);

  const eventTimelines = [...upcoming, ...past.slice(0, 6)].map((ev) => {
    const evTasks = tasksByEvent.get(ev.id) || [];
    const phases = {
      before: { total: 0, done: 0 },
      during: { total: 0, done: 0 },
      after: { total: 0, done: 0 },
    };
    let overdue = 0;
    let done = 0;
    for (const t of evTasks) {
      if (t.status === "done") done += 1;
      else if (t.dueAt && t.dueAt.slice(0, 10) < todayIso) overdue += 1;
      if (phases[t.phase]) {
        phases[t.phase].total += 1;
        if (t.status === "done") phases[t.phase].done += 1;
      }
    }
    const isUpcoming = upcoming.some((u) => u.id === ev.id);
    return {
      id: ev.id,
      slug: ev.slug,
      title: ev.title,
      type: ev.type,
      date: ev.date,
      dateDisplay: ev.dateDisplay,
      time: ev.time,
      location: ev.location,
      status: ev.status,
      isUpcoming,
      zaloGroupUrl: ev.zaloGroupUrl || "",
      taskSummary: {
        total: evTasks.length,
        done,
        overdue,
        percent: evTasks.length ? Math.round((done / evTasks.length) * 100) : 0,
        phases,
      },
      tasks: evTasks,
    };
  });

  const milestones = [];
  for (const ev of upcoming) {
    milestones.push({
      kind: "event",
      id: ev.id,
      date: ev.date,
      title: ev.title,
      subtitle: `${ev.time || "Trong ngày"} · ${ev.location}`,
      department: "Ban Sự Kiện",
      status: ev.status,
      eventId: ev.id,
    });
  }
  for (const t of tasks) {
    if (t.status === "done" || !t.dueAt) continue;
    milestones.push({
      kind: "task",
      id: t.id,
      date: t.dueAt.slice(0, 10),
      title: t.title,
      subtitle: `${t.department}${t.assigneeName ? ` · ${t.assigneeName}` : ""}${t.eventTitle ? ` · ${t.eventTitle}` : ""}`,
      department: t.department,
      status: t.status,
      priority: t.priority,
      overdue: t.dueAt.slice(0, 10) < todayIso,
      eventId: t.eventId,
    });
  }
  milestones.sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));

  return jsonResponse({
    ok: true,
    todayIso,
    eventTimelines,
    milestones: milestones.slice(0, 40),
    queues: {
      pendingPosts: (pendingPostsRes.results || []).map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        category: p.category,
        author: p.author,
        submittedBy: p.submitted_by || "",
        updatedAt: p.updated_at,
      })),
      pendingPhotosCount: Number(pendingPhotosRow?.cnt || 0),
      pendingReflectionsCount: Number(pendingRefRow?.cnt || 0),
      unreadChatThreadsCount: Number(unreadChatRow?.cnt || 0),
    },
  });
}
