import {
  ensureReflectionsSchema,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireMember,
} from "../../_lib/security.js";
import {
  extractMediaKeyFromUrl,
  parseReflectionPhotos,
  validateReflectionInput,
} from "../../_lib/validation.js";
import { serializePublicReflection } from "./index.js";

export async function onRequestPatch(context) {
  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;

  const { request, env, params } = context;
  await ensureReflectionsSchema(env.DB);
  const id = String(params?.id || "").trim();
  if (!id) {
    return errorResponse(400, "MISSING_ID", "Thiếu mã lưu bút.");
  }

  // Data-layer ownership enforcement (prevents IDOR)
  const existing = await env.DB.prepare(
    "SELECT * FROM activity_reflections WHERE id = ? AND member_id = ?"
  )
    .bind(id, auth.member.id)
    .first();

  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy lưu bút của bạn để chỉnh sửa.");
  }

  const parsed = await readJsonBody(request, 64 * 1024);
  if (!parsed.ok) return parsed.response;

  const existingPhotos = parseReflectionPhotos(existing.photos_json, existing.photo_url || "");
  const hasPhotoUrlsInput =
    parsed.data.photoUrls !== undefined ||
    parsed.data.photo_urls !== undefined ||
    parsed.data.photos !== undefined;
  const merged = {
    activitySlug: existing.activity_slug,
    participantRole: parsed.data.participantRole ?? parsed.data.participant_role ?? existing.participant_role,
    pullQuote: parsed.data.pullQuote !== undefined ? parsed.data.pullQuote : existing.pull_quote,
    mood: parsed.data.mood !== undefined ? parsed.data.mood : existing.mood || "",
    content: parsed.data.content !== undefined ? parsed.data.content : existing.content,
    ...(hasPhotoUrlsInput
      ? { photoUrls: parsed.data.photoUrls ?? parsed.data.photo_urls ?? parsed.data.photos }
      : parsed.data.photoUrl !== undefined || parsed.data.photo_url !== undefined
        ? { photoUrl: parsed.data.photoUrl ?? parsed.data.photo_url }
        : { photoUrls: existingPhotos }),
  };

  const validated = validateReflectionInput(merged, { requireSlug: false });
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Nội dung chỉnh sửa chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  const oldKeys = new Set(
    [existing.photo_media_key, ...existingPhotos.map(extractMediaKeyFromUrl)].filter(Boolean)
  );
  const nextKeys = new Set(
    [v.photo_media_key, ...v.photo_urls.map(extractMediaKeyFromUrl)].filter(Boolean)
  );
  const now = new Date().toISOString();

  // Any edit to an approved or rejected reflection automatically returns to 'pending' moderation!
  await env.DB.prepare(
    `UPDATE activity_reflections
     SET participant_role = ?, pull_quote = ?, mood = ?, content = ?, photo_url = ?, photo_media_key = ?, photos_json = ?,
         status = 'pending', admin_note = '', reviewed_by = '', reviewed_at = NULL, updated_at = ?
     WHERE id = ? AND member_id = ?`
  )
    .bind(
      v.participant_role,
      v.pull_quote,
      v.mood,
      v.content,
      v.photo_url,
      v.photo_media_key,
      v.photos_json,
      now,
      id,
      auth.member.id
    )
    .run();

  if (env?.MEDIA_KV?.delete) {
    for (const key of oldKeys) {
      if (!nextKeys.has(key)) {
        await env.MEDIA_KV.delete(`media:${key}`).catch(() => null);
      }
    }
  }

  const updated = await env.DB.prepare(
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

  return jsonResponse({
    ok: true,
    reflection: serializePublicReflection(updated, { currentMemberId: auth.member.id }),
    message: "Đã cập nhật lưu bút — bài viết đang chờ Ban Điều Phối duyệt lại.",
  });
}

export async function onRequestDelete(context) {
  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;

  const { env, params } = context;
  const id = String(params?.id || "").trim();
  if (!id) {
    return errorResponse(400, "MISSING_ID", "Thiếu mã lưu bút.");
  }

  await ensureReflectionsSchema(env.DB);
  const existing = await env.DB.prepare(
    "SELECT id, photo_url, photo_media_key, photos_json FROM activity_reflections WHERE id = ? AND member_id = ?"
  )
    .bind(id, auth.member.id)
    .first();

  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy lưu bút của bạn để xóa.");
  }

  await env.DB.prepare("DELETE FROM activity_reflections WHERE id = ? AND member_id = ?")
    .bind(id, auth.member.id)
    .run();

  if (env?.MEDIA_KV?.delete) {
    const keys = new Set(
      [
        existing.photo_media_key,
        ...parseReflectionPhotos(existing.photos_json, existing.photo_url || "").map(extractMediaKeyFromUrl),
      ].filter(Boolean)
    );
    await Promise.allSettled([...keys].map((k) => env.MEDIA_KV.delete(`media:${k}`)));
  }

  return jsonResponse({
    ok: true,
    id,
    message: "Đã xóa trang lưu bút của bạn.",
  });
}
