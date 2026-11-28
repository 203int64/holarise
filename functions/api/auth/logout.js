import {
  buildMemberSessionCookie,
  buildSessionCookie,
  errorResponse,
  jsonResponse,
  MEMBER_SESSION_COOKIE_NAME,
  parseCookies,
  SESSION_COOKIE_NAME,
  sha256Hex,
  verifyCsrfOrigin,
} from "../../_lib/security.js";

export async function onRequestPost({ request, env }) {
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }
  const cookies = parseCookies(request);
  const rawAdminToken = cookies[SESSION_COOKIE_NAME];
  const rawMemberToken = cookies[MEMBER_SESSION_COOKIE_NAME];
  const url = new URL(request.url);
  const clearMember = url.searchParams.get("scope") === "media" || (!rawAdminToken && Boolean(rawMemberToken));

  if (env?.DB) {
    const tasks = [];
    if (rawAdminToken) {
      tasks.push(
        sha256Hex(rawAdminToken).then((hashedId) =>
          env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(hashedId).run()
        )
      );
    }
    if (clearMember && rawMemberToken) {
      tasks.push(
        sha256Hex(rawMemberToken).then((hashedId) =>
          env.DB.prepare("DELETE FROM member_sessions WHERE id = ?").bind(hashedId).run().catch(() => {})
        )
      );
    }
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  const res = jsonResponse({ ok: true }, 200);
  res.headers.append("Set-Cookie", buildSessionCookie("", request, true));
  if (clearMember) {
    res.headers.append("Set-Cookie", buildMemberSessionCookie("", request, true));
  }
  return res;
}
