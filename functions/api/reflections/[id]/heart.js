import {
  checkRateLimit,
  ensureReflectionsSchema,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  resolveHeartActor,
  verifyCsrfOrigin,
} from "../../../_lib/security.js";
import { VALID_REACTION_TYPES, cleanStr } from "../../../_lib/validation.js";

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const id = String(params?.id || "").trim();
  if (!id) {
    return errorResponse(400, "MISSING_ID", "Thiếu mã lưu bút.");
  }

  // Optional reaction type: 'heart' | 'warm' | 'inspire' (defaults to 'heart' for backwards compatibility)
  let requestedReaction = "heart";
  const ct = String(request.headers.get("Content-Type") || "");
  if (ct.includes("application/json")) {
    try {
      const body = await request.json();
      const raw = cleanStr(body?.reaction || body?.reactionType, 24).toLowerCase();
      if (VALID_REACTION_TYPES.has(raw)) {
        requestedReaction = raw;
      }
    } catch {
      // Ignore empty/malformed optional JSON body
    }
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `heart:${ipHash}`, 30, 5 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Thao tác quá nhanh. Vui lòng đợi giây lát.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  await ensureReflectionsSchema(env.DB);

  const target = await env.DB.prepare(
    "SELECT id, status FROM activity_reflections WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!target) {
    const commTarget = await env.DB.prepare(
      "SELECT id, status, heart_count FROM community_testimonials WHERE id = ?"
    )
      .bind(id)
      .first()
      .catch(() => null);
    if (!commTarget || commTarget.status !== "approved") {
      return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài lưu bút công khai.");
    }
    await env.DB.prepare(
      "UPDATE community_testimonials SET heart_count = COALESCE(heart_count, 0) + 1 WHERE id = ?"
    )
      .bind(id)
      .run();
    const refreshedComm = await env.DB.prepare(
      "SELECT heart_count FROM community_testimonials WHERE id = ?"
    )
      .bind(id)
      .first();
    const nextCnt = Math.max(0, Number(refreshedComm?.heart_count || 0));
    return jsonResponse(
      {
        ok: true,
        id,
        hearted: true,
        heartCount: nextCnt,
        myReaction: requestedReaction,
        reactions: { heart: nextCnt, warm: 0, inspire: 0 },
      },
      200
    );
  }

  if (target.status !== "approved") {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài lưu bút công khai.");
  }

  const { actorKey, setCookie } = await resolveHeartActor(context);
  const existingHeart = await env.DB.prepare(
    "SELECT reflection_id, COALESCE(NULLIF(reaction_type, ''), 'heart') AS reaction_type FROM reflection_hearts WHERE reflection_id = ? AND actor_key = ?"
  )
    .bind(id, actorKey)
    .first();

  const now = new Date().toISOString();
  let myReaction = "";

  if (existingHeart && existingHeart.reaction_type === requestedReaction) {
    // Clicking the same reaction toggles it off
    await env.DB.batch([
      env.DB.prepare("DELETE FROM reflection_hearts WHERE reflection_id = ? AND actor_key = ?").bind(id, actorKey),
      env.DB.prepare(
        `UPDATE activity_reflections
         SET heart_count = (SELECT COUNT(*) FROM reflection_hearts WHERE reflection_id = ?)
         WHERE id = ?`
      ).bind(id, id),
    ]);
    myReaction = "";
  } else if (existingHeart) {
    // Switching from one reaction to another
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE reflection_hearts SET reaction_type = ?, created_at = ? WHERE reflection_id = ? AND actor_key = ?"
      ).bind(requestedReaction, now, id, actorKey),
      env.DB.prepare(
        `UPDATE activity_reflections
         SET heart_count = (SELECT COUNT(*) FROM reflection_hearts WHERE reflection_id = ?)
         WHERE id = ?`
      ).bind(id, id),
    ]);
    myReaction = requestedReaction;
  } else {
    // Adding a new reaction
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO reflection_hearts (reflection_id, actor_key, reaction_type, created_at) VALUES (?, ?, ?, ?)"
      ).bind(id, actorKey, requestedReaction, now),
      env.DB.prepare(
        `UPDATE activity_reflections
         SET heart_count = (SELECT COUNT(*) FROM reflection_hearts WHERE reflection_id = ?)
         WHERE id = ?`
      ).bind(id, id),
    ]);
    myReaction = requestedReaction;
  }

  const [refreshed, summaryRes] = await Promise.all([
    env.DB.prepare("SELECT heart_count FROM activity_reflections WHERE id = ?").bind(id).first(),
    env.DB.prepare(
      `SELECT COALESCE(NULLIF(reaction_type, ''), 'heart') AS reaction_type, COUNT(*) AS cnt
       FROM reflection_hearts
       WHERE reflection_id = ?
       GROUP BY COALESCE(NULLIF(reaction_type, ''), 'heart')`
    )
      .bind(id)
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const reactions = { heart: 0, warm: 0, inspire: 0 };
  for (const r of summaryRes.results || []) {
    const k = r.reaction_type in reactions ? r.reaction_type : "heart";
    reactions[k] += Number(r.cnt || 0);
  }

  const headers = setCookie ? { "Set-Cookie": setCookie } : {};
  return jsonResponse(
    {
      ok: true,
      id,
      hearted: Boolean(myReaction),
      heartCount: Math.max(0, Number(refreshed?.heart_count || 0)),
      myReaction,
      reactions,
    },
    200,
    headers
  );
}
