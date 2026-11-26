import { autoProvisionFinishedEventAlbums } from "../../../_lib/albums.js";
import { isDriveConfigured } from "../../../_lib/drive.js";
import {
  canActorViewAlbum,
  ensureDeepControlSchema,
  getMemberPermissions,
} from "../../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../../_lib/media-approval-schema.js";
import { jsonResponse, requireMember } from "../../../_lib/security.js";

const MAX_DRIVE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_KV_UPLOAD_BYTES = 1.5 * 1024 * 1024;

export async function onRequestGet(context) {
  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;

  const { env } = context;
  await Promise.all([ensureMediaApprovalSchema(env.DB), ensureDeepControlSchema(env.DB)]);
  await autoProvisionFinishedEventAlbums(env);

  const perms = await getMemberPermissions(env.DB, auth.member.id);
  const actor = {
    isSoleAdmin: false,
    isMediaTeam: false,
    member: auth.member,
    canViewAllMedia: perms.canViewAllMedia,
    isMediaViewer: perms.canAccessMediaPortal,
  };

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.slug, a.title, a.description, a.event_date, a.date_display, a.location,
            a.cover_url, a.drive_url, a.event_id, COALESCE(a.visibility, 'public') AS visibility,
            (SELECT COUNT(*) FROM media_photos p
              WHERE p.album_id = a.id AND COALESCE(p.approval_status, 'approved') = 'approved') AS approved_count,
            (SELECT COUNT(*) FROM media_photos p
              WHERE p.album_id = a.id AND p.contributor_member_id = ? AND p.approval_status = 'pending') AS my_pending_count,
            (SELECT COUNT(*) FROM media_photos p
              WHERE p.album_id = a.id AND p.contributor_member_id = ?) AS my_total_count
     FROM media_albums a
     WHERE a.status = 'published'
     ORDER BY a.sort_order ASC, a.event_date DESC, a.created_at DESC
     LIMIT 120`
  )
    .bind(auth.member.id, auth.member.id)
    .all();

  const driveConfigured = isDriveConfigured(env);
  const items = [];
  for (const row of results || []) {
    const canView = await canActorViewAlbum(env.DB, row, actor);
    if (!canView && String(row.visibility || "public") === "private") continue;
    items.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description || "",
      eventDate: row.event_date || "",
      dateDisplay: row.date_display || row.event_date || "",
      location: row.location || "",
      coverUrl: canView ? row.cover_url || "" : "",
      driveUrl: canView ? row.drive_url || "" : "",
      eventId: row.event_id || "",
      visibility: row.visibility || "public",
      canView,
      approvedCount: Number(row.approved_count || 0),
      myPendingCount: Number(row.my_pending_count || 0),
      myTotalCount: Number(row.my_total_count || 0),
    });
  }

  return jsonResponse({
    ok: true,
    items,
    canViewAllMedia: perms.canViewAllMedia,
    canAccessMediaPortal: perms.canAccessMediaPortal,
    driveConfigured,
    storage: driveConfigured ? "google_drive" : "media_kv",
    maxUploadBytes: driveConfigured ? MAX_DRIVE_UPLOAD_BYTES : MAX_KV_UPLOAD_BYTES,
    hourlyLimit: 60,
  });
}
