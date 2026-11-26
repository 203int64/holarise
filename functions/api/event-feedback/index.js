import {
  checkRateLimit,
  ensureEventFeedbackSchema,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";
import { validateEventFeedbackInput } from "../../_lib/validation.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi biểu mẫu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const isEn = String(parsed.data?.lang || "").trim().toLowerCase() === "en";
  const checked = validateEventFeedbackInput(parsed.data || {});
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
      parsed.data?.["cf-turnstile-response"] ?? parsed.data?.turnstileToken ?? "";
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
  const isAnon = Boolean(parsed.data?.isAnonymous ?? parsed.data?.is_anonymous);
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

  const id = `efb_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();

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

  return jsonResponse(
    {
      ok: true,
      id,
      isAnonymous: finalIsAnon === 1,
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
