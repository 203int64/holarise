import { ensureAdminPasskeySchema } from "../../../_lib/admin-passkey-schema.js";
import { errorResponse, jsonResponse, readJsonBody, verifyCsrfOrigin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";
import { generateChallengeBase64Url, resolveRpId } from "../../../_lib/webauthn.js";

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  await ensureAdminPasskeySchema(env.DB);
  const parsed = await readJsonBody(request, 8 * 1024);
  const email = parsed.ok ? cleanStr(parsed.data?.email, 160).toLowerCase() : "";

  let allowCredentials = [];
  if (email) {
    const { results } = await env.DB.prepare(
      `SELECT p.credential_id
       FROM admin_passkeys p
       JOIN admin_users u ON u.id = p.user_id
       WHERE u.email = ? AND u.is_active = 1`
    )
      .bind(email)
      .all();
    allowCredentials = (results || []).map((r) => ({ type: "public-key", id: r.credential_id }));
  }

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
