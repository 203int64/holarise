/**
 * Public Privacy-First Telemetry Collector: POST /api/telemetry
 *
 * Accepts lightweight sendBeacon / fetch JSON payloads from public pages (`assets/js/telemetry.js`).
 * - Tracks pageviews, unique visitors (daily rotating SHA-256 hash, zero raw IP), sessions,
 *   active dwell time, scroll depth, Core Web Vitals (LCP/INP/CLS/TTFB), CTA goals,
 *   Cloudflare Edge Geo/ISP (`request.cf`), device/OS/browser (including Zalo/Messenger WebView),
 *   and logged-in Member status (boolean flag only — never stores PII).
 * - Filters Search/AI bots cleanly into `dim_type='bot'` without polluting human analytics.
 */

import {
  classifySource,
  dailyVisitorHash,
  detectBotName,
  ensureAnalyticsSchema,
  getDateOffsetVnIso,
  getTodayVnIso,
  isTrackablePublicPath,
  loadAnalyticsSeoConfig,
  normalizePath,
  parseAcceptLanguage,
  parseUserAgent,
  recordBotHit,
} from "../_lib/analytics.js";
import { checkRateLimit, getClientIpHash, getSessionMember } from "../_lib/security.js";
import { cleanStr } from "../_lib/validation.js";

const ALLOWED_GOALS = new Set([
  "open_rsvp",
  "submit_rsvp",
  "join_zalo_group",
  "save_calendar",
  "share_page",
  "open_member_pass",
  "lang_switch",
  "outbound_partner",
]);

function clampInt(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function upsertDim(db, date, dimType, dimValue, { isNewUnique = false, dwellMs = 0, viewDelta = 1, nowIso }) {
  const cleanVal = cleanStr(dimValue, 80);
  if (!cleanVal) return;
  const uDelta = isNewUnique ? 1 : 0;
  const dInc = dwellMs > 0 ? 1 : 0;
  await db
    .prepare(
      `INSERT INTO analytics_daily_dims (date, dim_type, dim_value, views, uniques, dwell_ms_sum, dwell_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, dim_type, dim_value)
       DO UPDATE SET
         views = views + excluded.views,
         uniques = uniques + excluded.uniques,
         dwell_ms_sum = dwell_ms_sum + excluded.dwell_ms_sum,
         dwell_count = dwell_count + excluded.dwell_count,
         updated_at = excluded.updated_at`
    )
    .bind(date, dimType, cleanVal, viewDelta, uDelta, dwellMs, dInc, nowIso)
    .run()
    .catch(() => null);
}

async function registerDailyUnique(db, date, visitorHash, scope, nowIso) {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO analytics_daily_visitors (date, visitor_hash, scope, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(date, visitorHash, scope, nowIso)
    .run()
    .catch(() => ({ meta: { changes: 0 } }));
  return Number(res?.meta?.changes || 0) > 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return new Response(null, { status: 204 });
  }

  const ua = request.headers.get("User-Agent") || "";
  const botName = detectBotName(ua);
  if (botName) {
    await recordBotHit(env.DB, botName);
    return new Response(null, { status: 204 });
  }

  // Light abuse protection: max 90 beacons per minute per IP hash
  const ipHash = await getClientIpHash(request).catch(() => "anon");
  const rl = await checkRateLimit(env.DB, `telemetry:${ipHash}`, 90, 60_000).catch(() => ({ allowed: true }));
  if (!rl.allowed) {
    return new Response(null, { status: 204 });
  }

  const cfg = await loadAnalyticsSeoConfig(env.DB, env);
  if (cfg.telemetry_enabled === false) {
    return new Response(null, { status: 204 });
  }

  let body;
  try {
    const text = await request.text();
    if (!text || text.length > 4096) return new Response(null, { status: 204 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }

  const type = cleanStr(body?.type || "pageview", 20).toLowerCase();
  const path = normalizePath(body?.path || "/");
  if (!isTrackablePublicPath(path)) {
    return new Response(null, { status: 204 });
  }

  await ensureAnalyticsSchema(env.DB);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const date = getTodayVnIso(nowMs);
  const visitorHash = await dailyVisitorHash(ipHash, ua, date, env?.SESSION_SECRET || env?.ANALYTICS_SALT || "");
  const visitId = cleanStr(body?.visitId || "", 48).replace(/[^a-zA-Z0-9_-]/g, "") || `v_${crypto.randomUUID().slice(0, 12)}`;
  const sessionId = cleanStr(body?.sessionId || "", 48).replace(/[^a-zA-Z0-9_-]/g, "");

  if (type === "pageview") {
    const { device, os, browser } = parseUserAgent(ua);
    const referrer = cleanStr(body?.referrer || "", 300);
    const utmSource = cleanStr(body?.utmSource || "", 60);
    const utmCampaign = cleanStr(body?.utmCampaign || "", 80);
    const { sourceLabel, referrerHost } = classifySource({ referrer, utmSource, userAgent: ua, browser });

    const cf = request.cf || {};
    const country = cleanStr(cf.country || request.headers.get("CF-IPCountry") || "", 8).toUpperCase() || "VN";
    const city = cleanStr(cf.city || "", 60);
    const region = cleanStr(cf.region || "", 60);
    const asOrg = cleanStr(cf.asOrganization || "", 80);
    const lang = cleanStr(body?.lang || "", 12).toLowerCase() || parseAcceptLanguage(request.headers.get("Accept-Language"));
    const isReturning = body?.returning === true ? 1 : 0;

    const member = await getSessionMember(env.DB, request).catch(() => null);
    const isMember = member ? 1 : 0;
    const visitorType = isMember ? "Thành viên đã đăng nhập" : isReturning ? "Khách quay lại" : "Khách mới";

    const [isSiteUnique, isPathUnique] = await Promise.all([
      registerDailyUnique(env.DB, date, visitorHash, "*", nowIso),
      registerDailyUnique(env.DB, date, visitorHash, `p:${path}`, nowIso),
    ]);

    // Determine if this is the first page of a session or a subsequent navigation (which clears bounce)
    let isNewSession = true;
    let prevEntryPath = "";
    if (sessionId) {
      const prior = await env.DB.prepare(
        `SELECT path, COUNT(*) AS cnt
         FROM analytics_recent_visits
         WHERE session_id = ? AND date = ?
         GROUP BY session_id`
      )
        .bind(sessionId, date)
        .first()
        .catch(() => null);
      if (prior && Number(prior.cnt || 0) > 0) {
        isNewSession = false;
        if (Number(prior.cnt) === 1) {
          prevEntryPath = String(prior.path || "");
        }
      }
    }

    const sessionDelta = isNewSession ? 1 : 0;
    const bounceDelta = isNewSession ? 1 : 0;

    await env.DB.prepare(
      `INSERT INTO analytics_daily_pages (
         date, path, views, uniques, sessions, bounces, member_views, updated_at
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(date, path) DO UPDATE SET
         views = views + 1,
         uniques = uniques + excluded.uniques,
         sessions = sessions + excluded.sessions,
         bounces = bounces + excluded.bounces,
         member_views = member_views + excluded.member_views,
         updated_at = excluded.updated_at`
    )
      .bind(date, path, isPathUnique ? 1 : 0, sessionDelta, bounceDelta, isMember, nowIso)
      .run();

    // Second page in the same session clears the initial bounce on the landing page
    if (prevEntryPath) {
      await env.DB.prepare(
        `UPDATE analytics_daily_pages
         SET bounces = MAX(0, bounces - 1), updated_at = ?
         WHERE date = ? AND path = ?`
      )
        .bind(nowIso, date, prevEntryPath)
        .run()
        .catch(() => null);
    }

    // Store sanitized visit in rolling live feed
    await env.DB.prepare(
      `INSERT OR REPLACE INTO analytics_recent_visits (
         id, visited_at, date, visitor_hash, session_id, path, referrer_host, source_label,
         utm_source, utm_campaign, country, city, region, as_org, device, browser, os, lang,
         is_member, is_returning, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        visitId,
        nowIso,
        date,
        visitorHash,
        sessionId,
        path,
        referrerHost,
        sourceLabel,
        utmSource,
        utmCampaign,
        country,
        city,
        region,
        asOrg,
        device,
        browser,
        os,
        lang,
        isMember,
        isReturning,
        nowIso
      )
      .run()
      .catch(() => null);

    // Update dimension rollups in parallel
    await Promise.all([
      upsertDim(env.DB, date, "source", sourceLabel, { isNewUnique: isSiteUnique, nowIso }),
      upsertDim(env.DB, date, "country", country, { isNewUnique: isSiteUnique, nowIso }),
      city ? upsertDim(env.DB, date, "city", city, { isNewUnique: isSiteUnique, nowIso }) : Promise.resolve(),
      asOrg ? upsertDim(env.DB, date, "isp", asOrg, { isNewUnique: isSiteUnique, nowIso }) : Promise.resolve(),
      upsertDim(env.DB, date, "device", device, { isNewUnique: isSiteUnique, nowIso }),
      upsertDim(env.DB, date, "browser", browser, { isNewUnique: isSiteUnique, nowIso }),
      upsertDim(env.DB, date, "os", os, { isNewUnique: isSiteUnique, nowIso }),
      upsertDim(env.DB, date, "lang", lang, { isNewUnique: isSiteUnique, nowIso }),
      upsertDim(env.DB, date, "visitor_type", visitorType, { isNewUnique: isSiteUnique, nowIso }),
      utmSource ? upsertDim(env.DB, date, "utm_source", utmSource, { isNewUnique: isSiteUnique, nowIso }) : Promise.resolve(),
      utmCampaign ? upsertDim(env.DB, date, "utm_campaign", utmCampaign, { isNewUnique: isSiteUnique, nowIso }) : Promise.resolve(),
    ]);

    // Periodic lightweight pruning to keep D1 compact forever
    if (nowMs % 7 === 0) {
      const keepVisitorsAfter = getDateOffsetVnIso(14, nowMs);
      const keepDailyAfter = getDateOffsetVnIso(95, nowMs);
      await Promise.all([
        env.DB.prepare(
          `DELETE FROM analytics_recent_visits
           WHERE id NOT IN (SELECT id FROM analytics_recent_visits ORDER BY visited_at DESC LIMIT 200)`
        ).run().catch(() => null),
        env.DB.prepare("DELETE FROM analytics_daily_visitors WHERE date < ?").bind(keepVisitorsAfter).run().catch(() => null),
        env.DB.prepare("DELETE FROM analytics_daily_pages WHERE date < ?").bind(keepDailyAfter).run().catch(() => null),
        env.DB.prepare("DELETE FROM analytics_daily_dims WHERE date < ?").bind(keepDailyAfter).run().catch(() => null),
      ]);
    }

    return new Response(null, { status: 204 });
  }

  if (type === "engage") {
    const dwellMs = clampInt(body?.dwellMs, 0, 30 * 60 * 1000); // cap 30 min
    const scrollPct = clampInt(body?.scrollPct, 0, 100);
    const lcpMs = clampInt(body?.lcpMs, 0, 60_000);
    const inpMs = clampInt(body?.inpMs, 0, 10_000);
    const clsX1000 = clampInt(body?.clsX1000, 0, 5000);
    const ttfbMs = clampInt(body?.ttfbMs, 0, 30_000);
    const rawGoals = Array.isArray(body?.goals) ? body.goals : [];
    const goals = [...new Set(rawGoals.map((g) => cleanStr(g, 40)).filter((g) => ALLOWED_GOALS.has(g)))].slice(0, 10);

    // Fetch existing visit row to compute non-duplicated deltas safely if beacon fires more than once
    const existing = await env.DB.prepare(
      `SELECT id, dwell_ms, scroll_pct, lcp_ms, inp_ms, cls_x1000, ttfb_ms, goals_json, source_label
       FROM analytics_recent_visits WHERE id = ? LIMIT 1`
    )
      .bind(visitId)
      .first()
      .catch(() => null);

    const prevDwell = Number(existing?.dwell_ms || 0);
    const prevScroll = Number(existing?.scroll_pct || 0);
    const prevLcp = Number(existing?.lcp_ms || 0);
    const prevInp = Number(existing?.inp_ms || 0);
    const prevCls = Number(existing?.cls_x1000 || 0);
    const prevTtfb = Number(existing?.ttfb_ms || 0);
    let prevGoals = [];
    try {
      prevGoals = JSON.parse(existing?.goals_json || "[]");
    } catch {
      prevGoals = [];
    }

    const nextDwell = Math.max(prevDwell, dwellMs);
    const nextScroll = Math.max(prevScroll, scrollPct);
    const nextLcp = prevLcp > 0 ? prevLcp : lcpMs;
    const nextInp = Math.max(prevInp, inpMs);
    const nextCls = Math.max(prevCls, clsX1000);
    const nextTtfb = prevTtfb > 0 ? prevTtfb : ttfbMs;
    const mergedGoals = [...new Set([...prevGoals, ...goals])];
    const newGoals = goals.filter((g) => !prevGoals.includes(g));

    const dwellDelta = Math.max(0, nextDwell - prevDwell);
    const dwellCountDelta = prevDwell === 0 && nextDwell >= 1000 ? 1 : 0;
    const scrollDelta = Math.max(0, nextScroll - prevScroll);
    const scrollCountDelta = prevScroll === 0 && nextScroll > 0 ? 1 : 0;
    const lcpDelta = prevLcp === 0 && nextLcp > 0 ? nextLcp : 0;
    const lcpCountDelta = lcpDelta > 0 ? 1 : 0;
    const inpDelta = prevInp === 0 && nextInp > 0 ? nextInp : 0;
    const inpCountDelta = inpDelta > 0 ? 1 : 0;
    const clsDelta = prevCls === 0 && nextCls > 0 ? nextCls : 0;
    const clsCountDelta = clsDelta > 0 ? 1 : 0;
    const ttfbDelta = prevTtfb === 0 && nextTtfb > 0 ? nextTtfb : 0;
    const ttfbCountDelta = ttfbDelta > 0 ? 1 : 0;

    await env.DB.prepare(
      `INSERT INTO analytics_daily_pages (
         date, path, dwell_ms_sum, dwell_count, scroll_sum, scroll_count,
         lcp_sum, lcp_count, inp_sum, inp_count, cls_x1000_sum, cls_count,
         ttfb_sum, ttfb_count, cta_clicks, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, path) DO UPDATE SET
         dwell_ms_sum = dwell_ms_sum + excluded.dwell_ms_sum,
         dwell_count = dwell_count + excluded.dwell_count,
         scroll_sum = scroll_sum + excluded.scroll_sum,
         scroll_count = scroll_count + excluded.scroll_count,
         lcp_sum = lcp_sum + excluded.lcp_sum,
         lcp_count = lcp_count + excluded.lcp_count,
         inp_sum = inp_sum + excluded.inp_sum,
         inp_count = inp_count + excluded.inp_count,
         cls_x1000_sum = cls_x1000_sum + excluded.cls_x1000_sum,
         cls_count = cls_count + excluded.cls_count,
         ttfb_sum = ttfb_sum + excluded.ttfb_sum,
         ttfb_count = ttfb_count + excluded.ttfb_count,
         cta_clicks = cta_clicks + excluded.cta_clicks,
         updated_at = excluded.updated_at`
    )
      .bind(
        date,
        path,
        dwellDelta,
        dwellCountDelta,
        scrollDelta,
        scrollCountDelta,
        lcpDelta,
        lcpCountDelta,
        inpDelta,
        inpCountDelta,
        clsDelta,
        clsCountDelta,
        ttfbDelta,
        ttfbCountDelta,
        newGoals.length,
        nowIso
      )
      .run()
      .catch(() => null);

    if (existing) {
      await env.DB.prepare(
        `UPDATE analytics_recent_visits
         SET dwell_ms = ?, scroll_pct = ?, lcp_ms = ?, inp_ms = ?, cls_x1000 = ?, ttfb_ms = ?, goals_json = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(nextDwell, nextScroll, nextLcp, nextInp, nextCls, nextTtfb, JSON.stringify(mergedGoals), nowIso, visitId)
        .run()
        .catch(() => null);

      if (dwellDelta > 0 && existing.source_label) {
        await upsertDim(env.DB, date, "source", existing.source_label, {
          viewDelta: 0,
          dwellMs: dwellDelta,
          nowIso,
        });
      }
    }

    for (const g of newGoals) {
      await upsertDim(env.DB, date, "goal", g, { viewDelta: 1, nowIso });
    }

    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}
