/**
 * Single Source of Truth for Axis-2 Scoped Member Capabilities
 * (`event.companion`, `event.checkin`, `album.view_private`, `media.portal`)
 * and Delegation Matrix enforcement.
 */

import { ensureDeepControlSchema } from "./media-access.js";
import { resolveEventSlug } from "./render.js";
import { ensureMemberSchema } from "./security.js";
import { cleanStr } from "./validation.js";

export const VALID_CAPABILITIES = new Set([
  "event.companion",
  "event.checkin",
  "album.view_private",
  "media.portal",
]);

export const RESPONSIBILITY_CAPABILITIES = new Set([
  "event.companion",
  "event.checkin",
  "media.portal",
]);

export const CAPABILITY_META = {
  "event.companion": {
    scopeType: "event",
    labelVi: "Người đồng hành đón khách",
    labelEn: "Event Companion",
    summaryVi: "Xuất hiện ở mục Người đón bạn trên thư mời và trả lời câu hỏi khách gửi riêng cho sự kiện này.",
    summaryEn: "Appear on the event invitation as a welcoming host and answer guest questions for this event.",
    consentVi: "Tôi cam kết giữ kín thông tin liên hệ của người tham dự và giữ thái độ tôn trọng, không ép phát biểu.",
    consentEn: "I agree to keep attendee contact details confidential and welcome newcomers with care.",
  },
  "event.checkin": {
    scopeType: "event",
    labelVi: "Điều phối Check-in hiện trường",
    labelEn: "On-site Check-in Marshal",
    summaryVi: "Mở danh sách rút gọn (Tên + 4 số cuối SĐT) để đánh dấu người có mặt tại buổi gặp. Tự khóa sau sự kiện.",
    summaryEn: "Open a privacy-masked attendee list (Name + last 4 digits) to check guests in. Auto-expires after the event.",
    consentVi: "Tôi chỉ dùng danh sách điểm danh cho buổi gặp này và không chụp hay chia sẻ thông tin người tham dự ra ngoài.",
    consentEn: "I will use the check-in list solely for this gathering and never export or share attendee details.",
  },
  "album.view_private": {
    scopeType: "album",
    labelVi: "Mở khóa Album ảnh gốc",
    labelEn: "Private Album Access",
    summaryVi: "Xem và tải ảnh gốc của album sự kiện được chia sẻ riêng cho bạn.",
    summaryEn: "View and download photos from this private event album.",
    consentVi: "",
    consentEn: "",
  },
  "media.portal": {
    scopeType: "global",
    labelVi: "NGV · Kho Tư Liệu Media",
    labelEn: "NGV · Media Vault",
    summaryVi: "Đăng nhập Kho Media /media/ xem, tải bản gốc và đăng ảnh, video không giới hạn cho hoạt động dựng phim, bài viết, phóng sự.",
    summaryEn: "Access the /media/ vault to view, download originals, and upload unlimited photos and videos for team production.",
    consentVi: "Tôi cam kết không đăng ảnh cận mặt trẻ vị thành niên hoặc khoảnh khắc nhạy cảm khi chưa có sự đồng ý.",
    consentEn: "I agree to follow HolaRise safeguarding rules and never publish sensitive portraits without consent.",
  },
};

const ensuredChatDbs = new WeakSet();

export async function ensureChatAndCapabilitySchema(db) {
  if (!db || ensuredChatDbs.has(db)) return;
  await ensureDeepControlSchema(db);
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS member_capabilities (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL,
          capability TEXT NOT NULL CHECK(capability IN ('event.companion', 'event.checkin', 'album.view_private', 'media.portal')),
          scope_type TEXT NOT NULL DEFAULT 'global' CHECK(scope_type IN ('global', 'event', 'album')),
          scope_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending_accept' CHECK(status IN ('pending_accept', 'active', 'revoked', 'expired')),
          greeting TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          granted_by TEXT NOT NULL DEFAULT '',
          granted_by_name TEXT NOT NULL DEFAULT '',
          grant_message_id TEXT NOT NULL DEFAULT '',
          consent_accepted_at TEXT NOT NULL DEFAULT '',
          expires_at TEXT NOT NULL DEFAULT '',
          revoked_by TEXT NOT NULL DEFAULT '',
          revoked_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .run()
      .catch(() => {});

    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_member_capabilities_member ON member_capabilities(member_id, status, created_at DESC)"
      )
      .run()
      .catch(() => {});

    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_member_capabilities_scope ON member_capabilities(capability, scope_type, scope_id, status)"
      )
      .run()
      .catch(() => {});

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS chat_threads (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'member_direct' CHECK(kind IN ('event_support', 'member_direct')),
          event_id TEXT NOT NULL DEFAULT '',
          event_title TEXT NOT NULL DEFAULT '',
          member_id TEXT NOT NULL DEFAULT '',
          guest_name TEXT NOT NULL DEFAULT '',
          guest_contact TEXT NOT NULL DEFAULT '',
          guest_contact_norm TEXT NOT NULL DEFAULT '',
          guest_token_hash TEXT NOT NULL DEFAULT '',
          assigned_member_id TEXT NOT NULL DEFAULT '',
          assigned_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'waiting_member', 'resolved')),
          unread_admin INTEGER NOT NULL DEFAULT 0,
          unread_member INTEGER NOT NULL DEFAULT 0,
          last_message_preview TEXT NOT NULL DEFAULT '',
          last_message_at TEXT NOT NULL,
          last_notified_member_at TEXT NOT NULL DEFAULT '',
          last_notified_admin_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .run()
      .catch(() => {});

    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_chat_threads_member ON chat_threads(member_id, last_message_at DESC)")
      .run()
      .catch(() => {});
    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_chat_threads_event ON chat_threads(event_id, status, last_message_at DESC)")
      .run()
      .catch(() => {});
    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_chat_threads_guest_token ON chat_threads(guest_token_hash)")
      .run()
      .catch(() => {});
    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(status, last_message_at DESC)")
      .run()
      .catch(() => {});

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          sender_type TEXT NOT NULL CHECK(sender_type IN ('guest', 'member', 'companion', 'admin', 'system')),
          sender_id TEXT NOT NULL DEFAULT '',
          sender_name TEXT NOT NULL DEFAULT '',
          msg_kind TEXT NOT NULL DEFAULT 'text' CHECK(msg_kind IN ('text', 'capability_card', 'context_card')),
          body TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          is_internal INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`
      )
      .run()
      .catch(() => {});

    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC)")
      .run()
      .catch(() => {});
  } catch {
    // Non-fatal on minimal DB mocks
  }
  ensuredChatDbs.add(db);
}

/**
 * Strict Delegation Matrix (Anti-Privilege Escalation):
 * - super_admin, event_ops, editor (legacy): all 4 Axis-2 capabilities
 * - media_manager: album.view_private + media.portal
 * - media / media_ctv: ONLY album.view_private
 * - content_ctv / content_editor / non-admin: none
 */
export function canAdminGrantCapability(adminUser, capability) {
  if (!adminUser || !VALID_CAPABILITIES.has(capability)) return false;
  const role = String(adminUser.role || "").trim().toLowerCase();
  if (role === "super_admin" || role === "event_ops" || role === "editor") return true;
  if (role === "media_manager") return capability === "album.view_private" || capability === "media.portal";
  if (role === "media" || role === "media_ctv") return capability === "album.view_private";
  return false;
}

export function computeEffectiveStatus(row, nowIso = new Date().toISOString()) {
  const status = String(row?.status || "revoked");
  if (status === "revoked" || status === "expired") return status;
  const exp = String(row?.expires_at || "").trim();
  if (exp && exp <= nowIso) return "expired";
  return status;
}

export function isCapabilityActiveNow(row, nowIso = new Date().toISOString()) {
  return computeEffectiveStatus(row, nowIso) === "active";
}

export function serializeCapabilityRow(row, nowIso = new Date().toISOString()) {
  if (!row) return null;
  const meta = CAPABILITY_META[row.capability] || {};
  const effectiveStatus = computeEffectiveStatus(row, nowIso);
  return {
    id: row.id,
    memberId: row.member_id,
    capability: row.capability,
    scopeType: row.scope_type || meta.scopeType || "global",
    scopeId: row.scope_id || "",
    scopeTitle: row.scope_title || "",
    scopeSlug: row.scope_slug || "",
    status: effectiveStatus,
    requiresConsent: RESPONSIBILITY_CAPABILITIES.has(row.capability),
    labelVi: meta.labelVi || row.capability,
    labelEn: meta.labelEn || row.capability,
    summaryVi: meta.summaryVi || "",
    summaryEn: meta.summaryEn || "",
    consentVi: meta.consentVi || "",
    consentEn: meta.consentEn || "",
    greeting: row.greeting || "",
    note: row.note || "",
    grantedBy: row.granted_by || "",
    grantedByName: row.granted_by_name || "",
    grantMessageId: row.grant_message_id || "",
    consentAcceptedAt: row.consent_accepted_at || "",
    expiresAt: row.expires_at || "",
    revokedBy: row.revoked_by || "",
    revokedAt: row.revoked_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export async function listMemberCapabilities(db, memberId, { includeInactive = false } = {}) {
  if (!db || !memberId) return [];
  await ensureChatAndCapabilitySchema(db);
  const nowIso = new Date().toISOString();
  const res = await db
    .prepare(
      `SELECT c.*,
              CASE
                WHEN c.scope_type = 'event' THEN COALESCE(e.title, '')
                WHEN c.scope_type = 'album' THEN COALESCE(a.title, '')
                ELSE ''
              END AS scope_title,
              CASE
                WHEN c.scope_type = 'event' THEN COALESCE(e.id, c.scope_id)
                WHEN c.scope_type = 'album' THEN COALESCE(a.slug, c.scope_id)
                ELSE ''
              END AS scope_slug
       FROM member_capabilities c
       LEFT JOIN events e ON c.scope_type = 'event' AND e.id = c.scope_id
       LEFT JOIN media_albums a ON c.scope_type = 'album' AND a.id = c.scope_id
       WHERE c.member_id = ?
       ORDER BY c.created_at DESC
       LIMIT 80`
    )
    .bind(memberId)
    .all()
    .catch(() => ({ results: [] }));

  const items = (res.results || []).map((row) => {
    const normalizedRow =
      row.scope_type === "event"
        ? { ...row, scope_slug: resolveEventSlug({ id: row.scope_id }) }
        : row;
    return serializeCapabilityRow(normalizedRow, nowIso);
  });
  if (includeInactive) return items;
  return items.filter((item) => item.status === "active" || item.status === "pending_accept");
}

export async function hasMemberCapability(db, memberId, capability, scopeId = "") {
  if (!db || !memberId || !VALID_CAPABILITIES.has(capability)) return false;
  await ensureChatAndCapabilitySchema(db);
  const nowIso = new Date().toISOString();

  const rows = await db
    .prepare(
      `SELECT status, expires_at
       FROM member_capabilities
       WHERE member_id = ? AND capability = ? AND (? = '' OR scope_id = ?)
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .bind(memberId, capability, String(scopeId || ""), String(scopeId || ""))
    .all()
    .catch(() => ({ results: [] }));

  if ((rows.results || []).some((r) => isCapabilityActiveNow(r, nowIso))) {
    return true;
  }

  // Backward-compatible fallback with migration 0020 columns/tables
  if (capability === "media.portal") {
    const m = await db
      .prepare("SELECT can_access_media_portal FROM members WHERE id = ? AND is_active = 1")
      .bind(memberId)
      .first()
      .catch(() => null);
    return Number(m?.can_access_media_portal || 0) === 1;
  }

  if (capability === "album.view_private" && scopeId) {
    const g = await db
      .prepare("SELECT 1 AS ok FROM member_album_grants WHERE member_id = ? AND album_id = ? LIMIT 1")
      .bind(memberId, scopeId)
      .first()
      .catch(() => null);
    return Boolean(g?.ok);
  }

  return false;
}

export async function listMemberActiveEventIds(db, memberId, capability) {
  if (!db || !memberId || !VALID_CAPABILITIES.has(capability)) return [];
  await ensureChatAndCapabilitySchema(db);
  const nowIso = new Date().toISOString();
  const res = await db
    .prepare(
      `SELECT scope_id, status, expires_at
       FROM member_capabilities
       WHERE member_id = ? AND capability = ? AND scope_type = 'event' AND status = 'active'
       LIMIT 60`
    )
    .bind(memberId, capability)
    .all()
    .catch(() => ({ results: [] }));
  const ids = new Set();
  for (const r of res.results || []) {
    if (r.scope_id && isCapabilityActiveNow(r, nowIso)) ids.add(String(r.scope_id));
  }
  return Array.from(ids);
}

/**
 * Returns active, non-expired Event Companions (`event.companion`) for a given event.
 * Safe for public SSR display on /su-kien/<slug> & /en/events/<slug> (exposes NO phone/email).
 */
export async function listEventCompanions(db, eventId) {
  if (!db || !eventId) return [];
  await Promise.all([ensureChatAndCapabilitySchema(db), ensureMemberSchema(db)]);
  const nowIso = new Date().toISOString();
  const res = await db
    .prepare(
      `SELECT c.id AS capability_id, c.member_id, c.greeting, c.expires_at, c.status,
              m.name, m.member_code, m.avatar_url, m.role_title, m.organization
       FROM member_capabilities c
       JOIN members m ON m.id = c.member_id AND m.is_active = 1
       WHERE c.capability = 'event.companion'
         AND c.scope_type = 'event'
         AND c.scope_id = ?
         AND c.status = 'active'
       ORDER BY c.consent_accepted_at ASC, c.created_at ASC
       LIMIT 6`
    )
    .bind(String(eventId))
    .all()
    .catch(() => ({ results: [] }));

  const seen = new Set();
  const list = [];
  for (const row of res.results || []) {
    if (!isCapabilityActiveNow(row, nowIso)) continue;
    if (seen.has(row.member_id)) continue;
    seen.add(row.member_id);
    list.push({
      capabilityId: row.capability_id,
      memberId: row.member_id,
      memberCode: row.member_code || "",
      name: row.name || "Người đồng hành HolaRise",
      avatarUrl: row.avatar_url || "",
      roleTitle: row.role_title || "",
      organization: row.organization || "",
      greeting:
        row.greeting ||
        "Đi một mình cứ nhắn cho mình trước buổi gặp để mình ra đón bạn nhé.",
    });
  }
  return list;
}

/**
 * Syncs legacy 0020 media columns/tables when `album.view_private` or `media.portal`
 * transitions to active or revoked so /media/ and /api/media/[id] work seamlessly.
 */
export async function syncLegacyMediaGrantState(db, { memberId, capability, scopeId, active, grantedBy, now }) {
  if (!db || !memberId) return;
  await ensureDeepControlSchema(db);
  const ts = now || new Date().toISOString();

  if (capability === "media.portal") {
    if (active) {
      await db
        .prepare("UPDATE members SET can_access_media_portal = 1, updated_at = ? WHERE id = ?")
        .bind(ts, memberId)
        .run()
        .catch(() => {});
    } else {
      // Only disable if no other active media.portal capability remains
      const other = await db
        .prepare(
          `SELECT id, status, expires_at FROM member_capabilities
           WHERE member_id = ? AND capability = 'media.portal' AND status = 'active'
           LIMIT 5`
        )
        .bind(memberId)
        .all()
        .catch(() => ({ results: [] }));
      const stillActive = (other.results || []).some((r) => isCapabilityActiveNow(r, ts));
      if (!stillActive) {
        await db
          .prepare("UPDATE members SET can_access_media_portal = 0, updated_at = ? WHERE id = ?")
          .bind(ts, memberId)
          .run()
          .catch(() => {});
      }
    }
  } else if (capability === "album.view_private" && scopeId) {
    if (active) {
      await db
        .prepare(
          "INSERT OR IGNORE INTO member_album_grants (member_id, album_id, granted_by, note, created_at) VALUES (?, ?, ?, 'Cấp trong hộp thoại', ?)"
        )
        .bind(memberId, scopeId, cleanStr(grantedBy, 120), ts)
        .run()
        .catch(() => {});
    } else {
      await db
        .prepare("DELETE FROM member_album_grants WHERE member_id = ? AND album_id = ?")
        .bind(memberId, scopeId)
        .run()
        .catch(() => {});
    }
  }
}

/**
 * Computes default auto-expiry ISO timestamp for time-bound event capabilities.
 * If event has YYYY-MM-DD date, expires 24h after end of that date (VN +07:00);
 * otherwise defaults to ttlHours from now.
 */
export function computeDefaultExpiry({ capability, eventDate = "", ttlHours = 0 }) {
  const hours = Number(ttlHours || 0);
  if (Number.isFinite(hours) && hours > 0) {
    const cappedHours = Math.min(24 * 365, Math.max(1, Math.round(hours)));
    return new Date(Date.now() + cappedHours * 3600 * 1000).toISOString();
  }
  if (capability === "event.checkin" || capability === "event.companion") {
    const cleanDate = String(eventDate || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      const endOfDayVn = new Date(`${cleanDate}T23:59:59+07:00`);
      if (!Number.isNaN(endOfDayVn.getTime())) {
        const extraHours = capability === "event.checkin" ? 24 : 72;
        return new Date(endOfDayVn.getTime() + extraHours * 3600 * 1000).toISOString();
      }
    }
    const fallbackHours = capability === "event.checkin" ? 48 : 24 * 14;
    return new Date(Date.now() + fallbackHours * 3600 * 1000).toISOString();
  }
  return "";
}

/**
 * Nghị định 13/2023 Data Minimization for Event Check-in Marshals:
 * Reveals only the last 4 digits of a phone number (never full phone or email).
 */
export function maskPhoneForCheckin(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length >= 4) {
    return `••••••${digits.slice(-4)}`;
  }
  if (digits.length > 0) {
    return `••••${digits}`;
  }
  return "—";
}
