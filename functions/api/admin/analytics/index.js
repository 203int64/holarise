/**
 * GET /api/admin/analytics?days=7|30|90
 * Sole Super-Admin (203int64) Unified Analytics, Audience Intelligence,
 * Event Check-in Funnel, Core Web Vitals RUM, SEO Health Audit & Growth Recommendations API.
 */

import {
  buildGrowthRecommendations,
  ensureAnalyticsSchema,
  getDateOffsetVnIso,
  getTodayVnIso,
  loadAnalyticsSeoConfig,
  toPublicAnalyticsConfig,
} from "../../../_lib/analytics.js";
import { resolveEventHref, resolveEventHrefEn, resolveEventSlug, serializeEventRow, splitEventsByDate } from "../../../_lib/render.js";
import { jsonResponse, requireAdmin } from "../../../_lib/security.js";

function inferPillar(typeStr = "", titleStr = "") {
  const s = `${typeStr} ${titleStr}`.toLowerCase();
  if (s.includes("holagreen") || s.includes("xanh") || s.includes("rác") || s.includes("cây")) return "HolaGreen";
  if (s.includes("holaconnect") || s.includes("sách") || s.includes("tri thức") || s.includes("kết nối")) return "HolaConnect";
  return "HolaHeart";
}

function pct(num, den) {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureAnalyticsSchema(db);

  const url = new URL(context.request.url);
  const rawDays = Number(url.searchParams.get("days") || 30);
  const rangeDays = rawDays === 7 ? 7 : rawDays === 90 ? 90 : 30;
  const nowMs = Date.now();
  const toDate = getTodayVnIso(nowMs);
  const fromDate = getDateOffsetVnIso(rangeDays - 1, nowMs);
  const fiveMinAgoIso = new Date(nowMs - 5 * 60 * 1000).toISOString();

  const [
    dailySeriesRes,
    pagesRes,
    dimsRes,
    onlineRes,
    todayRes,
    recentVisitsRes,
    psiRes,
    eventsRes,
    regsByEventRes,
    regTotalsRes,
    membersRes,
    postsRes,
    seoCfg,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT date,
                SUM(views) AS views,
                SUM(uniques) AS path_uniques,
                SUM(sessions) AS sessions,
                SUM(bounces) AS bounces,
                SUM(dwell_ms_sum) AS dwell_ms_sum,
                SUM(dwell_count) AS dwell_count,
                SUM(scroll_sum) AS scroll_sum,
                SUM(scroll_count) AS scroll_count,
                SUM(cta_clicks) AS cta_clicks,
                SUM(member_views) AS member_views,
                SUM(lcp_sum) AS lcp_sum,
                SUM(lcp_count) AS lcp_count,
                SUM(inp_sum) AS inp_sum,
                SUM(inp_count) AS inp_count,
                SUM(cls_x1000_sum) AS cls_x1000_sum,
                SUM(cls_count) AS cls_count,
                SUM(ttfb_sum) AS ttfb_sum,
                SUM(ttfb_count) AS ttfb_count
         FROM analytics_daily_pages
         WHERE date >= ? AND date <= ?
         GROUP BY date
         ORDER BY date ASC`
      )
      .bind(fromDate, toDate)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT path,
                SUM(views) AS views,
                SUM(uniques) AS uniques,
                SUM(sessions) AS sessions,
                SUM(bounces) AS bounces,
                SUM(dwell_ms_sum) AS dwell_ms_sum,
                SUM(dwell_count) AS dwell_count,
                SUM(scroll_sum) AS scroll_sum,
                SUM(scroll_count) AS scroll_count,
                SUM(lcp_sum) AS lcp_sum,
                SUM(lcp_count) AS lcp_count,
                SUM(inp_sum) AS inp_sum,
                SUM(inp_count) AS inp_count,
                SUM(cls_x1000_sum) AS cls_x1000_sum,
                SUM(cls_count) AS cls_count,
                SUM(ttfb_sum) AS ttfb_sum,
                SUM(ttfb_count) AS ttfb_count,
                SUM(cta_clicks) AS cta_clicks,
                SUM(member_views) AS member_views
         FROM analytics_daily_pages
         WHERE date >= ? AND date <= ?
         GROUP BY path
         ORDER BY views DESC
         LIMIT 60`
      )
      .bind(fromDate, toDate)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT dim_type, dim_value,
                SUM(views) AS views,
                SUM(uniques) AS uniques,
                SUM(dwell_ms_sum) AS dwell_ms_sum,
                SUM(dwell_count) AS dwell_count
         FROM analytics_daily_dims
         WHERE date >= ? AND date <= ?
         GROUP BY dim_type, dim_value
         ORDER BY views DESC`
      )
      .bind(fromDate, toDate)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_hash) AS cnt
         FROM analytics_recent_visits
         WHERE updated_at >= ? OR visited_at >= ?`
      )
      .bind(fiveMinAgoIso, fiveMinAgoIso)
      .first()
      .catch(() => ({ cnt: 0 })),
    db
      .prepare(
        `SELECT SUM(views) AS views, SUM(sessions) AS sessions
         FROM analytics_daily_pages WHERE date = ?`
      )
      .bind(toDate)
      .first()
      .catch(() => ({ views: 0, sessions: 0 })),
    db
      .prepare(
        `SELECT id, visited_at, path, referrer_host, source_label, utm_source, utm_campaign,
                country, city, region, as_org, device, browser, os, lang,
                is_member, is_returning, dwell_ms, scroll_pct, lcp_ms, inp_ms, cls_x1000, ttfb_ms, goals_json
         FROM analytics_recent_visits
         ORDER BY visited_at DESC
         LIMIT 35`
      )
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT id, url, strategy, perf_score, seo_score, a11y_score, bp_score,
                fcp_ms, lcp_ms, tbt_ms, cls_x1000, ttfb_ms, source, created_at
         FROM analytics_psi_snapshots
         ORDER BY created_at DESC
         LIMIT 16`
      )
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT * FROM events ORDER BY sort_order ASC, date DESC LIMIT 100")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT event_id, activity_title, status, COUNT(*) AS cnt
         FROM registrations
         GROUP BY event_id, activity_title, status`
      )
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT status, COUNT(*) AS cnt FROM registrations GROUP BY status")
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_cnt FROM members")
      .first()
      .catch(() => ({ total: 0, active_cnt: 0 })),
    db
      .prepare("SELECT id, slug, title, excerpt, image, image_alt, status, date, updated_at FROM posts ORDER BY date DESC LIMIT 200")
      .all()
      .catch(() => ({ results: [] })),
    loadAnalyticsSeoConfig(db, context.env),
  ]);

  // 1. Totals & Daily Series
  const dailyRows = dailySeriesRes.results || [];
  let totalViews = 0;
  let totalSessions = 0;
  let totalBounces = 0;
  let dwellSum = 0;
  let dwellCount = 0;
  let scrollSum = 0;
  let scrollCount = 0;
  let ctaClicks = 0;
  let memberViews = 0;
  let lcpSum = 0;
  let lcpCount = 0;
  let inpSum = 0;
  let inpCount = 0;
  let clsSum = 0;
  let clsCount = 0;
  let ttfbSum = 0;
  let ttfbCount = 0;

  const dailyByDate = new Map();
  for (const r of dailyRows) {
    const views = Number(r.views || 0);
    const sessions = Number(r.sessions || 0);
    const bounces = Number(r.bounces || 0);
    const dSum = Number(r.dwell_ms_sum || 0);
    const dCnt = Number(r.dwell_count || 0);
    totalViews += views;
    totalSessions += sessions;
    totalBounces += bounces;
    dwellSum += dSum;
    dwellCount += dCnt;
    scrollSum += Number(r.scroll_sum || 0);
    scrollCount += Number(r.scroll_count || 0);
    ctaClicks += Number(r.cta_clicks || 0);
    memberViews += Number(r.member_views || 0);
    lcpSum += Number(r.lcp_sum || 0);
    lcpCount += Number(r.lcp_count || 0);
    inpSum += Number(r.inp_sum || 0);
    inpCount += Number(r.inp_count || 0);
    clsSum += Number(r.cls_x1000_sum || 0);
    clsCount += Number(r.cls_count || 0);
    ttfbSum += Number(r.ttfb_sum || 0);
    ttfbCount += Number(r.ttfb_count || 0);

    dailyByDate.set(r.date, {
      date: r.date,
      views,
      sessions,
      avgDwellSec: dCnt > 0 ? Math.round(dSum / dCnt / 1000) : 0,
    });
  }

  // Fill calendar gaps so sparkline has continuous days
  const dailySeries = [];
  for (let i = rangeDays - 1; i >= 0; i -= 1) {
    const d = getDateOffsetVnIso(i, nowMs);
    dailySeries.push(dailyByDate.get(d) || { date: d, views: 0, sessions: 0, avgDwellSec: 0 });
  }

  // Unique visitors from visitor_type dimension (tracks site-wide daily uniques cleanly)
  const dimsByType = {};
  for (const row of dimsRes.results || []) {
    const t = row.dim_type;
    if (!dimsByType[t]) dimsByType[t] = [];
    dimsByType[t].push({
      label: row.dim_value,
      views: Number(row.views || 0),
      uniques: Number(row.uniques || 0),
      avgDwellSec: Number(row.dwell_count || 0) > 0 ? Math.round(Number(row.dwell_ms_sum || 0) / Number(row.dwell_count) / 1000) : 0,
    });
  }
  const getDim = (t, limit = 10) => (dimsByType[t] || []).slice(0, limit);

  const siteUniques = (dimsByType.visitor_type || []).reduce((acc, item) => acc + item.uniques, 0) || totalSessions;
  const zaloViews = (dimsByType.source || [])
    .filter((s) => s.label.toLowerCase().includes("zalo"))
    .reduce((acc, s) => acc + s.views, 0);

  // Pages & EN share
  const pageViewsMap = new Map();
  let enViews = 0;
  const topPages = (pagesRes.results || []).map((r) => {
    const v = Number(r.views || 0);
    const s = Number(r.sessions || 0);
    const b = Number(r.bounces || 0);
    pageViewsMap.set(r.path, v);
    if (String(r.path || "").startsWith("/en/")) enViews += v;
    return {
      path: r.path,
      views: v,
      uniques: Number(r.uniques || 0),
      sessions: s,
      bounceRate: pct(b, s),
      avgDwellSec: Number(r.dwell_count || 0) > 0 ? Math.round(Number(r.dwell_ms_sum || 0) / Number(r.dwell_count) / 1000) : 0,
      avgScrollPct: Number(r.scroll_count || 0) > 0 ? Math.round(Number(r.scroll_sum || 0) / Number(r.scroll_count)) : 0,
      ctaClicks: Number(r.cta_clicks || 0),
      memberViews: Number(r.member_views || 0),
      avgLcpMs: Number(r.lcp_count || 0) > 0 ? Math.round(Number(r.lcp_sum || 0) / Number(r.lcp_count)) : 0,
      avgInpMs: Number(r.inp_count || 0) > 0 ? Math.round(Number(r.inp_sum || 0) / Number(r.inp_count)) : 0,
      avgCls: Number(r.cls_count || 0) > 0 ? Math.round((Number(r.cls_x1000_sum || 0) / Number(r.cls_count)) * 10) / 10000 : 0,
      avgTtfbMs: Number(r.ttfb_count || 0) > 0 ? Math.round(Number(r.ttfb_sum || 0) / Number(r.ttfb_count)) : 0,
    };
  });

  const summary = {
    views: totalViews,
    uniques: siteUniques,
    sessions: totalSessions,
    viewsPerVisit: totalSessions > 0 ? Math.round((totalViews / totalSessions) * 10) / 10 : 0,
    bounceRate: pct(totalBounces, totalSessions),
    avgDwellSec: dwellCount > 0 ? Math.round(dwellSum / dwellCount / 1000) : 0,
    avgScrollPct: scrollCount > 0 ? Math.round(scrollSum / scrollCount) : 0,
    ctaClicks,
    memberViews,
    memberSharePct: pct(memberViews, totalViews),
    zaloSharePct: pct(zaloViews, totalViews),
    enSharePct: pct(enViews, totalViews),
    onlineNow: Number(onlineRes?.cnt || 0),
    todayViews: Number(todayRes?.views || 0),
    todaySessions: Number(todayRes?.sessions || 0),
  };

  // 2. Live Visits feed (sanitized)
  const liveVisits = (recentVisitsRes.results || []).map((v) => {
    let goals = [];
    try {
      goals = JSON.parse(v.goals_json || "[]");
    } catch {
      goals = [];
    }
    return {
      id: v.id,
      visitedAt: v.visited_at,
      path: v.path,
      sourceLabel: v.source_label || "Direct",
      referrerHost: v.referrer_host || "",
      utmSource: v.utm_source || "",
      utmCampaign: v.utm_campaign || "",
      country: v.country || "VN",
      city: v.city || "",
      region: v.region || "",
      asOrg: v.as_org || "",
      device: v.device || "desktop",
      browser: v.browser || "Other",
      os: v.os || "Other",
      lang: v.lang || "vi",
      isMember: Number(v.is_member || 0) === 1,
      isReturning: Number(v.is_returning || 0) === 1,
      dwellSec: Math.round(Number(v.dwell_ms || 0) / 1000),
      scrollPct: Number(v.scroll_pct || 0),
      lcpMs: Number(v.lcp_ms || 0),
      ttfbMs: Number(v.ttfb_ms || 0),
      goals,
    };
  });

  // 3. Event Check-in & Conversion Funnel (D1 registrations + events + pageviews)
  const regTotals = { all: 0, new: 0, contacted: 0, attended: 0, cancelled: 0 };
  for (const r of regTotalsRes.results || []) {
    const c = Number(r.cnt || 0);
    regTotals.all += c;
    if (r.status in regTotals) regTotals[r.status] = c;
  }
  const activeRegTotal = Math.max(0, regTotals.all - regTotals.cancelled);

  const eventRegIndex = new Map();
  for (const r of regsByEventRes.results || []) {
    const key = r.event_id || r.activity_title || "";
    if (!key) continue;
    if (!eventRegIndex.has(key)) {
      eventRegIndex.set(key, { new: 0, contacted: 0, attended: 0, cancelled: 0, total: 0 });
    }
    const bucket = eventRegIndex.get(key);
    const c = Number(r.cnt || 0);
    bucket.total += c;
    if (r.status in bucket) bucket[r.status] += c;
  }

  const serializedEvents = (eventsRes.results || []).map((row) => serializeEventRow(row));
  const publishedEvents = serializedEvents.filter((e) => e.status === "published");
  const { upcoming, past } = splitEventsByDate(publishedEvents);

  const pillarStats = {
    HolaHeart: { pillar: "HolaHeart", events: 0, pageViews: 0, registered: 0, attended: 0 },
    HolaGreen: { pillar: "HolaGreen", events: 0, pageViews: 0, registered: 0, attended: 0 },
    HolaConnect: { pillar: "HolaConnect", events: 0, pageViews: 0, registered: 0, attended: 0 },
  };

  const eventFunnel = serializedEvents.slice(0, 25).map((ev) => {
    const viHref = resolveEventHref(ev);
    const enHref = resolveEventHrefEn(ev);
    const pv = (pageViewsMap.get(viHref) || 0) + (pageViewsMap.get(enHref) || 0);
    const regById = eventRegIndex.get(ev.id) || { new: 0, contacted: 0, attended: 0, cancelled: 0, total: 0 };
    const regByTitle = eventRegIndex.get(ev.title) || { new: 0, contacted: 0, attended: 0, cancelled: 0, total: 0 };
    // Avoid double counting if matched by id
    const stats = regById.total > 0 ? regById : regByTitle;
    const registered = Math.max(0, stats.total - stats.cancelled);
    const attended = stats.attended;
    const pillar = inferPillar(ev.type, ev.title);

    if (pillarStats[pillar]) {
      pillarStats[pillar].events += 1;
      pillarStats[pillar].pageViews += pv;
      pillarStats[pillar].registered += registered;
      pillarStats[pillar].attended += attended;
    }

    return {
      id: ev.id,
      slug: resolveEventSlug(ev),
      href: viHref,
      title: ev.title,
      date: ev.date || "",
      dateDisplay: ev.dateDisplay || "",
      kind: ev.kind || "upcoming",
      status: ev.status || "published",
      pillar,
      pageViews: pv,
      registered,
      attended,
      cancelled: stats.cancelled,
      conversionRate: pv > 0 ? pct(registered, pv) : 0,
      showupRate: registered > 0 ? pct(attended, registered) : 0,
    };
  });

  const funnel = {
    totals: {
      totalRegistrations: activeRegTotal,
      allIncludingCancelled: regTotals.all,
      newCount: regTotals.new,
      contacted: regTotals.contacted,
      attended: regTotals.attended,
      cancelled: regTotals.cancelled,
      overallShowupRate: pct(regTotals.attended, activeRegTotal),
      totalMembers: Number(membersRes?.total || 0),
      activeMembers: Number(membersRes?.active_cnt || 0),
    },
    events: eventFunnel,
    pillars: Object.values(pillarStats).map((p) => ({
      ...p,
      showupRate: pct(p.attended, p.registered),
    })),
  };

  // 4. Vitals & Speed
  const psiHistory = (psiRes.results || []).map((row) => ({
    id: row.id,
    url: row.url,
    strategy: row.strategy,
    perfScore: Number(row.perf_score || 0),
    seoScore: Number(row.seo_score || 0),
    a11yScore: Number(row.a11y_score || 0),
    bpScore: Number(row.bp_score || 0),
    fcpMs: Number(row.fcp_ms || 0),
    lcpMs: Number(row.lcp_ms || 0),
    tbtMs: Number(row.tbt_ms || 0),
    cls: Math.round(Number(row.cls_x1000 || 0)) / 1000,
    ttfbMs: Number(row.ttfb_ms || 0),
    createdAt: row.created_at,
  }));

  const latestPsi = {
    mobile: psiHistory.find((p) => p.strategy === "mobile") || null,
    desktop: psiHistory.find((p) => p.strategy === "desktop") || null,
  };

  const zaloSamples = liveVisits.filter((v) => v.browser === "Zalo In-App" && v.lcpMs > 0);
  const vitals = {
    avgLcpMs: lcpCount > 0 ? Math.round(lcpSum / lcpCount) : 0,
    avgInpMs: inpCount > 0 ? Math.round(inpSum / inpCount) : 0,
    avgCls: clsCount > 0 ? Math.round((clsSum / clsCount) * 10) / 10000 : 0,
    avgTtfbMs: ttfbCount > 0 ? Math.round(ttfbSum / ttfbCount) : 0,
    sampleCount: Math.max(lcpCount, ttfbCount),
    zaloAvgLcpMs:
      zaloSamples.length > 0
        ? Math.round(zaloSamples.reduce((a, b) => a + b.lcpMs, 0) / zaloSamples.length)
        : 0,
    zaloSampleCount: zaloSamples.length,
    slowestPages: topPages
      .filter((p) => p.avgLcpMs > 0 || p.avgTtfbMs > 0)
      .sort((a, b) => b.avgLcpMs - a.avgLcpMs)
      .slice(0, 10),
    psiHistory,
    latestPsi,
  };

  // 5. Live SEO Audit directly from D1
  const allPosts = postsRes.results || [];
  const publishedPosts = allPosts.filter((p) => p.status === "published");
  const issues = [];
  let missingAltPosts = 0;
  let shortExcerptPosts = 0;
  let missingImageEvents = 0;

  for (const p of publishedPosts) {
    if (!String(p.image_alt || "").trim()) {
      missingAltPosts += 1;
      if (issues.length < 12) {
        issues.push({ kind: "post", title: p.title, path: `/hanh-trinh/${p.slug}/`, issue: "Thiếu mô tả ảnh (alt text)" });
      }
    }
    if (String(p.excerpt || "").trim().length < 60) {
      shortExcerptPosts += 1;
      if (issues.length < 12) {
        issues.push({ kind: "post", title: p.title, path: `/hanh-trinh/${p.slug}/`, issue: "Đoạn tóm tắt quá ngắn (< 60 ký tự)" });
      }
    }
  }

  for (const ev of publishedEvents) {
    if (!String(ev.imageAlt || "").trim()) {
      missingImageEvents += 1;
      if (issues.length < 12) {
        issues.push({ kind: "event", title: ev.title, path: resolveEventHref(ev), issue: "Sự kiện thiếu alt ảnh bìa" });
      }
    }
  }

  // Static pairs (12) + published events VI/EN + published posts VI/EN
  const sitemapUrlCount = 12 + publishedEvents.length * 2 + publishedPosts.length * 2;
  const seoAudit = {
    sitemapUrlCount,
    publishedPosts: publishedPosts.length,
    publishedEvents: publishedEvents.length,
    upcomingEvents: upcoming.length,
    pastEvents: past.length,
    missingAltPosts,
    shortExcerptPosts,
    missingImageEvents,
    issues,
    endpoints: [
      { label: "Sitemap XML động (VI + EN hreflang)", url: "/sitemap.xml" },
      { label: "Robots.txt", url: "/robots.txt" },
      { label: "AI Search Context (llms.txt)", url: "/llms.txt" },
      { label: "IndexNow Key Verification", url: `/${seoCfg.indexnow_key}.txt` },
    ],
  };

  const publicCfg = toPublicAnalyticsConfig(seoCfg);
  const recommendations = buildGrowthRecommendations({
    summary,
    funnel,
    vitals,
    seoAudit,
    config: publicCfg,
    latestPsi,
  });

  return jsonResponse({
    ok: true,
    rangeDays,
    fromDate,
    toDate,
    summary,
    dailySeries,
    audience: {
      visitorTypes: getDim("visitor_type", 6),
      sources: getDim("source", 12),
      countries: getDim("country", 12),
      cities: getDim("city", 12),
      isps: getDim("isp", 10),
      devices: getDim("device", 5),
      browsers: getDim("browser", 10),
      os: getDim("os", 8),
      langs: getDim("lang", 8),
      utmSources: getDim("utm_source", 10),
      utmCampaigns: getDim("utm_campaign", 10),
      goals: getDim("goal", 12),
      bots: getDim("bot", 12),
    },
    liveVisits,
    topPages: topPages.slice(0, 25),
    funnel,
    vitals,
    seoAudit,
    config: publicCfg,
    recommendations,
  });
}
