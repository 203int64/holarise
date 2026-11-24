import { ensureAdminPasskeySchema } from "../../../_lib/admin-passkey-schema.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";
import {
  importSpkiPublicKey,
  resolveRpId,
  verifyAuthenticatorData,
  verifyClientData,
} from "../../../_lib/webauthn.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: ["super_admin", "editor", "media"] });
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  await ensureAdminPasskeySchema(env.DB);

  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const credentialId = cleanStr(parsed.data.credentialId, 512);
  const publicKeySpki = cleanStr(parsed.data.publicKeySpki, 2048);
  const algorithm = Number(parsed.data.algorithm || -7);
  const clientDataJSON = cleanStr(parsed.data.clientDataJSON, 4096);
  const authenticatorData = cleanStr(parsed.data.authenticatorData, 4096);
  const challenge = cleanStr(parsed.data.challenge, 256);
  const deviceLabel = cleanStr(parsed.data.deviceLabel, 80) || "Thiết bị sinh trắc học";

  if (!credentialId || !publicKeySpki || !clientDataJSON || !authenticatorData || !challenge) {
    return errorResponse(400, "INVALID_PASSKEY_PAYLOAD", "Thiếu dữ liệu đăng ký sinh trắc học.");
  }
  if (algorithm !== -7 && algorithm !== -257) {
    return errorResponse(400, "UNSUPPORTED_ALGORITHM", "Thuật toán khóa sinh trắc học không được hỗ trợ.");
  }

  const nowIso = new Date().toISOString();
  const chRow = await env.DB.prepare(
    "SELECT challenge FROM admin_passkey_challenges WHERE challenge = ? AND user_id = ? AND kind = 'register' AND expires_at > ?"
  )
    .bind(challenge, auth.user.id, nowIso)
    .first();

  if (!chRow) {
    return errorResponse(400, "EXPIRED_CHALLENGE", "Phiên kích hoạt sinh trắc học đã hết hạn. Vui lòng thử lại.");
  }

  await env.DB.prepare("DELETE FROM admin_passkey_challenges WHERE challenge = ?")
    .bind(challenge)
    .run();

  const expectedOrigin = new URL(request.url).origin;
  const rpId = resolveRpId(request);

  try {
    await verifyClientData(clientDataJSON, "webauthn.create", challenge, expectedOrigin);
    const authData = await verifyAuthenticatorData(authenticatorData, rpId);
    await importSpkiPublicKey(publicKeySpki, algorithm);

    await env.DB.prepare(
      `INSERT OR REPLACE INTO admin_passkeys
       (credential_id, user_id, public_key_spki, algorithm, sign_count, device_label, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        credentialId,
        auth.user.id,
        publicKeySpki,
        algorithm,
        authData.signCount,
        deviceLabel,
        nowIso,
        nowIso
      )
      .run();
  } catch (err) {
    return errorResponse(400, "PASSKEY_VERIFY_FAILED", err?.message || "Không thể xác thực khóa sinh trắc học.");
  }

  return jsonResponse({ ok: true, credentialId, deviceLabel }, 201);
}
