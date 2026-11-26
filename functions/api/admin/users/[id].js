import { errorResponse, hashPassword, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const target = await context.env.DB.prepare(
    "SELECT id, email, name, role, is_active FROM admin_users WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!target) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy tài khoản.");
  }

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const isActive =
    parsed.data.is_active !== undefined ? (parsed.data.is_active ? 1 : 0) : target.is_active;
  if (parsed.data.role !== undefined && parsed.data.role !== target.role && parsed.data.role !== "media") {
    return errorResponse(
      403,
      "ADMIN_LOCKED",
      "Hệ thống chỉ cho phép duy nhất 1 tài khoản Quản trị chính (203int64). Không thể nâng quyền tài khoản khác."
    );
  }
  const role = parsed.data.role === "media" ? "media" : target.role;
  const name = parsed.data.name !== undefined ? cleanStr(parsed.data.name, 100) || target.name : target.name;

  if (id === auth.user.id && (isActive === 0 || role !== "super_admin")) {
    return errorResponse(400, "SELF_LOCKOUT", "Không thể tự khóa hoặc hạ quyền chính tài khoản đang đăng nhập.");
  }

  const stmts = [
    context.env.DB.prepare("UPDATE admin_users SET name = ?, role = ?, is_active = ? WHERE id = ?").bind(
      name,
      role,
      isActive,
      id
    ),
  ];

  if (parsed.data.newPassword) {
    const pw = String(parsed.data.newPassword);
    if (pw.length < 8) {
      return errorResponse(400, "VALIDATION_ERROR", "Mật khẩu đặt lại cần tối thiểu 8 ký tự.");
    }
    const { hash, salt } = await hashPassword(pw);
    stmts.push(
      context.env.DB.prepare("UPDATE admin_users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(
        hash,
        salt,
        id
      ),
      context.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id)
    );
  }

  if (isActive === 0) {
    stmts.push(context.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  }

  await context.env.DB.batch(stmts);
  const updated = await context.env.DB.prepare(
    "SELECT id, email, name, role, is_active, created_at, last_login_at FROM admin_users WHERE id = ?"
  )
    .bind(id)
    .first();
  return jsonResponse({ ok: true, item: updated });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  if (id === auth.user.id) {
    return errorResponse(400, "SELF_DELETE", "Không thể tự xóa tài khoản đang đăng nhập.");
  }
  const res = await context.env.DB.prepare("DELETE FROM admin_users WHERE id = ?").bind(id).run();
  if (Number(res?.meta?.changes || 0) === 0) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy tài khoản để xóa.");
  }
  return jsonResponse({ ok: true, id });
}
