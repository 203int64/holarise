import {
  canAccessManagerShell,
  canAccessMediaPortalRole,
  getDefaultDepartmentForRole,
  getRoleMeta,
  getRolePermissions,
  logAudit,
  normalizeRole,
} from "../../_lib/rbac.js";
import {
  buildSessionCookie,
  checkRateLimit,
  createSession,
  errorResponse,
  getClientIpHash,
  isSoleAdminAccount,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
  verifyPassword,
} from "../../_lib/security.js";
import { cleanStr, isValidEmail } from "../../_lib/validation.js";

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
  const rl = await checkRateLimit(env.DB, `login:${ipHash}`, 10, 15 * 60 * 1000);
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

  const email = cleanStr(parsed.data.email, 160).toLowerCase();
  const password = String(parsed.data.password || "");

  if (!isValidEmail(email) || !password) {
    return errorResponse(400, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
  }

  const user = await env.DB.prepare(
    "SELECT id, email, name, role, password_hash, password_salt, is_active FROM admin_users WHERE email = ?"
  )
    .bind(email)
    .first();

  if (!user || !user.is_active) {
    // Run PBKDF2 even when user doesn't exist to equalize response timing
    await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
    return errorResponse(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    return errorResponse(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
  }

  const now = new Date().toISOString();
  const [{ rawToken }] = await Promise.all([
    createSession(env.DB, user.id),
    env.DB.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").bind(now, user.id).run(),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run(),
  ]);

  const isSole = isSoleAdminAccount(user, env);
  const canonicalRole = normalizeRole(user.role) || user.role;
  const roleMeta = getRoleMeta(canonicalRole);
  const permissions = getRolePermissions(canonicalRole, isSole);
  let department = "";
  try {
    const ext = await env.DB.prepare("SELECT department FROM admin_users WHERE id = ?").bind(user.id).first();
    department = ext?.department || "";
  } catch {}
  await logAudit(env.DB, user, {
    action: "auth.login",
    targetType: "admin_user",
    targetId: user.id,
    summary: `${user.name} (${roleMeta.shortLabel}) đăng nhập HolaRise Manager`,
  });

  return jsonResponse(
    {
      ok: true,
      isSoleAdmin: isSole,
      canAccessManager: canAccessManagerShell(canonicalRole, isSole),
      canAccessMedia: canAccessMediaPortalRole(canonicalRole, isSole),
      permissions,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        canonicalRole,
        roleLabel: roleMeta.label,
        roleShortLabel: roleMeta.shortLabel,
        department: department || getDefaultDepartmentForRole(canonicalRole),
        permissions,
      },
    },
    200,
    { "Set-Cookie": buildSessionCookie(rawToken, request, false) }
  );
}
