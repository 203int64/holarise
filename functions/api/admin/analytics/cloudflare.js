/**
 * GET /api/admin/analytics/cloudflare?days=7|30
 * Sole Super-Admin (203int64) Cloudflare GraphQL Analytics API connector.
 * Pulls Zone-level Edge HTTP Requests, Cache Hit Ratio, Bandwidth, Edge Unique Visitors,
 * WAF/Threats Blocked, HTTP 2xx/3xx/4xx/5xx status codes, Countries, and Content Types.
 * Works on Cloudflare Free plan using `httpRequests1dGroups` (max 30 days lookback).
 */

import {
  ensureAnalyticsSchema,
  getDateOffsetVnIso,
  getTodayVnIso,
  loadAnalyticsSeoConfig,
} from "../../../_lib/analytics.js";
import { errorResponse, jsonResponse, requireAdmin } from "../../../_lib/security.js";

const CF_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const ZONE_ANALYTICS_QUERY = `
query ZoneEdgeAnalytics($zoneTag: string!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(
        limit: 35
        filter: { date_geq: $since, date_leq: $until }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
        }
        uniq {
          uniques
        }
        sum {
          requests
          cachedRequests
          bytes
          cachedBytes
          pageViews
          threats
          encryptedRequests
          countryMap {
            clientCountryName
            requests
            threats
            bytes
          }
          responseStatusMap {
            edgeResponseStatus
            requests
          }
          contentTypeMap {
            edgeResponseContentTypeName
            requests
            bytes
          }
        }
      }
    }
  }
}
`;

function pct(num, den) {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  await ensureAnalyticsSchema(context.env.DB);
  const cfg = await loadAnalyticsSeoConfig(context.env.DB, context.env);

  if (!cfg.cf_zone_id || !cfg.cf_api_token) {
    return jsonResponse({
      ok: true,
      configured: false,
      zoneId: cfg.cf_zone_id || "",
      message: "Chưa cấu hình Cloudflare Zone ID và API Token (quyền Zone → Analytics → Read).",
    });
  }

  const url = new URL(context.request.url);
  const rawDays = Number(url.searchParams.get("days") || 30);
  // Cloudflare Free plan supports up to ~30 days on httpRequests1dGroups
  const days = rawDays === 7 ? 7 : 30;
  const until = getTodayVnIso();
  const since = getDateOffsetVnIso(days - 1);

  let payload;
  try {
    const resp = await fetch(CF_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.cf_api_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: ZONE_ANALYTICS_QUERY,
        variables: {
          zoneTag: cfg.cf_zone_id,
          since,
          until,
        },
      }),
    });
    payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = payload?.errors?.[0]?.message || `Cloudflare API HTTP ${resp.status}`;
      return errorResponse(502, "CF_API_HTTP_ERROR", msg);
    }
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      return errorResponse(502, "CF_GRAPHQL_ERROR", payload.errors[0]?.message || "Lỗi truy vấn Cloudflare GraphQL.");
    }
  } catch (err) {
    return errorResponse(502, "CF_NETWORK_ERROR", err?.message || "Không kết nối được Cloudflare GraphQL API.");
  }

  const groups = payload?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];

  let requests = 0;
  let cachedRequests = 0;
  let bytes = 0;
  let cachedBytes = 0;
  let pageViews = 0;
  let uniques = 0;
  let threats = 0;
  let encryptedRequests = 0;

  const statusBuckets = { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
  const statusDetailMap = new Map();
  const countryMap = new Map();
  const contentTypeMap = new Map();
  const daily = [];

  for (const g of groups) {
    const sum = g?.sum || {};
    const dReq = Number(sum.requests || 0);
    const dCachedReq = Number(sum.cachedRequests || 0);
    const dBytes = Number(sum.bytes || 0);
    const dCachedBytes = Number(sum.cachedBytes || 0);
    const dPv = Number(sum.pageViews || 0);
    const dThreats = Number(sum.threats || 0);
    const dEnc = Number(sum.encryptedRequests || 0);
    const dUniq = Number(g?.uniq?.uniques || 0);

    requests += dReq;
    cachedRequests += dCachedReq;
    bytes += dBytes;
    cachedBytes += dCachedBytes;
    pageViews += dPv;
    uniques += dUniq;
    threats += dThreats;
    encryptedRequests += dEnc;

    daily.push({
      date: g?.dimensions?.date || "",
      requests: dReq,
      cachedRequests: dCachedReq,
      pageViews: dPv,
      uniques: dUniq,
      threats: dThreats,
      bytes: dBytes,
    });

    for (const st of sum.responseStatusMap || []) {
      const code = Number(st.edgeResponseStatus || 0);
      const cnt = Number(st.requests || 0);
      if (code >= 200 && code < 300) statusBuckets.s2xx += cnt;
      else if (code >= 300 && code < 400) statusBuckets.s3xx += cnt;
      else if (code >= 400 && code < 500) statusBuckets.s4xx += cnt;
      else if (code >= 500) statusBuckets.s5xx += cnt;
      if (code >= 400) {
        statusDetailMap.set(code, (statusDetailMap.get(code) || 0) + cnt);
      }
    }

    for (const c of sum.countryMap || []) {
      const name = String(c.clientCountryName || "Unknown");
      const cur = countryMap.get(name) || { country: name, requests: 0, threats: 0, bytes: 0 };
      cur.requests += Number(c.requests || 0);
      cur.threats += Number(c.threats || 0);
      cur.bytes += Number(c.bytes || 0);
      countryMap.set(name, cur);
    }

    for (const ct of sum.contentTypeMap || []) {
      const name = String(ct.edgeResponseContentTypeName || "other");
      const cur = contentTypeMap.get(name) || { type: name, requests: 0, bytes: 0 };
      cur.requests += Number(ct.requests || 0);
      cur.bytes += Number(ct.bytes || 0);
      contentTypeMap.set(name, cur);
    }
  }

  const countries = Array.from(countryMap.values())
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 12);
  const contentTypes = Array.from(contentTypeMap.values())
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 10);
  const errorStatuses = Array.from(statusDetailMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return jsonResponse({
    ok: true,
    configured: true,
    zoneId: cfg.cf_zone_id,
    days,
    since,
    until,
    totals: {
      requests,
      cachedRequests,
      cacheHitRatePct: pct(cachedRequests, requests),
      bytes,
      cachedBytes,
      bandwidthSavedPct: pct(cachedBytes, bytes),
      pageViews,
      uniques,
      threats,
      encryptedRequests,
      httpsPct: pct(encryptedRequests, requests),
    },
    statusBuckets,
    errorStatuses,
    countries,
    contentTypes,
    daily,
  });
}
