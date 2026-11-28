import { getAdminUserProfile } from "../../_lib/admin-passkey-schema.js";
import { hasMemberCapability } from "../../_lib/capabilities.js";
import { getMediaAccessPin } from "../../_lib/gate-token.js";
import { getMemberPermissions } from "../../_lib/media-access.js";
import { errorResponse, getSessionMember, getSessionUser, isSoleAdminAccount, jsonResponse } from "../../_lib/security.js";

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }
  const [countRow, sessionUser, sessionMember] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM admin_users").first(),
    getSessionUser(env.DB, request),
    getSessionMember(env.DB, request).catch(() => null),
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
  let mediaContributor = null;
  if (!profile && sessionMember) {
    const perms = await getMemberPermissions(env.DB, sessionMember.id);
    const isNgv =
      perms.canAccessMediaPortal ||
      (await hasMemberCapability(env.DB, sessionMember.id, "media.portal").catch(() => false));
    if (isNgv) {
      mediaContributor = {
        id: sessionMember.id,
        email: sessionMember.email || "",
        name: sessionMember.name || "Thành viên NGV",
        phone: sessionMember.phone_display || "",
        department: `NGV · ${sessionMember.member_code || "Cộng tác viên Media"}`,
        memberCode: sessionMember.member_code || "",
        role: "ngv",
        hasPasskey: false,
        canUpload: true,
      };
    }
  }
  return jsonResponse({
    ok: true,
    initialized,
    authenticated: Boolean(profile),
    isSoleAdmin: Boolean(profile && isSoleAdminAccount(profile, env)),
    mediaGateEnabled: Boolean(getMediaAccessPin(env)),
    user: profile,
    mediaContributor,
    mediaViewer: mediaContributor,
  });
}
