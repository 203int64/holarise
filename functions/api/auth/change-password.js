import {
  errorResponse,
  hashPassword,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  verifyPassword,
} from "../../_lib/security.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: ["super_admin", "editor", "media"] });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const currentPassword = String(parsed.data.currentPassword || "");
  const newPassword = String(parsed.data.newPassword || "");

  if (newPassword.length < 8) {
    return errorResponse(400, "VALIDATION_ERROR", "Mật khẩu mới cần tối thiểu 8 ký tự.", {
      newPassword: "Tối thiểu 8 ký tự.",
    });
  }

  const row = await context.env.DB.prepare(
    "SELECT password_hash, password_salt FROM admin_users WHERE id = ?"
  )
    .bind(auth.user.id)
    .first();

  if (!row || !(await verifyPassword(currentPassword, row.password_hash, row.password_salt))) {
    return errorResponse(400, "INVALID_PASSWORD", "Mật khẩu hiện tại không chính xác.", {
      currentPassword: "Mật khẩu hiện tại không đúng.",
    });
  }

  const { hash, salt } = await hashPassword(newPassword);
  await context.env.DB.batch([
    context.env.DB.prepare("UPDATE admin_users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(
      hash,
      salt,
      auth.user.id
    ),
    context.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(
      auth.user.id,
      auth.user.session_id
    ),
  ]);

  return jsonResponse({ ok: true, message: "Đã đổi mật khẩu thành công." });
}
