import {
  checkRateLimit,
  ensureMemberSchema,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../../_lib/security.js";
import { parseMemberIdentifier } from "../../../_lib/validation.js";

/**
 * Unified Auth Smart Lookup:
 * Given a single Email or Phone input, tells the client whether to show
 * Password Sign-In (existing account) or Account Setup (new account).
 */
export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;

  const rawIdentifier =
    parsed.data.identifier ?? parsed.data.emailOrPhone ?? parsed.data.email ?? parsed.data.phone ?? "";
  const idInfo = parseMemberIdentifier(rawIdentifier);
  if (!idInfo.ok) {
    return errorResponse(400, "VALIDATION_ERROR", idInfo.error || "Vui lòng nhập Email hoặc Số điện thoại hợp lệ.", {
      identifier: idInfo.error,
    });
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `mbr_lookup:${ipHash}`, 20, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Bạn thao tác quá nhanh. Vui lòng đợi ít phút rồi thử lại.");
  }

  // Nghị định 13/2023 & Anti-Enumeration Guard:
  // Never disclose whether an email or Vietnamese phone number exists in `members`.
  return jsonResponse({
    ok: true,
    kind: idInfo.kind,
    normalized: idInfo.kind === "email" ? idInfo.email : idInfo.phoneDisplay,
  });
}
