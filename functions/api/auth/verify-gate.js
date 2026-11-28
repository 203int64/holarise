/**
 * POST /api/auth/verify-gate
 * Step 1 of the /media/ 2-step vault flow:
 * Verifies the 4-digit access code against MEDIA_ACCESS_PIN (default: "1948")
 * with strict rate limiting (5 attempts / 15 min per IP) and returns a 10-minute HMAC gateToken.
 */

import { constantTimeStringEqual, createGateToken, getMediaAccessPin } from "../../_lib/gate-token.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr } from "../../_lib/validation.js";

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const expectedPin = getMediaAccessPin(env);

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `verify-gate:${ipHash}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Bạn đã nhập sai quá số lần cho phép. Vui lòng thử lại sau ${rl.retryAfterSec} giây.`,
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const parsed = await readJsonBody(request, 4 * 1024);
  if (!parsed.ok) return parsed.response;

  const pin = cleanStr(parsed.data.pin, 32);
  if (!pin || !constantTimeStringEqual(pin, expectedPin)) {
    return errorResponse(401, "INVALID_PIN", "Mã cổng nội bộ chưa chính xác.");
  }

  const gateToken = await createGateToken(expectedPin);
  return jsonResponse({
    ok: true,
    gateToken,
    expiresInSec: 600,
  });
}
