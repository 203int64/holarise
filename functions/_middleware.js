/**
 * Global Pages Functions middleware:
 * - Canonicalizes www.holarise.org & holarise.pages.dev -> https://holarise.org (301 permanent redirect)
 * - 301 Permanent Redirects for legacy IA routes (/workshop/, /hoat-dong/, /tin-tuc/)
 * - Blocks direct external access to internal SSR templates (/_templates/*)
 * - Serves dynamic IndexNow verification key file `/<indexNowKey>.txt` configured from Admin
 * - Injects SEO site verification meta tags (Google/Bing) & optional Cloudflare Web Analytics beacon
 * - Passively records Search/AI bot crawls into D1 without blocking responses
 * - Marks *.pages.dev preview hosts with X-Robots-Tag: noindex, nofollow
 * - Ensures consistent baseline security headers on dynamic Function responses.
 */

import { detectBotName, isTrackablePublicPath, loadAnalyticsSeoConfig, recordBotHit } from "./_lib/analytics.js";

const CANONICAL_ORIGIN = "https://holarise.org";

const LEGACY_POST_SLUG_MAP = {
  "tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart": "tinh-yeu-thuong-cua-me",
  "chuoi-am-nhac-ket-noi-holaheart-musicspace": "holaheart-musicspace",
};

const LEGACY_EVENT_SLUG_MAP = {
  "chieu-leo-nui-rung-thong-nui-luot": "leo-nui-luot",
};

function escAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

  if (host === "www.holarise.org" || host === "holarise.pages.dev") {
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

  // Dynamic IndexNow verification file `/<indexNowKey>.txt` synced from D1 settings
  if (
    context.request.method === "GET" &&
    context.env?.DB &&
    /^\/[A-Za-z0-9-]{8,128}\.txt$/.test(url.pathname) &&
    url.pathname !== "/robots.txt" &&
    url.pathname !== "/llms.txt"
  ) {
    const requestedKey = url.pathname.slice(1, -4);
    const seoCfg = await loadAnalyticsSeoConfig(context.env.DB, context.env).catch(() => null);
    if (seoCfg?.indexnow_key && seoCfg.indexnow_key === requestedKey) {
      return new Response(`${seoCfg.indexnow_key}\n`, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
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

  const contentType = headers.get("Content-Type") || "";
  const isPublicHtml =
    context.request.method === "GET" &&
    response.status === 200 &&
    contentType.includes("text/html") &&
    isTrackablePublicPath(url.pathname);

  // Passive Search/AI Bot Crawl Tracking (non-blocking via waitUntil)
  if (isPublicHtml && context.env?.DB) {
    const botName = detectBotName(context.request.headers.get("User-Agent") || "");
    if (botName) {
      const task = recordBotHit(context.env.DB, botName);
      if (typeof context.waitUntil === "function") context.waitUntil(task);
      else await task.catch(() => null);
    }
  }

  let finalResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  // Dynamic Edge SEO verification tags & optional Cloudflare Web Analytics beacon injection
  if (isPublicHtml && context.env?.DB) {
    const seoCfg = await loadAnalyticsSeoConfig(context.env.DB, context.env).catch(() => null);
    const headTags = [];
    if (seoCfg?.google_site_verification) {
      headTags.push(`<meta name="google-site-verification" content="${escAttr(seoCfg.google_site_verification)}">`);
    }
    if (seoCfg?.bing_site_verification) {
      headTags.push(`<meta name="msvalidate.01" content="${escAttr(seoCfg.bing_site_verification)}">`);
    }
    const cfToken = seoCfg?.cf_web_analytics_token || "";
    const cfBeacon = cfToken
      ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: cfToken })}'></script>`
      : "";

    if (headTags.length > 0 || cfBeacon) {
      if (typeof HTMLRewriter !== "undefined") {
        let rewriter = new HTMLRewriter();
        if (headTags.length > 0) {
          rewriter = rewriter.on("head", {
            element(el) {
              el.append(`\n  ${headTags.join("\n  ")}`, { html: true });
            },
          });
        }
        if (cfBeacon) {
          rewriter = rewriter.on("body", {
            element(el) {
              el.append(`\n  ${cfBeacon}`, { html: true });
            },
          });
        }
        finalResponse = rewriter.transform(finalResponse);
      } else {
        // Fallback for Node test runtime without HTMLRewriter
        let html = await finalResponse.text();
        if (headTags.length > 0 && html.includes("</head>")) {
          html = html.replace("</head>", `  ${headTags.join("\n  ")}\n</head>`);
        }
        if (cfBeacon && html.includes("</body>")) {
          html = html.replace("</body>", `  ${cfBeacon}\n</body>`);
        }
        finalResponse = new Response(html, {
          status: finalResponse.status,
          statusText: finalResponse.statusText,
          headers,
        });
      }
    }
  }

  return finalResponse;
}
