import { ensureAdminPasskeySchema } from "../../../_lib/admin-passkey-schema.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  verifyCsrfOrigin,
} from "../../../_lib/security.js";
import { generateChallengeBase64Url, resolveRpId } from "../../../_lib/webauthn.js";

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `admin_pk_opt:${ipHash}`, 20, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${rl.retryAfterSec} giây.`,
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  await ensureAdminPasskeySchema(env.DB);

  // Use discoverable credentials only (empty allowCredentials) to prevent
  // unauthenticated admin email / passkey enumeration.
  const allowCredentials = [];

  const challenge = generateChallengeBase64Url(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  await env.DB.prepare("DELETE FROM admin_passkey_challenges WHERE expires_at <= ?")
    .bind(now.toISOString())
    .run();

  await env.DB.prepare(
    `INSERT INTO admin_passkey_challenges (challenge, user_id, kind, expires_at, created_at)
     VALUES (?, '', 'login', ?, ?)`
  )
    .bind(challenge, expiresAt, now.toISOString())
    .run();

  return jsonResponse({
    ok: true,
    options: {
      challenge,
      rpId: resolveRpId(request),
      timeout: 60000,
      userVerification: "required",
      allowCredentials,
    },
  });
}
