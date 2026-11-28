/**
 * GET /api/admin/analytics/gsc?days=28
 * Sole Super-Admin (203int64) Google Search Console Search Analytics connector.
 * Uses pure Web Crypto RS256 JWT authentication with a configured Google Cloud Service Account.
 */

import {
  ensureAnalyticsSchema,
  getDateOffsetVnIso,
  getGoogleAccessToken,
  getTodayVnIso,
  loadAnalyticsSeoConfig,
} from "../../../_lib/analytics.js";
import { errorResponse, jsonResponse, requireAdmin } from "../../../_lib/security.js";

async function queryGsc(accessToken, siteUrl, body) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || `Google Search Console HTTP ${resp.status}`);
  }
  return data;
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  await ensureAnalyticsSchema(context.env.DB);
  const cfg = await loadAnalyticsSeoConfig(context.env.DB, context.env);

  if (!cfg.gsc_client_email || !cfg.gsc_private_key) {
    return jsonResponse({
      ok: true,
      configured: false,
      siteUrl: cfg.gsc_site_url,
      message: "Chưa cấu hình Service Account cho Google Search Console.",
    });
  }

  const url = new URL(context.request.url);
  const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days") || 28)));
  const endDate = getTodayVnIso();
  const startDate = getDateOffsetVnIso(days);

  let token;
  try {
    token = await getGoogleAccessToken({
      clientEmail: cfg.gsc_client_email,
      privateKeyPem: cfg.gsc_private_key,
    });
  } catch (err) {
    return errorResponse(502, "GSC_AUTH_FAILED", `Không xác thực được Google Service Account: ${err?.message || "Lỗi khóa"}`);
  }

  try {
    const [queriesRes, pagesRes, datesRes] = await Promise.all([
      queryGsc(token, cfg.gsc_site_url, { startDate, endDate, dimensions: ["query"], rowLimit: 20 }),
      queryGsc(token, cfg.gsc_site_url, { startDate, endDate, dimensions: ["page"], rowLimit: 15 }),
      queryGsc(token, cfg.gsc_site_url, { startDate, endDate, dimensions: ["date"], rowLimit: 90 }),
    ]);

    const dateRows = (datesRes.rows || []).map((r) => ({
      date: r.keys?.[0] || "",
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      ctr: Math.round(Number(r.ctr || 0) * 1000) / 10,
      position: Math.round(Number(r.position || 0) * 10) / 10,
    }));

    const totalClicks = dateRows.reduce((a, b) => a + b.clicks, 0);
    const totalImpressions = dateRows.reduce((a, b) => a + b.impressions, 0);
    const avgCtr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : 0;
    const avgPos =
      dateRows.length > 0
        ? Math.round((dateRows.reduce((a, b) => a + b.position, 0) / dateRows.length) * 10) / 10
        : 0;

    return jsonResponse({
      ok: true,
      configured: true,
      siteUrl: cfg.gsc_site_url,
      startDate,
      endDate,
      totals: {
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: avgCtr,
        position: avgPos,
      },
      queries: (queriesRes.rows || []).map((r) => ({
        query: r.keys?.[0] || "",
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0),
        ctr: Math.round(Number(r.ctr || 0) * 1000) / 10,
        position: Math.round(Number(r.position || 0) * 10) / 10,
      })),
      pages: (pagesRes.rows || []).map((r) => ({
        page: r.keys?.[0] || "",
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0),
        ctr: Math.round(Number(r.ctr || 0) * 1000) / 10,
        position: Math.round(Number(r.position || 0) * 10) / 10,
      })),
      daily: dateRows,
    });
  } catch (err) {
    return errorResponse(502, "GSC_QUERY_FAILED", err?.message || "Lỗi truy vấn Google Search Console API.");
  }
}
