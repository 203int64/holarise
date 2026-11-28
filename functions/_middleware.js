/**
 * Global Pages Functions middleware:
 * - Canonicalizes www.holarise.org -> https://holarise.org (301 permanent redirect)
 * - 301 Permanent Redirects for legacy IA routes (/workshop/, /hoat-dong/, /tin-tuc/)
 * - Blocks direct external access to internal SSR templates (/_templates/*)
 * - Marks *.pages.dev preview/default hosts with X-Robots-Tag: noindex, nofollow
 * - Ensures consistent baseline security headers on dynamic Function responses.
 */

const CANONICAL_ORIGIN = "https://holarise.org";

const LEGACY_POST_SLUG_MAP = {
  "tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart": "tinh-yeu-thuong-cua-me",
  "chuoi-am-nhac-ket-noi-holaheart-musicspace": "holaheart-musicspace",
};

const LEGACY_EVENT_SLUG_MAP = {
  "chieu-leo-nui-rung-thong-nui-luot": "leo-nui-luot",
};

function buildLegacyRedirectPath(pathname, search) {
  const cleanPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (cleanPath === "/workshop") {
    return `/lich-hoat-dong/${search}`;
  }
  if (cleanPath === "/hoat-dong") {
    return `/gioi-thieu/${search}#chuong-trinh`;
  }
  if (cleanPath === "/tai-khoan") {
    return `/tham-gia/${search}`;
  }
  if (cleanPath === "/manager") {
    return `/admin/${search}`;
  }
  if (cleanPath === "/tin-tuc") {
    return `/hanh-trinh/${search}`;
  }
  if (cleanPath.startsWith("/tin-tuc/")) {
    const rest = cleanPath.slice("/tin-tuc/".length);
    if (rest && !rest.includes("/")) {
      const mapped = LEGACY_POST_SLUG_MAP[rest] || rest;
      return `/hanh-trinh/${mapped}/${search}`;
    }
    return `/hanh-trinh/${search}`;
  }
  if (cleanPath.startsWith("/hanh-trinh/")) {
    const rest = cleanPath.slice("/hanh-trinh/".length);
    if (rest && !rest.includes("/") && LEGACY_POST_SLUG_MAP[rest]) {
      return `/hanh-trinh/${LEGACY_POST_SLUG_MAP[rest]}/${search}`;
    }
  }
  if (cleanPath.startsWith("/su-kien/")) {
    const rest = cleanPath.slice("/su-kien/".length);
    if (rest && !rest.includes("/") && LEGACY_EVENT_SLUG_MAP[rest]) {
      return `/su-kien/${LEGACY_EVENT_SLUG_MAP[rest]}/${search}`;
    }
  }
  return null;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();

  if (host === "www.holarise.org") {
    const redirectPath = buildLegacyRedirectPath(url.pathname, url.search) || `${url.pathname}${url.search}`;
    const target = `${CANONICAL_ORIGIN}${redirectPath}`;
    return new Response(null, {
      status: 301,
      headers: {
        Location: target,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const legacyTarget = buildLegacyRedirectPath(url.pathname, url.search);
  if (legacyTarget) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${url.origin}${legacyTarget}`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  if (url.pathname === "/_templates" || url.pathname.startsWith("/_templates/")) {
    return new Response("Not Found", { status: 404 });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);

  if (host.endsWith(".pages.dev")) {
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("X-Frame-Options")) {
    headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  if (!headers.has("Permissions-Policy")) {
    headers.set("Permissions-Policy", "geolocation=(), payment=(), usb=(), interest-cohort=()");
  }
  if (url.protocol === "https:" && host === "holarise.org" && !headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
