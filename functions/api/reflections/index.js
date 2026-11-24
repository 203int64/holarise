import {
  READER_ID_COOKIE_NAME,
  checkRateLimit,
  errorResponse,
  getSessionMember,
  jsonResponse,
  parseCookies,
  readJsonBody,
  requireMember,
} from "../../_lib/security.js";
import { slugifyVi, validateReflectionInput } from "../../_lib/validation.js";

export function serializePublicReflection(row, { heartedSet = new Set(), currentMemberId = "" } = {}) {
  if (!row) return null;
  const isMine = Boolean(currentMemberId && row.member_id === currentMemberId);
  return {
    id: row.id,
    activitySlug: row.activity_slug,
    participantRole: row.participant_role || "member",
    pullQuote: row.pull_quote || "",
    content: row.content || "",
    photoUrl: row.photo_url || "",
    heartCount: Number(row.heart_count || 0),
    heartedByMe: heartedSet.has(row.id),
    isMine,
    status: row.status,
    adminNote: isMine ? row.admin_note || "" : undefined,
    authorName: row.author_name || "Thành viên Hola",
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

  const [approvedRes, mineRow, heartsRes] = await Promise.all([
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

  return jsonResponse({
    ok: true,
    items: (approvedRes.results || []).map((row) =>
      serializePublicReflection(row, { heartedSet, currentMemberId })
    ),
    myReflection: mineRow
      ? serializePublicReflection(mineRow, { heartedSet, currentMemberId })
      : null,
  });
}

export async function onRequestPost(context) {
  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  const parsed = await readJsonBody(request, 64 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validateReflectionInput(parsed.data, { requireSlug: true });
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Vui lòng kiểm tra lại nội dung lưu bút.", validated.fields);
  }

  const rl = await checkRateLimit(env.DB, `ref_post:${auth.member.id}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Bạn đã gửi nhiều lưu bút liên tiếp. Vui lòng thử lại sau ít phút.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const v = validated.value;
  const existing = await env.DB.prepare(
    "SELECT id FROM activity_reflections WHERE activity_slug = ? AND member_id = ?"
  )
    .bind(v.activity_slug, auth.member.id)
    .first();

  if (existing) {
    return errorResponse(
      409,
      "ALREADY_SUBMITTED",
      "Bạn đã có một trang lưu bút cho hoạt động này. Bạn có thể bấm Chỉnh sửa ngay trên bài viết của mình."
    );
  }

  const now = new Date().toISOString();
  const id = `ref-${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT INTO activity_reflections
     (id, activity_slug, member_id, participant_role, pull_quote, content, photo_url, photo_media_key,
      heart_count, status, admin_note, reviewed_by, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', '', '', NULL, ?, ?)`
  )
    .bind(
      id,
      v.activity_slug,
      auth.member.id,
      v.participant_role,
      v.pull_quote,
      v.content,
      v.photo_url,
      v.photo_media_key,
      now,
      now
    )
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
      reflection: serializePublicReflection(created, { currentMemberId: auth.member.id }),
      message: "Cảm ơn bạn! Trang lưu bút đã được gửi và sẽ hiển thị sau khi Ban Điều Phối duyệt.",
    },
    201
  );
}
