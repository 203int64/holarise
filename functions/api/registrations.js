import { sendInquiryConfirmationEmail, sendRsvpConfirmationEmail } from "../_lib/email.js";
import { syncRegistrationToGas } from "../_lib/gas.js";
import { verifyTurnstileToken } from "../_lib/turnstile.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../_lib/security.js";
import { handleFeedbackSubmission } from "./event-feedback/index.js";
import { cleanStr, normalizePhone, validateRegistrationInput } from "../_lib/validation.js";

export async function createEventRegistrationForMember(context, member, eventPayload, ipHash = "member") {
  const { env } = context;
  const eventId = cleanStr(eventPayload.event_id || eventPayload.eventId, 120);
  const activityTitle =
    cleanStr(eventPayload.activity_title || eventPayload.activityTitle || eventPayload.activity, 220) ||
    "Đăng ký tham dự sự kiện Hola";

  if (eventId) {
    const existing = await env.DB.prepare(
      `SELECT id, activity_title, created_at
       FROM registrations
       WHERE member_id = ? AND event_id = ? AND status != 'cancelled'
       LIMIT 1`
    )
      .bind(member.id, eventId)
      .first()
      .catch(() => null);

    if (existing) {
      return {
        id: existing.id,
        duplicate: true,
        activityTitle: existing.activity_title || activityTitle,
      };
    }
  }

  const now = new Date().toISOString();
  const id = `REG-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const record = {
    id,
    member_id: member.id,
    source: "event_modal",
    event_id: eventId,
    activity_title: activityTitle,
    full_name: member.name,
    phone: member.phone_display || member.email || "",
    email: member.email || "",
    role: cleanStr(eventPayload.role, 160) || `Thành viên (${member.member_code})`,
    organization: member.organization || "",
    note: cleanStr(eventPayload.note, 1000),
    status: "new",
    admin_note: "",
    sync_status: "pending",
    sync_error: "",
    ip_hash: ipHash,
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(
    `INSERT INTO registrations
     (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      record.id,
      record.member_id,
      record.source,
      record.event_id,
      record.activity_title,
      record.full_name,
      record.phone,
      record.email,
      record.role,
      record.organization,
      record.note,
      record.status,
      record.admin_note,
      record.sync_status,
      record.sync_error,
      record.ip_hash,
      record.created_at,
      record.updated_at
    )
    .run();

  const bgTasks = [syncRegistrationToGas(env.DB, record)];
  if (record.email && record.event_id) {
    bgTasks.push(
      sendRsvpConfirmationEmail(env, {
        registration: record,
        lang: cleanStr(eventPayload.lang, 10).toLowerCase() === "en" ? "en" : "vi",
      })
    );
  }
  const bgPromise = Promise.allSettled(bgTasks);
  if (typeof context.waitUntil === "function") {
    context.waitUntil(bgPromise);
  } else {
    await bgPromise;
  }

  return {
    id: record.id,
    duplicate: false,
    activityTitle: record.activity_title,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì. Vui lòng liên hệ qua Zalo hoặc Email.");
  }

  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi biểu mẫu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 768 * 1024);
  if (!parsed.ok) return parsed.response;

  // Backward-compatible redirect: legacy cached clients posting feedback to /api/registrations
  // are routed directly into the unified Feedback Inbox (`event_feedbacks`) instead of `registrations`.
  if (cleanStr(parsed.data?.source, 30) === "feedback") {
    const legacy = parsed.data || {};
    const legacyName = cleanStr(legacy.fullName || legacy.full_name, 100);
    const legacyContact = cleanStr(legacy.phone || legacy.contact || legacy.email, 120);
    const isAnonPlaceholder =
      (!legacyName || legacyName === "Thành viên đóng góp" || legacyName === "Community contributor") &&
      (!legacyContact || legacyContact === "Ẩn danh" || legacyContact === "Anonymous");
    return handleFeedbackSubmission(context, {
      website: legacy.website ?? legacy._hp ?? "",
      lang: legacy.lang,
      sourceKind: /lỗi|bug|technical/i.test(`${legacy.role || ""} ${legacy.activity || ""}`) ? "bug" : "site",
      topicLabel: legacy.role || legacy.activity || "",
      pageUrl: legacy.pageUrl || (String(legacy.organization || "").startsWith("/") ? legacy.organization : ""),
      content: legacy.note || legacy.content || "",
      diagnostics: legacy.diagnostics || "",
      attachmentDataUrl: legacy.attachmentDataUrl || legacy.screenshotDataUrl || "",
      authorName: isAnonPlaceholder ? "" : legacyName,
      authorContact: isAnonPlaceholder ? "" : legacyContact,
      isAnonymous: legacy.isAnonymous ?? isAnonPlaceholder,
      turnstileToken: legacy.turnstileToken ?? legacy["cf-turnstile-response"] ?? "",
    });
  }

  const sessionMember = await getSessionMember(env.DB, request);
  const rawBody = { ...parsed.data };

  // Pre-hydrate profile fields when an authenticated Member performs 1-tap RSVP
  if (sessionMember) {
    if (!rawBody.fullName && !rawBody.full_name) {
      rawBody.fullName = sessionMember.name;
    }
    if (!rawBody.phone && !rawBody.contact) {
      rawBody.phone = sessionMember.phone_display || sessionMember.email || "";
    }
    if (!rawBody.email && sessionMember.email) {
      rawBody.email = sessionMember.email;
    }
    if (!rawBody.organization && sessionMember.organization) {
      rawBody.organization = sessionMember.organization;
    }
  }

  const isEn = cleanStr(rawBody.lang, 10).toLowerCase() === "en";
  const validated = validateRegistrationInput(rawBody);
  if (!validated.ok) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      isEn ? "Please check your registration details." : "Vui lòng kiểm tra lại thông tin đăng ký.",
      validated.fields
    );
  }

  if (validated.honeypot) {
    return jsonResponse({ ok: true, id: "accepted" }, 200);
  }

  // Optional Cloudflare Turnstile gate for unauthenticated guests (activates only when TURNSTILE_SECRET is set)
  if (!sessionMember) {
    const tsToken =
      parsed.data?.["cf-turnstile-response"] ?? parsed.data?.turnstileToken ?? "";
    const tsCheck = await verifyTurnstileToken(request, env, tsToken, "rsvp");
    if (!tsCheck.ok) {
      return errorResponse(
        403,
        tsCheck.code || "TURNSTILE_FAILED",
        isEn
          ? "Bot verification failed. Please refresh and try again."
          : "Xác minh chống bot chưa thành công. Vui lòng tải lại trang và thử lại."
      );
    }
  }

  const ipHash = await getClientIpHash(request);
  const rlBucket = sessionMember ? `reg_mbr:${sessionMember.id}` : `reg:${ipHash}`;
  const rlMax = sessionMember ? 12 : 6;
  const rl = await checkRateLimit(env.DB, rlBucket, rlMax, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      isEn
        ? "Too many submissions in a short time. Please try again in a few minutes or email phungsu@holarise.org."
        : "Bạn đã gửi nhiều đơn đăng ký liên tiếp. Vui lòng thử lại sau ít phút hoặc liên hệ Zalo 077.777.1948.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const v = validated.value;

  // Enforce manual Admin RSVP close switch (rsvp_closed = 1)
  if (v.event_id && !v.is_feedback) {
    const evLock = await env.DB.prepare("SELECT rsvp_closed, title FROM events WHERE id = ?")
      .bind(v.event_id)
      .first()
      .catch(() => null);
    if (evLock && Number(evLock.rsvp_closed || 0) === 1) {
      return errorResponse(
        409,
        "RSVP_CLOSED",
        isEn
          ? "Seat reservation for this gathering is currently closed. Please join our Zalo community for upcoming sessions."
          : "Ban Điều Phối đã tạm khóa nhận giữ chỗ cho buổi gặp này. Mời bạn theo dõi lịch hoạt động tiếp theo của HolaRise."
      );
    }
  }

  // Idempotent 1-tap duplicate protection for logged-in members on the same event
  if (sessionMember && v.event_id) {
    const existing = await env.DB.prepare(
      `SELECT id FROM registrations WHERE member_id = ? AND event_id = ? AND status != 'cancelled' LIMIT 1`
    )
      .bind(sessionMember.id, v.event_id)
      .first()
      .catch(() => null);

    if (existing) {
      return jsonResponse(
        {
          ok: true,
          id: existing.id,
          duplicate: true,
          memberCode: sessionMember.member_code,
          emailSentHint: Boolean(v.email),
          message: isEn
            ? `Your seat for ${v.activity_title} is already confirmed (ref ${existing.id}). See you in Hoa Lac!`
            : `Chỗ của bạn tại ${v.activity_title} đã được giữ trước đó (mã ${existing.id}). Hẹn gặp bạn tại Hòa Lạc!`,
        },
        200
      );
    }
  }

  const now = new Date().toISOString();
  const id = `REG-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const record = {
    id,
    member_id: sessionMember ? sessionMember.id : "",
    source: v.source,
    event_id: v.event_id,
    activity_title: v.activity_title,
    full_name: v.full_name,
    phone: v.phone,
    email: v.email,
    role: v.role,
    organization: v.organization,
    note: v.note,
    status: "new",
    admin_note: "",
    sync_status: "pending",
    sync_error: "",
    ip_hash: ipHash,
    created_at: now,
    updated_at: now,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO registrations
       (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        record.id,
        record.member_id,
        record.source,
        record.event_id,
        record.activity_title,
        record.full_name,
        record.phone,
        record.email,
        record.role,
        record.organization,
        record.note,
        record.status,
        record.admin_note,
        record.sync_status,
        record.sync_error,
        record.ip_hash,
        record.created_at,
        record.updated_at
      )
      .run();
  } catch (err) {
    // Graceful rolling-deploy fallback if D1 migration 0006 has not yet added member_id
    if (String(err?.message || "").includes("member_id")) {
      await env.DB.prepare(
        `INSERT INTO registrations
         (id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          record.id,
          record.source,
          record.event_id,
          record.activity_title,
          record.full_name,
          record.phone,
          record.email,
          record.role,
          record.organization,
          record.note,
          record.status,
          record.admin_note,
          record.sync_status,
          record.sync_error,
          record.ip_hash,
          record.created_at,
          record.updated_at
        )
        .run();
    } else {
      throw err;
    }
  }

  // Auto-save member's phone on first RSVP if they signed up via Google/Email without a phone yet
  let savedMemberPhone = "";
  if (sessionMember && !sessionMember.phone_norm && !v.is_feedback && record.phone) {
    const parsedPhone = normalizePhone(record.phone);
    if (parsedPhone.ok) {
      try {
        const upd = await env.DB.prepare(
          `UPDATE members
           SET phone_norm = ?, phone_display = ?, updated_at = ?
           WHERE id = ? AND (phone_norm IS NULL OR phone_norm = '')`
        )
          .bind(parsedPhone.phoneNorm, parsedPhone.phoneDisplay, now, sessionMember.id)
          .run();
        if (upd?.meta?.changes > 0) {
          savedMemberPhone = parsedPhone.phoneDisplay;
        }
      } catch {
        // Ignore UNIQUE(phone_norm) collision — event registration itself still succeeds
      }
    }
  }

  const bgTasks = [syncRegistrationToGas(env.DB, record)];
  if (!v.is_feedback && record.email) {
    if (record.event_id) {
      bgTasks.push(
        sendRsvpConfirmationEmail(env, {
          registration: record,
          lang: isEn ? "en" : "vi",
        })
      );
    } else {
      bgTasks.push(
        sendInquiryConfirmationEmail(env, {
          registration: record,
          lang: isEn ? "en" : "vi",
        })
      );
    }
  }
  const bgPromise = Promise.allSettled(bgTasks);
  if (typeof context.waitUntil === "function") {
    context.waitUntil(bgPromise);
  } else {
    await bgPromise;
  }

  const hasSpecificEvent = Boolean(record.event_id);
  const confirmationMessage = isEn
    ? hasSpecificEvent
      ? `Thank you, ${record.full_name}. Your seat for ${record.activity_title} is confirmed (ref ${record.id}). See you in Hoa Lac.`
      : `Thank you, ${record.full_name}. We have received your inquiry (ref ${record.id}). Our coordinating team will follow up shortly.`
    : hasSpecificEvent
      ? `Cảm ơn ${record.full_name}. Hola đã ghi nhận giữ chỗ của bạn cho ${record.activity_title} (mã ${record.id}). Hẹn gặp bạn tại Hòa Lạc.`
      : `Cảm ơn ${record.full_name}. Hola đã ghi nhận thông tin đồng hành của bạn (mã ${record.id}). Ban Điều Phối sẽ liên hệ sớm nhất.`;

  return jsonResponse(
    {
      ok: true,
      id: record.id,
      duplicate: false,
      memberCode: sessionMember ? sessionMember.member_code : "",
      savedMemberPhone,
      emailSentHint: Boolean(record.email),
      message: confirmationMessage,
    },
    201
  );
}
