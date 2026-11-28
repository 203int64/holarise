import { notifyStaffInvite } from "../../../_lib/manager-notify.js";
import {
  DELEGATABLE_ROLES,
  ensureManagerSchema,
  getDefaultDepartmentForRole,
  getRoleMeta,
  logAudit,
  normalizeRole,
} from "../../../_lib/rbac.js";
import {
  errorResponse,
  jsonResponse,
  randomTokenHex,
  readJsonBody,
  requireAdmin,
  sha256Hex,
} from "../../../_lib/security.js";
import { cleanStr, isValidEmail, VALID_PILLAR_SCOPES } from "../../../_lib/validation.js";

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function serializeInvite(row, nowIso) {
  if (!row) return null;
  const canonicalRole = normalizeRole(row.role) || row.role;
  const meta = getRoleMeta(canonicalRole);
  let status = row.status || "pending";
  if (status === "pending" && row.expires_at && row.expires_at <= nowIso) {
    status = "expired";
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    canonicalRole,
    roleLabel: meta.label,
    roleShortLabel: meta.shortLabel,
    department: row.department || meta.department,
    pillarScope: row.pillar_scope || "all",
    note: row.note || "",
    status,
    invitedBy: row.invited_by || "",
    invitedByName: row.invited_by_name || "",
    acceptedUserId: row.accepted_user_id || "",
    acceptedAt: row.accepted_at || "",
    expiresAt: row.expires_at || "",
    createdAt: row.created_at || "",
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);
  const nowIso = new Date().toISOString();

  const { results } = await db
    .prepare("SELECT * FROM staff_invites ORDER BY created_at DESC LIMIT 80")
    .all();

  return jsonResponse({
    ok: true,
    items: (results || []).map((r) => serializeInvite(r, nowIso)),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const email = cleanStr(parsed.data.email, 160).toLowerCase();
  const name = cleanStr(parsed.data.name, 100);
  const requestedRole = cleanStr(parsed.data.role, 32).toLowerCase() || "event_ops";
  if (requestedRole === "super_admin" || !DELEGATABLE_ROLES.has(requestedRole)) {
    return errorResponse(
      403,
      "ADMIN_LOCKED",
      "Chỉ có thể gửi lời mời cho các vai Ban Sự Kiện, Ban Nội Dung hoặc Ban Hình Ảnh (không cấp thêm super_admin)."
    );
  }
  const canonicalRole = normalizeRole(requestedRole) || requestedRole;
  const department = cleanStr(parsed.data.department, 80) || getDefaultDepartmentForRole(canonicalRole);
  const rawPillar = cleanStr(parsed.data.pillarScope ?? parsed.data.pillar_scope, 24).toLowerCase() || "all";
  const pillarScope = VALID_PILLAR_SCOPES.has(rawPillar) ? rawPillar : "all";
  const note = cleanStr(parsed.data.note, 400);

  const fields = {};
  if (!isValidEmail(email)) fields.email = "Email người được mời không hợp lệ.";
  if (name.length < 2) fields.name = "Vui lòng nhập họ tên người được mời.";
  if (Object.keys(fields).length > 0) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin lời mời chưa hợp lệ.", fields);
  }

  const existingUser = await db.prepare("SELECT id FROM admin_users WHERE email = ?").bind(email).first();
  if (existingUser) {
    return errorResponse(409, "EMAIL_EXISTS", "Email này đã có tài khoản Ban. Hãy chỉnh Vai/Ban trực tiếp trong danh sách.");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const id = `inv-${crypto.randomUUID().slice(0, 12)}`;
  const rawToken = randomTokenHex(24);
  const tokenHash = await sha256Hex(rawToken);

  // Revoke any older pending invite for the same email to keep 1 active link per person
  await db
    .prepare("UPDATE staff_invites SET status = 'revoked', updated_at = ? WHERE email = ? AND status = 'pending'")
    .bind(nowIso, email)
    .run();

  await db
    .prepare(
      `INSERT INTO staff_invites
       (id, email, name, role, department, pillar_scope, token_hash, note, status, invited_by, invited_by_name, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      email,
      name,
      requestedRole,
      department,
      pillarScope,
      tokenHash,
      note,
      auth.user.id,
      auth.user.name || auth.user.email,
      expiresAt,
      nowIso,
      nowIso
    )
    .run();

  const origin = new URL(context.request.url).origin || "https://holarise.org";
  const inviteUrl = `${origin}/admin/?invite=${rawToken}`;

  const createdRow = await db.prepare("SELECT * FROM staff_invites WHERE id = ?").bind(id).first();
  const item = serializeInvite(createdRow, nowIso);

  const emailResult = await notifyStaffInvite(context.env, { invite: item, inviteUrl });

  await logAudit(db, auth.user, {
    action: "invite.create",
    targetType: "staff_invite",
    targetId: id,
    summary: `Tạo link mời ${name} (${getRoleMeta(canonicalRole).shortLabel} · ${department})`,
    meta: { email, role: requestedRole, department, pillarScope, emailStatus: emailResult?.status || "skipped" },
  });

  return jsonResponse(
    {
      ok: true,
      item,
      inviteUrl,
      emailStatus: emailResult?.status || "skipped",
    },
    201
  );
}
