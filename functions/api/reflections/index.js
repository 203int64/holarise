import {
  READER_ID_COOKIE_NAME,
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  parseCookies,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import { cleanStr, slugifyVi, validateReflectionInput } from "../../_lib/validation.js";
import { ensureCommunityTestimonialsTable } from "../admin/reflections/index.js";

export function serializePublicReflection(row, { heartedSet = new Set(), currentMemberId = "" } = {}) {
  if (!row) return null;
  const isMine = Boolean(currentMemberId && row.member_id && row.member_id === currentMemberId);
  return {
    id: row.id,
    activitySlug: row.activity_slug || "",
    participantRole: row.participant_role || row.author_role || "Thành viên tham dự",
    pullQuote: row.pull_quote || "",
    content: row.content || "",
    photoUrl: row.photo_url || "",
    heartCount: Number(row.heart_count || 0),
    heartedByMe: heartedSet.has(row.id),
    isMine,
    status: row.status,
    adminNote: isMine ? row.admin_note || "" : undefined,
    authorName: row.author_name || "Người tham dự",
    authorOrg: row.author_org || "",
    authorAvatarUrl: row.author_avatar_url || "",
    authorMemberCode: row.author_member_code || "",
    authorPillar: row.author_pillar || "holaheart",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return jsonResponse({ ok: true, items: [], myReflection: null });
  }

  await ensureCommunityTestimonialsTable(env.DB);

  const url = new URL(request.url);
  const rawSlug = (url.searchParams.get("slug") || "").trim();
  const slug = rawSlug ? slugifyVi(rawSlug) : "";
  if (!slug) {
    return errorResponse(400, "MISSING_SLUG", "Thiếu mã định danh hoạt động (slug).");
  }

  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "60", 10) || 60, 1), 100);
  const sessionMember = await getSessionMember(env.DB, request);

  const cookies = parseCookies(request);
  const readerCookie = String(cookies[READER_ID_COOKIE_NAME] || "").trim();
  const actorKey = sessionMember
    ? `mbr:${sessionMember.id}`
    : /^[a-f0-9]{24,64}$/.test(readerCookie)
      ? `rdr:${readerCookie}`
      : "";

  const [approvedRes, commRes, mineRow, heartsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT r.*,
              m.name AS author_name,
              m.organization AS author_org,
              m.avatar_url AS author_avatar_url,
              m.member_code AS author_member_code,
              m.pillar_choice AS author_pillar
       FROM activity_reflections r
       JOIN members m ON m.id = r.member_id
       WHERE r.activity_slug = ? AND r.status = 'approved' AND m.is_active = 1
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
      .bind(slug, limit)
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT * FROM community_testimonials
       WHERE activity_slug = ? AND status = 'approved'
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(slug, limit)
      .all()
      .catch(() => ({ results: [] })),
    sessionMember
      ? env.DB.prepare(
          `SELECT r.*,
                  m.name AS author_name,
                  m.organization AS author_org,
                  m.avatar_url AS author_avatar_url,
                  m.member_code AS author_member_code,
                  m.pillar_choice AS author_pillar
           FROM activity_reflections r
           JOIN members m ON m.id = r.member_id
           WHERE r.activity_slug = ? AND r.member_id = ?`
        )
          .bind(slug, sessionMember.id)
          .first()
          .catch(() => null)
      : Promise.resolve(null),
    actorKey
      ? env.DB.prepare(
          `SELECT h.reflection_id
           FROM reflection_hearts h
           JOIN activity_reflections r ON r.id = h.reflection_id
           WHERE r.activity_slug = ? AND h.actor_key = ?`
        )
          .bind(slug, actorKey)
          .all()
          .catch(() => ({ results: [] }))
      : Promise.resolve({ results: [] }),
  ]);

  const heartedSet = new Set((heartsRes.results || []).map((h) => h.reflection_id));
  const currentMemberId = sessionMember ? sessionMember.id : "";

  const merged = [
    ...(commRes.results || []).map((row) => serializePublicReflection(row, { heartedSet })),
    ...(approvedRes.results || []).map((row) =>
      serializePublicReflection(row, { heartedSet, currentMemberId })
    ),
  ].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return jsonResponse({
    ok: true,
    items: merged.slice(0, limit),
    myReflection: mineRow
      ? serializePublicReflection(mineRow, { heartedSet, currentMemberId })
      : null,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi biểu mẫu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 64 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};

  // Honeypot check
  if (cleanStr(d.website || d._hp, 100) !== "") {
    return jsonResponse({ ok: true, id: "accepted" }, 200);
  }

  const sessionMember = await getSessionMember(env.DB, request);

  // Path A: Passwordless public participant reflection (no account required!)
  if (!sessionMember) {
    await ensureCommunityTestimonialsTable(env.DB);
    const authorName = cleanStr(d.authorName || d.fullName || d.name, 120);
    const content = cleanStr(d.content, 1500);
    const rawSlug = cleanStr(d.activitySlug || d.slug, 120);
    const activitySlug = rawSlug ? slugifyVi(rawSlug) : "";

    if (!authorName || authorName.length < 2) {
      return errorResponse(400, "VALIDATION_ERROR", "Vui lòng nhập tên gọi của bạn (tối thiểu 2 ký tự).");
    }
    if (!content || content.length < 12) {
      return errorResponse(400, "VALIDATION_ERROR", "Cảm nhận cần ít nhất 12 ký tự.");
    }

    const ipHash = await getClientIpHash(request);
    const rl = await checkRateLimit(env.DB, `comm_ref:${ipHash}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return errorResponse(429, "RATE_LIMITED", "Bạn đã gửi nhiều cảm nhận liên tiếp. Vui lòng đợi ít phút.");
    }

    const now = new Date().toISOString();
    const id = `tst_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const authorRole = cleanStr(d.participantRole || d.authorRole, 80) || "Thành viên tham dự";
    const authorOrg = cleanStr(d.authorOrg || d.organization, 160);
    const pullQuote = cleanStr(d.pullQuote, 180);

    await env.DB.prepare(
      `INSERT INTO community_testimonials
       (id, activity_slug, author_name, author_role, author_org, pull_quote, content,
        photo_url, photo_media_key, is_featured_home, heart_count, status, source,
        reviewed_by, reviewed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', '', 0, 0, 'pending', 'public', '', NULL, ?, ?)`
    )
      .bind(id, activitySlug, authorName, authorRole, authorOrg, pullQuote, content, now, now)
      .run();

    const row = await env.DB.prepare("SELECT * FROM community_testimonials WHERE id = ?").bind(id).first();
    return jsonResponse(
      {
        ok: true,
        reflection: serializePublicReflection(row),
        message: "Cảm ơn bạn đã sẻ chia. Cảm nhận đã gửi tới Ban Điều Phối để hiển thị lên trang Hành trình.",
      },
      201
    );
  }

  // Path B: Legacy authenticated member reflection (preserves backward compatibility)
  const validated = validateReflectionInput(d, { requireSlug: true });
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Vui lòng kiểm tra lại nội dung lưu bút.", validated.fields);
  }

  const rl = await checkRateLimit(env.DB, `ref_post:${sessionMember.id}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Bạn đã gửi nhiều lưu bút liên tiếp. Vui lòng thử lại sau ít phút.");
  }

  const v = validated.value;
  const existing = await env.DB.prepare(
    "SELECT id FROM activity_reflections WHERE activity_slug = ? AND member_id = ?"
  )
    .bind(v.activity_slug, sessionMember.id)
    .first();

  if (existing) {
    return errorResponse(409, "ALREADY_SUBMITTED", "Bạn đã có một trang lưu bút cho hoạt động này.");
  }

  const now = new Date().toISOString();
  const id = `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await env.DB.prepare(
    `INSERT INTO activity_reflections
     (id, activity_slug, member_id, participant_role, pull_quote, content, photo_url, photo_media_key,
      heart_count, status, admin_note, reviewed_by, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', '', '', NULL, ?, ?)`
  )
    .bind(id, v.activity_slug, sessionMember.id, v.participant_role, v.pull_quote, v.content, v.photo_url, v.photo_media_key, now, now)
    .run();

  const created = await env.DB.prepare(
    `SELECT r.*,
            m.name AS author_name,
            m.organization AS author_org,
            m.avatar_url AS author_avatar_url,
            m.member_code AS author_member_code,
            m.pillar_choice AS author_pillar
     FROM activity_reflections r
     JOIN members m ON m.id = r.member_id
     WHERE r.id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse(
    {
      ok: true,
      reflection: serializePublicReflection(created, { currentMemberId: sessionMember.id }),
      message: "Cảm ơn bạn đã sẻ chia! Lưu bút của bạn đã được gửi tới Ban Điều Phối duyệt hiển thị.",
    },
    201
  );
}
