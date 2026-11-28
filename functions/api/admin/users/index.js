import {
  DELEGATABLE_ROLES,
  DEPARTMENTS,
  getDefaultDepartmentForRole,
  getRoleMeta,
  listRolesCatalog,
  logAudit,
  normalizeRole,
} from "../../../_lib/rbac.js";
import { errorResponse, hashPassword, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr, isValidEmail } from "../../../_lib/validation.js";

function serializeStaffRow(r) {
  const canonicalRole = normalizeRole(r.role) || r.role;
  const meta = getRoleMeta(canonicalRole);
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    canonicalRole,
    roleLabel: meta.label,
    roleShortLabel: meta.shortLabel,
    department: r.department || getDefaultDepartmentForRole(canonicalRole),
    phone: r.phone || "",
    is_active: r.is_active,
    created_at: r.created_at,
    last_login_at: r.last_login_at,
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  let results = [];
  try {
    const res = await context.env.DB.prepare(
      "SELECT id, email, name, role, department, phone, is_active, created_at, last_login_at FROM admin_users ORDER BY created_at ASC LIMIT 80"
    ).all();
    results = res.results || [];
  } catch {
    const res = await context.env.DB.prepare(
      "SELECT id, email, name, role, is_active, created_at, last_login_at FROM admin_users ORDER BY created_at ASC LIMIT 80"
    ).all();
    results = res.results || [];
  }

  return jsonResponse({
    ok: true,
    items: results.map(serializeStaffRow),
    departments: DEPARTMENTS,
    rolesCatalog: listRolesCatalog(),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const email = cleanStr(parsed.data.email, 160).toLowerCase();
  const name = cleanStr(parsed.data.name, 100);
  const requestedRole = cleanStr(parsed.data.role, 32).toLowerCase() || "media_ctv";
  if (requestedRole === "super_admin" || !DELEGATABLE_ROLES.has(requestedRole)) {
    return errorResponse(
      403,
      "ADMIN_LOCKED",
      "Hệ thống chỉ cho phép duy nhất 1 tài khoản Chủ nhiệm (super_admin). Hãy chọn vai trong nhóm Ban Sự Kiện, Ban Nội Dung hoặc Ban Hình Ảnh."
    );
  }
  const role = requestedRole;
  const canonicalRole = normalizeRole(role) || role;
  const department = cleanStr(parsed.data.department, 80) || getDefaultDepartmentForRole(canonicalRole);
  const phone = cleanStr(parsed.data.phone, 30);
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

  try {
    await context.env.DB.prepare(
      "INSERT INTO admin_users (id, email, name, role, department, phone, password_hash, password_salt, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)"
    )
      .bind(id, email, name, role, department, phone, hash, salt, now)
      .run();
  } catch {
    await context.env.DB.prepare(
      "INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
    )
      .bind(id, email, name, role, hash, salt, now)
      .run();
  }

  await logAudit(context.env.DB, auth.user, {
    action: "user.create",
    targetType: "admin_user",
    targetId: id,
    summary: `Cấp tài khoản ${name} (${getRoleMeta(canonicalRole).shortLabel} · ${department})`,
    meta: { email, role, department },
  });

  return jsonResponse(
    {
      ok: true,
      item: serializeStaffRow({
        id,
        email,
        name,
        role,
        department,
        phone,
        is_active: 1,
        created_at: now,
        last_login_at: null,
      }),
    },
    201
  );
}
