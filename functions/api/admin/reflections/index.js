import { ensureReflectionsSchema, errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import {
  VALID_REFLECTION_STATUSES,
  cleanStr,
  extractMediaKeyFromUrl,
  isSafeMediaUrl,
  parseReflectionPhotos,
  slugifyVi,
} from "../../../_lib/validation.js";

export async function ensureCommunityTestimonialsTable(db) {
  if (!db) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS community_testimonials (
        id TEXT PRIMARY KEY,
        activity_slug TEXT NOT NULL DEFAULT '',
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL DEFAULT 'Thành viên tham dự',
        author_org TEXT NOT NULL DEFAULT '',
        pull_quote TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        photo_url TEXT NOT NULL DEFAULT '',
        photo_media_key TEXT NOT NULL DEFAULT '',
        is_featured_home INTEGER NOT NULL DEFAULT 0,
        heart_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        source TEXT NOT NULL DEFAULT 'public' CHECK(source IN ('public', 'admin')),
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run()
    .catch(() => null);
}

export function serializeAdminReflection(row, kind = "member") {
  const photoUrls = parseReflectionPhotos(row.photos_json, row.photo_url || "");
  if (kind === "community") {
    return {
      id: row.id,
      kind: "community",
      activitySlug: row.activity_slug || "",
      memberId: "",
      participantRole: row.author_role || "Thành viên tham dự",
      pullQuote: row.pull_quote || "",
      content: row.content || "",
      photoUrl: photoUrls[0] || "",
      photoUrls,
      isFeaturedHome: Number(row.is_featured_home || 0) === 1,
      heartCount: Number(row.heart_count || 0),
      status: row.status,
      source: row.source || "public",
      adminNote: "",
      reviewedBy: row.reviewed_by || "",
      reviewedAt: row.reviewed_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      authorName: row.author_name || "",
      authorEmail: "",
      authorPhone: "",
      authorOrg: row.author_org || "",
      authorMemberCode: "",
      authorAvatarUrl: "",
    };
  }
  return {
    id: row.id,
    kind: "member",
    activitySlug: row.activity_slug,
    memberId: row.member_id,
    participantRole: row.participant_role || "member",
    pullQuote: row.pull_quote || "",
    content: row.content || "",
    photoUrl: photoUrls[0] || "",
    photoUrls,
    isFeaturedHome: false,
    heartCount: Number(row.heart_count || 0),
    status: row.status,
    source: "member",
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

  await Promise.all([
    ensureCommunityTestimonialsTable(context.env.DB),
    ensureReflectionsSchema(context.env.DB),
  ]);

  const url = new URL(context.request.url);
  const statusFilter = (url.searchParams.get("status") || "all").trim().toLowerCase();
  const rawSlug = (url.searchParams.get("slug") || "").trim();
  const slugFilter = rawSlug ? slugifyVi(rawSlug) : "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10) || 80, 1), 150);

  const buildFilter = (prefix) => {
    const clauses = [];
    const binds = [];
    if (VALID_REFLECTION_STATUSES.has(statusFilter)) {
      clauses.push(`${prefix}status = ?`);
      binds.push(statusFilter);
    }
    if (slugFilter) {
      clauses.push(`${prefix}activity_slug = ?`);
      binds.push(slugFilter);
    }
    return { whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", binds };
  };

  const memFilter = buildFilter("r.");
  const commFilter = buildFilter("");

  const [memberListRes, commListRes, memCountsRes, commCountsRes] = await Promise.all([
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
       ${memFilter.whereSql}
       ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, r.created_at DESC
       LIMIT ?`
    )
      .bind(...memFilter.binds, limit)
      .all()
      .catch(() => ({ results: [] })),
    context.env.DB.prepare(
      `SELECT * FROM community_testimonials
       ${commFilter.whereSql}
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC
       LIMIT ?`
    )
      .bind(...commFilter.binds, limit)
      .all()
      .catch(() => ({ results: [] })),
    context.env.DB.prepare("SELECT status, COUNT(*) AS cnt FROM activity_reflections GROUP BY status")
      .all()
      .catch(() => ({ results: [] })),
    context.env.DB.prepare("SELECT status, COUNT(*) AS cnt FROM community_testimonials GROUP BY status")
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const c of [...(memCountsRes.results || []), ...(commCountsRes.results || [])]) {
    if (c.status in counts) counts[c.status] += Number(c.cnt || 0);
  }

  const items = [
    ...(commListRes.results || []).map((row) => serializeAdminReflection(row, "community")),
    ...(memberListRes.results || []).map((row) => serializeAdminReflection(row, "member")),
  ].sort((a, b) => {
    const rank = (s) => (s === "pending" ? 0 : s === "approved" ? 1 : 2);
    return rank(a.status) - rank(b.status) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  return jsonResponse({
    ok: true,
    items: items.slice(0, limit),
    counts,
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  await Promise.all([
    ensureCommunityTestimonialsTable(context.env.DB),
    ensureReflectionsSchema(context.env.DB),
  ]);

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};

  const authorName = cleanStr(d.authorName || d.author_name, 120);
  if (authorName.length < 2) {
    return errorResponse(400, "VALIDATION_ERROR", "Vui lòng nhập tên người chia sẻ (tối thiểu 2 ký tự).");
  }
  const content = cleanStr(d.content, 1500);
  if (content.length < 10) {
    return errorResponse(400, "VALIDATION_ERROR", "Nội dung cảm nhận cần ít nhất 10 ký tự.");
  }

  const rawSlug = cleanStr(d.activitySlug || d.activity_slug, 120);
  const activitySlug = rawSlug ? slugifyVi(rawSlug) : "";
  const authorRole = cleanStr(d.participantRole || d.authorRole || d.author_role, 80) || "Thành viên tham dự";
  const authorOrg = cleanStr(d.authorOrg || d.author_org, 160);
  const pullQuote = cleanStr(d.pullQuote || d.pull_quote, 180);
  const photoUrl = cleanStr(d.photoUrl || d.photo_url, 500);
  if (photoUrl && !isSafeMediaUrl(photoUrl)) {
    return errorResponse(400, "VALIDATION_ERROR", "Đường dẫn ảnh kỷ niệm không hợp lệ.");
  }
  const isFeaturedHome = Boolean(d.isFeaturedHome ?? d.is_featured_home) ? 1 : 0;
  const status = VALID_REFLECTION_STATUSES.has(cleanStr(d.status, 24))
    ? cleanStr(d.status, 24)
    : "approved";

  const now = new Date().toISOString();
  const id = `tst_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const photoKey = photoUrl ? extractMediaKeyFromUrl(photoUrl) : "";

  await context.env.DB.prepare(
    `INSERT INTO community_testimonials
     (id, activity_slug, author_name, author_role, author_org, pull_quote, content,
      photo_url, photo_media_key, is_featured_home, heart_count, status, source,
      reviewed_by, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'admin', ?, ?, ?, ?)`
  )
    .bind(
      id,
      activitySlug,
      authorName,
      authorRole,
      authorOrg,
      pullQuote,
      content,
      photoUrl,
      photoKey,
      isFeaturedHome,
      status,
      auth.user.email,
      now,
      now,
      now
    )
    .run();

  const row = await context.env.DB.prepare("SELECT * FROM community_testimonials WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializeAdminReflection(row, "community") }, 201);
}
