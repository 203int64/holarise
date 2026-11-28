/**
 * Public 1-Click Staff Invite Preview & Activation Endpoint (`/api/auth/invite`).
 * - GET ?token=<raw> : returns safe invite metadata (name, email, role, department, expiry)
 * - POST { token, password, consentAccepted } : validates Safeguarding/NĐ 13 consent, creates admin_users,
 *   marks invite accepted, sets HttpOnly session cookie, and logs audit trail.
 */

import {
  canAccessManagerShell,
  canAccessMediaPortalRole,
  ensureManagerSchema,
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
  hashPassword,
  jsonResponse,
  readJsonBody,
  sha256Hex,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr } from "../../_lib/validation.js";

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  await ensureManagerSchema(env.DB);

  const url = new URL(request.url);
  const rawToken = cleanStr(url.searchParams.get("token"), 128);
  if (!rawToken || rawToken.length < 16) {
    return errorResponse(400, "INVALID_TOKEN", "Link mời không hợp lệ.");
  }

  const tokenHash = await sha256Hex(rawToken);
  const invite = await env.DB.prepare("SELECT * FROM staff_invites WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  if (!invite) {
    return errorResponse(404, "INVITE_NOT_FOUND", "Link mời không tồn tại hoặc đã bị thu hồi.");
  }

  const nowIso = new Date().toISOString();
  if (invite.status !== "pending") {
    return errorResponse(410, "INVITE_USED", "Link mời này đã được kích hoạt hoặc thu hồi trước đó.");
  }
  if (invite.expires_at && invite.expires_at <= nowIso) {
    return errorResponse(410, "INVITE_EXPIRED", "Link mời đã hết hạn (48 giờ). Hãy nhắn Chủ nhiệm gửi lại link mới.");
  }

  const canonicalRole = normalizeRole(invite.role) || invite.role;
  const meta = getRoleMeta(canonicalRole);
  return jsonResponse({
    ok: true,
    invite: {
      id: invite.id,
      name: invite.name,
      email: invite.email,
      role: invite.role,
      canonicalRole,
      roleLabel: meta.label,
      roleSummary: meta.summary,
      department: invite.department || meta.department,
      pillarScope: invite.pillar_scope || "all",
      note: invite.note || "",
      invitedByName: invite.invited_by_name || "Ban Điều Hành HolaRise",
      expiresAt: invite.expires_at,
    },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `invite-accept:${ipHash}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Bạn thử quá nhiều lần. Vui lòng chờ vài phút rồi thử lại.");
  }

  await ensureManagerSchema(env.DB);
  const parsed = await readJsonBody(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const rawToken = cleanStr(parsed.data.token, 128);
  const password = String(parsed.data.password || "");
  const nameOverride = cleanStr(parsed.data.name, 100);
  const consentAccepted = Boolean(parsed.data.consentAccepted);

  if (!rawToken || rawToken.length < 16) {
    return errorResponse(400, "INVALID_TOKEN", "Thiếu mã kích hoạt lời mời.");
  }
  if (!consentAccepted) {
    return errorResponse(
      400,
      "CONSENT_REQUIRED",
      "Vui lòng xác nhận Cam kết bảo mật dữ liệu (Nghị định 13) & An toàn cộng đồng trước khi kích hoạt."
    );
  }
  if (password.length < 8) {
    return errorResponse(400, "VALIDATION_ERROR", "Mật khẩu cần tối thiểu 8 ký tự.");
  }

  const tokenHash = await sha256Hex(rawToken);
  const invite = await env.DB.prepare("SELECT * FROM staff_invites WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  if (!invite) {
    return errorResponse(404, "INVITE_NOT_FOUND", "Link mời không tồn tại.");
  }
  const nowIso = new Date().toISOString();
  if (invite.status !== "pending") {
    return errorResponse(410, "INVITE_USED", "Link mời này đã được sử dụng hoặc thu hồi.");
  }
  if (invite.expires_at && invite.expires_at <= nowIso) {
    return errorResponse(410, "INVITE_EXPIRED", "Link mời đã hết hạn.");
  }

  const dup = await env.DB.prepare("SELECT id FROM admin_users WHERE email = ?").bind(invite.email).first();
  if (dup) {
    return errorResponse(409, "EMAIL_EXISTS", "Tài khoản với email này đã được tạo trước đó. Hãy đăng nhập trực tiếp.");
  }

  const userId = crypto.randomUUID();
  const finalName = nameOverride.length >= 2 ? nameOverride : invite.name;
  const canonicalRole = normalizeRole(invite.role) || invite.role;
  const department = invite.department || getDefaultDepartmentForRole(canonicalRole);
  const pillarScope = invite.pillar_scope || "all";
  const { hash, salt } = await hashPassword(password);

  try {
    await env.DB.prepare(
      `INSERT INTO admin_users
       (id, email, name, role, department, pillar_scope, password_hash, password_salt, is_active, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(userId, invite.email, finalName, invite.role, department, pillarScope, hash, salt, nowIso, nowIso)
      .run();
  } catch {
    await env.DB.prepare(
      `INSERT INTO admin_users
       (id, email, name, role, department, password_hash, password_salt, is_active, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(userId, invite.email, finalName, invite.role, department, hash, salt, nowIso, nowIso)
      .run();
  }

  await env.DB.prepare(
    `UPDATE staff_invites
     SET status = 'accepted', accepted_user_id = ?, consent_accepted_at = ?, accepted_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(userId, nowIso, nowIso, nowIso, invite.id)
    .run();

  const { rawToken: sessionToken } = await createSession(env.DB, userId);
  const roleMeta = getRoleMeta(canonicalRole);
  const permissions = getRolePermissions(canonicalRole, false);

  await logAudit(
    env.DB,
    { id: userId, email: invite.email, name: finalName, role: invite.role },
    {
      action: "invite.accepted",
      targetType: "staff_invite",
      targetId: invite.id,
      summary: `${finalName} kích hoạt lời mời (${roleMeta.shortLabel} · ${department}) và xác nhận cam kết bảo mật`,
      meta: { inviteId: invite.id, department, pillarScope },
    }
  );

  return jsonResponse(
    {
      ok: true,
      isSoleAdmin: false,
      canAccessManager: canAccessManagerShell(canonicalRole, false),
      canAccessMedia: canAccessMediaPortalRole(canonicalRole, false),
      permissions,
      user: {
        id: userId,
        email: invite.email,
        name: finalName,
        role: invite.role,
        canonicalRole,
        roleLabel: roleMeta.label,
        roleShortLabel: roleMeta.shortLabel,
        department,
        pillarScope,
        permissions,
      },
    },
    201,
    { "Set-Cookie": buildSessionCookie(sessionToken, request, false) }
  );
}
