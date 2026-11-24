import {
  ensureMemberSchema,
  errorResponse,
  jsonResponse,
  requireMember,
  verifyCsrfOrigin,
} from "../../../../_lib/security.js";
import { bytesToBase64Url, generateChallengeBase64Url, resolveRpId } from "../../../../_lib/webauthn.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  if (!verifyCsrfOrigin(request)) return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");

  const auth = await requireMember(context);
  if (auth.error) return auth.error;
  const member = auth.member;

  await ensureMemberSchema(env.DB);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const challenge = generateChallengeBase64Url(32);

  await env.DB.prepare("DELETE FROM passkey_challenges WHERE expires_at < ?").bind(now.toISOString()).run().catch(() => {});
  await env.DB.prepare(
    "INSERT INTO passkey_challenges (challenge, member_id, kind, expires_at, created_at) VALUES (?, ?, 'register', ?, ?)"
  )
    .bind(challenge, member.id, expiresAt, now.toISOString())
    .run();

  const existing = await env.DB.prepare("SELECT credential_id FROM member_passkeys WHERE member_id = ?")
    .bind(member.id)
    .all()
    .catch(() => ({ results: [] }));

  const rpId = resolveRpId(request);
  const userIdB64 = bytesToBase64Url(new TextEncoder().encode(member.id));

  return jsonResponse({
    ok: true,
    options: {
      challenge,
      rp: { name: "HolaRise", id: rpId },
      user: {
        id: userIdB64,
        name: member.email || member.phone_display || member.member_code,
        displayName: member.name || "Thành viên Hola",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 60000,
      attestation: "none",
      excludeCredentials: (existing.results || []).map((r) => ({
        type: "public-key",
        id: r.credential_id,
      })),
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "preferred",
      },
    },
  });
}
