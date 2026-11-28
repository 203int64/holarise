/**
 * POST /api/auth/media-login
 * Step 2 of /media/ vault flow:
 * Requires valid HMAC gateToken (or PIN matching MEDIA_ACCESS_PIN / default "1948"),
 * then authenticates either:
 *   1. Admin account (admin_users) — full Media & CMS permissions
 *   2. Member account (members) with NGV upgrade (can_access_media_portal = 1 / media.portal)
 * Regular members without NGV upgrade receive 403 NGV_REQUIRED.
 */

import { getAdminUserProfile } from "../../_lib/admin-passkey-schema.js";
import { hasMemberCapability } from "../../_lib/capabilities.js";
import { constantTimeStringEqual, getMediaAccessPin, verifyGateToken } from "../../_lib/gate-token.js";
import { getMemberPermissions } from "../../_lib/media-access.js";
import {
  buildMemberSessionCookie,
  buildSessionCookie,
  checkRateLimit,
  createMemberSession,
  createSession,
  ensureMemberSchema,
  errorResponse,
  getClientIpHash,
  isSoleAdminAccount,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
  verifyPassword,
} from "../../_lib/security.js";
import { cleanStr, isValidEmail, parseMemberIdentifier } from "../../_lib/validation.js";

const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const DUMMY_HASH = "0".repeat(64);

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `media-login:${ipHash}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Bạn thử đăng nhập quá nhiều lần. Vui lòng chờ ${rl.retryAfterSec} giây rồi thử lại.`,
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const expectedPin = getMediaAccessPin(env);
  const gateToken = cleanStr(parsed.data.gateToken, 256);
  const pin = cleanStr(parsed.data.pin, 32);
  const gateValid =
    (gateToken && (await verifyGateToken(gateToken, expectedPin))) ||
    (pin && constantTimeStringEqual(pin, expectedPin));

  if (!gateValid) {
    return errorResponse(
      401,
      "GATE_EXPIRED",
      "Phiên mã cổng không hợp lệ hoặc đã hết hạn. Vui lòng nhập lại mã cổng."
    );
  }

  const rawIdentifier =
    parsed.data.identifier ?? parsed.data.emailOrPhone ?? parsed.data.email ?? parsed.data.phone ?? "";
  const trimmedId = cleanStr(rawIdentifier, 160);
  const password = String(parsed.data.password || "");

  if (!trimmedId || !password) {
    return errorResponse(400, "INVALID_CREDENTIALS", "Vui lòng nhập Email/Số điện thoại và mật khẩu.");
  }

  const now = new Date().toISOString();

  // 1. Check Admin / legacy team account first when identifier is an email
  const emailLower = trimmedId.toLowerCase();
  if (isValidEmail(emailLower)) {
    const adminRow = await env.DB.prepare(
      "SELECT id, email, name, role, password_hash, password_salt, is_active FROM admin_users WHERE LOWER(email) = ?"
    )
      .bind(emailLower)
      .first()
      .catch(() => null);

    if (adminRow) {
      const validAdminPw =
        Boolean(adminRow.is_active) &&
        (await verifyPassword(password, adminRow.password_hash, adminRow.password_salt));
      if (validAdminPw) {
        const [{ rawToken }, profile] = await Promise.all([
          createSession(env.DB, adminRow.id),
          getAdminUserProfile(env.DB, adminRow.id).catch(() => null),
          env.DB.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").bind(now, adminRow.id).run(),
          env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run(),
        ]);
        const userObj = profile || {
          id: adminRow.id,
          email: adminRow.email,
          name: adminRow.name,
          phone: "",
          department: "",
          role: adminRow.role,
          hasPasskey: false,
        };
        return jsonResponse(
          {
            ok: true,
            accountType: "admin",
            isSoleAdmin: isSoleAdminAccount(userObj, env),
            user: userObj,
          },
          200,
          { "Set-Cookie": buildSessionCookie(rawToken, request, false) }
        );
      }
      // If email also exists in members (e.g. upgraded NGV), fall through to check members before rejecting
    }
  }

  // 2. Authenticate Member account (Email or VN Phone) & enforce NGV upgrade
  const idInfo = parseMemberIdentifier(trimmedId);
  if (!idInfo.ok) {
    await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
    return errorResponse(401, "INVALID_CREDENTIALS", "Email/Số điện thoại hoặc mật khẩu chưa chính xác.");
  }

  await ensureMemberSchema(env.DB);
  const memberRow =
    idInfo.kind === "email"
      ? await env.DB.prepare("SELECT * FROM members WHERE LOWER(email) = ?").bind(idInfo.email).first()
      : await env.DB.prepare("SELECT * FROM members WHERE phone_norm = ?").bind(idInfo.phoneNorm).first();

  if (!memberRow) {
    await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
    return errorResponse(401, "INVALID_CREDENTIALS", "Email/Số điện thoại hoặc mật khẩu chưa chính xác.");
  }

  const validMemberPw = await verifyPassword(password, memberRow.password_hash, memberRow.password_salt);
  if (!validMemberPw) {
    return errorResponse(401, "INVALID_CREDENTIALS", "Email/Số điện thoại hoặc mật khẩu chưa chính xác.");
  }

  if (Number(memberRow.is_active) !== 1) {
    return errorResponse(403, "ACCOUNT_DISABLED", "Tài khoản này hiện đang bị tạm khóa.");
  }

  const perms = await getMemberPermissions(env.DB, memberRow.id);
  const hasNgvAccess =
    perms.canAccessMediaPortal || (await hasMemberCapability(env.DB, memberRow.id, "media.portal"));

  if (!hasNgvAccess) {
    return errorResponse(
      403,
      "NGV_REQUIRED",
      "Tài khoản Thành viên này chưa được nâng quyền NGV. Vui lòng liên hệ Quản trị để mở quyền vào Cổng Media."
    );
  }

  const [{ rawToken }] = await Promise.all([
    createMemberSession(env.DB, memberRow.id),
    env.DB.prepare("UPDATE members SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, memberRow.id)
      .run(),
  ]);

  const ngvUser = {
    id: memberRow.id,
    email: memberRow.email || "",
    name: memberRow.name || "Thành viên NGV",
    phone: memberRow.phone_display || "",
    department: `NGV · ${memberRow.member_code || "Cộng tác viên Media"}`,
    memberCode: memberRow.member_code || "",
    role: "ngv",
    hasPasskey: false,
    canUpload: true,
  };

  return jsonResponse(
    {
      ok: true,
      accountType: "ngv",
      isSoleAdmin: false,
      user: ngvUser,
    },
    200,
    { "Set-Cookie": buildMemberSessionCookie(rawToken, request, false) }
  );
}
