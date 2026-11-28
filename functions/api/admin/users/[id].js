import {
  DELEGATABLE_ROLES,
  getDefaultDepartmentForRole,
  getRoleMeta,
  logAudit,
  normalizeRole,
} from "../../../_lib/rbac.js";
import { errorResponse, hashPassword, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  let target = null;
  let hasExtendedCols = true;
  try {
    target = await context.env.DB.prepare(
      "SELECT id, email, name, role, department, phone, is_active FROM admin_users WHERE id = ?"
    )
      .bind(id)
      .first();
  } catch {
    hasExtendedCols = false;
    target = await context.env.DB.prepare(
      "SELECT id, email, name, role, is_active FROM admin_users WHERE id = ?"
    )
      .bind(id)
      .first();
  }
  if (!target) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy tài khoản.");
  }

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const isActive =
    parsed.data.is_active !== undefined ? (parsed.data.is_active ? 1 : 0) : target.is_active;

  let role = target.role;
  if (parsed.data.role !== undefined && parsed.data.role !== target.role) {
    const reqRole = cleanStr(parsed.data.role, 32).toLowerCase();
    if (reqRole === "super_admin" || !DELEGATABLE_ROLES.has(reqRole)) {
      return errorResponse(
        403,
        "ADMIN_LOCKED",
        "Hệ thống chỉ cho phép duy nhất 1 tài khoản Chủ nhiệm (super_admin). Không thể nâng quyền lên super_admin."
      );
    }
    role = reqRole;
  }

  const name = parsed.data.name !== undefined ? cleanStr(parsed.data.name, 100) || target.name : target.name;
  const department =
    parsed.data.department !== undefined
      ? cleanStr(parsed.data.department, 80) || getDefaultDepartmentForRole(role)
      : target.department || getDefaultDepartmentForRole(role);
  const phone = parsed.data.phone !== undefined ? cleanStr(parsed.data.phone, 30) : target.phone || "";

  if (id === auth.user.id && (isActive === 0 || role !== "super_admin")) {
    return errorResponse(400, "SELF_LOCKOUT", "Không thể tự khóa hoặc hạ quyền chính tài khoản đang đăng nhập.");
  }

  const stmts = [
    hasExtendedCols
      ? context.env.DB.prepare(
          "UPDATE admin_users SET name = ?, role = ?, department = ?, phone = ?, is_active = ? WHERE id = ?"
        ).bind(name, role, department, phone, isActive, id)
      : context.env.DB.prepare("UPDATE admin_users SET name = ?, role = ?, is_active = ? WHERE id = ?").bind(
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

  const canonicalRole = normalizeRole(role) || role;
  await logAudit(context.env.DB, auth.user, {
    action: "user.update",
    targetType: "admin_user",
    targetId: id,
    summary: `Cập nhật nhân sự ${name} (${getRoleMeta(canonicalRole).shortLabel} · ${department}${isActive ? "" : " · Đã khóa"})`,
    meta: { role, department, isActive: Boolean(isActive), passwordReset: Boolean(parsed.data.newPassword) },
  });

  const updated = hasExtendedCols
    ? await context.env.DB.prepare(
        "SELECT id, email, name, role, department, phone, is_active, created_at, last_login_at FROM admin_users WHERE id = ?"
      )
        .bind(id)
        .first()
    : await context.env.DB.prepare(
        "SELECT id, email, name, role, is_active, created_at, last_login_at FROM admin_users WHERE id = ?"
      )
        .bind(id)
        .first();

  return jsonResponse({
    ok: true,
    item: {
      ...updated,
      canonicalRole,
      roleLabel: getRoleMeta(canonicalRole).label,
      roleShortLabel: getRoleMeta(canonicalRole).shortLabel,
      department: updated?.department || department,
      phone: updated?.phone || "",
    },
  });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  if (id === auth.user.id) {
    return errorResponse(400, "SELF_DELETE", "Không thể tự xóa tài khoản đang đăng nhập.");
  }
  const target = await context.env.DB.prepare("SELECT id, email, name, role FROM admin_users WHERE id = ?")
    .bind(id)
    .first();
  if (!target) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy tài khoản để xóa.");
  }
  await context.env.DB.prepare("DELETE FROM admin_users WHERE id = ?").bind(id).run();
  await logAudit(context.env.DB, auth.user, {
    action: "user.delete",
    targetType: "admin_user",
    targetId: id,
    summary: `Xóa tài khoản ${target.name} (${target.email})`,
  });
  return jsonResponse({ ok: true, id });
}
