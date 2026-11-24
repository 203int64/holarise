import { errorResponse, hashPassword, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import {
  VALID_PILLAR_CHOICES,
  cleanStr,
  extractMediaKeyFromUrl,
  isSafeMediaUrl,
  isValidEmail,
  normalizePhone,
} from "../../../_lib/validation.js";
import { ensureMemberProfileColumns, serializeAdminMember } from "./index.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  await ensureMemberProfileColumns(context.env.DB);

  const id = String(context.params?.id || "").trim();
  const existing = await context.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy thành viên.");
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};

  const nextName = d.name !== undefined ? cleanStr(d.name, 120) : existing.name;
  if (nextName.length < 2) {
    return errorResponse(400, "VALIDATION_ERROR", "Họ và tên cần tối thiểu 2 ký tự.");
  }

  let nextEmail = existing.email;
  if (d.email !== undefined) {
    const raw = cleanStr(d.email, 160).toLowerCase();
    if (raw && !isValidEmail(raw)) {
      return errorResponse(400, "VALIDATION_ERROR", "Email chưa đúng định dạng.");
    }
    nextEmail = raw || null;
  }

  let nextPhoneDisplay = existing.phone_display || "";
  let nextPhoneNorm = existing.phone_norm;
  if (d.phone !== undefined || d.phoneDisplay !== undefined) {
    const rawP = cleanStr(d.phone ?? d.phoneDisplay, 40);
    nextPhoneDisplay = rawP;
    const parsedP = rawP ? normalizePhone(rawP) : null;
    nextPhoneNorm = rawP ? (parsedP?.ok ? parsedP.phoneNorm : rawP.replace(/\D/g, "")) : null;
  }

  const nextOrg = d.organization !== undefined ? cleanStr(d.organization, 160) : existing.organization || "";
  const nextPillar =
    d.pillarChoice !== undefined && VALID_PILLAR_CHOICES.has(cleanStr(d.pillarChoice, 32))
      ? cleanStr(d.pillarChoice, 32)
      : existing.pillar_choice || "holaheart";
  const nextRoleTitle =
    d.roleTitle !== undefined || d.role_title !== undefined
      ? cleanStr(d.roleTitle ?? d.role_title, 120)
      : existing.role_title || "";
  const nextBio = d.bio !== undefined ? cleanStr(d.bio, 400) : existing.bio || "";
  const nextNotes = d.notes !== undefined ? cleanStr(d.notes, 800) : existing.notes || "";
  const nextPublicTeam =
    d.isPublicTeam !== undefined || d.is_public_team !== undefined
      ? Boolean(d.isPublicTeam ?? d.is_public_team) ? 1 : 0
      : Number(existing.is_public_team || 0);

  let nextAvatarUrl = existing.avatar_url || "";
  let nextAvatarKey = existing.avatar_media_key || "";
  if (d.avatarUrl !== undefined || d.avatar_url !== undefined) {
    const rawUrl = cleanStr(d.avatarUrl ?? d.avatar_url, 500);
    if (rawUrl && !isSafeMediaUrl(rawUrl)) {
      return errorResponse(400, "VALIDATION_ERROR", "Đường dẫn ảnh đại diện không hợp lệ.");
    }
    nextAvatarUrl = rawUrl;
    nextAvatarKey = rawUrl ? extractMediaKeyFromUrl(rawUrl) : "";
  }

  let nextActive = Number(existing.is_active);
  if (d.isActive !== undefined || d.is_active !== undefined) {
    nextActive = Boolean(d.isActive ?? d.is_active) ? 1 : 0;
  }

  let nextHash = existing.password_hash;
  let nextSalt = existing.password_salt;
  let clearSessions = nextActive === 0;

  if (d.resetPassword !== undefined && String(d.resetPassword).length > 0) {
    const tempPw = String(d.resetPassword);
    if (tempPw.length < 6 || tempPw.length > 128) {
      return errorResponse(400, "INVALID_PASSWORD", "Mật khẩu tạm cần từ 6 đến 128 ký tự.");
    }
    const hashed = await hashPassword(tempPw);
    nextHash = hashed.hash;
    nextSalt = hashed.salt;
    clearSessions = true;
  }

  const now = new Date().toISOString();
  const stmts = [
    context.env.DB.prepare(
      `UPDATE members
       SET name = ?, email = ?, phone_norm = ?, phone_display = ?, organization = ?,
           pillar_choice = ?, role_title = ?, bio = ?, notes = ?, is_public_team = ?,
           avatar_url = ?, avatar_media_key = ?, is_active = ?,
           password_hash = ?, password_salt = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      nextName,
      nextEmail,
      nextPhoneNorm,
      nextPhoneDisplay,
      nextOrg,
      nextPillar,
      nextRoleTitle,
      nextBio,
      nextNotes,
      nextPublicTeam,
      nextAvatarUrl,
      nextAvatarKey,
      nextActive,
      nextHash,
      nextSalt,
      now,
      id
    ),
  ];

  if (clearSessions) {
    stmts.push(context.env.DB.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(id));
  }

  await context.env.DB.batch(stmts);

  const updated = await context.env.DB.prepare(
    `SELECT m.*,
            (SELECT COUNT(*) FROM registrations rg WHERE rg.member_id = m.id) AS reg_count,
            (SELECT COUNT(*) FROM activity_reflections rf WHERE rf.member_id = m.id) AS ref_count
     FROM members m
     WHERE m.id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({
    ok: true,
    item: serializeAdminMember(updated),
  });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "").trim();
  const existing = await context.env.DB.prepare("SELECT id, avatar_media_key FROM members WHERE id = ?")
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy thành viên để xóa.");
  }

  const refPhotos = await context.env.DB.prepare(
    "SELECT photo_media_key FROM activity_reflections WHERE member_id = ? AND photo_media_key != ''"
  )
    .bind(id)
    .all();

  await context.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id).run();

  if (context.env?.MEDIA_KV?.delete) {
    const keysToDelete = [];
    if (existing.avatar_media_key) keysToDelete.push(existing.avatar_media_key);
    for (const r of refPhotos.results || []) {
      if (r.photo_media_key) keysToDelete.push(r.photo_media_key);
    }
    await Promise.all(keysToDelete.map((k) => context.env.MEDIA_KV.delete(`media:${k}`).catch(() => null)));
  }

  return jsonResponse({ ok: true, id });
}
