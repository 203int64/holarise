/**
 * HolaRise Privacy-First Analytics, Audience Intelligence, SEO Config,
 * Web Crypto Google Search Console JWT Auth & Growth Recommendations Engine.
 *
 * Privacy Invariants (AGENTS.md Layer 3 — Vietnam Decree 13/2023/ND-CP):
 * - NEVER stores raw IP addresses or persistent tracking cookies.
 * - Uses daily rotating SHA-256 hash(date + ip + ua + salt) for unique counts.
 * - Secrets (PageSpeed API Key, GSC Service Account Private Key) are stored in D1 `settings`
 *   and NEVER returned in plain text via GET APIs.
 */

import { cleanStr } from "./validation.js";

export const ANALYTICS_CONFIG_KEY = "analytics_seo_config";
export const DEFAULT_INDEXNOW_KEY = "9a6a41c8a275d9ed39b1a0e4b1df32e1";
export const SITE_ORIGIN = "https://holarise.org";

export function getTodayVnIso(nowMs = Date.now()) {
  return new Date(nowMs + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getDateOffsetVnIso(daysBack, nowMs = Date.now()) {
  return getTodayVnIso(nowMs - daysBack * 24 * 60 * 60 * 1000);
}

export async function ensureAnalyticsSchema(db) {
  if (!db) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS analytics_daily_pages (
      date TEXT NOT NULL,
      path TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      uniques INTEGER NOT NULL DEFAULT 0,
      sessions INTEGER NOT NULL DEFAULT 0,
      bounces INTEGER NOT NULL DEFAULT 0,
      dwell_ms_sum INTEGER NOT NULL DEFAULT 0,
      dwell_count INTEGER NOT NULL DEFAULT 0,
      scroll_sum INTEGER NOT NULL DEFAULT 0,
      scroll_count INTEGER NOT NULL DEFAULT 0,
      lcp_sum INTEGER NOT NULL DEFAULT 0,
      lcp_count INTEGER NOT NULL DEFAULT 0,
      inp_sum INTEGER NOT NULL DEFAULT 0,
      inp_count INTEGER NOT NULL DEFAULT 0,
      cls_x1000_sum INTEGER NOT NULL DEFAULT 0,
      cls_count INTEGER NOT NULL DEFAULT 0,
      ttfb_sum INTEGER NOT NULL DEFAULT 0,
      ttfb_count INTEGER NOT NULL DEFAULT 0,
      cta_clicks INTEGER NOT NULL DEFAULT 0,
      member_views INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, path)
    )`,
    `CREATE TABLE IF NOT EXISTS analytics_daily_dims (
      date TEXT NOT NULL,
      dim_type TEXT NOT NULL,
      dim_value TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      uniques INTEGER NOT NULL DEFAULT 0,
      dwell_ms_sum INTEGER NOT NULL DEFAULT 0,
      dwell_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, dim_type, dim_value)
    )`,
    `CREATE TABLE IF NOT EXISTS analytics_daily_visitors (
      date TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (date, visitor_hash, scope)
    )`,
    `CREATE TABLE IF NOT EXISTS analytics_recent_visits (
      id TEXT PRIMARY KEY,
      visited_at TEXT NOT NULL,
      date TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL,
      referrer_host TEXT NOT NULL DEFAULT '',
      source_label TEXT NOT NULL DEFAULT 'Direct',
      utm_source TEXT NOT NULL DEFAULT '',
      utm_campaign TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      as_org TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT 'desktop',
      browser TEXT NOT NULL DEFAULT 'Other',
      os TEXT NOT NULL DEFAULT 'Other',
      lang TEXT NOT NULL DEFAULT 'vi',
      is_member INTEGER NOT NULL DEFAULT 0,
      is_returning INTEGER NOT NULL DEFAULT 0,
      dwell_ms INTEGER NOT NULL DEFAULT 0,
      scroll_pct INTEGER NOT NULL DEFAULT 0,
      lcp_ms INTEGER NOT NULL DEFAULT 0,
      inp_ms INTEGER NOT NULL DEFAULT 0,
      cls_x1000 INTEGER NOT NULL DEFAULT 0,
      ttfb_ms INTEGER NOT NULL DEFAULT 0,
      goals_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS analytics_psi_snapshots (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      strategy TEXT NOT NULL CHECK(strategy IN ('mobile', 'desktop')),
      perf_score INTEGER NOT NULL DEFAULT 0,
      seo_score INTEGER NOT NULL DEFAULT 0,
      a11y_score INTEGER NOT NULL DEFAULT 0,
      bp_score INTEGER NOT NULL DEFAULT 0,
      fcp_ms INTEGER NOT NULL DEFAULT 0,
      lcp_ms INTEGER NOT NULL DEFAULT 0,
      tbt_ms INTEGER NOT NULL DEFAULT 0,
      cls_x1000 INTEGER NOT NULL DEFAULT 0,
      ttfb_ms INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'pagespeed',
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_daily_pages_date ON analytics_daily_pages(date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_daily_dims_lookup ON analytics_daily_dims(dim_type, date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_recent_visited ON analytics_recent_visits(visited_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_recent_session ON analytics_recent_visits(session_id, visited_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_psi_created ON analytics_psi_snapshots(created_at DESC)`,
  ];
  for (const sql of statements) {
    await db.prepare(sql).run().catch(() => null);
  }
}

export function normalizePath(rawPath) {
  let p = String(rawPath || "/").trim();
  try {
    if (/^https?:\/\//i.test(p)) {
      p = new URL(p).pathname;
    }
  } catch {
    // keep raw
  }
  const qIdx = p.indexOf("?");
  if (qIdx >= 0) p = p.slice(0, qIdx);
  const hIdx = p.indexOf("#");
  if (hIdx >= 0) p = p.slice(0, hIdx);
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && !p.endsWith("/") && !/\.[a-z0-9]{2,5}$/i.test(p)) {
    p = `${p}/`;
  }
  return p.slice(0, 180) || "/";
}

export function isTrackablePublicPath(pathname) {
  const p = normalizePath(pathname).toLowerCase();
  if (
    p === "/admin/" ||
    p.startsWith("/admin/") ||
    p === "/media/" ||
    p.startsWith("/media/") ||
    p.startsWith("/api/") ||
    p.startsWith("/_templates/") ||
    p.startsWith("/assets/") ||
    p === "/robots.txt" ||
    p === "/sitemap.xml" ||
    p === "/llms.txt" ||
    p === "/favicon.ico" ||
    p === "/site.webmanifest"
  ) {
    return false;
  }
  return true;
}

const BOT_PATTERNS = [
  { name: "Googlebot", re: /googlebot|google-inspectiontool|adsbot-google/i },
  { name: "Bingbot", re: /bingbot|msnbot|bingpreview/i },
  { name: "GPTBot / OpenAI", re: /gptbot|oai-searchbot|chatgpt-user/i },
  { name: "PerplexityBot", re: /perplexitybot|perplexity-user/i },
  { name: "ClaudeBot", re: /claudebot|anthropic-ai|claude-web/i },
  { name: "Applebot", re: /applebot/i },
  { name: "ZaloPreview", re: /zalo.*preview|zalobot/i },
  { name: "Facebook / Meta", re: /facebookexternalhit|meta-externalagent|facebot/i },
  { name: "Ahrefs / Semrush", re: /ahrefsbot|semrushbot|mj12bot|dotbot/i },
  { name: "Other Bot", re: /bot\b|crawler|spider|slurp|duckduckbot|yandex|baiduspider|headlesschrome|lighthouse|curl\/|python-urllib/i },
];

export function detectBotName(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "";
  for (const item of BOT_PATTERNS) {
    if (item.re.test(ua)) return item.name;
  }
  return "";
}

export function parseUserAgent(userAgent) {
  const ua = String(userAgent || "");
  const isTablet = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua);
  const isMobile = !isTablet && /iphone|ipod|android.*mobile|windows phone|blackberry|zalo|fban|fbav|instagram|tiktok/i.test(ua);
  const device = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let os = "Other";
  if (/iphone|ipad|ipod|ios/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Other";
  if (/zalo/i.test(ua)) browser = "Zalo In-App";
  else if (/fban\/messenger|messenger/i.test(ua)) browser = "Messenger In-App";
  else if (/fban|fbav|fb_iab/i.test(ua)) browser = "Facebook In-App";
  else if (/instagram/i.test(ua)) browser = "Instagram In-App";
  else if (/tiktok|bytedancewebview|musical_ly/i.test(ua)) browser = "TikTok In-App";
  else if (/coc_coc_browser/i.test(ua)) browser = "Cốc Cốc";
  else if (/edg\//i.test(ua)) browser = "Edge";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";

  return { device, os, browser };
}

export function classifySource({ referrer = "", utmSource = "", userAgent = "", browser = "" }) {
  const utm = cleanStr(utmSource, 60).toLowerCase();
  if (utm) {
    if (utm.includes("zalo")) return { sourceLabel: "Zalo", referrerHost: "zalo" };
    if (utm.includes("fb") || utm.includes("facebook")) return { sourceLabel: "Facebook", referrerHost: "facebook" };
    if (utm.includes("messenger")) return { sourceLabel: "Messenger", referrerHost: "messenger" };
    if (utm.includes("google")) return { sourceLabel: "Google", referrerHost: "google" };
    if (utm.includes("ig") || utm.includes("instagram")) return { sourceLabel: "Instagram", referrerHost: "instagram" };
    if (utm.includes("tiktok")) return { sourceLabel: "TikTok", referrerHost: "tiktok" };
    if (utm.includes("youtube")) return { sourceLabel: "YouTube", referrerHost: "youtube" };
    if (utm.includes("qr") || utm.includes("poster")) return { sourceLabel: "QR / In ấn", referrerHost: "qr" };
    return { sourceLabel: `UTM: ${utm}`, referrerHost: utm };
  }

  let refHost = "";
  if (referrer) {
    try {
      const u = new URL(referrer);
      refHost = u.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      refHost = "";
    }
  }

  // Ignore self-referrals
  if (refHost === "holarise.org" || refHost.endsWith(".holarise.org") || refHost.endsWith(".pages.dev")) {
    refHost = "";
  }

  const ua = String(userAgent || "");
  if (refHost) {
    if (refHost.includes("zalo")) return { sourceLabel: "Zalo", referrerHost: refHost };
    if (refHost.includes("messenger.com")) return { sourceLabel: "Messenger", referrerHost: refHost };
    if (refHost.includes("facebook.com") || refHost === "fb.com" || refHost === "l.facebook.com" || refHost === "lm.facebook.com" || refHost === "m.facebook.com") {
      return { sourceLabel: "Facebook", referrerHost: refHost };
    }
    if (refHost.includes("google.")) return { sourceLabel: "Google Search", referrerHost: refHost };
    if (refHost.includes("bing.com")) return { sourceLabel: "Bing Search", referrerHost: refHost };
    if (refHost.includes("chatgpt.com") || refHost.includes("openai.com")) return { sourceLabel: "ChatGPT / AI", referrerHost: refHost };
    if (refHost.includes("perplexity.ai")) return { sourceLabel: "Perplexity AI", referrerHost: refHost };
    if (refHost.includes("duckduckgo.com")) return { sourceLabel: "DuckDuckGo", referrerHost: refHost };
    if (refHost.includes("coccoc.com")) return { sourceLabel: "Cốc Cốc", referrerHost: refHost };
    if (refHost.includes("youtube.com") || refHost === "youtu.be") return { sourceLabel: "YouTube", referrerHost: refHost };
    if (refHost.includes("instagram.com")) return { sourceLabel: "Instagram", referrerHost: refHost };
    if (refHost.includes("tiktok.com")) return { sourceLabel: "TikTok", referrerHost: refHost };
    if (refHost.includes("threads.net")) return { sourceLabel: "Threads", referrerHost: refHost };
    return { sourceLabel: refHost.slice(0, 50), referrerHost: refHost.slice(0, 80) };
  }

  // Dark Social detection from In-App WebView User-Agent when Referrer is stripped
  if (browser === "Zalo In-App" || /zalo/i.test(ua)) return { sourceLabel: "Zalo (In-App)", referrerHost: "zalo-webview" };
  if (browser === "Messenger In-App") return { sourceLabel: "Messenger (In-App)", referrerHost: "messenger-webview" };
  if (browser === "Facebook In-App") return { sourceLabel: "Facebook (In-App)", referrerHost: "fb-webview" };
  if (browser === "Instagram In-App") return { sourceLabel: "Instagram (In-App)", referrerHost: "ig-webview" };
  if (browser === "TikTok In-App") return { sourceLabel: "TikTok (In-App)", referrerHost: "tiktok-webview" };

  return { sourceLabel: "Direct", referrerHost: "" };
}

export async function dailyVisitorHash(ip, ua, date, salt = "") {
  const raw = `${date}|${ip || "anon"}|${String(ua || "").slice(0, 120)}|${salt || "holarise-daily-v1"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function parseAcceptLanguage(headerVal) {
  const raw = String(headerVal || "").trim();
  if (!raw) return "vi";
  const primary = raw.split(",")[0].split(";")[0].trim().toLowerCase();
  if (primary.startsWith("vi")) return "vi";
  if (primary.startsWith("en")) return "en";
  if (primary.startsWith("ja")) return "ja";
  if (primary.startsWith("ko")) return "ko";
  if (primary.startsWith("zh")) return "zh";
  if (primary.startsWith("fr")) return "fr";
  return primary.slice(0, 8) || "vi";
}

export async function recordBotHit(db, botName, nowMs = Date.now()) {
  if (!db || !botName) return;
  const date = getTodayVnIso(nowMs);
  const nowIso = new Date(nowMs).toISOString();
  await ensureAnalyticsSchema(db).catch(() => null);
  await db
    .prepare(
      `INSERT INTO analytics_daily_dims (date, dim_type, dim_value, views, uniques, dwell_ms_sum, dwell_count, updated_at)
       VALUES (?, 'bot', ?, 1, 1, 0, 0, ?)
       ON CONFLICT(date, dim_type, dim_value)
       DO UPDATE SET views = views + 1, updated_at = excluded.updated_at`
    )
    .bind(date, cleanStr(botName, 60), nowIso)
    .run()
    .catch(() => null);
}

export function maskSecret(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export async function loadAnalyticsSeoConfig(db, env = {}) {
  let raw = {};
  if (db) {
    try {
      const row = await db
        .prepare("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(ANALYTICS_CONFIG_KEY)
        .first();
      if (row?.value) {
        raw = JSON.parse(row.value);
      }
    } catch {
      raw = {};
    }
  }
  const indexNowKey = cleanStr(raw.indexnow_key || env?.INDEXNOW_KEY || DEFAULT_INDEXNOW_KEY, 128);
  return {
    telemetry_enabled: raw.telemetry_enabled !== false,
    google_site_verification: cleanStr(raw.google_site_verification || "", 120),
    bing_site_verification: cleanStr(raw.bing_site_verification || "", 120),
    indexnow_key: indexNowKey,
    cf_web_analytics_token: cleanStr(raw.cf_web_analytics_token || "", 120),
    cf_zone_id: cleanStr(raw.cf_zone_id || env?.CF_ZONE_ID || "", 64),
    cf_api_token: cleanStr(raw.cf_api_token || env?.CF_API_TOKEN || "", 200),
    pagespeed_api_key: cleanStr(raw.pagespeed_api_key || env?.PAGESPEED_API_KEY || "", 200),
    gsc_site_url: cleanStr(raw.gsc_site_url || "sc-domain:holarise.org", 200),
    gsc_client_email: cleanStr(raw.gsc_client_email || env?.GSC_CLIENT_EMAIL || "", 200),
    gsc_private_key: String(raw.gsc_private_key || env?.GSC_PRIVATE_KEY || "").trim(),
    last_indexnow_ping_at: cleanStr(raw.last_indexnow_ping_at || "", 60),
    last_indexnow_status: cleanStr(raw.last_indexnow_status || "", 80),
    last_indexnow_count: Number(raw.last_indexnow_count || 0),
    updated_at: cleanStr(raw.updated_at || "", 60),
  };
}

export function toPublicAnalyticsConfig(cfg) {
  return {
    telemetry_enabled: cfg.telemetry_enabled !== false,
    google_site_verification: cfg.google_site_verification || "",
    bing_site_verification: cfg.bing_site_verification || "",
    indexnow_key: cfg.indexnow_key || DEFAULT_INDEXNOW_KEY,
    cf_web_analytics_token: cfg.cf_web_analytics_token || "",
    cf_zone_id: cfg.cf_zone_id || "",
    has_cf_api_token: Boolean(cfg.cf_zone_id && cfg.cf_api_token),
    cf_token_hint: maskSecret(cfg.cf_api_token),
    has_pagespeed_key: Boolean(cfg.pagespeed_api_key),
    pagespeed_key_hint: maskSecret(cfg.pagespeed_api_key),
    gsc_site_url: cfg.gsc_site_url || "sc-domain:holarise.org",
    gsc_client_email: cfg.gsc_client_email || "",
    has_gsc_credentials: Boolean(cfg.gsc_client_email && cfg.gsc_private_key),
    last_indexnow_ping_at: cfg.last_indexnow_ping_at || "",
    last_indexnow_status: cfg.last_indexnow_status || "",
    last_indexnow_count: Number(cfg.last_indexnow_count || 0),
    updated_at: cfg.updated_at || "",
  };
}

export async function saveAnalyticsSeoConfig(db, env, patch) {
  const current = await loadAnalyticsSeoConfig(db, env);
  const now = new Date().toISOString();
  const next = {
    ...current,
    updated_at: now,
  };

  if (typeof patch.telemetry_enabled === "boolean") {
    next.telemetry_enabled = patch.telemetry_enabled;
  }
  if (typeof patch.google_site_verification === "string") {
    next.google_site_verification = cleanStr(patch.google_site_verification, 120);
  }
  if (typeof patch.bing_site_verification === "string") {
    next.bing_site_verification = cleanStr(patch.bing_site_verification, 120);
  }
  if (typeof patch.indexnow_key === "string") {
    const k = cleanStr(patch.indexnow_key, 128);
    if (k) next.indexnow_key = k;
  }
  if (typeof patch.cf_web_analytics_token === "string") {
    next.cf_web_analytics_token = cleanStr(patch.cf_web_analytics_token, 120);
  }
  if (typeof patch.cf_zone_id === "string") {
    next.cf_zone_id = cleanStr(patch.cf_zone_id, 64);
  }
  if (patch.clear_cf_api_token === true) {
    next.cf_api_token = "";
  } else if (typeof patch.cf_api_token === "string" && patch.cf_api_token.trim()) {
    next.cf_api_token = cleanStr(patch.cf_api_token, 200);
  }
  if (patch.clear_pagespeed_key === true) {
    next.pagespeed_api_key = "";
  } else if (typeof patch.pagespeed_api_key === "string" && patch.pagespeed_api_key.trim()) {
    next.pagespeed_api_key = cleanStr(patch.pagespeed_api_key, 200);
  }
  if (typeof patch.gsc_site_url === "string") {
    next.gsc_site_url = cleanStr(patch.gsc_site_url, 200) || "sc-domain:holarise.org";
  }
  if (patch.clear_gsc_credentials === true) {
    next.gsc_client_email = "";
    next.gsc_private_key = "";
  } else {
    if (typeof patch.gsc_service_account_json === "string" && patch.gsc_service_account_json.trim()) {
      const parsed = JSON.parse(patch.gsc_service_account_json);
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error("File JSON Service Account thiếu client_email hoặc private_key.");
      }
      next.gsc_client_email = cleanStr(parsed.client_email, 200);
      next.gsc_private_key = String(parsed.private_key).trim();
    } else {
      if (typeof patch.gsc_client_email === "string") {
        next.gsc_client_email = cleanStr(patch.gsc_client_email, 200);
      }
      if (typeof patch.gsc_private_key === "string" && patch.gsc_private_key.trim()) {
        next.gsc_private_key = patch.gsc_private_key.trim();
      }
    }
  }
  if (typeof patch.last_indexnow_ping_at === "string") next.last_indexnow_ping_at = patch.last_indexnow_ping_at;
  if (typeof patch.last_indexnow_status === "string") next.last_indexnow_status = patch.last_indexnow_status;
  if (typeof patch.last_indexnow_count === "number") next.last_indexnow_count = patch.last_indexnow_count;

  await db
    .prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
    .bind(ANALYTICS_CONFIG_KEY, JSON.stringify(next), now)
    .run();

  return next;
}

function base64UrlEncode(bytes) {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const clean = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

/**
 * Pure Web Crypto RS256 JWT Exchange for Google Search Console API (Zero npm dependencies).
 */
export async function getGoogleAccessToken({ clientEmail, privateKeyPem, scope = "https://www.googleapis.com/auth/webmasters.readonly" }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      exp: nowSec + 3600,
      iat: nowSec,
    })
  );
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const assertion = `${signingInput}.${base64UrlEncode(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google OAuth HTTP ${res.status}`);
  }
  return data.access_token;
}

/**
 * Automated Growth & SEO Playbook Generator ("Hướng xây dựng") from verified D1 + RUM + SEO + PSI data.
 */
export function buildGrowthRecommendations({ summary, funnel, vitals, seoAudit, config, latestPsi }) {
  const items = [];

  // 1. Search Engine Verification & IndexNow
  if (!config?.google_site_verification) {
    items.push({
      id: "verify-gsc",
      priority: "critical",
      category: "SEO & Index",
      title: "Gắn mã xác minh Google Search Console ngay tại tab này",
      detail: "Chưa có thẻ google-site-verification trong cấu hình Edge. Dán mã tại mục Cấu hình SEO & API để hệ thống tự bơm vào toàn bộ trang công khai không cần rebuild.",
      actionTab: "seo-api",
      actionLabel: "Mở Cấu hình SEO",
    });
  }

  if (!config?.last_indexnow_ping_at) {
    items.push({
      id: "ping-indexnow",
      priority: "high",
      category: "AI Search & Bing",
      title: "Đẩy Sitemap lên IndexNow để Bing & ChatGPT Search lập chỉ mục tức thì",
      detail: `Hiện có ${seoAudit?.sitemapUrlCount || 0} URL trong sitemap động nhưng chưa ghi nhận lần ping IndexNow nào từ bảng điều trị.`,
      actionTab: "seo-api",
      actionLabel: "Ping IndexNow ngay",
    });
  }

  if (!config?.has_cf_api_token) {
    items.push({
      id: "connect-cf-graphql",
      priority: "high",
      category: "Cloudflare Edge",
      title: "Gắn Cloudflare Zone ID & API Token để xem toàn bộ thông số Edge tại đây",
      detail: "Kéo trực tiếp tổng Requests, Cache Hit %, Băng thông, Threats/WAF bị chặn, lỗi HTTP 4xx/5xx và Quốc gia từ Cloudflare về cùng tab này.",
      actionTab: "seo-api",
      actionLabel: "Gắn Cloudflare API",
    });
  }

  if (!config?.has_gsc_credentials) {
    items.push({
      id: "connect-gsc-api",
      priority: "medium",
      category: "Search Intelligence",
      title: "Kết nối Google Search Console API để xem từ khóa tìm kiếm thật",
      detail: "Dán Service Account JSON (quyền Restricted/Read-only trên GSC) để kéo trực tiếp Clicks, Impressions, CTR và Top từ khóa 28 ngày về cùng tab này.",
      actionTab: "seo-api",
      actionLabel: "Cấu hình GSC API",
    });
  }

  // 2. SEO Content Hygiene
  if ((seoAudit?.missingAltPosts || 0) > 0 || (seoAudit?.shortExcerptPosts || 0) > 0) {
    items.push({
      id: "fix-post-meta",
      priority: "high",
      category: "Nội dung SEO",
      title: `Hoàn thiện mô tả & Alt ảnh cho ${Math.max(seoAudit.missingAltPosts, seoAudit.shortExcerptPosts)} bài Hành trình`,
      detail: `Phát hiện ${seoAudit.missingAltPosts} bài thiếu alt ảnh và ${seoAudit.shortExcerptPosts} bài có mô tả quá ngắn (< 60 ký tự), làm giảm tỷ lệ bấm (CTR) trên Google và thẻ chia sẻ Zalo.`,
      actionTab: "funnel",
      actionLabel: "Xem danh sách",
    });
  }

  // 3. Speed & Core Web Vitals (Field RUM + Lab PSI)
  if ((vitals?.avgLcpMs || 0) > 2500) {
    items.push({
      id: "rum-lcp-slow",
      priority: "critical",
      category: "Tốc độ trang",
      title: `LCP thực tế đang ở ${(vitals.avgLcpMs / 1000).toFixed(2)}s (vượt chuẩn 2.5s của Google)`,
      detail: "Người xem trên điện thoại/4G đang chờ ảnh chính tải chậm. Kiểm tra danh sách trang chậm nhất ở tab Tốc độ & CWV để nén ảnh WebP <= 1280px.",
      actionTab: "speed",
      actionLabel: "Xem trang chậm",
    });
  } else if ((vitals?.avgCls || 0) > 0.1) {
    items.push({
      id: "rum-cls-high",
      priority: "high",
      category: "Tốc độ trang",
      title: `Độ nhảy bố cục CLS = ${vitals.avgCls.toFixed(3)} (cần <= 0.10)`,
      detail: "Kiểm tra ảnh hoặc khung động thiếu thuộc tính width/height cố định khiến trang bị giật khi mở trên Zalo WebView.",
      actionTab: "speed",
      actionLabel: "Kiểm tra CWV",
    });
  } else if (!latestPsi?.mobile) {
    items.push({
      id: "run-first-psi",
      priority: "medium",
      category: "Tốc độ trang",
      title: "Chạy bản quét Google PageSpeed Insights đầu tiên (Mobile)",
      detail: "Lưu mốc điểm Performance / SEO / Accessibility làm chuẩn so sánh trước và sau mỗi lần nâng cấp giao diện.",
      actionTab: "speed",
      actionLabel: "Quét PageSpeed",
    });
  }

  // 4. Event Check-in & Conversion Funnel
  const weakShowup = (funnel?.events || []).find(
    (ev) => ev.registered >= 5 && ev.attended > 0 && ev.showupRate < 55
  );
  if (weakShowup) {
    items.push({
      id: `showup-${weakShowup.id}`,
      priority: "high",
      category: "Phễu Check-in",
      title: `Tỷ lệ có mặt thật của "${weakShowup.title}" đạt ${weakShowup.showupRate}%`,
      detail: `${weakShowup.attended}/${weakShowup.registered} người đăng ký đã check-in. Nên đẩy mạnh nhắc lịch trước 24h trong nhóm Zalo buổi gặp và nhắc ghép xe.`,
      actionTab: "funnel",
      actionLabel: "Xem phễu sự kiện",
    });
  }

  const highViewLowReg = (funnel?.events || []).find(
    (ev) => ev.pageViews >= 30 && ev.conversionRate < 5
  );
  if (highViewLowReg) {
    items.push({
      id: `conv-${highViewLowReg.id}`,
      priority: "high",
      category: "Chuyển đổi Thư mời",
      title: `"${highViewLowReg.title}" có ${highViewLowReg.pageViews} lượt xem nhưng tỷ lệ giữ chỗ mới ${highViewLowReg.conversionRate}%`,
      detail: "Kiểm tra lại 4 điểm trên màn hình đầu thư mời: đi một mình có người đón, chi phí rõ bằng con số, chỉ đường và nút giữ chỗ nhanh.",
      actionTab: "funnel",
      actionLabel: "Phân tích phễu",
    });
  }

  // 5. Dwell Time & Audience Opportunity
  if ((summary?.views || 0) > 0 && (summary?.avgDwellSec || 0) < 20) {
    items.push({
      id: "low-dwell",
      priority: "medium",
      category: "Giữ chân người đọc",
      title: `Thời gian ở lại trung bình đang thấp (${summary.avgDwellSec} giây)`,
      detail: "Khách rời trang nhanh trước khi đọc hết nội dung. Kiểm tra xem nguồn vào từ Zalo/Facebook có dẫn đúng trang thư mời sự kiện đang mở không.",
      actionTab: "audience",
      actionLabel: "Xem chân dung khách",
    });
  } else if ((summary?.zaloSharePct || 0) >= 40) {
    items.push({
      id: "zalo-dominant",
      priority: "opportunity",
      category: "Kênh mũi nhọn",
      title: `${summary.zaloSharePct}% lượt ghé đến từ Zalo — tiếp tục tối ưu luồng Zalo WebView & đẩy thêm Organic Google`,
      detail: "Zalo đang là kênh kéo người mạnh nhất. Song song giữ tốc độ tải nhanh dưới 1.5s trong Zalo, nên viết thêm bài tổng kết thực địa gắn từ khóa Hòa Lạc để mở kênh tìm kiếm tự nhiên.",
      actionTab: "audience",
      actionLabel: "Xem nguồn truy cập",
    });
  }

  if ((summary?.enSharePct || 0) >= 8) {
    items.push({
      id: "en-growth",
      priority: "opportunity",
      category: "Khách quốc tế (/en/)",
      title: `${summary.enSharePct}% lượt xem đang đọc bản tiếng Anh (/en/)`,
      detail: "Đã có lượng người đọc quốc tế rõ rệt — ưu tiên cập nhật song song lịch sự kiện và bài Hành trình bản tiếng Anh đầy đủ.",
      actionTab: "audience",
      actionLabel: "Xem chi tiết quốc gia",
    });
  }

  if (items.length === 0) {
    items.push({
      id: "steady-growth",
      priority: "opportunity",
      category: "Tăng trưởng bền vững",
      title: "Nền tảng SEO & theo dõi đã thông suốt — duy trì nhịp xuất bản bài thực địa",
      detail: "Sau mỗi buổi gặp, xuất bản bài Hành trình kèm ảnh thật, bấm Ping IndexNow 1 chạm và kiểm tra lại tỷ lệ Show-up + thời gian đọc sau 48 giờ.",
      actionTab: "seo-api",
      actionLabel: "Ping IndexNow",
    });
  }

  return items.slice(0, 6);
}
