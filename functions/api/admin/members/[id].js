import { errorResponse, hashPassword, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { serializeAdminMember } from "./index.js";

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "").trim();
  const existing = await context.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy thành viên.");
  }

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  let nextActive = Number(existing.is_active);
  if (parsed.data.isActive !== undefined || parsed.data.is_active !== undefined) {
    nextActive = Boolean(parsed.data.isActive ?? parsed.data.is_active) ? 1 : 0;
  }

  let nextHash = existing.password_hash;
  let nextSalt = existing.password_salt;
  let clearSessions = nextActive === 0;

  if (parsed.data.resetPassword !== undefined && String(parsed.data.resetPassword).length > 0) {
    const tempPw = String(parsed.data.resetPassword);
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
      "UPDATE members SET is_active = ?, password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?"
    ).bind(nextActive, nextHash, nextSalt, now, id),
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
