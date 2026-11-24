import { jsonResponse, requireAdmin } from "../../../_lib/security.js";
import { truncateUtf8Bytes } from "../../../_lib/validation.js";

export function serializeAdminMember(row) {
  return {
    id: row.id,
    memberCode: row.member_code,
    name: row.name,
    email: row.email || "",
    phoneDisplay: row.phone_display || "",
    organization: row.organization || "",
    pillarChoice: row.pillar_choice || "holaheart",
    avatarUrl: row.avatar_url || "",
    isActive: Number(row.is_active) === 1,
    registrationCount: Number(row.reg_count || 0),
    reflectionCount: Number(row.ref_count || 0),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

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
              (SELECT COUNT(*) FROM activity_reflections rf WHERE rf.member_id = m.id) AS ref_count
       FROM members m
       WHERE m.name LIKE ? OR m.member_code LIKE ? OR m.email LIKE ? OR m.phone_display LIKE ? OR m.phone_norm LIKE ?
       ORDER BY m.created_at DESC
       LIMIT ?`
    ).bind(pat, pat, pat, pat, pat, limit);
  } else {
    stmt = context.env.DB.prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM registrations rg WHERE rg.member_id = m.id) AS reg_count,
              (SELECT COUNT(*) FROM activity_reflections rf WHERE rf.member_id = m.id) AS ref_count
       FROM members m
       ORDER BY m.created_at DESC
       LIMIT ?`
    ).bind(limit);
  }

  const { results } = await stmt.all();
  return jsonResponse({
    ok: true,
    items: (results || []).map(serializeAdminMember),
  });
}
