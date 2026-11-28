import { notifyAdminNewFeedback } from "../../_lib/manager-notify.js";
import {
  checkRateLimit,
  ensureEventFeedbackSchema,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  readJsonBody,
  sniffImageMime,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";
import { validateEventFeedbackInput } from "../../_lib/validation.js";

const MAX_ATTACHMENT_BYTES = 512 * 1024; // 512 KB binary cap
const ATTACHMENT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days auto-expiry

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

export async function handleFeedbackSubmission(context, rawInput) {
  const { request, env } = context;
  const isEn = String(rawInput?.lang || "").trim().toLowerCase() === "en";
  const checked = validateEventFeedbackInput(rawInput || {});
  if (checked.honeypot) {
    return jsonResponse({ ok: true, id: "accepted" }, 200);
  }
  if (!checked.ok) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      isEn ? "Please check your feedback note (at least 8 characters)." : "Vui lòng kiểm tra lại lời đóng góp.",
      checked.fields
    );
  }

  await ensureEventFeedbackSchema(env.DB);
  const sessionMember = await getSessionMember(env.DB, request).catch(() => null);
  if (!sessionMember) {
    const tsToken =
      rawInput?.["cf-turnstile-response"] ?? rawInput?.turnstileToken ?? "";
    const tsCheck = await verifyTurnstileToken(request, env, tsToken, "event_feedback");
    if (!tsCheck.ok) {
      return errorResponse(
        403,
        tsCheck.code || "TURNSTILE_FAILED",
        isEn
          ? "Bot verification failed. Please reload the page and try again."
          : "Xác minh chống bot chưa thành công. Vui lòng tải lại trang và thử lại."
      );
    }
  }
  const ipHash = await getClientIpHash(request);
  const rlKey = sessionMember ? `ev_fb_mbr:${sessionMember.id}` : `ev_fb_ip:${ipHash}`;
  const rl = await checkRateLimit(env.DB, rlKey, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      isEn
        ? "You have sent several feedback notes in a row. Please try again in a few minutes."
        : "Bạn đã gửi nhiều góp ý liên tiếp. Vui lòng thử lại sau ít phút.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const v = checked.value;
  // Strict NGO Safeguarding (Nghị định 13/2023): when anonymous is requested, strip ALL identity traces.
  const isAnon = Boolean(rawInput?.isAnonymous ?? rawInput?.is_anonymous);
  const memberId = !isAnon && sessionMember ? sessionMember.id : "";
  const authorName = isAnon
    ? "Ẩn danh"
    : v.author_name !== "Ẩn danh"
      ? v.author_name
      : sessionMember?.name || "Ẩn danh";
  const authorContact = isAnon
    ? ""
    : v.author_contact || sessionMember?.phone_display || sessionMember?.email || "";
  const finalIsAnon = isAnon || (!memberId && authorName === "Ẩn danh" && !authorContact) ? 1 : 0;

  // Enrich event title from DB if event_id was provided without a title
  let eventTitle = v.event_title;
  if (!eventTitle && v.event_id) {
    const evRow = await env.DB.prepare("SELECT title FROM events WHERE id = ?")
      .bind(v.event_id)
      .first()
      .catch(() => null);
    if (evRow?.title) eventTitle = evRow.title;
  }
  if (!eventTitle && v.source_kind !== "event") {
    eventTitle = v.topic_label || (v.source_kind === "bug" ? "Báo lỗi kỹ thuật" : "Góp ý trên web");
  }

  const id = `efb_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();

  let attachmentUrl = "";
  if (v.attachment_data_url && env?.MEDIA_KV) {
    const bytes = decodeBase64DataUrl(v.attachment_data_url);
    if (bytes && bytes.length > 0 && bytes.length <= MAX_ATTACHMENT_BYTES) {
      const sniffed = sniffImageMime(bytes);
      if (sniffed) {
        const shotId = `bug-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8)}.${sniffed.ext}`;
        await env.MEDIA_KV.put(`bugshot:${shotId}`, bytes.buffer, {
          expirationTtl: ATTACHMENT_TTL_SEC,
          metadata: {
            contentType: sniffed.mime,
            feedbackId: id,
            createdAt: now,
          },
        }).catch(() => null);
        attachmentUrl = `/api/admin/bug-screenshot/${shotId}`;
      }
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO event_feedbacks
       (id, event_id, event_slug, event_title, source_kind, topic_label, page_url, attachment_url, diagnostics,
        category, content, author_name, author_contact, member_id, is_anonymous, status, admin_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?)`
    )
      .bind(
        id,
        v.event_id,
        v.event_slug,
        eventTitle,
        v.source_kind,
        v.topic_label,
        v.page_url,
        attachmentUrl,
        v.diagnostics,
        v.category,
        v.content,
        authorName,
        authorContact,
        memberId,
        finalIsAnon,
        now,
        now
      )
      .run();
  } catch (err) {
    // Graceful rolling-deploy fallback if D1 migration 0028 has not yet added extended columns
    if (String(err?.message || "").includes("no column named") || String(err?.message || "").includes("source_kind")) {
      await env.DB.prepare(
        `INSERT INTO event_feedbacks
         (id, event_id, event_slug, event_title, category, content, author_name, author_contact,
          member_id, is_anonymous, status, admin_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?)`
      )
        .bind(
          id,
          v.event_id,
          v.event_slug,
          eventTitle,
          v.category,
          v.content,
          authorName,
          authorContact,
          memberId,
          finalIsAnon,
          now,
          now
        )
        .run();
    } else {
      throw err;
    }
  }

  const notifyPromise = notifyAdminNewFeedback(env, {
    feedback: {
      id,
      sourceKind: v.source_kind,
      topicLabel: v.topic_label,
      category: v.category,
      eventTitle,
      pageUrl: v.page_url,
      attachmentUrl,
      content: v.content,
      authorName,
      authorContact,
      isAnonymous: finalIsAnon === 1,
    },
  });
  if (typeof context.waitUntil === "function") {
    context.waitUntil(notifyPromise);
  } else {
    await notifyPromise;
  }

  return jsonResponse(
    {
      ok: true,
      id,
      sourceKind: v.source_kind,
      isAnonymous: finalIsAnon === 1,
      attachmentSaved: Boolean(attachmentUrl),
      screenshotSaved: Boolean(attachmentUrl),
      message: isEn
        ? finalIsAnon === 1
          ? "Thank you for your anonymous note. It has been sent privately to our Coordinating Team."
          : "Thank you for your thoughtful feedback. Our Coordinating Team has received it."
        : finalIsAnon === 1
          ? "Cảm ơn bạn đã góp ý ẩn danh. Lời nhắn đã gửi kín tới Ban Điều Phối."
          : "Cảm ơn lời đóng góp chân thành của bạn. Ban Điều Phối đã tiếp nhận.",
    },
    201
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi biểu mẫu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 768 * 1024);
  if (!parsed.ok) return parsed.response;

  return handleFeedbackSubmission(context, parsed.data || {});
}
