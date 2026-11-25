import { syncRegistrationToGas } from "../_lib/gas.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  readJsonBody,
  sniffImageMime,
  verifyCsrfOrigin,
} from "../_lib/security.js";

const MAX_BUG_SCREENSHOT_BYTES = 512 * 1024; // 512 KB binary cap
const BUG_SCREENSHOT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days auto-expiry

function decodeBase64DataUrl(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return null;
  const b64 = dataUrl.slice(commaIdx + 1);
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}
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

  const syncPromise = syncRegistrationToGas(env.DB, record);
  if (typeof context.waitUntil === "function") {
    context.waitUntil(syncPromise);
  } else {
    await syncPromise;
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

  const validated = validateRegistrationInput(rawBody);
  if (!validated.ok) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Vui lòng kiểm tra lại thông tin đăng ký.",
      validated.fields
    );
  }

  if (validated.honeypot) {
    return jsonResponse({ ok: true, id: "accepted" }, 200);
  }

  const ipHash = await getClientIpHash(request);
  const rlBucket = sessionMember ? `reg_mbr:${sessionMember.id}` : `reg:${ipHash}`;
  const rlMax = sessionMember ? 12 : 6;
  const rl = await checkRateLimit(env.DB, rlBucket, rlMax, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Bạn đã gửi nhiều đơn đăng ký liên tiếp. Vui lòng thử lại sau ít phút hoặc liên hệ Zalo 077.777.1948.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const v = validated.value;

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
          message: `Chỗ của bạn tại ${v.activity_title} đã được giữ trước đó (mã ${existing.id}). Hẹn gặp bạn tại Hòa Lạc!`,
        },
        200
      );
    }
  }

  const now = new Date().toISOString();
  const id = `REG-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  let screenshotPath = "";
  if (v.is_feedback && v.screenshot_data_url && env?.MEDIA_KV) {
    const bytes = decodeBase64DataUrl(v.screenshot_data_url);
    if (bytes && bytes.length > 0 && bytes.length <= MAX_BUG_SCREENSHOT_BYTES) {
      const sniffed = sniffImageMime(bytes);
      if (sniffed) {
        const shotId = `bug-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8)}.${sniffed.ext}`;
        await env.MEDIA_KV.put(`bugshot:${shotId}`, bytes.buffer, {
          expirationTtl: BUG_SCREENSHOT_TTL_SEC,
          metadata: {
            contentType: sniffed.mime,
            regId: id,
            createdAt: now,
          },
        }).catch(() => null);
        screenshotPath = `/api/admin/bug-screenshot/${shotId}`;
      }
    }
  }

  let finalNote = v.note;
  if (v.is_feedback) {
    const extraParts = [];
    if (screenshotPath) extraParts.push(`[Ảnh màn hình lỗi (Admin)]: ${screenshotPath}`);
    if (v.diagnostics) extraParts.push(`[Ngữ cảnh kỹ thuật]: ${v.diagnostics}`);
    if (extraParts.length > 0) {
      finalNote = `${v.note}\n\n${extraParts.join("\n")}`;
    }
  }

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
    note: finalNote,
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

  const syncPromise = syncRegistrationToGas(env.DB, record);
  if (typeof context.waitUntil === "function") {
    context.waitUntil(syncPromise);
  } else {
    await syncPromise;
  }

  const hasSpecificEvent = Boolean(record.event_id);
  const confirmationMessage = hasSpecificEvent
    ? `Cảm ơn ${record.full_name}! Hola đã ghi nhận giữ chỗ của bạn cho ${record.activity_title} (mã ${record.id}). Hẹn gặp bạn tại Hòa Lạc!`
    : `Cảm ơn ${record.full_name}! Hola đã ghi nhận thông tin đồng hành của bạn (mã ${record.id}). Ban Điều Phối sẽ liên hệ sớm nhất.`;

  return jsonResponse(
    {
      ok: true,
      id: record.id,
      duplicate: false,
      memberCode: sessionMember ? sessionMember.member_code : "",
      savedMemberPhone,
      emailSentHint: Boolean(record.email),
      screenshotSaved: Boolean(screenshotPath),
      message: confirmationMessage,
    },
    201
  );
}
