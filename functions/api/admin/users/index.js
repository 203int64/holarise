import { errorResponse, hashPassword, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr, isValidEmail } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const { results } = await context.env.DB.prepare(
    "SELECT id, email, name, role, is_active, created_at, last_login_at FROM admin_users ORDER BY created_at ASC LIMIT 50"
  ).all();

  return jsonResponse({ ok: true, items: results || [] });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const email = cleanStr(parsed.data.email, 160).toLowerCase();
  const name = cleanStr(parsed.data.name, 100);
  const role =
    parsed.data.role === "super_admin" || parsed.data.role === "media"
      ? parsed.data.role
      : "editor";
  const password = String(parsed.data.password || "");

  const fields = {};
  if (!isValidEmail(email)) fields.email = "Email không hợp lệ.";
  if (name.length < 2) fields.name = "Vui lòng nhập tên thành viên BĐP.";
  if (password.length < 8) fields.password = "Mật khẩu tạm cần tối thiểu 8 ký tự.";
  if (Object.keys(fields).length > 0) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin tài khoản chưa hợp lệ.", fields);
  }

  const dup = await context.env.DB.prepare("SELECT id FROM admin_users WHERE email = ?").bind(email).first();
  if (dup) {
    return errorResponse(409, "EMAIL_EXISTS", "Email này đã có tài khoản trong hệ thống.", {
      email: "Email đã tồn tại.",
    });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { hash, salt } = await hashPassword(password);

  await context.env.DB.prepare(
    "INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
  )
    .bind(id, email, name, role, hash, salt, now)
    .run();

  return jsonResponse(
    {
      ok: true,
      item: { id, email, name, role, is_active: 1, created_at: now, last_login_at: null },
    },
    201
  );
}
