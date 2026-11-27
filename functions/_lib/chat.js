/**
 * HolaRise Desk — Two-Way Companion & BTC Chat Engine
 * - Guest Event Support threads (no login wall; HttpOnly session token + auto-merge on member signup)
 * - Member Direct threads (contributions, capability grants, BTC communication)
 * - Internal BTC whisper notes (strictly stripped from non-admin responses)
 * - Anti-spam offline email notifications (6h per-thread cooldown via email.js)
 */

import {
  ensureChatAndCapabilitySchema,
  hasMemberCapability,
  listMemberActiveEventIds,
} from "./capabilities.js";
import { escapeHtml, sendTransactionalEmail } from "./email.js";
import {
  getSessionMember,
  getSessionUser,
  parseCookies,
  randomTokenHex,
  sha256Hex,
  timingSafeEqualHex,
} from "./security.js";
import { cleanStr, normalizePhone } from "./validation.js";

export const GUEST_CHAT_COOKIE_NAME = "holarise_guest_chat";
const GUEST_CHAT_MAX_AGE = 14 * 24 * 60 * 60; // 14 days
const OFFLINE_EMAIL_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours per thread

export function buildGuestChatCookie(token, request, clear = false) {
  const url = new URL(request.url);
  const isHttps = url.protocol === "https:";
  const parts = [
    `${GUEST_CHAT_COOKIE_NAME}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${GUEST_CHAT_MAX_AGE}`,
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

export function normalizeGuestContact(rawContact) {
  const s = cleanStr(rawContact, 140).trim();
  if (!s) return "";
  if (s.includes("@")) return s.toLowerCase();
  const p = normalizePhone(s);
  return p.norm || s.toLowerCase();
}

export function buildContactVariants(rawNorm) {
  const clean = String(rawNorm || "").trim().toLowerCase();
  if (!clean) return [];
  if (clean.includes("@")) return [clean];
  const digits = clean.replace(/\D/g, "");
  if (digits.length < 8) return [clean];
  const set = new Set([digits]);
  if (digits.startsWith("0") && digits.length === 10) {
    set.add(`84${digits.slice(1)}`);
    set.add(`+84${digits.slice(1)}`);
  } else if (digits.startsWith("84") && digits.length === 11) {
    set.add(`0${digits.slice(2)}`);
    set.add(`+${digits}`);
  }
  return Array.from(set);
}

/**
 * Resolves the caller across Admin, Member, and Guest Chat Cookie contexts.
 */
export async function resolveChatActor(db, request) {
  await ensureChatAndCapabilitySchema(db);
  const cookies = parseCookies(request);
  const guestToken = String(cookies[GUEST_CHAT_COOKIE_NAME] || "").trim();
  const [adminUser, member, guestTokenHash] = await Promise.all([
    getSessionUser(db, request).catch(() => null),
    getSessionMember(db, request).catch(() => null),
    guestToken ? sha256Hex(guestToken) : Promise.resolve(""),
  ]);
  const companionEventIds = member
    ? await listMemberActiveEventIds(db, member.id, "event.companion")
    : [];
  const checkinEventIds = member
    ? await listMemberActiveEventIds(db, member.id, "event.checkin")
    : [];

  return {
    adminUser,
    member,
    guestToken,
    guestTokenHash,
    companionEventIds,
    checkinEventIds,
  };
}

export function createGuestChatToken() {
  return randomTokenHex(24);
}

/**
 * Automatically merges any unlinked guest chat threads matching a member's
 * normalized phone or email into that member's account.
 */
export async function mergeGuestThreadsToMember(db, member) {
  if (!db || !member?.id) return 0;
  await ensureChatAndCapabilitySchema(db);
  const variants = new Set();
  const email = String(member.email || "").trim().toLowerCase();
  if (email) variants.add(email);
  for (const v of buildContactVariants(member.phone_norm || member.phone_display || "")) {
    variants.add(v);
  }
  const list = Array.from(variants).filter(Boolean);
  if (!list.length) return 0;
  const placeholders = list.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const res = await db
    .prepare(
      `UPDATE chat_threads
       SET member_id = ?, updated_at = ?
       WHERE (member_id = '' OR member_id IS NULL)
         AND guest_contact_norm IN (${placeholders})`
    )
    .bind(member.id, now, ...list)
    .run()
    .catch(() => ({ meta: { changes: 0 } }));
  return Number(res?.meta?.changes || 0);
}

export async function getOrCreateMemberDirectThread(db, member, now = new Date().toISOString()) {
  await ensureChatAndCapabilitySchema(db);
  const existing = await db
    .prepare(
      `SELECT * FROM chat_threads
       WHERE kind = 'member_direct' AND member_id = ?
       ORDER BY last_message_at DESC
       LIMIT 1`
    )
    .bind(member.id)
    .first()
    .catch(() => null);
  if (existing) return existing;

  const id = `thr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db
    .prepare(
      `INSERT INTO chat_threads
       (id, kind, event_id, event_title, member_id, guest_name, guest_contact, guest_contact_norm,
        guest_token_hash, assigned_member_id, assigned_name, status, unread_admin, unread_member,
        last_message_preview, last_message_at, last_notified_member_at, last_notified_admin_at,
        created_at, updated_at)
       VALUES (?, 'member_direct', '', '', ?, ?, ?, ?, '', '', '', 'open', 0, 0, '', ?, '', '', ?, ?)`
    )
    .bind(
      id,
      member.id,
      member.name || "Thành viên Hola",
      member.phone_display || member.email || "",
      normalizeGuestContact(member.phone_norm || member.email || ""),
      now,
      now,
      now
    )
    .run();

  return db.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(id).first();
}

export async function canActorAccessThread(db, actor, thread) {
  if (!thread) return { allowed: false, role: "none" };
  if (actor.adminUser) {
    return { allowed: true, role: "admin" };
  }
  if (actor.member) {
    if (thread.member_id && thread.member_id === actor.member.id) {
      return { allowed: true, role: "member" };
    }
    if (thread.kind === "event_support" && thread.event_id) {
      const isCompanion =
        actor.companionEventIds.includes(thread.event_id) ||
        (await hasMemberCapability(db, actor.member.id, "event.companion", thread.event_id));
      if (isCompanion) {
        return { allowed: true, role: "companion" };
      }
    }
  }
  if (
    actor.guestTokenHash &&
    thread.guest_token_hash &&
    timingSafeEqualHex(actor.guestTokenHash, thread.guest_token_hash)
  ) {
    return { allowed: true, role: "guest" };
  }
  return { allowed: false, role: "none" };
}

export function serializeThreadForActor(row, viewerRole = "member") {
  if (!row) return null;
  const isStaff = viewerRole === "admin" || viewerRole === "companion";
  const base = {
    id: row.id,
    kind: row.kind || "member_direct",
    eventId: row.event_id || "",
    eventTitle: row.event_title || "",
    memberId: row.member_id || "",
    memberName: row.member_name || row.guest_name || "Khách tham dự",
    memberCode: row.member_code || "",
    memberAvatar: row.member_avatar || "",
    guestName: row.guest_name || "",
    assignedMemberId: row.assigned_member_id || "",
    assignedName: row.assigned_name || "",
    status: row.status || "open",
    unreadAdmin: Number(row.unread_admin || 0),
    unreadMember: Number(row.unread_member || 0),
    lastMessagePreview: row.last_message_preview || "",
    lastMessageAt: row.last_message_at || row.updated_at || row.created_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };

  // Nghị định 13 data minimization:
  // - Admin sees contact for coordination.
  // - Companion only sees masked contact (unless guest explicitly typed something in chat).
  if (viewerRole === "admin") {
    base.contact = row.member_phone || row.member_email || row.guest_contact || "";
    base.memberEmail = row.member_email || "";
  } else if (isStaff) {
    base.contact = "";
  }

  return base;
}

export function serializeMessageRow(row, isAdmin = false) {
  if (!row) return null;
  if (Number(row.is_internal || 0) === 1 && !isAdmin) return null;
  let payload = {};
  try {
    payload = row.payload_json ? JSON.parse(row.payload_json) : {};
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    threadId: row.thread_id,
    senderType: row.sender_type,
    senderId: row.sender_id || "",
    senderName: row.sender_name || "",
    msgKind: row.msg_kind || "text",
    body: row.body || "",
    payload,
    isInternal: Number(row.is_internal || 0) === 1,
    createdAt: row.created_at || "",
  };
}

export async function insertChatMessage(
  db,
  {
    threadId,
    senderType,
    senderId = "",
    senderName = "",
    msgKind = "text",
    body = "",
    payload = {},
    isInternal = false,
    now = new Date().toISOString(),
    updateThreadPreview = true,
  }
) {
  const id = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const cleanBody = cleanStr(body, 2000);
  const payloadJson = JSON.stringify(payload || {});

  await db
    .prepare(
      `INSERT INTO chat_messages
       (id, thread_id, sender_type, sender_id, sender_name, msg_kind, body, payload_json, is_internal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      threadId,
      senderType,
      cleanStr(senderId, 80),
      cleanStr(senderName, 120),
      msgKind,
      cleanBody,
      payloadJson,
      isInternal ? 1 : 0,
      now
    )
    .run();

  if (updateThreadPreview && !isInternal) {
    const preview = cleanBody.slice(0, 160);
    const isFromGuestOrMember = senderType === "guest" || senderType === "member";
    const nextStatus = isFromGuestOrMember ? "open" : "waiting_member";
    await db
      .prepare(
        `UPDATE chat_threads
         SET last_message_preview = ?,
             last_message_at = ?,
             updated_at = ?,
             status = ?,
             unread_admin = CASE WHEN ? = 1 THEN unread_admin + 1 ELSE unread_admin END,
             unread_member = CASE WHEN ? = 0 THEN unread_member + 1 ELSE unread_member END
         WHERE id = ?`
      )
      .bind(
        preview,
        now,
        now,
        nextStatus,
        isFromGuestOrMember ? 1 : 0,
        isFromGuestOrMember ? 1 : 0,
        threadId
      )
      .run();
  } else if (isInternal) {
    await db
      .prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?")
      .bind(now, threadId)
      .run();
  }

  return db.prepare("SELECT * FROM chat_messages WHERE id = ?").bind(id).first();
}

/**
 * Anti-spam offline email alert (max 1 email per thread per 6h per direction).
 */
export async function maybeSendOfflineChatEmail(
  env,
  {
    thread,
    direction = "to_member", // 'to_member' | 'to_admin'
    recipientEmail,
    recipientName = "",
    senderName = "HolaRise",
    preview = "",
    actionUrl = "https://holarise.org/tham-gia/#hop-thoai",
    fetchImpl = fetch,
  }
) {
  if (!env?.DB || !thread?.id || !recipientEmail) return { skipped: true, reason: "missing_recipient" };
  const lastField = direction === "to_admin" ? "last_notified_admin_at" : "last_notified_member_at";
  const lastSentStr = String(thread[lastField] || "").trim();
  if (lastSentStr) {
    const elapsed = Date.now() - Date.parse(lastSentStr);
    if (Number.isFinite(elapsed) && elapsed < OFFLINE_EMAIL_COOLDOWN_MS) {
      return { skipped: true, reason: "cooldown" };
    }
  }

  const safeSender = escapeHtml(senderName || "HolaRise");
  const safeRecipient = escapeHtml(recipientName || "bạn");
  const safePreview = escapeHtml(cleanStr(preview, 240));
  const safeUrl = escapeHtml(actionUrl);
  const subject =
    direction === "to_admin"
      ? `[HolaRise Desk] Tin nhắn mới từ ${cleanStr(senderName, 60)}`
      : `${cleanStr(senderName, 60)} vừa nhắn cho bạn trên HolaRise`;

  const html = `<!doctype html><html lang="vi"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f5ef;padding:24px;color:#1b2620;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3dfd3;border-radius:14px;padding:24px;">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#4f6858;">HOLARISE · HỘP THOẠI ĐỒNG HÀNH</p>
    <h2 style="margin:0 0 12px;font-size:19px;color:#16251d;">Chào ${safeRecipient},</h2>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;"><strong>${safeSender}</strong> vừa gửi một cập nhật mới cho bạn:</p>
    <blockquote style="margin:0 0 18px;padding:12px 14px;background:#f4f7f2;border-left:3px solid #2d5a3f;border-radius:6px;font-size:14px;line-height:1.55;">${safePreview}</blockquote>
    <a href="${safeUrl}" style="display:inline-block;background:#1f4a33;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:14px;font-weight:600;">Mở hộp thoại ngay →</a>
    <p style="margin:18px 0 0;font-size:12px;color:#6c7770;">HolaRise — Cộng đồng Thanh niên Hòa Lạc · holarise.org</p>
  </div></body></html>`;

  const text = `Chào ${recipientName || "bạn"},\n\n${senderName} vừa gửi một tin nhắn mới trên HolaRise:\n"${cleanStr(preview, 240)}"\n\nMở hộp thoại: ${actionUrl}`;

  const result = await sendTransactionalEmail(env, {
    to: recipientEmail,
    subject,
    html,
    text,
    fetchImpl,
  }).catch((err) => ({ ok: false, error: String(err?.message || err) }));

  if (result?.ok) {
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE chat_threads SET ${lastField} = ? WHERE id = ?`)
      .bind(now, thread.id)
      .run()
      .catch(() => {});
  }
  return result;
}
