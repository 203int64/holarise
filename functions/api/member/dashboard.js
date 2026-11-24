import { errorResponse, getSessionMember, jsonResponse, serializePublicMember } from "../../_lib/security.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }

  const member = await getSessionMember(env.DB, request);
  if (!member) {
    return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên Hola.");
  }

  const [regsRes, refsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, event_id, activity_title, role, note, status, created_at
       FROM registrations
       WHERE member_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
      .bind(member.id)
      .all(),
    env.DB.prepare(
      `SELECT id, activity_slug, participant_role, pull_quote, content, photo_url, heart_count, status, admin_note, created_at, updated_at
       FROM activity_reflections
       WHERE member_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
      .bind(member.id)
      .all(),
  ]);

  const registrations = (regsRes.results || []).map((r) => ({
    id: r.id,
    eventId: r.event_id || "",
    activityTitle: r.activity_title || "",
    role: r.role || "",
    note: r.note || "",
    status: r.status || "new",
    createdAt: r.created_at,
  }));

  const reflections = (refsRes.results || []).map((r) => ({
    id: r.id,
    activitySlug: r.activity_slug,
    participantRole: r.participant_role,
    pullQuote: r.pull_quote || "",
    content: r.content,
    photoUrl: r.photo_url || "",
    heartCount: Number(r.heart_count || 0),
    status: r.status,
    adminNote: r.admin_note || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return jsonResponse({
    ok: true,
    member: serializePublicMember(member),
    registrations,
    reflections,
  });
}
