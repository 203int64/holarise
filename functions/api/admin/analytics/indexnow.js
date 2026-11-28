/**
 * POST /api/admin/analytics/indexnow
 * Sole Super-Admin (203int64) 1-click IndexNow submission for all live sitemap URLs
 * (Bing, ChatGPT Search, Copilot, DuckDuckGo, Yandex, Naver).
 */

import {
  ensureAnalyticsSchema,
  loadAnalyticsSeoConfig,
  saveAnalyticsSeoConfig,
  SITE_ORIGIN,
} from "../../../_lib/analytics.js";
import { logAudit } from "../../../_lib/rbac.js";
import { absUrl, resolveEventHref, resolveEventHrefEn } from "../../../_lib/render.js";
import { errorResponse, jsonResponse, requireAdmin } from "../../../_lib/security.js";

const STATIC_PATHS = [
  "/",
  "/en/",
  "/gioi-thieu/",
  "/en/about/",
  "/lich-hoat-dong/",
  "/en/schedule/",
  "/hanh-trinh/",
  "/en/journey/",
  "/tham-gia/",
  "/en/join/",
  "/chinh-sach/",
  "/en/privacy/",
];

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureAnalyticsSchema(db);
  const cfg = await loadAnalyticsSeoConfig(db, context.env);

  if (!cfg.indexnow_key || !/^[A-Za-z0-9-]{8,128}$/.test(cfg.indexnow_key)) {
    return errorResponse(400, "MISSING_INDEXNOW_KEY", "Chưa có mã IndexNow hợp lệ. Vui lòng lưu mã IndexNow trước.");
  }

  const [postsRes, eventsRes] = await Promise.all([
    db.prepare("SELECT slug FROM posts WHERE status = 'published' ORDER BY date DESC LIMIT 500").all().catch(() => ({ results: [] })),
    db.prepare("SELECT id, kind, date, sort_order, created_at FROM events WHERE status = 'published' ORDER BY date DESC LIMIT 100").all().catch(() => ({ results: [] })),
  ]);

  const urlSet = new Set(STATIC_PATHS.map((p) => absUrl(p)));
  for (const ev of eventsRes.results || []) {
    const vi = resolveEventHref(ev);
    const en = resolveEventHrefEn(ev);
    if (vi) urlSet.add(absUrl(vi));
    if (en) urlSet.add(absUrl(en));
  }
  for (const p of postsRes.results || []) {
    if (p.slug) {
      urlSet.add(absUrl(`/hanh-trinh/${p.slug}/`));
      urlSet.add(absUrl(`/en/journey/${p.slug}/`));
    }
  }

  const urlList = Array.from(urlSet);
  const payload = {
    host: "holarise.org",
    key: cfg.indexnow_key,
    keyLocation: `${SITE_ORIGIN}/${cfg.indexnow_key}.txt`,
    urlList,
  };

  let statusText = "";
  let httpStatus = 0;
  try {
    const resp = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    httpStatus = resp.status;
    if (resp.status === 200 || resp.status === 202) {
      statusText = `Thành công (HTTP ${resp.status})`;
    } else {
      const txt = await resp.text().catch(() => "");
      statusText = `Lỗi HTTP ${resp.status}${txt ? `: ${txt.slice(0, 60)}` : ""}`;
      await saveAnalyticsSeoConfig(db, context.env, {
        last_indexnow_ping_at: new Date().toISOString(),
        last_indexnow_status: statusText,
        last_indexnow_count: urlList.length,
      }).catch(() => null);
      return errorResponse(502, "INDEXNOW_REJECTED", `IndexNow phản hồi ${statusText}`);
    }
  } catch (err) {
    return errorResponse(502, "INDEXNOW_NETWORK_ERROR", err?.message || "Không kết nối được api.indexnow.org.");
  }

  const pingAt = new Date().toISOString();
  await saveAnalyticsSeoConfig(db, context.env, {
    last_indexnow_ping_at: pingAt,
    last_indexnow_status: statusText,
    last_indexnow_count: urlList.length,
  });

  await logAudit(db, auth.user, {
    action: "analytics.indexnow.ping",
    targetType: "seo",
    targetId: "indexnow",
    summary: `Đẩy ${urlList.length} URL lên IndexNow (${statusText})`,
  }).catch(() => null);

  return jsonResponse({
    ok: true,
    httpStatus,
    status: statusText,
    submittedCount: urlList.length,
    pingAt,
    keyLocation: payload.keyLocation,
  });
}
