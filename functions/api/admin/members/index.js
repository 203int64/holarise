import { ensureDeepControlSchema } from "../../../_lib/media-access.js";
import {
  errorResponse,
  generateSequentialMemberCode,
  hashPassword,
  jsonResponse,
  readJsonBody,
  requireAdmin,
} from "../../../_lib/security.js";
import {
  VALID_PILLAR_CHOICES,
  cleanStr,
  extractMediaKeyFromUrl,
  isSafeMediaUrl,
  isValidEmail,
  normalizePhone,
  truncateUtf8Bytes,
} from "../../../_lib/validation.js";

export async function ensureMemberProfileColumns(db) {
  if (!db) return;
  try {
    await db.prepare("SELECT role_title, bio, notes, is_public_team FROM members LIMIT 1").first();
    return;
  } catch (_err) {
    for (const stmt of [
      "ALTER TABLE members ADD COLUMN role_title TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE members ADD COLUMN bio TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE members ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE members ADD COLUMN is_public_team INTEGER NOT NULL DEFAULT 0",
    ]) {
      await db.prepare(stmt).run().catch(() => null);
    }
  }
}

export function serializeAdminMember(row) {
  return {
    id: row.id,
    memberCode: row.member_code,
    name: row.name,
    email: row.email || "",
    phoneDisplay: row.phone_display || "",
    organization: row.organization || "",
    pillarChoice: row.pillar_choice || "holaheart",
    roleTitle: row.role_title || "",
    bio: row.bio || "",
    notes: row.notes || "",
    isPublicTeam: Number(row.is_public_team || 0) === 1,
    avatarUrl: row.avatar_url || "",
    isActive: Number(row.is_active) === 1,
    canViewAllMedia: Number(row.can_view_all_media || 0) === 1,
    canAccessMediaPortal: Number(row.can_access_media_portal || 0) === 1,
    albumGrantCount: Number(row.grant_count || 0),
    registrationCount: Number(row.reg_count || 0),
    reflectionCount: Number(row.ref_count || 0),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "members.read" });
  if (!auth.ok) return auth.response;

  await Promise.all([
    ensureMemberProfileColumns(context.env.DB),
    ensureDeepControlSchema(context.env.DB),
  ]);

  const url = new URL(context.request.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10) || 80, 1), 150);

  let stmt;
  if (qRaw) {
    const safeQ = truncateUtf8Bytes(qRaw.replace(/[%_]/g, ""), 42);
    const pat = `%${safeQ}%`;
    stmt = context.env.DB.prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM registrations rg WHERE rg.member_id = m.id) AS reg_count,
              (SELECT COUNT(*) FROM activity_reflections rf WHERE rf.member_id = m.id) AS ref_count,
              (SELECT COUNT(*) FROM member_album_grants g WHERE g.member_id = m.id) AS grant_count
       FROM members m
       WHERE m.name LIKE ? OR m.member_code LIKE ? OR m.email LIKE ? OR m.phone_display LIKE ? OR m.phone_norm LIKE ? OR m.role_title LIKE ?
       ORDER BY m.is_public_team DESC, m.created_at DESC
       LIMIT ?`
    ).bind(pat, pat, pat, pat, pat, pat, limit);
  } else {
    stmt = context.env.DB.prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM registrations rg WHERE rg.member_id = m.id) AS reg_count,
              (SELECT COUNT(*) FROM activity_reflections rf WHERE rf.member_id = m.id) AS ref_count,
              (SELECT COUNT(*) FROM member_album_grants g WHERE g.member_id = m.id) AS grant_count
       FROM members m
       ORDER BY m.is_public_team DESC, m.created_at DESC
       LIMIT ?`
    ).bind(limit);
  }

  const { results } = await stmt.all();
  return jsonResponse({
    ok: true,
    items: (results || []).map(serializeAdminMember),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  await ensureMemberProfileColumns(context.env.DB);

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data || {};
  const name = cleanStr(data.name || data.fullName, 120);
  if (name.length < 2) {
    return errorResponse(400, "VALIDATION_ERROR", "Vui lòng nhập họ và tên thành viên (tối thiểu 2 ký tự).");
  }

  const rawEmail = cleanStr(data.email, 160).toLowerCase();
  if (rawEmail && !isValidEmail(rawEmail)) {
    return errorResponse(400, "VALIDATION_ERROR", "Email chưa đúng định dạng.");
  }

  const rawPhone = cleanStr(data.phone || data.phoneDisplay, 40);
  const phoneParsed = rawPhone ? normalizePhone(rawPhone) : null;
  const phoneNorm = phoneParsed?.ok ? phoneParsed.phoneNorm : rawPhone.replace(/\D/g, "");
  const organization = cleanStr(data.organization, 160);
  const pillarChoice = VALID_PILLAR_CHOICES.has(cleanStr(data.pillarChoice, 32))
    ? cleanStr(data.pillarChoice, 32)
    : "holaheart";
  const roleTitle = cleanStr(data.roleTitle || data.role_title, 120);
  const bio = cleanStr(data.bio, 400);
  const notes = cleanStr(data.notes, 800);
  const isPublicTeam = Boolean(data.isPublicTeam ?? data.is_public_team) ? 1 : 0;
  const avatarUrl = cleanStr(data.avatarUrl || data.avatar_url, 500);
  if (avatarUrl && !isSafeMediaUrl(avatarUrl)) {
    return errorResponse(400, "VALIDATION_ERROR", "Đường dẫn ảnh đại diện không hợp lệ.");
  }

  // Deduplicate cleanly by phone or email if already exists
  if (phoneNorm) {
    const dupPhone = await context.env.DB.prepare("SELECT id, member_code FROM members WHERE phone_norm = ?")
      .bind(phoneNorm)
      .first();
    if (dupPhone) {
      return errorResponse(409, "ALREADY_EXISTS", `Số điện thoại này đã thuộc thành viên ${dupPhone.member_code}.`);
    }
  }
  if (rawEmail) {
    const dupEmail = await context.env.DB.prepare("SELECT id, member_code FROM members WHERE email = ?")
      .bind(rawEmail)
      .first();
    if (dupEmail) {
      return errorResponse(409, "ALREADY_EXISTS", `Email này đã thuộc thành viên ${dupEmail.member_code}.`);
    }
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const id = `mbr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const randomSecret = crypto.randomUUID() + crypto.randomUUID();
  const { hash, salt } = await hashPassword(randomSecret);
  const avatarMediaKey = avatarUrl ? extractMediaKeyFromUrl(avatarUrl) : "";

  let memberCode = "";
  let inserted = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    memberCode = await generateSequentialMemberCode(context.env.DB, nowDate, attempt);
    try {
      await context.env.DB.prepare(
        `INSERT INTO members
         (id, member_code, email, phone_norm, phone_display, name, organization, pillar_choice,
          role_title, bio, notes, is_public_team, avatar_url, avatar_media_key,
          password_hash, password_salt, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
        .bind(
          id,
          memberCode,
          rawEmail || null,
          phoneNorm || null,
          rawPhone,
          name,
          organization,
          pillarChoice,
          roleTitle,
          bio,
          notes,
          isPublicTeam,
          avatarUrl,
          avatarMediaKey,
          hash,
          salt,
          now,
          now
        )
        .run();
      inserted = true;
      break;
    } catch (err) {
      if (!String(err?.message || "").includes("member_code")) {
        throw err;
      }
    }
  }
  if (!inserted) {
    return errorResponse(500, "CODE_GENERATION_FAILED", "Không thể cấp mã thành viên lúc này. Vui lòng thử lại.");
  }

  const created = await context.env.DB.prepare(
    `SELECT m.*, 0 AS reg_count, 0 AS ref_count FROM members m WHERE m.id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: serializeAdminMember(created) }, 201);
}
