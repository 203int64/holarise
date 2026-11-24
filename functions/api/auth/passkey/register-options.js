import { ensureAdminPasskeySchema, getAdminUserProfile } from "../../../_lib/admin-passkey-schema.js";
import { errorResponse, jsonResponse, requireAdmin } from "../../../_lib/security.js";
import { bytesToBase64Url, generateChallengeBase64Url, resolveRpId } from "../../../_lib/webauthn.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: ["super_admin", "editor", "media"] });
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  await ensureAdminPasskeySchema(env.DB);
  const profile = await getAdminUserProfile(env.DB, auth.user.id);
  if (!profile) {
    return errorResponse(404, "USER_NOT_FOUND", "Không tìm thấy tài khoản.");
  }

  const { results: existing } = await env.DB.prepare(
    "SELECT credential_id FROM admin_passkeys WHERE user_id = ?"
  )
    .bind(profile.id)
    .all();

  const challenge = generateChallengeBase64Url(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  await env.DB.prepare(
    "DELETE FROM admin_passkey_challenges WHERE expires_at <= ?"
  )
    .bind(now.toISOString())
    .run();

  await env.DB.prepare(
    `INSERT INTO admin_passkey_challenges (challenge, user_id, kind, expires_at, created_at)
     VALUES (?, ?, 'register', ?, ?)`
  )
    .bind(challenge, profile.id, expiresAt, now.toISOString())
    .run();

  return jsonResponse({
    ok: true,
    options: {
      challenge,
      rp: {
        name: "HolaRise – Ban Hình Ảnh & Quản Trị",
        id: resolveRpId(request),
      },
      user: {
        id: bytesToBase64Url(new TextEncoder().encode(profile.id)),
        name: profile.email,
        displayName: `${profile.name}${profile.department ? ` (${profile.department})` : ""}`,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      excludeCredentials: (existing || []).map((row) => ({
        type: "public-key",
        id: row.credential_id,
      })),
    },
  });
}
