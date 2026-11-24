import {
  ensureMemberSchema,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireMember,
  verifyCsrfOrigin,
} from "../../../../_lib/security.js";
import { cleanStr } from "../../../../_lib/validation.js";
import {
  importSpkiPublicKey,
  resolveRpId,
  verifyAuthenticatorData,
  verifyClientData,
} from "../../../../_lib/webauthn.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  if (!verifyCsrfOrigin(request)) return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");

  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;
  const member = auth.member;

  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const credentialId = cleanStr(parsed.data.id || parsed.data.credentialId, 512);
  const clientDataJSON = cleanStr(parsed.data.clientDataJSON, 4096);
  const authenticatorData = cleanStr(parsed.data.authenticatorData, 4096);
  const publicKeySpki = cleanStr(parsed.data.publicKey, 4096);
  const algorithm = Number(parsed.data.algorithm ?? -7);
  const challenge = cleanStr(parsed.data.challenge, 256);
  const deviceLabel = cleanStr(parsed.data.deviceLabel, 80) || "Passkey thiết bị";

  if (!credentialId || !clientDataJSON || !authenticatorData || !publicKeySpki || !challenge) {
    return errorResponse(400, "VALIDATION_ERROR", "Dữ liệu Passkey chưa đầy đủ.");
  }

  await ensureMemberSchema(env.DB);
  const nowIso = new Date().toISOString();

  // Single-use challenge lookup & consumption
  const chRow = await env.DB.prepare(
    "SELECT challenge, member_id, expires_at FROM passkey_challenges WHERE challenge = ? AND kind = 'register'"
  )
    .bind(challenge)
    .first();

  if (!chRow || chRow.member_id !== member.id || chRow.expires_at < nowIso) {
    return errorResponse(400, "INVALID_CHALLENGE", "Phiên tạo Passkey đã hết hạn. Vui lòng thử lại.");
  }
  await env.DB.prepare("DELETE FROM passkey_challenges WHERE challenge = ?").bind(challenge).run();

  const origin = new URL(request.url).origin;
  const cdCheck = await verifyClientData(clientDataJSON, "webauthn.create", challenge, origin);
  if (!cdCheck.ok) return errorResponse(400, "INVALID_CLIENT_DATA", cdCheck.error);

  const rpId = resolveRpId(request);
  const authCheck = await verifyAuthenticatorData(authenticatorData, rpId);
  if (!authCheck.ok) return errorResponse(400, "INVALID_AUTH_DATA", authCheck.error);

  try {
    await importSpkiPublicKey(publicKeySpki, algorithm);
  } catch {
    return errorResponse(400, "INVALID_PUBLIC_KEY", "Khóa công khai Passkey không được hỗ trợ (chỉ hỗ trợ ES256/RS256).");
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO member_passkeys
     (credential_id, member_id, public_key_spki, algorithm, sign_count, device_label, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '')`
  )
    .bind(credentialId, member.id, publicKeySpki, algorithm, authCheck.signCount, deviceLabel, nowIso)
    .run();

  return jsonResponse({
    ok: true,
    passkey: {
      id: credentialId,
      deviceLabel,
      createdAt: nowIso,
    },
  }, 201);
}
