/**
 * POST /api/auth/media-gate
 * Step 2 (Register): Registers or updates a verified team uploader account
 * after validating either the HMAC gateToken from Step 1 (/api/auth/verify-gate)
 * or direct team access PIN (MEDIA_ACCESS_PIN).
 */

import { ensureAdminPasskeySchema, getAdminUserProfile } from "../../_lib/admin-passkey-schema.js";
import { constantTimeStringEqual, verifyGateToken } from "../../_lib/gate-token.js";
import {
  buildSessionCookie,
  checkRateLimit,
  createSession,
  errorResponse,
  getClientIpHash,
  hashPassword,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr, isValidEmail } from "../../_lib/validation.js";

const VN_PHONE_RE = /^(?:0|\+?84)(?:3|5|7|8|9)\d{8}$/;

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const expectedPin = String(env?.MEDIA_ACCESS_PIN || "").trim();
  if (!expectedPin) {
    return errorResponse(
      503,
      "PIN_NOT_CONFIGURED",
      "Chưa cấu hình mã cổng đội ngũ (MEDIA_ACCESS_PIN) trên hệ thống."
    );
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `media-gate:${ipHash}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${rl.retryAfterSec} giây.`,
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const gateToken = cleanStr(parsed.data.gateToken, 256);
  const pin = cleanStr(parsed.data.pin, 32);
  const gateValid =
    (gateToken && (await verifyGateToken(gateToken, expectedPin))) ||
    (pin && constantTimeStringEqual(pin, expectedPin));

  if (!gateValid) {
    return errorResponse(401, "INVALID_PIN", "Phiên xác thực mã cổng không hợp lệ hoặc đã hết hạn.");
  }

  const fullName = cleanStr(parsed.data.fullName ?? parsed.data.name, 100);
  const phoneRaw = cleanStr(parsed.data.phone, 24).replace(/[\s.-]+/g, "");
  const department = cleanStr(parsed.data.department, 80);
  const email = cleanStr(parsed.data.email, 160).toLowerCase();
  const password = String(parsed.data.password || "");

  const fields = {};
  if (fullName.length < 3 || fullName.split(/\s+/).filter(Boolean).length < 2) {
    fields.fullName = "Vui lòng nhập đầy đủ Họ và tên (ít nhất 2 từ).";
  }
  if (!VN_PHONE_RE.test(phoneRaw)) {
    fields.phone = "Vui lòng nhập số điện thoại/Zalo Việt Nam hợp lệ (10 chữ số).";
  }
  if (department.length < 2) {
    fields.department = "Vui lòng ghi rõ Ban / Vai trò phụ trách (ví dụ: Ban Hình Ảnh).";
  }
  if (!isValidEmail(email)) {
    fields.email = "Vui lòng nhập địa chỉ email hợp lệ.";
  }
  if (password && password.length < 8) {
    fields.password = "Mật khẩu tối thiểu 8 ký tự.";
  }
  if (Object.keys(fields).length > 0) {
    return errorResponse(
      400,
      "INCOMPLETE_PROFILE",
      "Thông tin người đăng chưa đầy đủ hoặc chưa đúng định dạng.",
      fields
    );
  }

  await ensureAdminPasskeySchema(env.DB);
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    "SELECT id, is_active FROM admin_users WHERE email = ?"
  )
    .bind(email)
    .first();

  if (existing) {
    if (!existing.is_active) {
      return errorResponse(403, "ACCOUNT_DISABLED", "Tài khoản này đang bị tạm khóa.");
    }
    return errorResponse(
      409,
      "EMAIL_EXISTS",
      "Email này đã có tài khoản. Vui lòng chuyển sang Đăng nhập bằng Email.",
      { email: "Email này đã được đăng ký trước đó." }
    );
  }

  const newId = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const secretPw = password || crypto.randomUUID() + crypto.randomUUID();
  const { hash, salt } = await hashPassword(secretPw);
  await env.DB.prepare(
    `INSERT INTO admin_users (id, email, name, phone, department, password_hash, password_salt, role, is_active, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'media', 1, ?, ?)`
  )
    .bind(newId, email, fullName, phoneRaw, department, hash, salt, now, now)
    .run();
  const user = { id: newId };

  const [{ rawToken }, profile] = await Promise.all([
    createSession(env.DB, user.id),
    getAdminUserProfile(env.DB, user.id),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run(),
  ]);

  return jsonResponse(
    {
      ok: true,
      user: profile,
      requiresPasskeySetup: !profile?.hasPasskey,
    },
    200,
    { "Set-Cookie": buildSessionCookie(rawToken, request, false) }
  );
}
