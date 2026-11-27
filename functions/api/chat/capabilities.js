import {
  canAdminGrantCapability,
  CAPABILITY_META,
  computeDefaultExpiry,
  computeEffectiveStatus,
  ensureChatAndCapabilitySchema,
  listMemberCapabilities,
  RESPONSIBILITY_CAPABILITIES,
  serializeCapabilityRow,
  syncLegacyMediaGrantState,
  VALID_CAPABILITIES,
} from "../../_lib/capabilities.js";
import {
  getOrCreateMemberDirectThread,
  insertChatMessage,
  maybeSendOfflineChatEmail,
  resolveChatActor,
} from "../../_lib/chat.js";
import { resolveEventSlug } from "../../_lib/render.js";
import {
  errorResponse,
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
  const actor = await resolveChatActor(env.DB, request);
  const url = new URL(request.url);
  const requestedMemberId = cleanStr(url.searchParams.get("memberId") || "", 80);
  const includeInactive = url.searchParams.get("all") === "1";

  if (actor.adminUser) {
    if (requestedMemberId) {
      const items = await listMemberCapabilities(env.DB, requestedMemberId, { includeInactive: true });
      return jsonResponse({ ok: true, memberId: requestedMemberId, capabilities: items });
    }
    const eventId = cleanStr(url.searchParams.get("eventId") || "", 120);
    const where = ["1=1"];
    const params = [];
    if (eventId) {
      where.push("c.scope_type = 'event' AND c.scope_id = ?");
      params.push(eventId);
    }
    const nowIso = new Date().toISOString();
    const res = await env.DB.prepare(
      `SELECT c.*,
              m.name AS member_name,
              m.member_code AS member_code,
              m.avatar_url AS member_avatar,
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
       LEFT JOIN members m ON m.id = c.member_id
       LEFT JOIN events e ON c.scope_type = 'event' AND e.id = c.scope_id
       LEFT JOIN media_albums a ON c.scope_type = 'album' AND a.id = c.scope_id
       WHERE ${where.join(" AND ")}
       ORDER BY c.created_at DESC
       LIMIT 100`
    )
      .bind(...params)
      .all()
      .catch(() => ({ results: [] }));

    return jsonResponse({
      ok: true,
      capabilities: (res.results || []).map((row) => ({
        ...serializeCapabilityRow(row, nowIso),
        memberName: row.member_name || "",
        memberCode: row.member_code || "",
        memberAvatar: row.member_avatar || "",
      })),
    });
  }

  if (!actor.member) {
    return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên.");
  }

  const items = await listMemberCapabilities(env.DB, actor.member.id, { includeInactive });
  return jsonResponse({ ok: true, memberId: actor.member.id, capabilities: items });
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
  const parsed = await readJsonBody(request, 24 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};
  const action = cleanStr(d.action || "", 24).toLowerCase();
  const actor = await resolveChatActor(env.DB, request);
  const now = new Date().toISOString();

  // 1. GRANT a scoped capability inside chat (Admin only, Delegation Matrix enforced)
  if (action === "grant") {
    if (!actor.adminUser) {
      return errorResponse(403, "ADMIN_REQUIRED", "Chỉ Ban Điều phối mới có quyền trao quyền.");
    }
    const memberId = cleanStr(d.memberId || "", 80);
    const capability = cleanStr(d.capability || "", 40);
    if (!memberId) return errorResponse(400, "MISSING_MEMBER", "Vui lòng chọn thành viên nhận quyền.");
    if (!VALID_CAPABILITIES.has(capability)) {
      return errorResponse(400, "INVALID_CAPABILITY", "Loại quyền không hợp lệ.");
    }
    if (!canAdminGrantCapability(actor.adminUser, capability)) {
      return errorResponse(
        403,
        "DELEGATION_DENIED",
        `Vai trò '${actor.adminUser.role}' không được phép trao quyền '${capability}'.`
      );
    }

    const member = await env.DB.prepare("SELECT * FROM members WHERE id = ? AND is_active = 1")
      .bind(memberId)
      .first();
    if (!member) {
      return errorResponse(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên đang hoạt động.");
    }

    const meta = CAPABILITY_META[capability];
    const scopeType = meta.scopeType;
    let scopeId = cleanStr(d.scopeId || "", 120);
    let scopeTitle = "";
    let scopeSlug = "";
    let eventDate = "";

    if (scopeType === "event") {
      if (!scopeId) return errorResponse(400, "MISSING_SCOPE", "Vui lòng chọn sự kiện cho quyền này.");
      const ev = await env.DB.prepare("SELECT id, title, date FROM events WHERE id = ? LIMIT 1")
        .bind(scopeId)
        .first();
      if (!ev) return errorResponse(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện đã chọn.");
      scopeId = ev.id;
      scopeTitle = ev.title;
      scopeSlug = resolveEventSlug(ev);
      eventDate = ev.date || "";
    } else if (scopeType === "album") {
      if (!scopeId) return errorResponse(400, "MISSING_SCOPE", "Vui lòng chọn album cho quyền này.");
      const alb = await env.DB.prepare("SELECT id, slug, title FROM media_albums WHERE id = ? OR slug = ? LIMIT 1")
        .bind(scopeId, scopeId)
        .first();
      if (!alb) return errorResponse(404, "ALBUM_NOT_FOUND", "Không tìm thấy album đã chọn.");
      scopeId = alb.id;
      scopeTitle = alb.title;
      scopeSlug = alb.slug || alb.id;
    } else {
      scopeId = "";
    }

    const greeting = cleanStr(d.greeting || "", 220);
    const note = cleanStr(d.note || "", 400);
    const expiresAt = computeDefaultExpiry({
      capability,
      eventDate,
      ttlHours: Number(d.ttlHours || 0),
    });

    const requiresConsent = RESPONSIBILITY_CAPABILITIES.has(capability);
    const initialStatus = requiresConsent ? "pending_accept" : "active";
    const capId = `cap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    // Ensure direct thread exists (or use provided threadId if it belongs to this member)
    let thread = null;
    const providedThreadId = cleanStr(d.threadId || "", 80);
    if (providedThreadId) {
      const candidate = await env.DB.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(providedThreadId).first();
      if (candidate && candidate.member_id === member.id) {
        thread = candidate;
      }
    }
    if (!thread) {
      thread = await getOrCreateMemberDirectThread(env.DB, member, now);
    }

    const actionHref =
      capability === "album.view_private"
        ? `/media/?album=${encodeURIComponent(scopeSlug || scopeId)}`
        : capability === "media.portal"
          ? "/media/"
          : capability === "event.companion" && scopeSlug
            ? `/su-kien/${encodeURIComponent(scopeSlug)}/`
            : "/tham-gia/#hop-thoai";

    const cardBody =
      note ||
      (requiresConsent
        ? `${actor.adminUser.name || "Ban Điều phối"} mời bạn đảm nhận vai trò "${meta.labelVi}"${scopeTitle ? ` cho "${scopeTitle}"` : ""}.`
        : `${actor.adminUser.name || "Ban Điều phối"} đã mở quyền "${meta.labelVi}"${scopeTitle ? ` cho "${scopeTitle}"` : ""}.`);

    const msg = await insertChatMessage(env.DB, {
      threadId: thread.id,
      senderType: "admin",
      senderId: actor.adminUser.id,
      senderName: actor.adminUser.name || "Ban Điều phối HolaRise",
      msgKind: "capability_card",
      body: cardBody,
      payload: {
        capabilityId: capId,
        capability,
        labelVi: meta.labelVi,
        labelEn: meta.labelEn,
        scopeType,
        scopeId,
        scopeTitle,
        scopeSlug,
        requiresConsent,
        consentVi: meta.consentVi,
        consentEn: meta.consentEn,
        liveStatus: initialStatus,
        expiresAt,
        actionHref,
      },
      isInternal: false,
      now,
    });

    await env.DB.prepare(
      `INSERT INTO member_capabilities
       (id, member_id, capability, scope_type, scope_id, status, greeting, note,
        granted_by, granted_by_name, grant_message_id, consent_accepted_at, expires_at,
        revoked_by, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`
    )
      .bind(
        capId,
        member.id,
        capability,
        scopeType,
        scopeId,
        initialStatus,
        greeting,
        note,
        actor.adminUser.email || actor.adminUser.id,
        actor.adminUser.name || "Ban Điều phối",
        msg.id,
        requiresConsent ? "" : now,
        expiresAt,
        now,
        now
      )
      .run();

    // If immediately active (album.view_private), sync legacy table right away
    if (initialStatus === "active") {
      await syncLegacyMediaGrantState(env.DB, {
        memberId: member.id,
        capability,
        scopeId,
        active: true,
        grantedBy: actor.adminUser.email || actor.adminUser.id,
        now,
      });
    }

    if (member.email) {
      await maybeSendOfflineChatEmail(env, {
        thread,
        direction: "to_member",
        recipientEmail: member.email,
        recipientName: member.name,
        senderName: actor.adminUser.name || "Ban Điều phối HolaRise",
        preview: cardBody,
        actionUrl: "https://holarise.org/tham-gia/#hop-thoai",
      }).catch(() => {});
    }

    const row = await env.DB.prepare("SELECT * FROM member_capabilities WHERE id = ?").bind(capId).first();
    return jsonResponse(
      {
        ok: true,
        action: "grant",
        capability: serializeCapabilityRow({ ...row, scope_title: scopeTitle, scope_slug: scopeSlug }, now),
        threadId: thread.id,
        messageId: msg.id,
      },
      201
    );
  }

  // 2. ACCEPT or DECLINE a pending responsibility grant (Target Member ONLY)
  if (action === "accept" || action === "decline") {
    if (!actor.member) {
      return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên.");
    }
    const capId = cleanStr(d.capabilityId || d.id || "", 80);
    if (!capId) return errorResponse(400, "MISSING_CAPABILITY_ID", "Thiếu mã quyền.");

    const cap = await env.DB.prepare("SELECT * FROM member_capabilities WHERE id = ?").bind(capId).first();
    if (!cap) return errorResponse(404, "NOT_FOUND", "Không tìm thấy lời mời trao quyền.");
    if (cap.member_id !== actor.member.id) {
      return errorResponse(403, "FORBIDDEN", "Bạn không thể xác nhận quyền của thành viên khác.");
    }

    const effStatus = computeEffectiveStatus(cap, now);
    if (effStatus !== "pending_accept") {
      return errorResponse(409, "INVALID_STATE", `Quyền này đang ở trạng thái '${effStatus}', không thể xác nhận.`);
    }

    const meta = CAPABILITY_META[cap.capability] || {};
    const greeting = cleanStr(d.greeting || cap.greeting || "", 220);

    if (action === "accept") {
      if (RESPONSIBILITY_CAPABILITIES.has(cap.capability) && d.consentAccepted !== true) {
        return errorResponse(
          400,
          "CONSENT_REQUIRED",
          "Vui lòng đánh dấu đồng ý cam kết bảo mật & tôn trọng người tham dự trước khi kích hoạt quyền."
        );
      }
      await env.DB.prepare(
        `UPDATE member_capabilities
         SET status = 'active', consent_accepted_at = ?, greeting = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(now, greeting, now, capId)
        .run();

      await syncLegacyMediaGrantState(env.DB, {
        memberId: actor.member.id,
        capability: cap.capability,
        scopeId: cap.scope_id,
        active: true,
        grantedBy: cap.granted_by,
        now,
      });

      const thread = await getOrCreateMemberDirectThread(env.DB, actor.member, now);
      await insertChatMessage(env.DB, {
        threadId: thread.id,
        senderType: "system",
        senderId: actor.member.id,
        senderName: "Hệ thống",
        msgKind: "text",
        body: `${actor.member.name} đã xác nhận cam kết và kích hoạt quyền "${meta.labelVi || cap.capability}".`,
        now,
      });

      const updated = await env.DB.prepare("SELECT * FROM member_capabilities WHERE id = ?").bind(capId).first();
      return jsonResponse({ ok: true, action: "accept", capability: serializeCapabilityRow(updated, now) });
    }

    // decline
    await env.DB.prepare(
      `UPDATE member_capabilities
       SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(actor.member.id, now, now, capId)
      .run();

    const thread = await getOrCreateMemberDirectThread(env.DB, actor.member, now);
    await insertChatMessage(env.DB, {
      threadId: thread.id,
      senderType: "system",
      senderId: actor.member.id,
      senderName: "Hệ thống",
      msgKind: "text",
      body: `${actor.member.name} đã hẹn dịp khác cho vai trò "${meta.labelVi || cap.capability}".`,
      now,
    });

    const updated = await env.DB.prepare("SELECT * FROM member_capabilities WHERE id = ?").bind(capId).first();
    return jsonResponse({ ok: true, action: "decline", capability: serializeCapabilityRow(updated, now) });
  }

  // 3. REVOKE a capability (Authorized Admin OR target Member voluntarily stepping down)
  if (action === "revoke") {
    const capId = cleanStr(d.capabilityId || d.id || "", 80);
    if (!capId) return errorResponse(400, "MISSING_CAPABILITY_ID", "Thiếu mã quyền cần thu hồi.");

    const cap = await env.DB.prepare("SELECT * FROM member_capabilities WHERE id = ?").bind(capId).first();
    if (!cap) return errorResponse(404, "NOT_FOUND", "Không tìm thấy bản ghi quyền.");

    const isSelfSteppingDown = Boolean(actor.member && cap.member_id === actor.member.id);
    const isAdminAllowed = Boolean(actor.adminUser && canAdminGrantCapability(actor.adminUser, cap.capability));
    if (!isAdminAllowed && !isSelfSteppingDown) {
      return errorResponse(403, "FORBIDDEN", "Bạn không có quyền thu hồi quyền này.");
    }

    const revoker = actor.adminUser
      ? actor.adminUser.email || actor.adminUser.id
      : actor.member.id;
    const revokerLabel = actor.adminUser
      ? actor.adminUser.name || "Ban Điều phối"
      : actor.member.name || "Thành viên";

    await env.DB.prepare(
      `UPDATE member_capabilities
       SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(revoker, now, now, capId)
      .run();

    await syncLegacyMediaGrantState(env.DB, {
      memberId: cap.member_id,
      capability: cap.capability,
      scopeId: cap.scope_id,
      active: false,
      grantedBy: revoker,
      now,
    });

    const targetMember = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(cap.member_id).first();
    if (targetMember) {
      const meta = CAPABILITY_META[cap.capability] || {};
      const thread = await getOrCreateMemberDirectThread(env.DB, targetMember, now);
      await insertChatMessage(env.DB, {
        threadId: thread.id,
        senderType: "system",
        senderId: revoker,
        senderName: "Hệ thống",
        msgKind: "text",
        body: `${revokerLabel} đã kết thúc quyền "${meta.labelVi || cap.capability}".`,
        now,
      });
    }

    const updated = await env.DB.prepare("SELECT * FROM member_capabilities WHERE id = ?").bind(capId).first();
    return jsonResponse({ ok: true, action: "revoke", capability: serializeCapabilityRow(updated, now) });
  }

  return errorResponse(400, "UNKNOWN_ACTION", "Thao tác không được hỗ trợ.");
}
