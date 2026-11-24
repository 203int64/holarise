import { ensureAdminPasskeySchema, getAdminUserProfile } from "../../../_lib/admin-passkey-schema.js";
import {
  buildSessionCookie,
  checkRateLimit,
  createSession,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";
import {
  resolveRpId,
  verifyAssertionSignature,
  verifyAuthenticatorData,
  verifyClientData,
} from "../../../_lib/webauthn.js";

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `passkey-login:${ipHash}`, 15, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Bạn thử quá nhiều lần. Vui lòng chờ ${rl.retryAfterSec} giây.`,
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  await ensureAdminPasskeySchema(env.DB);
  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const credentialId = cleanStr(parsed.data.credentialId, 512);
  const clientDataJSON = cleanStr(parsed.data.clientDataJSON, 4096);
  const authenticatorData = cleanStr(parsed.data.authenticatorData, 4096);
  const signature = cleanStr(parsed.data.signature, 2048);
  const challenge = cleanStr(parsed.data.challenge, 256);

  if (!credentialId || !clientDataJSON || !authenticatorData || !signature || !challenge) {
    return errorResponse(400, "INVALID_PASSKEY_PAYLOAD", "Thiếu dữ liệu xác thực sinh trắc học.");
  }

  const nowIso = new Date().toISOString();
  const chRow = await env.DB.prepare(
    "SELECT challenge FROM admin_passkey_challenges WHERE challenge = ? AND kind = 'login' AND expires_at > ?"
  )
    .bind(challenge, nowIso)
    .first();
  if (!chRow) {
    return errorResponse(400, "EXPIRED_CHALLENGE", "Phiên xác thực sinh trắc học đã hết hạn.");
  }
  await env.DB.prepare("DELETE FROM admin_passkey_challenges WHERE challenge = ?")
    .bind(challenge)
    .run();

  const cred = await env.DB.prepare(
    `SELECT p.credential_id, p.user_id, p.public_key_spki, p.algorithm, p.sign_count, u.is_active
     FROM admin_passkeys p
     JOIN admin_users u ON u.id = p.user_id
     WHERE p.credential_id = ?`
  )
    .bind(credentialId)
    .first();

  if (!cred || !cred.is_active) {
    return errorResponse(401, "PASSKEY_NOT_FOUND", "Không tìm thấy khóa sinh trắc học hợp lệ.");
  }

  try {
    const expectedOrigin = new URL(request.url).origin;
    const rpId = resolveRpId(request);
    await verifyClientData(clientDataJSON, "webauthn.get", challenge, expectedOrigin);
    const authData = await verifyAuthenticatorData(authenticatorData, rpId);
    if (cred.sign_count > 0 && authData.signCount > 0 && authData.signCount <= cred.sign_count) {
      return errorResponse(401, "PASSKEY_REPLAY", "Phát hiện chữ ký sinh trắc học không hợp lệ.");
    }
    const valid = await verifyAssertionSignature({
      publicKeySpki: cred.public_key_spki,
      algorithm: cred.algorithm,
      authenticatorDataB64: authenticatorData,
      clientDataJSONB64: clientDataJSON,
      signatureB64: signature,
    });
    if (!valid) {
      return errorResponse(401, "PASSKEY_INVALID", "Xác thực sinh trắc học không khớp.");
    }

    await env.DB.prepare(
      "UPDATE admin_passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?"
    )
      .bind(Math.max(cred.sign_count, authData.signCount), nowIso, cred.credential_id)
      .run();
  } catch (err) {
    return errorResponse(401, "PASSKEY_VERIFY_FAILED", err?.message || "Xác thực sinh trắc học thất bại.");
  }

  const [{ rawToken }, profile] = await Promise.all([
    createSession(env.DB, cred.user_id),
    getAdminUserProfile(env.DB, cred.user_id),
    env.DB.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").bind(nowIso, cred.user_id).run(),
  ]);

  return jsonResponse(
    { ok: true, user: profile },
    200,
    { "Set-Cookie": buildSessionCookie(rawToken, request, false) }
  );
}
