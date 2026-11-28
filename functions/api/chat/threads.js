import {
  ensureChatAndCapabilitySchema,
  listEventCompanions,
  listMemberCapabilities,
} from "../../_lib/capabilities.js";
import {
  buildGuestChatCookie,
  createGuestChatToken,
  getOrCreateMemberDirectThread,
  insertChatMessage,
  maybeSendOfflineChatEmail,
  mergeGuestThreadsToMember,
  normalizeGuestContact,
  resolveChatActor,
  serializeThreadForActor,
} from "../../_lib/chat.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  sha256Hex,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";
import { cleanStr } from "../../_lib/validation.js";

const VALID_THREAD_STATUSES = new Set(["open", "waiting_member", "resolved"]);

async function fetchEnrichedThreadById(db, threadId) {
  return db
    .prepare(
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
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa sẵn sàng.");
  }

  await ensureChatAndCapabilitySchema(env.DB);
  const url = new URL(request.url);
  const scope = cleanStr(url.searchParams.get("scope") || "auto", 24).toLowerCase();

  // 1. Admin unified inbox
  if (scope === "admin") {
    const auth = await requireAdmin(context, { permission: "inbox.read" });
    if (!auth.ok) return auth.response;

    const kind = cleanStr(url.searchParams.get("kind") || "", 24);
    const status = cleanStr(url.searchParams.get("status") || "", 24);
    const eventId = cleanStr(url.searchParams.get("eventId") || "", 120);
    const memberId = cleanStr(url.searchParams.get("memberId") || "", 80);

    const where = ["1=1"];
    const params = [];
    if (kind === "event_support" || kind === "member_direct") {
      where.push("t.kind = ?");
      params.push(kind);
    }
    if (VALID_THREAD_STATUSES.has(status)) {
      where.push("t.status = ?");
      params.push(status);
    }
    if (eventId) {
      where.push("t.event_id = ?");
      params.push(eventId);
    }
    if (memberId) {
      where.push("t.member_id = ?");
      params.push(memberId);
    }

    const [threadsRes, eventsRes, albumsRes, membersRes] = await Promise.all([
      env.DB.prepare(
        `SELECT t.*,
                m.name AS member_name,
                m.member_code AS member_code,
                m.avatar_url AS member_avatar,
                m.phone_display AS member_phone,
                m.email AS member_email
         FROM chat_threads t
         LEFT JOIN members m ON m.id = t.member_id
         WHERE ${where.join(" AND ")}
         ORDER BY CASE WHEN t.unread_admin > 0 THEN 0 ELSE 1 END, t.last_message_at DESC
         LIMIT 120`
      )
        .bind(...params)
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare("SELECT id, title, date, status FROM events ORDER BY date DESC, created_at DESC LIMIT 60")
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare("SELECT id, slug, title, visibility FROM media_albums ORDER BY created_at DESC LIMIT 60")
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare(
        "SELECT id, member_code, name, phone_display, email, organization FROM members WHERE is_active = 1 ORDER BY created_at DESC LIMIT 120"
      )
        .all()
        .catch(() => ({ results: [] })),
    ]);

    const threads = (threadsRes.results || []).map((r) => serializeThreadForActor(r, "admin"));
    const unreadTotal = threads.reduce((sum, t) => sum + (t.unreadAdmin > 0 ? 1 : 0), 0);

    return jsonResponse({
      ok: true,
      scope: "admin",
      adminRole: auth.user.role,
      unreadTotal,
      threads,
      grantOptions: {
        events: eventsRes.results || [],
        albums: albumsRes.results || [],
        members: (membersRes.results || []).map((m) => ({
          id: m.id,
          memberCode: m.member_code,
          name: m.name,
          phoneDisplay: m.phone_display || "",
          email: m.email || "",
          organization: m.organization || "",
        })),
      },
    });
  }

  const actor = await resolveChatActor(env.DB, request);

  // 2. Public/Event companion check & caller's thread for one specific event
  if (scope === "event") {
    const eventId = cleanStr(url.searchParams.get("eventId") || "", 120);
    if (!eventId) {
      return errorResponse(400, "MISSING_EVENT_ID", "Thiếu mã sự kiện.");
    }
    const companions = await listEventCompanions(env.DB, eventId);
    let myThread = null;
    if (actor.member) {
      await mergeGuestThreadsToMember(env.DB, actor.member);
      const row = await env.DB.prepare(
        `SELECT t.*, m.name AS member_name, m.member_code AS member_code, m.avatar_url AS member_avatar
         FROM chat_threads t
         LEFT JOIN members m ON m.id = t.member_id
         WHERE t.kind = 'event_support' AND t.event_id = ? AND t.member_id = ?
         ORDER BY t.last_message_at DESC
         LIMIT 1`
      )
        .bind(eventId, actor.member.id)
        .first()
        .catch(() => null);
      if (row) myThread = serializeThreadForActor(row, "member");
    } else if (actor.guestTokenHash) {
      const row = await env.DB.prepare(
        `SELECT * FROM chat_threads
         WHERE kind = 'event_support' AND event_id = ? AND guest_token_hash = ?
         ORDER BY last_message_at DESC
         LIMIT 1`
      )
        .bind(eventId, actor.guestTokenHash)
        .first()
        .catch(() => null);
      if (row) myThread = serializeThreadForActor(row, "guest");
    }

    return jsonResponse({
      ok: true,
      scope: "event",
      eventId,
      companions,
      isMember: Boolean(actor.member),
      memberName: actor.member?.name || "",
      thread: myThread,
    });
  }

  // 3. Companion inbox (only threads for events where member has active `event.companion`)
  if (scope === "companion") {
    if (!actor.member) {
      return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên.");
    }
    if (!actor.companionEventIds.length) {
      return jsonResponse({ ok: true, scope: "companion", eventIds: [], threads: [] });
    }
    const placeholders = actor.companionEventIds.map(() => "?").join(", ");
    const res = await env.DB.prepare(
      `SELECT t.*, m.name AS member_name, m.member_code AS member_code, m.avatar_url AS member_avatar
       FROM chat_threads t
       LEFT JOIN members m ON m.id = t.member_id
       WHERE t.kind = 'event_support' AND t.event_id IN (${placeholders})
       ORDER BY CASE WHEN t.unread_admin > 0 THEN 0 ELSE 1 END, t.last_message_at DESC
       LIMIT 80`
    )
      .bind(...actor.companionEventIds)
      .all()
      .catch(() => ({ results: [] }));

    return jsonResponse({
      ok: true,
      scope: "companion",
      eventIds: actor.companionEventIds,
      threads: (res.results || []).map((r) => serializeThreadForActor(r, "companion")),
    });
  }

  // 4. Default: Member's own threads + capabilities (+ companion threads summary)
  if (!actor.member) {
    if (actor.guestTokenHash) {
      const guestRes = await env.DB.prepare(
        `SELECT * FROM chat_threads WHERE guest_token_hash = ? ORDER BY last_message_at DESC LIMIT 20`
      )
        .bind(actor.guestTokenHash)
        .all()
        .catch(() => ({ results: [] }));
      return jsonResponse({
        ok: true,
        scope: "guest",
        threads: (guestRes.results || []).map((r) => serializeThreadForActor(r, "guest")),
        capabilities: [],
        companionThreads: [],
      });
    }
    return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập để mở hộp thoại thành viên.");
  }

  await mergeGuestThreadsToMember(env.DB, actor.member);
  const directThread = await getOrCreateMemberDirectThread(env.DB, actor.member);

  const [ownRes, capabilities] = await Promise.all([
    env.DB.prepare(
      `SELECT t.*, m.name AS member_name, m.member_code AS member_code, m.avatar_url AS member_avatar
       FROM chat_threads t
       LEFT JOIN members m ON m.id = t.member_id
       WHERE t.member_id = ?
       ORDER BY CASE WHEN t.kind = 'member_direct' THEN 0 ELSE 1 END, t.last_message_at DESC
       LIMIT 40`
    )
      .bind(actor.member.id)
      .all()
      .catch(() => ({ results: [] })),
    listMemberCapabilities(env.DB, actor.member.id, { includeInactive: false }),
  ]);

  let companionThreads = [];
  if (actor.companionEventIds.length) {
    const placeholders = actor.companionEventIds.map(() => "?").join(", ");
    const cRes = await env.DB.prepare(
      `SELECT t.*, m.name AS member_name, m.member_code AS member_code, m.avatar_url AS member_avatar
       FROM chat_threads t
       LEFT JOIN members m ON m.id = t.member_id
       WHERE t.kind = 'event_support' AND t.event_id IN (${placeholders})
       ORDER BY CASE WHEN t.unread_admin > 0 THEN 0 ELSE 1 END, t.last_message_at DESC
       LIMIT 60`
    )
      .bind(...actor.companionEventIds)
      .all()
      .catch(() => ({ results: [] }));
    companionThreads = (cRes.results || []).map((r) => serializeThreadForActor(r, "companion"));
  }

  return jsonResponse({
    ok: true,
    scope: "member",
    directThreadId: directThread?.id || "",
    threads: (ownRes.results || []).map((r) => serializeThreadForActor(r, "member")),
    capabilities,
    companionEventIds: actor.companionEventIds,
    checkinEventIds: actor.checkinEventIds,
    companionThreads,
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

  const kind = cleanStr(d.kind || "event_support", 24);
  if (kind !== "event_support" && kind !== "member_direct") {
    return errorResponse(400, "INVALID_KIND", "Loại hộp thoại không hợp lệ.");
  }

  const actor = await resolveChatActor(env.DB, request);
  const now = new Date().toISOString();
  const body = cleanStr(d.body || "", 2000);

  // Case A: Admin initiating/opening a direct thread with a member (with optional context card)
  if (kind === "member_direct" && actor.adminUser && d.memberId) {
    const memberId = cleanStr(d.memberId, 80);
    const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first();
    if (!member) {
      return errorResponse(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên.");
    }

    // Nghị định 13 guard: never link anonymous feedback into a named member thread
    let contextPayload = null;
    if (d.contextCard && typeof d.contextCard === "object") {
      const refType = cleanStr(d.contextCard.type, 32);
      const refId = cleanStr(d.contextCard.id, 80);
      if (refType === "event_feedback" && refId) {
        const fb = await env.DB.prepare("SELECT is_anonymous, content, event_title FROM event_feedbacks WHERE id = ?")
          .bind(refId)
          .first()
          .catch(() => null);
        if (fb && Number(fb.is_anonymous || 0) === 1) {
          return errorResponse(
            403,
            "ANONYMOUS_PROTECTED",
            "Không thể gắn góp ý ẩn danh vào hộp thoại định danh của thành viên."
          );
        }
      }
      contextPayload = {
        type: refType || "note",
        id: refId,
        title: cleanStr(d.contextCard.title, 180),
        excerpt: cleanStr(d.contextCard.excerpt, 300),
        href: cleanStr(d.contextCard.href, 300),
      };
    }

    const thread = await getOrCreateMemberDirectThread(env.DB, member, now);
    let message = null;
    if (contextPayload || body) {
      message = await insertChatMessage(env.DB, {
        threadId: thread.id,
        senderType: "admin",
        senderId: actor.adminUser.id,
        senderName: actor.adminUser.name || "Ban Điều phối HolaRise",
        msgKind: contextPayload ? "context_card" : "text",
        body: body || contextPayload?.title || "Ban Điều phối gửi phản hồi cho bạn.",
        payload: contextPayload || {},
        isInternal: false,
        now,
      });
      if (member.email) {
        await maybeSendOfflineChatEmail(env, {
          thread,
          direction: "to_member",
          recipientEmail: member.email,
          recipientName: member.name,
          senderName: actor.adminUser.name || "HolaRise",
          preview: body || contextPayload?.title || "Bạn có tin nhắn mới từ HolaRise.",
        }).catch(() => {});
      }
    }

    const enriched = await fetchEnrichedThreadById(env.DB, thread.id);
    return jsonResponse(
      {
        ok: true,
        thread: serializeThreadForActor(enriched || thread, "admin"),
        message: message
          ? {
              id: message.id,
              threadId: message.thread_id,
              senderType: message.sender_type,
              senderName: message.sender_name,
              msgKind: message.msg_kind,
              body: message.body,
              createdAt: message.created_at,
            }
          : null,
      },
      201
    );
  }

  // Case B: Member opening their own direct thread
  if (kind === "member_direct") {
    if (!actor.member) {
      return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên.");
    }
    const thread = await getOrCreateMemberDirectThread(env.DB, actor.member, now);
    let message = null;
    if (body) {
      const rl = await checkRateLimit(env.DB, `chat_msg_mbr:${actor.member.id}`, 30, 10 * 60 * 1000);
      if (!rl.allowed) {
        return errorResponse(429, "RATE_LIMITED", "Bạn gửi tin nhắn hơi nhanh, vui lòng đợi một lát.");
      }
      message = await insertChatMessage(env.DB, {
        threadId: thread.id,
        senderType: "member",
        senderId: actor.member.id,
        senderName: actor.member.name,
        msgKind: "text",
        body,
        now,
      });
    }
    const enriched = await fetchEnrichedThreadById(env.DB, thread.id);
    return jsonResponse({ ok: true, thread: serializeThreadForActor(enriched || thread, "member"), message }, 201);
  }

  // Case C: Event Support thread (Guest without login wall OR logged-in Member)
  const eventId = cleanStr(d.eventId || d.event_id, 120);
  if (!eventId) {
    return errorResponse(400, "MISSING_EVENT_ID", "Thiếu mã sự kiện cần hỏi.");
  }
  const ev = await env.DB.prepare("SELECT id, title FROM events WHERE id = ? LIMIT 1")
    .bind(eventId)
    .first()
    .catch(() => null);
  if (!ev) {
    return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện này.");
  }

  if (!body || body.length < 2) {
    return errorResponse(400, "EMPTY_MESSAGE", "Vui lòng nhập câu hỏi ngắn cho người đón bạn.");
  }

  const extraHeaders = {};
  let thread = null;
  let senderType = "guest";
  let senderId = "";
  let senderName = "";

  if (actor.member) {
    const rl = await checkRateLimit(env.DB, `chat_ev_mbr:${actor.member.id}`, 20, 15 * 60 * 1000);
    if (!rl.allowed) {
      return errorResponse(429, "RATE_LIMITED", "Bạn gửi nhiều tin nhắn liên tiếp, vui lòng thử lại sau ít phút.");
    }
    senderType = "member";
    senderId = actor.member.id;
    senderName = actor.member.name || "Thành viên Hola";

    thread = await env.DB.prepare(
      `SELECT * FROM chat_threads
       WHERE kind = 'event_support' AND event_id = ? AND member_id = ?
       ORDER BY last_message_at DESC
       LIMIT 1`
    )
      .bind(ev.id, actor.member.id)
      .first()
      .catch(() => null);

    if (!thread) {
      const id = `thr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await env.DB.prepare(
        `INSERT INTO chat_threads
         (id, kind, event_id, event_title, member_id, guest_name, guest_contact, guest_contact_norm,
          guest_token_hash, assigned_member_id, assigned_name, status, unread_admin, unread_member,
          last_message_preview, last_message_at, last_notified_member_at, last_notified_admin_at,
          created_at, updated_at)
         VALUES (?, 'event_support', ?, ?, ?, ?, ?, ?, '', '', '', 'open', 0, 0, '', ?, '', '', ?, ?)`
      )
        .bind(
          id,
          ev.id,
          ev.title,
          actor.member.id,
          senderName,
          actor.member.phone_display || actor.member.email || "",
          normalizeGuestContact(actor.member.phone_norm || actor.member.email || ""),
          now,
          now,
          now
        )
        .run();
      thread = await env.DB.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(id).first();
    }
  } else {
    // Guest flow — NO login wall, protected by Turnstile + rate limit + HttpOnly guest token
    const tsToken = d["cf-turnstile-response"] ?? d.turnstileToken ?? "";
    const tsCheck = await verifyTurnstileToken(request, env, tsToken, "event_chat");
    if (!tsCheck.ok) {
      return errorResponse(
        403,
        tsCheck.code || "TURNSTILE_FAILED",
        "Xác minh chống bot chưa thành công. Vui lòng tải lại trang và thử lại."
      );
    }

    const ipHash = await getClientIpHash(request);
    const rl = await checkRateLimit(env.DB, `chat_ev_ip:${ipHash}`, 12, 15 * 60 * 1000);
    if (!rl.allowed) {
      return errorResponse(429, "RATE_LIMITED", "Bạn gửi nhiều tin nhắn liên tiếp, vui lòng thử lại sau ít phút.");
    }

    const guestName = cleanStr(d.guestName || d.name || "", 80);
    const guestContact = cleanStr(d.guestContact || d.contact || d.phone || "", 120);
    if (guestName.length < 2) {
      return errorResponse(400, "MISSING_NAME", "Vui lòng nhập tên gọi của bạn để người đón tiện xưng hô.", {
        guestName: "Vui lòng nhập tên gọi (tối thiểu 2 ký tự).",
      });
    }
    if (guestContact.length < 6) {
      return errorResponse(400, "MISSING_CONTACT", "Vui lòng nhập số Zalo hoặc email để chúng mình hỗ trợ bạn.", {
        guestContact: "Vui lòng nhập số điện thoại Zalo hoặc email.",
      });
    }

    let token = actor.guestToken;
    let tokenHash = actor.guestTokenHash;
    if (!token) {
      token = createGuestChatToken();
      tokenHash = await sha256Hex(token);
      extraHeaders["Set-Cookie"] = buildGuestChatCookie(token, request, false);
    }

    senderType = "guest";
    senderId = `guest:${tokenHash.slice(0, 12)}`;
    senderName = guestName;

    thread = await env.DB.prepare(
      `SELECT * FROM chat_threads
       WHERE kind = 'event_support' AND event_id = ? AND guest_token_hash = ?
       ORDER BY last_message_at DESC
       LIMIT 1`
    )
      .bind(ev.id, tokenHash)
      .first()
      .catch(() => null);

    if (!thread) {
      const id = `thr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await env.DB.prepare(
        `INSERT INTO chat_threads
         (id, kind, event_id, event_title, member_id, guest_name, guest_contact, guest_contact_norm,
          guest_token_hash, assigned_member_id, assigned_name, status, unread_admin, unread_member,
          last_message_preview, last_message_at, last_notified_member_at, last_notified_admin_at,
          created_at, updated_at)
         VALUES (?, 'event_support', ?, ?, '', ?, ?, ?, ?, '', '', 'open', 0, 0, '', ?, '', '', ?, ?)`
      )
        .bind(
          id,
          ev.id,
          ev.title,
          guestName,
          guestContact,
          normalizeGuestContact(guestContact),
          tokenHash,
          now,
          now,
          now
        )
        .run();
      thread = await env.DB.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(id).first();
    }
  }

  const msg = await insertChatMessage(env.DB, {
    threadId: thread.id,
    senderType,
    senderId,
    senderName,
    msgKind: "text",
    body,
    now,
  });

  // Notify configured admin alert email (or first super_admin email) with 6h cooldown
  const alertEmail =
    cleanStr(env.CHAT_ALERT_EMAIL || env.ADMIN_ALERT_EMAIL || "", 160) ||
    (
      await env.DB.prepare("SELECT email FROM admin_users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1")
        .first()
        .catch(() => null)
    )?.email ||
    "";

  if (alertEmail) {
    await maybeSendOfflineChatEmail(env, {
      thread,
      direction: "to_admin",
      recipientEmail: alertEmail,
      recipientName: "Ban Điều phối",
      senderName: `${senderName} (${ev.title})`,
      preview: body,
      actionUrl: "https://holarise.org/admin/#inbox",
    }).catch(() => {});
  }

  const refreshed = await fetchEnrichedThreadById(env.DB, thread.id);
  return jsonResponse(
    {
      ok: true,
      thread: serializeThreadForActor(refreshed || thread, actor.member ? "member" : "guest"),
      message: {
        id: msg.id,
        threadId: msg.thread_id,
        senderType: msg.sender_type,
        senderName: msg.sender_name,
        msgKind: msg.msg_kind,
        body: msg.body,
        createdAt: msg.created_at,
      },
    },
    201,
    extraHeaders
  );
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa sẵn sàng.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi yêu cầu không hợp lệ.");
  }

  await ensureChatAndCapabilitySchema(env.DB);
  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};
  const threadId = cleanStr(d.threadId || d.id, 80);
  if (!threadId) return errorResponse(400, "MISSING_THREAD_ID", "Thiếu mã hộp thoại.");

  const thread = await env.DB.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(threadId).first();
  if (!thread) return errorResponse(404, "NOT_FOUND", "Không tìm thấy hộp thoại.");

  const actor = await resolveChatActor(env.DB, request);
  const isCompanionForThread =
    Boolean(actor.member) &&
    thread.kind === "event_support" &&
    actor.companionEventIds.includes(thread.event_id);

  if (!actor.adminUser && !isCompanionForThread) {
    return errorResponse(403, "FORBIDDEN", "Bạn không có quyền cập nhật hộp thoại này.");
  }

  const now = new Date().toISOString();
  let nextStatus = thread.status;
  if (d.status && VALID_THREAD_STATUSES.has(cleanStr(d.status, 24))) {
    nextStatus = cleanStr(d.status, 24);
  }

  let nextAssignedId = thread.assigned_member_id || "";
  let nextAssignedName = thread.assigned_name || "";
  if (d.claim === true) {
    if (actor.adminUser) {
      nextAssignedId = actor.adminUser.id;
      nextAssignedName = actor.adminUser.name || "BTC";
    } else if (actor.member) {
      nextAssignedId = actor.member.id;
      nextAssignedName = actor.member.name || "Người đồng hành";
    }
  } else if (d.unclaim === true && actor.adminUser) {
    nextAssignedId = "";
    nextAssignedName = "";
  }

  await env.DB.prepare(
    `UPDATE chat_threads
     SET status = ?, assigned_member_id = ?, assigned_name = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(nextStatus, nextAssignedId, nextAssignedName, now, threadId)
    .run();

  const updated = await fetchEnrichedThreadById(env.DB, threadId);
  return jsonResponse({
    ok: true,
    thread: serializeThreadForActor(updated || thread, actor.adminUser ? "admin" : "companion"),
  });
}
