/**
 * Canonical Cloudflare Turnstile server-side verification helper.
 * - Fails closed when `env.TURNSTILE_SECRET` is configured: requires `success === true`,
 *   matching `action`, and hostname inside the deployment allowlist.
 * - Passes through transparently (`{ ok: true, skipped: true }`) when `env.TURNSTILE_SECRET`
 *   is not configured yet so local dev & zero-key environments remain unblocked.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function resolveExpectedHostnames(request, env) {
  const configured = String(env?.TURNSTILE_HOSTNAMES || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  let reqHost = "";
  try {
    reqHost = new URL(request.url).hostname.toLowerCase();
  } catch {
    reqHost = "";
  }

  const isProdHost = Boolean(reqHost && !LOCAL_HOSTS.has(reqHost));
  if (configured.length > 0) {
    // Never accept localhost/127.0.0.1 when serving a non-local production host.
    return new Set(isProdHost ? configured.filter((h) => !LOCAL_HOSTS.has(h)) : configured);
  }
  return reqHost ? new Set([reqHost]) : new Set();
}

export async function verifyTurnstileToken(
  request,
  env,
  rawToken,
  expectedAction,
  fetchImpl = fetch
) {
  const secret = String(env?.TURNSTILE_SECRET || "").trim();
  if (!secret) {
    return { ok: true, skipped: true };
  }

  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  const expectedHostnames = resolveExpectedHostnames(request, env);
  if (token.length === 0 || token.length > 2048 || expectedHostnames.size === 0) {
    return { ok: false, code: "TURNSTILE_REQUIRED" };
  }

  const remoteip =
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "";

  const form = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteip) form.set("remoteip", remoteip);

  let result;
  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10000),
      body: form,
    });
    if (!res.ok) {
      return { ok: false, code: "TURNSTILE_UPSTREAM_ERROR" };
    }
    result = await res.json();
  } catch {
    return { ok: false, code: "TURNSTILE_NETWORK_ERROR" };
  }

  const returnedHost = String(result?.hostname || "").trim().toLowerCase();
  const returnedAction = String(result?.action || "").trim();

  if (
    result?.success !== true ||
    (expectedAction && returnedAction !== expectedAction) ||
    !expectedHostnames.has(returnedHost)
  ) {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      errorCodes: Array.isArray(result?.["error-codes"]) ? result["error-codes"] : [],
    };
  }

  return { ok: true, skipped: false, hostname: returnedHost, action: returnedAction };
}
