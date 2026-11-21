import { errorResponse, getSessionUser, jsonResponse } from "../../_lib/security.js";

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  const [countRow, user] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM admin_users").first(),
    getSessionUser(env.DB, request),
  ]);
  const initialized = Number(countRow?.cnt || 0) > 0;
  return jsonResponse({
    ok: true,
    initialized,
    authenticated: Boolean(user),
    user: user
      ? { id: user.id, email: user.email, name: user.name, role: user.role }
      : null,
  });
}
