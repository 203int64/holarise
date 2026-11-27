/**
 * Privacy-Minimized On-Site Event Check-in API for Delegated `event.checkin` Members (and Admins).
 * Nghị định 13/2023 compliance:
 * - Exposes ONLY attendee fullName, organization, maskedPhone (last 4 digits), and status.
 * - NEVER exposes full phone numbers, emails, or personal notes to delegated members.
 * - Enforces active, non-expired `event.checkin` capability scoped to the exact `eventId`.
 */

import {
  ensureChatAndCapabilitySchema,
  hasMemberCapability,
  maskPhoneForCheckin,
} from "../../_lib/capabilities.js";
import { resolveEventSlug } from "../../_lib/render.js";
import {
  errorResponse,
  getSessionMember,
  getSessionUser,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr } from "../../_lib/validation.js";

async function authorizeCheckinActor(db, request, eventId) {
  await ensureChatAndCapabilitySchema(db);
  const [adminUser, member] = await Promise.all([
    getSessionUser(db, request).catch(() => null),
    getSessionMember(db, request).catch(() => null),
  ]);
  if (adminUser && (adminUser.role === "super_admin" || adminUser.role === "editor")) {
    return { allowed: true, actorLabel: `${adminUser.name || "BTC"} (${adminUser.role})`, isAdmin: true };
  }
  if (member) {
    const ok = await hasMemberCapability(db, member.id, "event.checkin", eventId);
    if (ok) {
      return {
        allowed: true,
        actorLabel: `${member.name} (${member.member_code || member.id})`,
        isAdmin: false,
      };
    }
  }
  return { allowed: false, actorLabel: "", isAdmin: false };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa sẵn sàng.");
  }

  const url = new URL(request.url);
  const eventId = cleanStr(url.searchParams.get("eventId") || "", 120);
  if (!eventId) {
    return errorResponse(400, "MISSING_EVENT_ID", "Thiếu mã sự kiện cần check-in.");
  }

  const ev = await env.DB.prepare("SELECT id, title, date, date_display, time, location FROM events WHERE id = ? LIMIT 1")
    .bind(eventId)
    .first()
    .catch(() => null);
  if (!ev) {
    return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const auth = await authorizeCheckinActor(env.DB, request, ev.id);
  if (!auth.allowed) {
    return errorResponse(403, "CHECKIN_FORBIDDEN", "Bạn chưa được cấp quyền Check-in (hoặc quyền đã hết hạn) cho sự kiện này.");
  }

  const regsRes = await env.DB.prepare(
    `SELECT id, full_name, organization, phone, status, updated_at, created_at
     FROM registrations
     WHERE (event_id = ? OR activity_title = ?)
       AND status != 'cancelled'
     ORDER BY CASE status WHEN 'attended' THEN 1 ELSE 0 END, full_name ASC
     LIMIT 400`
  )
    .bind(ev.id, ev.title)
    .all()
    .catch(() => ({ results: [] }));

  const attendees = (regsRes.results || []).map((r) => ({
    id: r.id,
    fullName: r.full_name || "Người tham dự",
    organization: r.organization || "",
    maskedPhone: maskPhoneForCheckin(r.phone),
    status: r.status || "new",
    checkedIn: r.status === "attended",
    updatedAt: r.updated_at || r.created_at || "",
  }));

  const attendedCount = attendees.filter((a) => a.checkedIn).length;

  return jsonResponse({
    ok: true,
    event: {
      id: ev.id,
      slug: resolveEventSlug(ev),
      title: ev.title,
      date: ev.date || "",
      dateDisplay: ev.date_display || "",
      time: ev.time || "",
      location: ev.location || "",
    },
    stats: {
      total: attendees.length,
      attended: attendedCount,
      remaining: Math.max(0, attendees.length - attendedCount),
    },
    attendees,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa sẵn sàng.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi yêu cầu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};
  const eventId = cleanStr(d.eventId || "", 120);
  const registrationId = cleanStr(d.registrationId || "", 80);
  const checkedIn = d.checkedIn !== false;

  if (!eventId || !registrationId) {
    return errorResponse(400, "MISSING_PARAMS", "Thiếu mã sự kiện hoặc mã đăng ký.");
  }

  const ev = await env.DB.prepare("SELECT id, title FROM events WHERE id = ? LIMIT 1")
    .bind(eventId)
    .first()
    .catch(() => null);
  if (!ev) {
    return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const auth = await authorizeCheckinActor(env.DB, request, ev.id);
  if (!auth.allowed) {
    return errorResponse(403, "CHECKIN_FORBIDDEN", "Bạn chưa được cấp quyền Check-in (hoặc quyền đã hết hạn) cho sự kiện này.");
  }

  const reg = await env.DB.prepare(
    "SELECT id, status, admin_note FROM registrations WHERE id = ? AND (event_id = ? OR activity_title = ?) LIMIT 1"
  )
    .bind(registrationId, ev.id, ev.title)
    .first()
    .catch(() => null);
  if (!reg) {
    return errorResponse(404, "REG_NOT_FOUND", "Không tìm thấy bản ghi tham dự trong sự kiện này.");
  }

  const nextStatus = checkedIn ? "attended" : "contacted";
  const now = new Date().toISOString();
  const auditTag = checkedIn
    ? `Check-in bởi ${auth.actorLabel} lúc ${now.slice(11, 16)} UTC`
    : `Hoàn tác check-in bởi ${auth.actorLabel}`;
  const nextNote = reg.admin_note ? `${reg.admin_note}\n${auditTag}`.slice(-600) : auditTag;

  await env.DB.prepare("UPDATE registrations SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?")
    .bind(nextStatus, nextNote, now, reg.id)
    .run();

  return jsonResponse({
    ok: true,
    registrationId: reg.id,
    status: nextStatus,
    checkedIn: nextStatus === "attended",
  });
}
