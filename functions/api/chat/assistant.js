/**
 * POST /api/chat/assistant
 * Grounded HolaRise Quick-Assistant ("Hỏi nhanh") endpoint.
 * - CSRF origin check + rate limit (12 requests / 15 min per IP or member)
 * - Optional Turnstile check when TURNSTILE_SECRET is configured
 * - Grounded in live D1 events + deterministic crisis safeguarding guardrail
 */

import { runGeminiAssistant } from "../../_lib/assistant.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";
import { cleanStr } from "../../_lib/validation.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi yêu cầu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 12 * 1024);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data || {};
  const isEn = cleanStr(body.lang, 10).toLowerCase() === "en";

  // Honeypot trap
  if (cleanStr(body.website || body._hp, 100) !== "") {
    return jsonResponse({ ok: true, reply: "", mode: "accepted", suggestedLinks: [] }, 200);
  }

  const message = cleanStr(body.message, 500);
  if (message.length < 2) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      isEn ? "Please enter a question (at least 2 characters)." : "Vui lòng nhập câu hỏi ngắn (tối thiểu 2 ký tự)."
    );
  }

  const sessionMember = env?.DB ? await getSessionMember(env.DB, request).catch(() => null) : null;
  if (!sessionMember) {
    const tsToken = body["cf-turnstile-response"] ?? body.turnstileToken ?? "";
    const tsCheck = await verifyTurnstileToken(request, env, tsToken, "assistant_chat");
    if (!tsCheck.ok) {
      return errorResponse(
        403,
        tsCheck.code || "TURNSTILE_FAILED",
        isEn
          ? "Bot verification failed. Please reload and try again."
          : "Xác minh chống bot chưa thành công. Vui lòng tải lại trang và thử lại."
      );
    }
  }

  if (env?.DB) {
    const ipHash = await getClientIpHash(request);
    const rlKey = sessionMember ? `ai_chat_mbr:${sessionMember.id}` : `ai_chat_ip:${ipHash}`;
    const rl = await checkRateLimit(env.DB, rlKey, 12, 15 * 60 * 1000);
    if (!rl.allowed) {
      return errorResponse(
        429,
        "RATE_LIMITED",
        isEn
          ? "You have asked several questions in a row. Please try again in a few minutes or email phungsu@holarise.org."
          : "Bạn đã hỏi khá nhiều lượt liên tiếp. Vui lòng thử lại sau ít phút hoặc nhắn Zalo 077.777.1948 nhé.",
        null,
        { "Retry-After": String(rl.retryAfterSec) }
      );
    }
  }

  const rawPageUrl = cleanStr(body.pageUrl ?? body.page_url, 220);
  const pageUrl = rawPageUrl.startsWith("/") ? rawPageUrl : isEn ? "/en/" : "/";
  const history = Array.isArray(body.history) ? body.history.slice(-4) : [];

  const result = await runGeminiAssistant({
    env,
    db: env?.DB || null,
    message,
    history,
    lang: isEn ? "en" : "vi",
    pageUrl,
  });

  return jsonResponse({
    ok: true,
    reply: result.reply,
    mode: result.mode,
    handoffSuggested: Boolean(result.handoffSuggested),
    suggestedLinks: Array.isArray(result.suggestedLinks) ? result.suggestedLinks : [],
  });
}
