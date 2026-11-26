import { constantTimeStringEqual } from "../../../../_lib/gate-token.js";
import {
  buildMemberSessionCookie,
  createMemberSession,
  ensureMemberSchema,
  generateSequentialMemberCode,
  hashPassword,
  parseCookies,
} from "../../../../_lib/security.js";

function clearOauthStateCookie(isSecure) {
  return `holarise_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? "; Secure" : ""}`;
}

function redirectWithError(origin, returnTo, code) {
  const target = new URL(returnTo || "/tham-gia/", origin);
  target.searchParams.set("auth_error", code);
  const isSecure = target.protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Set-Cookie": clearOauthStateCookie(isSecure),
      "Cache-Control": "no-store",
    },
  });
}

/**
 * GET /api/member/auth/google/callback
 * Exchanges Google OAuth code -> verifies email/profile -> signs in existing member
 * OR auto-creates a new member and redirects to step-by-step onboarding (?onboarding=1).
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const cookies = parseCookies(request);
  let stored = null;
  try {
    stored = cookies.holarise_oauth_state ? JSON.parse(decodeURIComponent(cookies.holarise_oauth_state)) : null;
  } catch {
    stored = null;
  }

  const returnTo =
    stored?.returnTo && stored.returnTo.startsWith("/") && !stored.returnTo.startsWith("//")
      ? stored.returnTo
      : "/tham-gia/";

  const oauthErr = url.searchParams.get("error");
  if (oauthErr) {
    return redirectWithError(url.origin, returnTo, "google_cancelled");
  }

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state || !stored?.state || !constantTimeStringEqual(String(stored.state), state)) {
    return redirectWithError(url.origin, returnTo, "google_state_invalid");
  }

  const clientId = String(env?.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env?.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret || !env?.DB) {
    return redirectWithError(url.origin, returnTo, "google_not_configured");
  }

  try {
    const redirectUri = `${url.origin}/api/member/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      return redirectWithError(url.origin, returnTo, "google_token_failed");
    }

    const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await userRes.json().catch(() => ({}));
    const email = String(profile.email || "").trim().toLowerCase();
    if (!userRes.ok || !email || profile.email_verified === false) {
      return redirectWithError(url.origin, returnTo, "google_email_unavailable");
    }

    const displayName = String(profile.name || email.split("@")[0] || "Thành viên Hola").trim().slice(0, 120);
    const pictureUrl =
      typeof profile.picture === "string" && profile.picture.startsWith("https://")
        ? profile.picture.slice(0, 500)
        : "";

    await ensureMemberSchema(env.DB);
    const now = new Date().toISOString();

    let memberRow = await env.DB.prepare("SELECT * FROM members WHERE email = ?").bind(email).first();
    let isNewMember = false;

    if (memberRow) {
      if (Number(memberRow.is_active) !== 1) {
        return redirectWithError(url.origin, returnTo, "account_disabled");
      }
      // Refresh last_login_at (and fill Google avatar if member has none yet)
      const nextAvatar = memberRow.avatar_url || pictureUrl;
      await env.DB.prepare("UPDATE members SET avatar_url = ?, last_login_at = ?, updated_at = ? WHERE id = ?")
        .bind(nextAvatar, now, now, memberRow.id)
        .run();
    } else {
      isNewMember = true;
      const memberId = `mbr-${crypto.randomUUID()}`;
      const randomSecret = crypto.randomUUID() + crypto.randomUUID();
      const { hash, salt } = await hashPassword(randomSecret);

      let inserted = false;
      const nowDate = new Date();
      for (let attempt = 0; attempt < 8; attempt++) {
        const memberCode = await generateSequentialMemberCode(env.DB, nowDate, attempt);
        try {
          await env.DB.prepare(
            `INSERT INTO members
             (id, member_code, email, phone_norm, phone_display, name, organization, pillar_choice,
              avatar_url, avatar_media_key, password_hash, password_salt, is_active, created_at, updated_at, last_login_at)
             VALUES (?, ?, ?, NULL, '', ?, '', 'holaheart', ?, '', ?, ?, 1, ?, ?, ?)`
          )
            .bind(memberId, memberCode, email, displayName, pictureUrl, hash, salt, now, now, now)
            .run();
          inserted = true;
          break;
        } catch (err) {
          if (!String(err?.message || "").includes("member_code")) throw err;
        }
      }
      if (!inserted) {
        return redirectWithError(url.origin, returnTo, "google_create_failed");
      }
      memberRow = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first();
    }

    const { rawToken } = await createMemberSession(env.DB, memberRow.id);
    const dest = new URL(isNewMember ? "/tham-gia/?onboarding=1" : returnTo, url.origin);

    const headers = new Headers({
      Location: dest.toString(),
      "Cache-Control": "no-store",
    });
    headers.append("Set-Cookie", clearOauthStateCookie(url.protocol === "https:"));
    headers.append("Set-Cookie", buildMemberSessionCookie(rawToken, request));

    return new Response(null, { status: 302, headers });
  } catch (_err) {
    return redirectWithError(url.origin, returnTo, "google_exchange_error");
  }
}
