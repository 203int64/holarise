import {
  MEMBER_SESSION_COOKIE_NAME,
  buildMemberSessionCookie,
  errorResponse,
  jsonResponse,
  parseCookies,
  sha256Hex,
  verifyCsrfOrigin,
} from "../../../_lib/security.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const cookies = parseCookies(request);
  const rawToken = cookies[MEMBER_SESSION_COOKIE_NAME];
  if (rawToken && env?.DB) {
    const hashedId = await sha256Hex(rawToken);
    await env.DB.prepare("DELETE FROM member_sessions WHERE id = ?")
      .bind(hashedId)
      .run()
      .catch(() => null);
  }

  return jsonResponse(
    { ok: true },
    200,
    {
      "Set-Cookie": buildMemberSessionCookie("", request, true),
    }
  );
}
