import { jsonResponse, requireAdmin } from "../../../_lib/security.js";
import { VALID_REFLECTION_STATUSES, slugifyVi } from "../../../_lib/validation.js";

export function serializeAdminReflection(row) {
  return {
    id: row.id,
    activitySlug: row.activity_slug,
    memberId: row.member_id,
    participantRole: row.participant_role || "member",
    pullQuote: row.pull_quote || "",
    content: row.content || "",
    photoUrl: row.photo_url || "",
    heartCount: Number(row.heart_count || 0),
    status: row.status,
    adminNote: row.admin_note || "",
    reviewedBy: row.reviewed_by || "",
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name || "",
    authorEmail: row.author_email || "",
    authorPhone: row.author_phone || "",
    authorOrg: row.author_org || "",
    authorMemberCode: row.author_member_code || "",
    authorAvatarUrl: row.author_avatar_url || "",
  };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const statusFilter = (url.searchParams.get("status") || "all").trim().toLowerCase();
  const rawSlug = (url.searchParams.get("slug") || "").trim();
  const slugFilter = rawSlug ? slugifyVi(rawSlug) : "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10) || 80, 1), 150);

  const clauses = [];
  const binds = [];

  if (VALID_REFLECTION_STATUSES.has(statusFilter)) {
    clauses.push("r.status = ?");
    binds.push(statusFilter);
  }
  if (slugFilter) {
    clauses.push("r.activity_slug = ?");
    binds.push(slugFilter);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  binds.push(limit);

  const [listRes, countsRes] = await Promise.all([
    context.env.DB.prepare(
      `SELECT r.*,
              m.name AS author_name,
              m.email AS author_email,
              m.phone_display AS author_phone,
              m.organization AS author_org,
              m.member_code AS author_member_code,
              m.avatar_url AS author_avatar_url
       FROM activity_reflections r
       LEFT JOIN members m ON m.id = r.member_id
       ${whereSql}
       ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, r.created_at DESC
       LIMIT ?`
    )
      .bind(...binds)
      .all(),
    context.env.DB.prepare(
      `SELECT status, COUNT(*) AS cnt
       FROM activity_reflections
       GROUP BY status`
    ).all(),
  ]);

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const c of countsRes.results || []) {
    if (c.status in counts) counts[c.status] = Number(c.cnt || 0);
  }

  return jsonResponse({
    ok: true,
    counts,
    items: (listRes.results || []).map(serializeAdminReflection),
  });
}
