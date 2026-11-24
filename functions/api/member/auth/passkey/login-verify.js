import {
  buildMemberSessionCookie,
  checkRateLimit,
  createMemberSession,
  ensureMemberSchema,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  readJsonBody,
  serializePublicMember,
  verifyCsrfOrigin,
} from "../../../../_lib/security.js";
import { cleanStr } from "../../../../_lib/validation.js";
import {
  resolveRpId,
  verifyAssertionSignature,
  verifyAuthenticatorData,
  verifyClientData,
} from "../../../../_lib/webauthn.js";

export async function onRequestPost({ request, env }) {
  if (!env?.DB) return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  if (!verifyCsrfOrigin(request)) return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `pk_login:${ipHash}`, 20, 15 * 60 * 1000);
  if (!rl.allowed) return errorResponse(429, "RATE_LIMITED", "Quá nhiều lần thử Passkey. Vui lòng đợi ít phút.");

  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const credentialId = cleanStr(parsed.data.id || parsed.data.credentialId, 512);
  const clientDataJSON = cleanStr(parsed.data.clientDataJSON, 4096);
  const authenticatorData = cleanStr(parsed.data.authenticatorData, 4096);
  const signature = cleanStr(parsed.data.signature, 4096);
  const challenge = cleanStr(parsed.data.challenge, 256);

  if (!credentialId || !clientDataJSON || !authenticatorData || !signature || !challenge) {
    return errorResponse(400, "VALIDATION_ERROR", "Dữ liệu xác thực Passkey không đầy đủ.");
  }

  await ensureMemberSchema(env.DB);
  const nowIso = new Date().toISOString();

  const chRow = await env.DB.prepare(
    "SELECT challenge, expires_at FROM passkey_challenges WHERE challenge = ? AND kind = 'login'"
  )
    .bind(challenge)
    .first();

  if (!chRow || chRow.expires_at < nowIso) {
    return errorResponse(400, "INVALID_CHALLENGE", "Phiên đăng nhập Passkey đã hết hạn. Vui lòng thử lại.");
  }
  await env.DB.prepare("DELETE FROM passkey_challenges WHERE challenge = ?").bind(challenge).run();

  const pkRow = await env.DB.prepare("SELECT * FROM member_passkeys WHERE credential_id = ?")
    .bind(credentialId)
    .first();
  if (!pkRow) {
    return errorResponse(401, "PASSKEY_NOT_FOUND", "Không tìm thấy Passkey này trong hệ thống HolaRise.");
  }

  const memberRow = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(pkRow.member_id).first();
  if (!memberRow) {
    return errorResponse(401, "MEMBER_NOT_FOUND", "Tài khoản gắn với Passkey không còn tồn tại.");
  }
  if (Number(memberRow.is_active) !== 1) {
    return errorResponse(403, "ACCOUNT_DISABLED", "Tài khoản này đang tạm khóa.");
  }

  const origin = new URL(request.url).origin;
  const cdCheck = await verifyClientData(clientDataJSON, "webauthn.get", challenge, origin);
  if (!cdCheck.ok) return errorResponse(401, "INVALID_CLIENT_DATA", cdCheck.error);

  const rpId = resolveRpId(request);
  const authCheck = await verifyAuthenticatorData(authenticatorData, rpId);
  if (!authCheck.ok) return errorResponse(401, "INVALID_AUTH_DATA", authCheck.error);

  const validSig = await verifyAssertionSignature({
    publicKeySpki: pkRow.public_key_spki,
    algorithm: pkRow.algorithm,
    authenticatorDataBytes: authCheck.authData,
    clientDataRawBytes: cdCheck.rawBytes,
    signatureB64: signature,
  }).catch(() => false);

  if (!validSig) {
    return errorResponse(401, "INVALID_SIGNATURE", "Chữ ký Passkey không hợp lệ.");
  }

  await env.DB.prepare("UPDATE member_passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?")
    .bind(Math.max(Number(pkRow.sign_count || 0), authCheck.signCount), nowIso, credentialId)
    .run();
  await env.DB.prepare("UPDATE members SET last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(nowIso, nowIso, memberRow.id)
    .run();

  const { rawToken } = await createMemberSession(env.DB, memberRow.id);
  return jsonResponse(
    { ok: true, member: serializePublicMember(memberRow) },
    200,
    { "Set-Cookie": buildMemberSessionCookie(rawToken, request) }
  );
}
