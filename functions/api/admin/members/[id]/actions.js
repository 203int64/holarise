import { ensureDeepControlSchema } from "../../../../_lib/media-access.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../../_lib/security.js";
import { cleanStr, VALID_REG_STATUSES } from "../../../../_lib/validation.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureDeepControlSchema(db);

  const memberId = String(context.params?.id || "").trim();
  const member = await db.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first();
  if (!member) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy thành viên.");
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};
  const action = cleanStr(d.action, 40);
  const now = new Date().toISOString();

  if (action === "revoke_sessions") {
    const res = await db.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(memberId).run();
    return jsonResponse({
      ok: true,
      action,
      revokedCount: Number(res?.meta?.changes || 0),
      message: "Đã đăng xuất toàn bộ thiết bị của thành viên.",
    });
  }

  if (action === "assign_event") {
    const eventId = cleanStr(d.eventId || d.event_id, 120);
    if (!eventId) {
      return errorResponse(400, "MISSING_EVENT", "Vui lòng chọn sự kiện cần gán.");
    }
    const ev = await db.prepare("SELECT id, title FROM events WHERE id = ?").bind(eventId).first();
    if (!ev) {
      return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện.");
    }
    const rawStatus = cleanStr(d.status, 20) || "attended";
    const status = VALID_REG_STATUSES.has(rawStatus) ? rawStatus : "attended";
    const adminNote = cleanStr(d.adminNote || d.admin_note, 500) || `Gán trực tiếp bởi Quản trị (${auth.user.email})`;

    const existingReg = await db
      .prepare("SELECT id FROM registrations WHERE member_id = ? AND event_id = ? LIMIT 1")
      .bind(memberId, eventId)
      .first()
      .catch(() => null);

    if (existingReg) {
      await db
        .prepare("UPDATE registrations SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?")
        .bind(status, adminNote, now, existingReg.id)
        .run();
      return jsonResponse({ ok: true, action, registrationId: existingReg.id, updated: true });
    }

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
        member.name,
        member.phone_display || member.email || member.member_code,
        member.email || "",
        `Thành viên (${member.member_code})`,
        member.organization || "",
        status,
        adminNote,
        now,
        now
      )
      .run();

    return jsonResponse({ ok: true, action, registrationId: regId, created: true }, 201);
  }

  if (action === "remove_registration") {
    const regId = cleanStr(d.registrationId || d.registration_id, 80);
    if (!regId) return errorResponse(400, "MISSING_REG_ID", "Thiếu mã đơn đăng ký.");
    const res = await db
      .prepare("DELETE FROM registrations WHERE id = ? AND (member_id = ? OR LOWER(TRIM(email)) = ?)")
      .bind(regId, memberId, String(member.email || "").trim().toLowerCase())
      .run();
    return jsonResponse({ ok: true, action, deleted: Number(res?.meta?.changes || 0) > 0 });
  }

  if (action === "set_album_grants") {
    const canViewAllMedia =
      d.canViewAllMedia !== undefined ? (Boolean(d.canViewAllMedia) ? 1 : 0) : Number(member.can_view_all_media || 0);
    const canAccessMediaPortal =
      d.canAccessMediaPortal !== undefined
        ? Boolean(d.canAccessMediaPortal)
          ? 1
          : 0
        : Number(member.can_access_media_portal || 0);
    const albumIds = Array.isArray(d.albumIds)
      ? Array.from(new Set(d.albumIds.map((x) => cleanStr(x, 80)).filter(Boolean))).slice(0, 100)
      : [];

    const stmts = [
      db
        .prepare("UPDATE members SET can_view_all_media = ?, can_access_media_portal = ?, updated_at = ? WHERE id = ?")
        .bind(canViewAllMedia, canAccessMediaPortal, now, memberId),
      db.prepare("DELETE FROM member_album_grants WHERE member_id = ?").bind(memberId),
    ];

    for (const albumId of albumIds) {
      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO member_album_grants (member_id, album_id, granted_by, note, created_at) VALUES (?, ?, ?, '', ?)"
          )
          .bind(memberId, albumId, auth.user.email, now)
      );
    }

    await db.batch(stmts);
    return jsonResponse({
      ok: true,
      action,
      canViewAllMedia: canViewAllMedia === 1,
      canAccessMediaPortal: canAccessMediaPortal === 1,
      grantedAlbumIds: albumIds,
    });
  }

  return errorResponse(400, "UNKNOWN_ACTION", "Thao tác không được hỗ trợ.");
}
