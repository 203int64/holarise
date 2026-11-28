/**
 * GET / POST /api/admin/analytics/pagespeed
 * Sole Super-Admin (203int64) on-demand Google PageSpeed Insights v5 audit + D1 history.
 *
 * Security: Strictly restricts target URLs to `https://holarise.org/*` to prevent SSRF.
 */

import { ensureAnalyticsSchema, loadAnalyticsSeoConfig, SITE_ORIGIN } from "../../../_lib/analytics.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";

function normalizeAuditUrl(raw) {
  const input = cleanStr(raw || "/", 240);
  if (!input || input === "/") return `${SITE_ORIGIN}/`;
  if (input.startsWith("/")) return `${SITE_ORIGIN}${input}`;
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "holarise.org") {
      return null;
    }
    return `${SITE_ORIGIN}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  await ensureAnalyticsSchema(context.env.DB);
  const res = await context.env.DB.prepare(
    `SELECT id, url, strategy, perf_score, seo_score, a11y_score, bp_score,
            fcp_ms, lcp_ms, tbt_ms, cls_x1000, ttfb_ms, source, created_at
     FROM analytics_psi_snapshots
     ORDER BY created_at DESC
     LIMIT 20`
  )
    .all()
    .catch(() => ({ results: [] }));

  return jsonResponse({
    ok: true,
    snapshots: (res.results || []).map((r) => ({
      id: r.id,
      url: r.url,
      strategy: r.strategy,
      perfScore: Number(r.perf_score || 0),
      seoScore: Number(r.seo_score || 0),
      a11yScore: Number(r.a11y_score || 0),
      bpScore: Number(r.bp_score || 0),
      fcpMs: Number(r.fcp_ms || 0),
      lcpMs: Number(r.lcp_ms || 0),
      tbtMs: Number(r.tbt_ms || 0),
      cls: Math.round(Number(r.cls_x1000 || 0)) / 1000,
      ttfbMs: Number(r.ttfb_ms || 0),
      createdAt: r.created_at,
    })),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;

  const targetUrl = normalizeAuditUrl(parsed.data?.url || "/");
  if (!targetUrl) {
    return errorResponse(400, "INVALID_URL", "Chỉ cho phép quét tốc độ các đường dẫn thuộc https://holarise.org.");
  }
  const strategy = parsed.data?.strategy === "desktop" ? "desktop" : "mobile";

  await ensureAnalyticsSchema(context.env.DB);
  const cfg = await loadAnalyticsSeoConfig(context.env.DB, context.env);

  const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  apiUrl.searchParams.set("url", targetUrl);
  apiUrl.searchParams.set("strategy", strategy);
  apiUrl.searchParams.append("category", "PERFORMANCE");
  apiUrl.searchParams.append("category", "SEO");
  apiUrl.searchParams.append("category", "ACCESSIBILITY");
  apiUrl.searchParams.append("category", "BEST_PRACTICES");
  if (cfg.pagespeed_api_key) {
    apiUrl.searchParams.set("key", cfg.pagespeed_api_key);
  }

  let data;
  try {
    const resp = await fetch(apiUrl.toString(), { headers: { Accept: "application/json" } });
    data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || `PageSpeed API HTTP ${resp.status}`;
      return errorResponse(502, "PSI_UPSTREAM_ERROR", msg);
    }
  } catch (err) {
    return errorResponse(502, "PSI_NETWORK_ERROR", err?.message || "Không gọi được Google PageSpeed Insights.");
  }

  const lhr = data?.lighthouseResult || {};
  const cats = lhr.categories || {};
  const audits = lhr.audits || {};
  const scorePct = (cat) => Math.round(Number(cat?.score || 0) * 100);

  const snapshot = {
    id: `psi_${crypto.randomUUID().slice(0, 10)}`,
    url: targetUrl,
    strategy,
    perfScore: scorePct(cats.performance),
    seoScore: scorePct(cats.seo),
    a11yScore: scorePct(cats.accessibility),
    bpScore: scorePct(cats["best-practices"]),
    fcpMs: Math.round(Number(audits["first-contentful-paint"]?.numericValue || 0)),
    lcpMs: Math.round(Number(audits["largest-contentful-paint"]?.numericValue || 0)),
    tbtMs: Math.round(Number(audits["total-blocking-time"]?.numericValue || 0)),
    clsX1000: Math.round(Number(audits["cumulative-layout-shift"]?.numericValue || 0) * 1000),
    ttfbMs: Math.round(Number(audits["server-response-time"]?.numericValue || 0)),
    createdAt: new Date().toISOString(),
  };

  await context.env.DB.prepare(
    `INSERT INTO analytics_psi_snapshots (
       id, url, strategy, perf_score, seo_score, a11y_score, bp_score,
       fcp_ms, lcp_ms, tbt_ms, cls_x1000, ttfb_ms, source, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pagespeed', ?)`
  )
    .bind(
      snapshot.id,
      snapshot.url,
      snapshot.strategy,
      snapshot.perfScore,
      snapshot.seoScore,
      snapshot.a11yScore,
      snapshot.bpScore,
      snapshot.fcpMs,
      snapshot.lcpMs,
      snapshot.tbtMs,
      snapshot.clsX1000,
      snapshot.ttfbMs,
      snapshot.createdAt
    )
    .run();

  // Keep latest 50 snapshots
  await context.env.DB.prepare(
    `DELETE FROM analytics_psi_snapshots
     WHERE id NOT IN (SELECT id FROM analytics_psi_snapshots ORDER BY created_at DESC LIMIT 50)`
  )
    .run()
    .catch(() => null);

  // Extract top actionable opportunities from Lighthouse
  const opportunities = Object.values(audits)
    .filter((a) => a && a.details?.type === "opportunity" && Number(a.details?.overallSavingsMs || 0) >= 100)
    .sort((a, b) => Number(b.details?.overallSavingsMs || 0) - Number(a.details?.overallSavingsMs || 0))
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      title: a.title,
      displayValue: a.displayValue || "",
      savingsMs: Math.round(Number(a.details?.overallSavingsMs || 0)),
    }));

  return jsonResponse({
    ok: true,
    snapshot: {
      ...snapshot,
      cls: snapshot.clsX1000 / 1000,
    },
    opportunities,
  });
}
