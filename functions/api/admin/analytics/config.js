/**
 * GET / PUT /api/admin/analytics/config
 * Sole Super-Admin (203int64) centralized management of SEO verification tags,
 * IndexNow key, PageSpeed Insights API key, Cloudflare Web Analytics token,
 * and Google Search Console Service Account credentials.
 *
 * Security: Secrets are persisted in D1 `settings` and NEVER returned in plain text.
 */

import {
  ensureAnalyticsSchema,
  loadAnalyticsSeoConfig,
  saveAnalyticsSeoConfig,
  toPublicAnalyticsConfig,
} from "../../../_lib/analytics.js";
import { logAudit } from "../../../_lib/rbac.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  await ensureAnalyticsSchema(context.env.DB);
  const cfg = await loadAnalyticsSeoConfig(context.env.DB, context.env);
  return jsonResponse({ ok: true, config: toPublicAnalyticsConfig(cfg) });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 48 * 1024);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data || {};
  const fields = {};

  if (typeof data.indexnow_key === "string" && data.indexnow_key.trim()) {
    if (!/^[A-Za-z0-9-]{8,128}$/.test(data.indexnow_key.trim())) {
      fields.indexnow_key = "IndexNow key phải dài 8–128 ký tự (chỉ gồm chữ, số và dấu gạch ngang).";
    }
  }
  if (typeof data.google_site_verification === "string" && data.google_site_verification.length > 120) {
    fields.google_site_verification = "Mã xác minh Google tối đa 120 ký tự.";
  }
  if (typeof data.bing_site_verification === "string" && data.bing_site_verification.length > 120) {
    fields.bing_site_verification = "Mã xác minh Bing tối đa 120 ký tự.";
  }
  if (typeof data.cf_web_analytics_token === "string" && data.cf_web_analytics_token.trim()) {
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(data.cf_web_analytics_token.trim())) {
      fields.cf_web_analytics_token = "Token Cloudflare Web Analytics chỉ gồm chữ, số, gạch dưới hoặc gạch ngang.";
    }
  }
  if (typeof data.cf_zone_id === "string" && data.cf_zone_id.trim()) {
    if (!/^[a-fA-F0-9]{32}$/.test(data.cf_zone_id.trim())) {
      fields.cf_zone_id = "Cloudflare Zone ID phải là chuỗi hex 32 ký tự (lấy ở mục Overview → API trên Cloudflare Dashboard).";
    }
  }
  if (typeof data.gsc_site_url === "string" && data.gsc_site_url.trim()) {
    const s = data.gsc_site_url.trim();
    if (!s.startsWith("sc-domain:") && !s.startsWith("https://")) {
      fields.gsc_site_url = "Property GSC phải bắt đầu bằng sc-domain: hoặc https:// (ví dụ: sc-domain:holarise.org).";
    }
  }

  if (Object.keys(fields).length > 0) {
    return errorResponse(400, "VALIDATION_ERROR", "Cấu hình SEO & API chưa hợp lệ.", fields);
  }

  await ensureAnalyticsSchema(context.env.DB);
  let saved;
  try {
    saved = await saveAnalyticsSeoConfig(context.env.DB, context.env, data);
  } catch (err) {
    return errorResponse(400, "INVALID_CREDENTIALS_JSON", err?.message || "Không đọc được tệp JSON Service Account.");
  }

  await logAudit(context.env.DB, auth.user, {
    action: "analytics.config.update",
    targetType: "settings",
    targetId: "analytics_seo_config",
    summary: "Cập nhật cấu hình SEO, Telemetry & API theo dõi",
  }).catch(() => null);

  return jsonResponse({ ok: true, config: toPublicAnalyticsConfig(saved) });
}
