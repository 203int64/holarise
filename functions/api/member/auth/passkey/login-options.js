import {
  checkRateLimit,
  ensureMemberSchema,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  verifyCsrfOrigin,
} from "../../../../_lib/security.js";
import { generateChallengeBase64Url, resolveRpId } from "../../../../_lib/webauthn.js";

export async function onRequestPost({ request, env }) {
  if (!env?.DB) return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  if (!verifyCsrfOrigin(request)) return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `pk_opt:${ipHash}`, 30, 15 * 60 * 1000);
  if (!rl.allowed) return errorResponse(429, "RATE_LIMITED", "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.");

  await ensureMemberSchema(env.DB);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const challenge = generateChallengeBase64Url(32);

  await env.DB.prepare("DELETE FROM passkey_challenges WHERE expires_at < ?").bind(now.toISOString()).run().catch(() => {});
  await env.DB.prepare(
    "INSERT INTO passkey_challenges (challenge, member_id, kind, expires_at, created_at) VALUES (?, '', 'login', ?, ?)"
  )
    .bind(challenge, expiresAt, now.toISOString())
    .run();

  return jsonResponse({
    ok: true,
    options: {
      challenge,
      rpId: resolveRpId(request),
      timeout: 60000,
      userVerification: "preferred",
    },
  });
}
