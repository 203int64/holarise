import { ensureDeepControlSchema, VALID_ALBUM_VISIBILITIES, VALID_STAGE_OVERRIDES } from "../../../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../../../_lib/media-approval-schema.js";
import { serializeEventRow } from "../../../../_lib/render.js";
import {
  ensureEventFeedbackSchema,
  ensureReflectionsSchema,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireAdmin,
} from "../../../../_lib/security.js";
import { cleanStr, isValidEmail, VALID_POST_STATUSES, VALID_REG_STATUSES } from "../../../../_lib/validation.js";
import { serializeAdminEventFeedback } from "../../event-feedback/index.js";

async function findLinkedAlbum(db, ev) {
  let album = await db
    .prepare(
      `SELECT a.*,
              (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id) AS photo_count,
              (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND COALESCE(p.approval_status, 'approved') = 'approved') AS approved_count,
              (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND p.approval_status = 'pending') AS pending_count
       FROM media_albums a
       WHERE a.event_id = ?
       ORDER BY a.created_at DESC
       LIMIT 1`
    )
    .bind(ev.id)
    .first()
    .catch(() => null);

  if (!album && ev.slug) {
    album = await db
      .prepare(
        `SELECT a.*,
                (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id) AS photo_count,
                (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND COALESCE(p.approval_status, 'approved') = 'approved') AS approved_count,
                (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id AND p.approval_status = 'pending') AS pending_count
         FROM media_albums a
         WHERE a.slug = ? OR LOWER(TRIM(a.title)) = ?
         ORDER BY a.created_at DESC
         LIMIT 1`
      )
      .bind(ev.slug, String(ev.title || "").trim().toLowerCase())
      .first()
      .catch(() => null);
  }
  return album || null;
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await Promise.all([
    ensureDeepControlSchema(db),
    ensureMediaApprovalSchema(db),
    ensureEventFeedbackSchema(db),
    ensureReflectionsSchema(db),
  ]);

  const id = String(context.params?.id || "").trim();
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!row) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const ev = serializeEventRow(row);
  const [regsRes, albumRow, feedbacksRes, refCountRow, membersRes] = await Promise.all([
    db
      .prepare(
        `SELECT id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization,
                note, status, admin_note, sync_status, created_at, updated_at
         FROM registrations
         WHERE event_id = ? OR activity_title = ?
         ORDER BY CASE status WHEN 'attended' THEN 0 WHEN 'contacted' THEN 1 WHEN 'new' THEN 2 ELSE 3 END, created_at DESC
         LIMIT 300`
      )
      .bind(ev.id, ev.title)
      .all()
      .catch(() => ({ results: [] })),
    findLinkedAlbum(db, ev),
    db
      .prepare(
        `SELECT * FROM event_feedbacks
         WHERE event_id = ? OR event_slug = ?
         ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'read' THEN 1 ELSE 2 END, created_at DESC
         LIMIT 100`
      )
      .bind(ev.id, ev.slug || ev.id)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT COUNT(*) AS cnt FROM activity_reflections WHERE activity_slug = ?")
      .bind(ev.slug || ev.id)
      .first()
      .catch(() => ({ cnt: 0 })),
    db
      .prepare("SELECT id, member_code, name, phone_display, email, organization FROM members WHERE is_active = 1 ORDER BY created_at DESC LIMIT 120")
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const registrations = regsRes.results || [];
  const stats = { total: registrations.length, new: 0, contacted: 0, attended: 0, cancelled: 0, activeBooked: 0 };
  for (const r of registrations) {
    if (r.status in stats) stats[r.status] += 1;
    if (r.status !== "cancelled") stats.activeBooked += 1;
  }

  let grantedMembers = [];
  if (albumRow) {
    const gRes = await db
      .prepare(
        `SELECT g.member_id, g.created_at, m.name, m.member_code, m.phone_display
         FROM member_album_grants g
         JOIN members m ON m.id = g.member_id
         WHERE g.album_id = ?
         ORDER BY g.created_at DESC`
      )
      .bind(albumRow.id)
      .all()
      .catch(() => ({ results: [] }));
    grantedMembers = (gRes.results || []).map((g) => ({
      memberId: g.member_id,
      name: g.name,
      memberCode: g.member_code,
      phoneDisplay: g.phone_display || "",
      grantedAt: g.created_at,
    }));
  }

  return jsonResponse({
    ok: true,
    event: ev,
    stats,
    registrations,
    album: albumRow
      ? {
          id: albumRow.id,
          slug: albumRow.slug,
          title: albumRow.title,
          status: albumRow.status || "published",
          visibility: albumRow.visibility || "public",
          driveUrl: albumRow.drive_url || "",
          photoCount: Number(albumRow.photo_count || 0),
          approvedCount: Number(albumRow.approved_count || 0),
          pendingCount: Number(albumRow.pending_count || 0),
          grantedMembers,
        }
      : null,
    feedbacks: (feedbacksRes.results || []).map(serializeAdminEventFeedback),
    reflectionsCount: Number(refCountRow?.cnt || 0),
    members: (membersRes.results || []).map((m) => ({
      id: m.id,
      memberCode: m.member_code,
      name: m.name,
      phoneDisplay: m.phone_display || "",
      email: m.email || "",
      organization: m.organization || "",
    })),
  });
}

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureDeepControlSchema(db);

  const id = String(context.params?.id || "").trim();
  const existing = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};

  const nextRsvpClosed =
    d.rsvpClosed !== undefined ? (Boolean(d.rsvpClosed) ? 1 : 0) : Number(existing.rsvp_closed || 0);
  const nextStageOverride =
    d.stageOverride !== undefined
      ? cleanStr(d.stageOverride, 20).toLowerCase()
      : String(existing.stage_override || "auto");
  if (!VALID_STAGE_OVERRIDES.has(nextStageOverride)) {
    return errorResponse(400, "INVALID_STAGE", "Chế độ hiển thị chỉ nhận auto, invite hoặc memory.");
  }

  const nextSeatCap =
    d.seatCapacity !== undefined
      ? Math.min(5000, Math.max(0, Math.trunc(Number(d.seatCapacity) || 0)))
      : Number(existing.seat_capacity || 0);
  const nextExtBooked =
    d.externalBooked !== undefined
      ? Math.min(5000, Math.max(0, Math.trunc(Number(d.externalBooked) || 0)))
      : Number(existing.external_booked || 0);
  const nextShowSeatBar =
    d.showSeatBar !== undefined ? (Boolean(d.showSeatBar) ? 1 : 0) : Number(existing.show_seat_bar || 0);
  const nextStatus =
    d.status !== undefined && VALID_POST_STATUSES.has(cleanStr(d.status, 20))
      ? cleanStr(d.status, 20)
      : existing.status;

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE events
       SET rsvp_closed = ?, stage_override = ?, seat_capacity = ?, external_booked = ?,
           show_seat_bar = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(nextRsvpClosed, nextStageOverride, nextSeatCap, nextExtBooked, nextShowSeatBar, nextStatus, now, id)
    .run();

  if (d.albumId && (d.albumVisibility !== undefined || d.albumStatus !== undefined)) {
    const albumId = cleanStr(d.albumId, 80);
    const alb = await db.prepare("SELECT id, status, visibility FROM media_albums WHERE id = ?").bind(albumId).first();
    if (alb) {
      const nextVis =
        d.albumVisibility !== undefined ? cleanStr(d.albumVisibility, 24).toLowerCase() : alb.visibility || "public";
      const nextAlbStatus =
        d.albumStatus !== undefined && VALID_POST_STATUSES.has(cleanStr(d.albumStatus, 20))
          ? cleanStr(d.albumStatus, 20)
          : alb.status;
      if (!VALID_ALBUM_VISIBILITIES.has(nextVis)) {
        return errorResponse(400, "INVALID_VISIBILITY", "Chế độ quyền xem album không hợp lệ.");
      }
      await db
        .prepare("UPDATE media_albums SET visibility = ?, status = ?, updated_at = ? WHERE id = ?")
        .bind(nextVis, nextAlbStatus, now, albumId)
        .run();
    }
  }

  const updated = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, event: serializeEventRow(updated) });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureDeepControlSchema(db);

  const id = String(context.params?.id || "").trim();
  const ev = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!ev) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};
  const action = cleanStr(d.action, 40) || "add_attendee";
  const now = new Date().toISOString();

  if (action === "add_attendee") {
    const memberId = cleanStr(d.memberId, 80);
    let fullName = cleanStr(d.fullName, 120);
    let phone = cleanStr(d.phone, 40);
    let email = cleanStr(d.email, 160).toLowerCase();
    let organization = cleanStr(d.organization, 160);
    let roleLabel = "Khách check-in tại cửa";

    if (memberId) {
      const m = await db.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first();
      if (!m) return errorResponse(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên đã chọn.");
      fullName = fullName || m.name;
      phone = phone || m.phone_display || m.email || m.member_code;
      email = email || m.email || "";
      organization = organization || m.organization || "";
      roleLabel = `Thành viên (${m.member_code})`;
    }

    if (fullName.length < 2) {
      return errorResponse(400, "VALIDATION_ERROR", "Vui lòng nhập họ và tên người tham dự (tối thiểu 2 ký tự).");
    }
    if (email && !isValidEmail(email)) {
      return errorResponse(400, "VALIDATION_ERROR", "Email không đúng định dạng.");
    }
    const rawStatus = cleanStr(d.status, 20) || "attended";
    const status = VALID_REG_STATUSES.has(rawStatus) ? rawStatus : "attended";
    const adminNote = cleanStr(d.adminNote, 500) || "Thêm thủ công từ Trung tâm điều hành sự kiện";

    const regId = `REG-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    await db
      .prepare(
        `INSERT INTO registrations
         (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
         VALUES (?, ?, 'event_modal', ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 'skipped', '', 'admin', ?, ?)`
      )
      .bind(
        regId,
        memberId,
        ev.id,
        ev.title,
        fullName,
        phone || "Tại cửa",
        email,
        roleLabel,
        organization,
        status,
        adminNote,
        now,
        now
      )
      .run();

    return jsonResponse({ ok: true, action, registrationId: regId }, 201);
  }

  if (action === "grant_album_member" || action === "revoke_album_member") {
    const albumId = cleanStr(d.albumId, 80);
    const memberId = cleanStr(d.memberId, 80);
    if (!albumId || !memberId) {
      return errorResponse(400, "VALIDATION_ERROR", "Thiếu mã album hoặc thành viên.");
    }
    if (action === "grant_album_member") {
      await db
        .prepare(
          "INSERT OR IGNORE INTO member_album_grants (member_id, album_id, granted_by, note, created_at) VALUES (?, ?, ?, '', ?)"
        )
        .bind(memberId, albumId, auth.user.email, now)
        .run();
    } else {
      await db
        .prepare("DELETE FROM member_album_grants WHERE member_id = ? AND album_id = ?")
        .bind(memberId, albumId)
        .run();
    }
    return jsonResponse({ ok: true, action, albumId, memberId });
  }

  return errorResponse(400, "UNKNOWN_ACTION", "Thao tác không được hỗ trợ.");
}
