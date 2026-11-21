import {
  buildSessionCookie,
  errorResponse,
  jsonResponse,
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
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (rawToken && env?.DB) {
    const hashedId = await sha256Hex(rawToken);
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(hashedId).run();
  }
  return jsonResponse({ ok: true }, 200, {
    "Set-Cookie": buildSessionCookie("", request, true),
  });
}
