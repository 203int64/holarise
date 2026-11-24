/**
 * GET /api/member/auth/google
 * Starts Google OAuth 2.0 Authorization Code Flow with CSRF state cookie.
 * Requires Cloudflare Pages env vars: GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET.
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const returnToRaw = url.searchParams.get("returnTo") || "/tham-gia/";
  const returnTo = returnToRaw.startsWith("/") && !returnToRaw.startsWith("//") ? returnToRaw : "/tham-gia/";

  const clientId = String(env?.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env?.GOOGLE_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    const fallback = new URL(returnTo, url.origin);
    fallback.searchParams.set("auth_error", "google_not_configured");
    return Response.redirect(fallback.toString(), 302);
  }

  const stateBytes = new Uint8Array(24);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const redirectUri = `${url.origin}/api/member/auth/google/callback`;
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("state", state);
  googleAuthUrl.searchParams.set("prompt", "select_account");

  const payload = encodeURIComponent(JSON.stringify({ state, returnTo }));
  const isSecure = url.protocol === "https:";
  const stateCookie = `holarise_oauth_state=${payload}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isSecure ? "; Secure" : ""}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: googleAuthUrl.toString(),
      "Set-Cookie": stateCookie,
      "Cache-Control": "no-store",
    },
  });
}
