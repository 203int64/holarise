import {
  ensureChatAndCapabilitySchema,
  listMemberCapabilities,
} from "../../_lib/capabilities.js";
import {
  canActorAccessThread,
  insertChatMessage,
  maybeSendOfflineChatEmail,
  resolveChatActor,
  serializeMessageRow,
  serializeThreadForActor,
} from "../../_lib/chat.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr } from "../../_lib/validation.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa sẵn sàng.");
  }

  await ensureChatAndCapabilitySchema(env.DB);
  const url = new URL(request.url);
  const threadId = cleanStr(url.searchParams.get("threadId") || "", 80);
  const since = cleanStr(url.searchParams.get("since") || "", 40);
  const peek = url.searchParams.get("peek") === "1";

  if (!threadId) {
    return errorResponse(400, "MISSING_THREAD_ID", "Thiếu mã hộp thoại.");
  }

  const thread = await env.DB.prepare(
    `SELECT t.*,
            m.name AS member_name,
            m.member_code AS member_code,
            m.avatar_url AS member_avatar,
            m.phone_display AS member_phone,
            m.email AS member_email
     FROM chat_threads t
     LEFT JOIN members m ON m.id = t.member_id
     WHERE t.id = ?`
  )
    .bind(threadId)
    .first()
    .catch(() => null);

  if (!thread) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy hộp thoại.");
  }

  const actor = await resolveChatActor(env.DB, request);
  const access = await canActorAccessThread(env.DB, actor, thread);
  if (!access.allowed) {
    return errorResponse(403, "FORBIDDEN", "Bạn không có quyền xem hộp thoại này.");
  }

  const isAdmin = access.role === "admin";
  const isStaff = isAdmin || access.role === "companion";

  // Build query (incremental ?since= for ultra-lightweight smart polling)
  let msgQuery = `SELECT * FROM chat_messages WHERE thread_id = ?`;
  const params = [threadId];
  if (!isAdmin) {
    msgQuery += " AND is_internal = 0";
  }
  if (since) {
    msgQuery += " AND created_at > ?";
    params.push(since);
  }
  msgQuery += " ORDER BY created_at ASC LIMIT 120";

  const [msgsRes, memberCaps] = await Promise.all([
    env.DB.prepare(msgQuery).bind(...params).all().catch(() => ({ results: [] })),
    thread.member_id
      ? listMemberCapabilities(env.DB, thread.member_id, { includeInactive: true })
      : Promise.resolve([]),
  ]);

  const capMap = new Map(memberCaps.map((c) => [c.id, c]));

  const messages = (msgsRes.results || [])
    .map((r) => serializeMessageRow(r, isAdmin))
    .filter(Boolean)
    .map((m) => {
      if (m.msgKind === "capability_card" && m.payload?.capabilityId) {
        const liveCap = capMap.get(m.payload.capabilityId);
        if (liveCap) {
          return {
            ...m,
            payload: {
              ...m.payload,
              liveStatus: liveCap.status,
              expiresAt: liveCap.expiresAt,
              consentAcceptedAt: liveCap.consentAcceptedAt,
              revokedAt: liveCap.revokedAt,
            },
          };
        }
      }
      return m;
    });

  // Clear unread counter on read (unless peek=1)
  if (!peek) {
    if (isStaff && Number(thread.unread_admin || 0) > 0) {
      await env.DB.prepare("UPDATE chat_threads SET unread_admin = 0 WHERE id = ?")
        .bind(threadId)
        .run()
        .catch(() => {});
      thread.unread_admin = 0;
    } else if (!isStaff && Number(thread.unread_member || 0) > 0) {
      await env.DB.prepare("UPDATE chat_threads SET unread_member = 0 WHERE id = ?")
        .bind(threadId)
        .run()
        .catch(() => {});
      thread.unread_member = 0;
    }
  }

  return jsonResponse({
    ok: true,
    viewerRole: access.role,
    thread: serializeThreadForActor(thread, access.role),
    messages,
    capabilities: thread.member_id ? memberCaps.filter((c) => c.status === "active" || c.status === "pending_accept") : [],
    serverTime: new Date().toISOString(),
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

  await ensureChatAndCapabilitySchema(env.DB);
  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};

  const threadId = cleanStr(d.threadId || "", 80);
  const body = cleanStr(d.body || "", 2000);
  if (!threadId) return errorResponse(400, "MISSING_THREAD_ID", "Thiếu mã hộp thoại.");
  if (!body) return errorResponse(400, "EMPTY_MESSAGE", "Vui lòng nhập nội dung tin nhắn.");

  const thread = await env.DB.prepare(
    `SELECT t.*,
            m.name AS member_name,
            m.email AS member_email,
            m.phone_display AS member_phone
     FROM chat_threads t
     LEFT JOIN members m ON m.id = t.member_id
     WHERE t.id = ?`
  )
    .bind(threadId)
    .first()
    .catch(() => null);

  if (!thread) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy hộp thoại.");
  }

  const actor = await resolveChatActor(env.DB, request);
  const access = await canActorAccessThread(env.DB, actor, thread);
  if (!access.allowed) {
    return errorResponse(403, "FORBIDDEN", "Bạn không có quyền gửi tin nhắn vào hộp thoại này.");
  }

  // Rate limit per actor
  const ipHash = await getClientIpHash(request);
  const rlKey =
    access.role === "admin"
      ? `chat_post_adm:${actor.adminUser.id}`
      : access.role === "member" || access.role === "companion"
        ? `chat_post_mbr:${actor.member.id}`
        : `chat_post_ip:${ipHash}`;
  const rl = await checkRateLimit(env.DB, rlKey, 40, 10 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Bạn gửi tin nhắn hơi nhanh, vui lòng đợi một lát.");
  }

  // Only Admin can post internal whisper notes (strictly blocked for member/companion/guest)
  const isInternal = access.role === "admin" && Boolean(d.isInternal);
  const now = new Date().toISOString();

  let senderType = access.role;
  let senderId = "";
  let senderName = "";

  if (access.role === "admin") {
    senderId = actor.adminUser.id;
    senderName = actor.adminUser.name || "Ban Điều phối HolaRise";
  } else if (access.role === "companion") {
    senderId = actor.member.id;
    senderName = actor.member.name || "Người đồng hành";
  } else if (access.role === "member") {
    senderId = actor.member.id;
    senderName = actor.member.name || "Thành viên Hola";
  } else {
    senderId = `guest:${actor.guestTokenHash.slice(0, 12)}`;
    senderName = thread.guest_name || "Khách tham dự";
  }

  const msg = await insertChatMessage(env.DB, {
    threadId,
    senderType,
    senderId,
    senderName,
    msgKind: "text",
    body,
    isInternal,
    now,
  });

  // Auto-claim thread when a companion sends the first reply
  if (access.role === "companion" && !thread.assigned_member_id) {
    await env.DB.prepare("UPDATE chat_threads SET assigned_member_id = ?, assigned_name = ? WHERE id = ?")
      .bind(actor.member.id, senderName, threadId)
      .run()
      .catch(() => {});
  }

  // Offline email escalation (respecting 6h anti-spam cooldown)
  if (!isInternal) {
    if ((access.role === "admin" || access.role === "companion") && thread.member_email) {
      await maybeSendOfflineChatEmail(env, {
        thread,
        direction: "to_member",
        recipientEmail: thread.member_email,
        recipientName: thread.member_name || thread.guest_name,
        senderName,
        preview: body,
        actionUrl: "https://holarise.org/tham-gia/#hop-thoai",
      }).catch(() => {});
    } else if (access.role === "member" || access.role === "guest") {
      const alertEmail = cleanStr(env.CHAT_ALERT_EMAIL || env.ADMIN_ALERT_EMAIL || "", 160);
      if (alertEmail) {
        await maybeSendOfflineChatEmail(env, {
          thread,
          direction: "to_admin",
          recipientEmail: alertEmail,
          recipientName: "Ban Điều phối",
          senderName,
          preview: body,
          actionUrl: "https://holarise.org/admin/#inbox",
        }).catch(() => {});
      }
    }
  }

  return jsonResponse(
    {
      ok: true,
      message: serializeMessageRow(msg, access.role === "admin"),
    },
    201
  );
}
