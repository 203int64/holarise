import { getAdminUserProfile } from "../../_lib/admin-passkey-schema.js";
import { errorResponse, getSessionUser, isSoleAdminAccount, jsonResponse } from "../../_lib/security.js";

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  const [countRow, sessionUser] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM admin_users").first(),
    getSessionUser(env.DB, request),
  ]);
  const initialized = Number(countRow?.cnt || 0) > 0;
  let profile = null;
  if (sessionUser) {
    profile =
      (await getAdminUserProfile(env.DB, sessionUser.id).catch(() => null)) || {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        phone: "",
        department: "",
        role: sessionUser.role,
        hasPasskey: false,
      };
  }
  return jsonResponse({
    ok: true,
    initialized,
    authenticated: Boolean(profile),
    isSoleAdmin: Boolean(profile && isSoleAdminAccount(profile, env)),
    mediaGateEnabled: Boolean(String(env?.MEDIA_ACCESS_PIN || "").trim()),
    user: profile,
  });
}
