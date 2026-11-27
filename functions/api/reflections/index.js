import { sendContributionThankYouEmail } from "../../_lib/email.js";
import {
  READER_ID_COOKIE_NAME,
  checkRateLimit,
  ensureReflectionsSchema,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  parseCookies,
  readJsonBody,
  verifyCsrfOrigin,
} from "../../_lib/security.js";
import {
  cleanStr,
  parseReflectionPhotos,
  slugifyVi,
  validateReflectionInput,
} from "../../_lib/validation.js";
import { ensureCommunityTestimonialsTable } from "../admin/reflections/index.js";

export function serializePublicReflection(
  row,
  { heartedSet = new Set(), myReactionMap = new Map(), reactionCountsMap = new Map(), currentMemberId = "" } = {}
) {
  if (!row) return null;
  const isMine = Boolean(currentMemberId && row.member_id && row.member_id === currentMemberId);
  const photoUrls = parseReflectionPhotos(row.photos_json, row.photo_url || "");
  const myReaction = myReactionMap.get(row.id) || (heartedSet.has(row.id) ? "heart" : "");
  const counts = reactionCountsMap.get(row.id) || {
    heart: Number(row.heart_count || 0),
    warm: 0,
    inspire: 0,
  };
  const totalHearts = Math.max(
    Number(row.heart_count || 0),
    Number(counts.heart || 0) + Number(counts.warm || 0) + Number(counts.inspire || 0)
  );
  return {
    id: row.id,
    activitySlug: row.activity_slug || "",
    participantRole: row.participant_role || row.author_role || "Thành viên tham dự",
    pullQuote: row.pull_quote || "",
    mood: row.mood || "",
    content: row.content || "",
    photoUrl: photoUrls[0] || "",
    photoUrls,
    heartCount: totalHearts,
    heartedByMe: Boolean(myReaction),
    myReaction,
    reactions: {
      heart: Number(counts.heart || 0),
      warm: Number(counts.warm || 0),
      inspire: Number(counts.inspire || 0),
    },
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

  await Promise.all([
    ensureCommunityTestimonialsTable(env.DB),
    ensureReflectionsSchema(env.DB),
  ]);

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

  const [approvedRes, commRes, mineRow, heartsRes, reactionSummaryRes] = await Promise.all([
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
          `SELECT h.reflection_id, COALESCE(NULLIF(h.reaction_type, ''), 'heart') AS reaction_type
           FROM reflection_hearts h
           JOIN activity_reflections r ON r.id = h.reflection_id
           WHERE r.activity_slug = ? AND h.actor_key = ?`
        )
          .bind(slug, actorKey)
          .all()
          .catch(() => ({ results: [] }))
      : Promise.resolve({ results: [] }),
    env.DB.prepare(
      `SELECT h.reflection_id, COALESCE(NULLIF(h.reaction_type, ''), 'heart') AS reaction_type, COUNT(*) AS cnt
       FROM reflection_hearts h
       JOIN activity_reflections r ON r.id = h.reflection_id
       WHERE r.activity_slug = ? AND r.status = 'approved'
       GROUP BY h.reflection_id, COALESCE(NULLIF(h.reaction_type, ''), 'heart')`
    )
      .bind(slug)
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const heartedSet = new Set((heartsRes.results || []).map((h) => h.reflection_id));
  const myReactionMap = new Map(
    (heartsRes.results || []).map((h) => [h.reflection_id, h.reaction_type || "heart"])
  );
  const reactionCountsMap = new Map();
  for (const row of reactionSummaryRes.results || []) {
    if (!reactionCountsMap.has(row.reflection_id)) {
      reactionCountsMap.set(row.reflection_id, { heart: 0, warm: 0, inspire: 0 });
    }
    const bucket = reactionCountsMap.get(row.reflection_id);
    const kind = row.reaction_type in bucket ? row.reaction_type : "heart";
    bucket[kind] += Number(row.cnt || 0);
  }
  const currentMemberId = sessionMember ? sessionMember.id : "";

  const merged = [
    ...(commRes.results || []).map((row) =>
      serializePublicReflection(row, { heartedSet, myReactionMap, reactionCountsMap })
    ),
    ...(approvedRes.results || []).map((row) =>
      serializePublicReflection(row, { heartedSet, myReactionMap, reactionCountsMap, currentMemberId })
    ),
  ].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return jsonResponse({
    ok: true,
    items: merged.slice(0, limit),
    myReflection: mineRow
      ? serializePublicReflection(mineRow, { heartedSet, myReactionMap, reactionCountsMap, currentMemberId })
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
  if (!sessionMember) {
    return errorResponse(
      401,
      "MEMBER_UNAUTHORIZED",
      "Vui lòng đăng nhập tài khoản Thành viên Hola để viết lưu bút và đính kèm ảnh."
    );
  }

  // Authenticated member reflection (up to 7 photos)
  await ensureReflectionsSchema(env.DB);
  const validated = validateReflectionInput(d, { requireSlug: true });
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Vui lòng kiểm tra lại nội dung lưu bút.", validated.fields);
  }

  const rl = await checkRateLimit(env.DB, `ref_post:${sessionMember.id}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Bạn đã gửi nhiều lưu bút liên tiếp. Vui lòng thử lại sau ít phút.");
  }

  const v = validated.value;
  try {
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
       (id, activity_slug, member_id, participant_role, pull_quote, mood, content, photo_url, photo_media_key, photos_json,
        heart_count, status, admin_note, reviewed_by, reviewed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', '', '', NULL, ?, ?)`
    )
      .bind(
        id,
        v.activity_slug,
        sessionMember.id,
        v.participant_role,
        v.pull_quote,
        v.mood,
        v.content,
        v.photo_url,
        v.photo_media_key,
        v.photos_json,
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

    if (sessionMember?.email) {
      let targetTitle = v.activity_slug;
      const evRow = await env.DB.prepare("SELECT title FROM events WHERE id = ? OR slug = ? LIMIT 1")
        .bind(v.activity_slug, v.activity_slug)
        .first()
        .catch(() => null);
      if (evRow?.title) {
        targetTitle = evRow.title;
      } else {
        const postRow = await env.DB.prepare("SELECT title FROM posts WHERE slug = ? LIMIT 1")
          .bind(v.activity_slug)
          .first()
          .catch(() => null);
        if (postRow?.title) targetTitle = postRow.title;
      }
      const quoteSnippet = v.pull_quote || String(v.content || "").split(/\n+/)[0].slice(0, 180);
      const emailTask = sendContributionThankYouEmail(env, {
        kind: "reflection",
        lang: "vi",
        member: sessionMember,
        targetKey: v.activity_slug,
        targetTitle,
        targetSlug: v.activity_slug,
        pullQuote: quoteSnippet,
      });
      if (typeof context.waitUntil === "function") {
        context.waitUntil(emailTask);
      } else {
        await emailTask;
      }
    }

    return jsonResponse(
      {
        ok: true,
        reflection: serializePublicReflection(created, { currentMemberId: sessionMember.id }),
        message: "Đã gửi hương khí — bài của bạn đang chờ Ban Điều Phối duyệt hiển thị.",
      },
      201
    );
  } catch (_err) {
    return errorResponse(500, "DB_WRITE_FAILED", "Chưa thể lưu cảm nhận lúc này. Vui lòng thử lại sau giây lát.");
  }
}
