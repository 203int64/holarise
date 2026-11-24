import {
  ensureMemberSchema,
  errorResponse,
  jsonResponse,
  requireMember,
  verifyCsrfOrigin,
} from "../../../../_lib/security.js";

export async function onRequestGet(context) {
  const { env } = context;
  if (!env?.DB) return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");

  const auth = await requireMember(context);
  if (auth.error) return auth.error;

  await ensureMemberSchema(env.DB);
  const res = await env.DB.prepare(
    "SELECT credential_id, device_label, created_at, last_used_at FROM member_passkeys WHERE member_id = ? ORDER BY created_at DESC"
  )
    .bind(auth.member.id)
    .all();

  return jsonResponse({
    ok: true,
    items: (res.results || []).map((r) => ({
      id: r.credential_id,
      deviceLabel: r.device_label || "Passkey thiết bị",
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at || "",
    })),
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env?.DB) return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì.");
  if (!verifyCsrfOrigin(request)) return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");

  const auth = await requireMember(context);
  if (auth.error) return auth.error;

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return errorResponse(400, "MISSING_ID", "Thiếu mã Passkey cần gỡ.");

  await ensureMemberSchema(env.DB);
  await env.DB.prepare("DELETE FROM member_passkeys WHERE credential_id = ? AND member_id = ?")
    .bind(id, auth.member.id)
    .run();

  return jsonResponse({ ok: true });
}
