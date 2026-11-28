import { ensureChatAndCapabilitySchema } from "../../_lib/capabilities.js";
import { isDriveConfigured } from "../../_lib/drive.js";
import { getSettingsMap } from "../../_lib/gas.js";
import { getMediaAccessPin } from "../../_lib/gate-token.js";
import { ensureMediaApprovalSchema } from "../../_lib/media-approval-schema.js";
import { ensureManagerSchema, roleHasPermission } from "../../_lib/rbac.js";
import { serializeEventRow, splitEventsByDate } from "../../_lib/render.js";
import { jsonResponse, requireAdmin } from "../../_lib/security.js";
import { PURE_REGISTRATION_SQL } from "./registrations/index.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "overview.read" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await Promise.all([
    ensureMediaApprovalSchema(db).catch(() => null),
    ensureChatAndCapabilitySchema(db).catch(() => null),
    ensureManagerSchema(db).catch(() => null),
  ]);
  const canReadRegs = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "registrations.read", auth.isSoleAdmin);

  const [
    regCountsRes,
    recentRegsRes,
    bookedByEventRes,
    eventsRes,
    postsRes,
    memRefRes,
    commRefRes,
    membersRes,
    mediaStatsRes,
    feedbackCountsRes,
    settingsMap,
  ] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) AS cnt FROM registrations WHERE ${PURE_REGISTRATION_SQL} GROUP BY status`).all().catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT id, source, event_id, activity_title, full_name, phone, email, organization, status, sync_status, created_at
         FROM registrations
         WHERE ${PURE_REGISTRATION_SQL}
         ORDER BY created_at DESC
         LIMIT 6`
      )
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT event_id, COUNT(*) AS cnt
         FROM registrations
         WHERE status != 'cancelled' AND event_id != ''
         GROUP BY event_id`
      )
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT * FROM events ORDER BY sort_order ASC, date ASC, created_at DESC LIMIT 100")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT status, COUNT(*) AS cnt FROM posts GROUP BY status")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT status, COUNT(*) AS cnt FROM activity_reflections GROUP BY status")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT status, COUNT(*) AS cnt FROM community_testimonials GROUP BY status")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_cnt
         FROM members`
      )
      .first()
      .catch(() => ({ total: 0, active_cnt: 0 })),
    Promise.all([
      db.prepare("SELECT COUNT(*) AS cnt FROM media_albums").first().catch(() => ({ cnt: 0 })),
      db
        .prepare("SELECT COUNT(*) AS cnt FROM media_photos WHERE approval_status = 'pending'")
        .first()
        .catch(() => ({ cnt: 0 })),
      db.prepare("SELECT COUNT(*) AS cnt FROM media_photos").first().catch(() => ({ cnt: 0 })),
    ]),
    db.prepare("SELECT status, COUNT(*) AS cnt FROM event_feedbacks GROUP BY status").all().catch(() => ({ results: [] })),
    getSettingsMap(db).catch(() => ({})),
  ]);

  const registrations = { all: 0, new: 0, contacted: 0, attended: 0, cancelled: 0 };
  for (const row of regCountsRes.results || []) {
    const c = Number(row.cnt || 0);
    registrations.all += c;
    if (row.status in registrations) registrations[row.status] = c;
  }

  const bookedMap = new Map();
  for (const row of bookedByEventRes.results || []) {
    bookedMap.set(row.event_id, Number(row.cnt || 0));
  }

  const serializedEvents = (eventsRes.results || []).map((row) => {
    const ev = serializeEventRow(row);
    return { ...ev, webBookedCount: bookedMap.get(ev.id) || 0 };
  });
  const publishedEvents = serializedEvents.filter((e) => e.status === "published");
  const { upcoming, past } = splitEventsByDate(publishedEvents);

  const posts = { published: 0, draft: 0, pending_review: 0, total: 0 };
  for (const row of postsRes.results || []) {
    const c = Number(row.cnt || 0);
    posts.total += c;
    if (row.status === "published") posts.published = c;
    else if (row.status === "draft") posts.draft = c;
    else if (row.status === "pending_review") posts.pending_review = c;
  }

  const reflections = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of [...(memRefRes.results || []), ...(commRefRes.results || [])]) {
    const c = Number(row.cnt || 0);
    reflections.total += c;
    if (row.status in reflections) reflections[row.status] += c;
  }

  const feedbacks = { new: 0, read: 0, resolved: 0, total: 0 };
  for (const row of feedbackCountsRes.results || []) {
    const c = Number(row.cnt || 0);
    feedbacks.total += c;
    if (row.status in feedbacks) feedbacks[row.status] += c;
  }

  const [albumRow, pendingPhotoRow, totalPhotoRow] = mediaStatsRes;
  const chatStatsRow = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN unread_admin > 0 THEN 1 ELSE 0 END) AS unread_threads,
              SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_threads
       FROM chat_threads`
    )
    .first()
    .catch(() => ({ total: 0, unread_threads: 0, open_threads: 0 }));

  const todayIso = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const taskRowsRes = await db
    .prepare("SELECT status, due_at, assignee_type, assignee_id FROM ops_tasks LIMIT 500")
    .all()
    .catch(() => ({ results: [] }));
  const tasksSummary = { open: 0, done: 0, overdue: 0, mine: 0, total: 0 };
  for (const t of taskRowsRes.results || []) {
    tasksSummary.total += 1;
    if (t.status === "done") tasksSummary.done += 1;
    else {
      tasksSummary.open += 1;
      if (t.due_at && String(t.due_at).slice(0, 10) < todayIso) tasksSummary.overdue += 1;
      if (t.assignee_type === "staff" && t.assignee_id === auth.user.id) tasksSummary.mine += 1;
    }
  }

  return jsonResponse({
    ok: true,
    registrations: canReadRegs ? registrations : { all: registrations.all, new: 0, contacted: 0, attended: 0, cancelled: 0 },
    recentRegistrations: canReadRegs ? recentRegsRes.results || [] : [],
    tasks: tasksSummary,
    events: {
      total: serializedEvents.length,
      upcomingCount: upcoming.length,
      pastCount: past.length,
      draftCount: serializedEvents.filter((e) => e.status === "draft").length,
      upcoming: upcoming.slice(0, 5),
    },
    posts,
    reflections,
    feedbacks,
    chat: {
      total: Number(chatStatsRow?.total || 0),
      unreadThreads: Number(chatStatsRow?.unread_threads || 0),
      openThreads: Number(chatStatsRow?.open_threads || 0),
    },
    members: {
      total: Number(membersRes?.total || 0),
      active: Number(membersRes?.active_cnt || 0),
    },
    media: {
      albumCount: Number(albumRow?.cnt || 0),
      photoCount: Number(totalPhotoRow?.cnt || 0),
      pendingPhotoCount: Number(pendingPhotoRow?.cnt || 0),
    },
    integrations: {
      driveConfigured: isDriveConfigured(context.env),
      gasConfigured: Boolean(settingsMap?.gas_webhook_url),
      hasWebhookSecret: Boolean(settingsMap?.gas_webhook_secret),
      mediaGateEnabled: Boolean(getMediaAccessPin(context.env)),
    },
  });
}
