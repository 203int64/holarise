import { isDriveConfigured } from "../../_lib/drive.js";
import { getSettingsMap } from "../../_lib/gas.js";
import { ensureMediaApprovalSchema } from "../../_lib/media-approval-schema.js";
import { serializeEventRow, splitEventsByDate } from "../../_lib/render.js";
import { jsonResponse, requireAdmin } from "../../_lib/security.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureMediaApprovalSchema(db).catch(() => null);

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
    settingsMap,
  ] = await Promise.all([
    db.prepare("SELECT status, COUNT(*) AS cnt FROM registrations GROUP BY status").all().catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT id, source, event_id, activity_title, full_name, phone, email, organization, status, sync_status, created_at
         FROM registrations
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

  const posts = { published: 0, draft: 0, total: 0 };
  for (const row of postsRes.results || []) {
    const c = Number(row.cnt || 0);
    posts.total += c;
    if (row.status === "published") posts.published = c;
    else if (row.status === "draft") posts.draft = c;
  }

  const reflections = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of [...(memRefRes.results || []), ...(commRefRes.results || [])]) {
    const c = Number(row.cnt || 0);
    reflections.total += c;
    if (row.status in reflections) reflections[row.status] += c;
  }

  const [albumRow, pendingPhotoRow, totalPhotoRow] = mediaStatsRes;

  return jsonResponse({
    ok: true,
    registrations,
    recentRegistrations: recentRegsRes.results || [],
    events: {
      total: serializedEvents.length,
      upcomingCount: upcoming.length,
      pastCount: past.length,
      draftCount: serializedEvents.filter((e) => e.status === "draft").length,
      upcoming: upcoming.slice(0, 5),
    },
    posts,
    reflections,
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
      mediaGateEnabled: Boolean(String(context.env?.MEDIA_ACCESS_PIN || "").trim()),
    },
  });
}
