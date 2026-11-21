import {
  buildSessionCookie,
  createSession,
  errorResponse,
  hashPassword,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr, isValidEmail } from "../../_lib/validation.js";

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const email = cleanStr(parsed.data.email, 160).toLowerCase();
  const name = cleanStr(parsed.data.name, 100) || "Quản trị viên HolaRise";
  const password = String(parsed.data.password || "");

  const fields = {};
  if (!isValidEmail(email)) fields.email = "Vui lòng nhập địa chỉ email hợp lệ.";
  if (password.length < 8) fields.password = "Mật khẩu cần tối thiểu 8 ký tự.";
  if (Object.keys(fields).length > 0) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin khởi tạo chưa hợp lệ.", fields);
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM admin_users").first();
  if (Number(countRow?.cnt || 0) > 0) {
    return errorResponse(
      409,
      "ALREADY_INITIALIZED",
      "Hệ thống đã có tài khoản quản trị. Vui lòng đăng nhập bằng tài khoản đã tạo."
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { hash, salt } = await hashPassword(password);

  // Guard race condition with conditional INSERT WHERE NOT EXISTS
  const res = await env.DB.prepare(
    `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at, last_login_at)
     SELECT ?, ?, ?, 'super_admin', ?, ?, 1, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM admin_users)`
  )
    .bind(id, email, name, hash, salt, now, now)
    .run();

  if (Number(res?.meta?.changes || 0) === 0) {
    return errorResponse(409, "ALREADY_INITIALIZED", "Hệ thống đã được khởi tạo trước đó.");
  }

  const { rawToken } = await createSession(env.DB, id);
  return jsonResponse(
    {
      ok: true,
      user: { id, email, name, role: "super_admin" },
    },
    201,
    { "Set-Cookie": buildSessionCookie(rawToken, request, false) }
  );
}
