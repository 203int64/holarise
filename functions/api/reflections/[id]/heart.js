import {
  checkRateLimit,
  ensureReflectionsSchema,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  resolveHeartActor,
  verifyCsrfOrigin,
} from "../../../_lib/security.js";

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
    return jsonResponse(
      {
        ok: true,
        id,
        hearted: true,
        heartCount: Math.max(0, Number(refreshedComm?.heart_count || 0)),
      },
      200
    );
  }

  if (target.status !== "approved") {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài lưu bút công khai.");
  }

  const { actorKey, setCookie } = await resolveHeartActor(context);
  const existingHeart = await env.DB.prepare(
    "SELECT reflection_id FROM reflection_hearts WHERE reflection_id = ? AND actor_key = ?"
  )
    .bind(id, actorKey)
    .first();

  const now = new Date().toISOString();
  let hearted = false;

  if (existingHeart) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM reflection_hearts WHERE reflection_id = ? AND actor_key = ?").bind(id, actorKey),
      env.DB.prepare(
        `UPDATE activity_reflections
         SET heart_count = (SELECT COUNT(*) FROM reflection_hearts WHERE reflection_id = ?)
         WHERE id = ?`
      ).bind(id, id),
    ]);
    hearted = false;
  } else {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO reflection_hearts (reflection_id, actor_key, created_at) VALUES (?, ?, ?)"
      ).bind(id, actorKey, now),
      env.DB.prepare(
        `UPDATE activity_reflections
         SET heart_count = (SELECT COUNT(*) FROM reflection_hearts WHERE reflection_id = ?)
         WHERE id = ?`
      ).bind(id, id),
    ]);
    hearted = true;
  }

  const refreshed = await env.DB.prepare("SELECT heart_count FROM activity_reflections WHERE id = ?")
    .bind(id)
    .first();

  const headers = setCookie ? { "Set-Cookie": setCookie } : {};
  return jsonResponse(
    {
      ok: true,
      id,
      hearted,
      heartCount: Math.max(0, Number(refreshed?.heart_count || 0)),
    },
    200,
    headers
  );
}
