import {
  buildMemberSessionCookie,
  checkRateLimit,
  createMemberSession,
  ensureMemberSchema,
  errorResponse,
  getClientIpHash,
  hashPassword,
  jsonResponse,
  readJsonBody,
  serializePublicMember,
  verifyCsrfOrigin,
  verifyPassword,
} from "../../../_lib/security.js";
import { cleanStr, parseMemberIdentifier } from "../../../_lib/validation.js";
import { createEventRegistrationForMember } from "../../registrations.js";

const DUMMY_SALT_HEX = "00112233445566778899aabbccddeeff";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const rawIdentifier =
    parsed.data.identifier ?? parsed.data.emailOrPhone ?? parsed.data.email ?? parsed.data.phone ?? "";
  const idInfo = parseMemberIdentifier(rawIdentifier);
  const password = typeof parsed.data.password === "string" ? parsed.data.password : "";

  if (!idInfo.ok || !password) {
    return errorResponse(400, "VALIDATION_ERROR", "Vui lòng nhập Email/Số điện thoại và Mật khẩu.", {
      identifier: !idInfo.ok ? idInfo.error : undefined,
      password: !password ? "Vui lòng nhập mật khẩu." : undefined,
    });
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `mbr_login:${ipHash}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Bạn đã nhập sai nhiều lần liên tiếp. Vui lòng thử lại sau ít phút.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  await ensureMemberSchema(env.DB);

  const memberRow =
    idInfo.kind === "email"
      ? await env.DB.prepare("SELECT * FROM members WHERE email = ?").bind(idInfo.email).first()
      : await env.DB.prepare("SELECT * FROM members WHERE phone_norm = ?").bind(idInfo.phoneNorm).first();

  if (!memberRow) {
    // Equalize PBKDF2 timing to avoid account enumeration
    await hashPassword(password, DUMMY_SALT_HEX);
    return errorResponse(401, "INVALID_CREDENTIALS", "Email/Số điện thoại hoặc mật khẩu chưa chính xác.");
  }

  const validPw = await verifyPassword(password, memberRow.password_hash, memberRow.password_salt);
  if (!validPw) {
    return errorResponse(401, "INVALID_CREDENTIALS", "Email/Số điện thoại hoặc mật khẩu chưa chính xác.");
  }

  if (Number(memberRow.is_active) !== 1) {
    return errorResponse(
      403,
      "ACCOUNT_DISABLED",
      "Tài khoản thành viên này hiện đang tạm khóa. Vui lòng liên hệ Ban Điều Phối nếu cần hỗ trợ."
    );
  }

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE members SET last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, memberRow.id)
    .run();
  memberRow.last_login_at = now;

  const { rawToken } = await createMemberSession(env.DB, memberRow.id);

  let autoRegistration = null;
  const autoEv = parsed.data.autoRegisterEvent;
  if (autoEv && typeof autoEv === "object" && (cleanStr(autoEv.eventId || autoEv.event_id, 120) || cleanStr(autoEv.activityTitle || autoEv.activity, 220))) {
    autoRegistration = await createEventRegistrationForMember(context, memberRow, autoEv, ipHash);
  }

  return jsonResponse(
    {
      ok: true,
      member: serializePublicMember(memberRow),
      autoRegistration,
      message: `Mừng bạn quay lại, ${memberRow.name}!`,
    },
    200,
    {
      "Set-Cookie": buildMemberSessionCookie(rawToken, request, false),
    }
  );
}
