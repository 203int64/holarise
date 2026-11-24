/**
 * POST /api/auth/media-gate
 * Verifies team access PIN (stored in Cloudflare Secret MEDIA_ACCESS_PIN, never hardcoded)
 * plus mandatory verified uploader profile (Full Name, Phone/Zalo, Department/Role, Email),
 * then issues a session cookie and prompts Passkey (Face ID / Touch ID) enrollment.
 */

import { ensureAdminPasskeySchema, getAdminUserProfile } from "../../_lib/admin-passkey-schema.js";
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

function constantTimeStringEqual(a, b) {
  const s1 = String(a || "");
  const s2 = String(b || "");
  const len = Math.max(s1.length, s2.length);
  let diff = s1.length ^ s2.length;
  for (let i = 0; i < len; i++) {
    diff |= (s1.charCodeAt(i) || 0) ^ (s2.charCodeAt(i) || 0);
  }
  return diff === 0;
}

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
  const rl = await checkRateLimit(env.DB, `media-gate:${ipHash}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Bạn đã nhập sai quá số lần cho phép. Vui lòng thử lại sau ${rl.retryAfterSec} giây.`,
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const pin = cleanStr(parsed.data.pin, 32);
  const fullName = cleanStr(parsed.data.fullName ?? parsed.data.name, 100);
  const phoneRaw = cleanStr(parsed.data.phone, 24).replace(/[\s.-]+/g, "");
  const department = cleanStr(parsed.data.department, 80);
  const email = cleanStr(parsed.data.email, 160).toLowerCase();

  const fields = {};
  if (!pin || !constantTimeStringEqual(pin, expectedPin)) {
    return errorResponse(401, "INVALID_PIN", "Mã cổng đội ngũ không đúng.");
  }
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

  let user = await env.DB.prepare(
    "SELECT id, email, name, role, is_active FROM admin_users WHERE email = ?"
  )
    .bind(email)
    .first();

  if (user && !user.is_active) {
    return errorResponse(403, "ACCOUNT_DISABLED", "Tài khoản này đang bị tạm khóa.");
  }

  if (user) {
    await env.DB.prepare(
      "UPDATE admin_users SET name = ?, phone = ?, department = ?, last_login_at = ? WHERE id = ?"
    )
      .bind(fullName, phoneRaw, department, now, user.id)
      .run();
  } else {
    const newId = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const randomPw = crypto.randomUUID() + crypto.randomUUID();
    const { hash, salt } = await hashPassword(randomPw);
    await env.DB.prepare(
      `INSERT INTO admin_users (id, email, name, phone, department, password_hash, password_salt, role, is_active, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'media', 1, ?, ?)`
    )
      .bind(newId, email, fullName, phoneRaw, department, hash, salt, now, now)
      .run();
    user = { id: newId };
  }

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
