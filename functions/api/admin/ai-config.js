/**
 * GET / POST /api/admin/ai-config
 * Sole-Admin (203int64) management of Gemini AI Image API keys & default studio settings.
 * Stored in D1 `settings` table (`key = 'ai_image_config'`). Raw keys are NEVER returned in GET responses.
 */

import {
  DEFAULT_BRAND_SLOGAN,
  loadAdminAiConfig,
  normalizeAspectRatio,
  normalizeImageSize,
  resolveFullAiRuntime,
  saveAdminAiConfig,
} from "../../_lib/ai-retouch.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../_lib/security.js";

const MAX_ADMIN_KEYS = 10;

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const runtime = await resolveFullAiRuntime(context.env, context.env.DB);
  return jsonResponse({
    ok: true,
    configured: runtime.keyPool.length > 0,
    keyCount: runtime.keyPool.length,
    slots: runtime.slots,
    model: runtime.model,
    fallbackModel: runtime.fallbackModel,
    defaultImageSize: runtime.defaultImageSize,
    defaultAspectRatio: runtime.defaultAspectRatio,
    defaultSlogan: runtime.defaultSlogan,
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const action = String(parsed.data?.action || "").trim().toLowerCase();
  const cfg = await loadAdminAiConfig(context.env.DB);

  if (action === "add_key") {
    const rawKeys = String(parsed.data?.apiKeys ?? parsed.data?.apiKey ?? "").trim();
    const labelBase = String(parsed.data?.label || "").trim().slice(0, 50);
    const candidates = rawKeys
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 10 && s.length <= 256);

    if (candidates.length === 0) {
      return errorResponse(400, "INVALID_API_KEY", "Vui lòng nhập ít nhất 1 khóa API hợp lệ (tối thiểu 10 ký tự).");
    }

    const existingSet = new Set(cfg.keys.map((k) => k.key));
    const now = new Date().toISOString();
    let added = 0;

    for (let i = 0; i < candidates.length; i += 1) {
      if (cfg.keys.length >= MAX_ADMIN_KEYS) break;
      const keyVal = candidates[i];
      if (existingSet.has(keyVal)) continue;
      existingSet.add(keyVal);
      const label =
        labelBase && candidates.length > 1
          ? `${labelBase} #${i + 1}`
          : labelBase || `Gemini Key #${cfg.keys.length + 1}`;
      cfg.keys.push({
        id: `adm-${crypto.randomUUID().slice(0, 8)}`,
        label,
        key: keyVal,
        addedAt: now,
      });
      added += 1;
    }

    await saveAdminAiConfig(context.env.DB, cfg);
    const runtime = await resolveFullAiRuntime(context.env, context.env.DB);
    return jsonResponse({
      ok: true,
      added,
      keyCount: runtime.keyPool.length,
      slots: runtime.slots,
    });
  }

  if (action === "remove_key") {
    const keyId = String(parsed.data?.keyId || "").trim();
    if (!keyId) {
      return errorResponse(400, "MISSING_KEY_ID", "Thiếu mã khóa cần xóa.");
    }
    const before = cfg.keys.length;
    cfg.keys = cfg.keys.filter((k) => k.id !== keyId);
    if (cfg.keys.length === before) {
      return errorResponse(404, "KEY_NOT_FOUND", "Không tìm thấy khóa này trong cấu hình Admin (khóa từ Cloudflare Env không xóa tại đây).");
    }
    await saveAdminAiConfig(context.env.DB, cfg);
    const runtime = await resolveFullAiRuntime(context.env, context.env.DB);
    return jsonResponse({
      ok: true,
      keyCount: runtime.keyPool.length,
      slots: runtime.slots,
    });
  }

  if (action === "save_defaults") {
    cfg.model = String(parsed.data?.model || "").trim().slice(0, 80);
    cfg.fallbackModel = String(parsed.data?.fallbackModel || "").trim().slice(0, 80);
    cfg.defaultImageSize = normalizeImageSize(parsed.data?.defaultImageSize);
    cfg.defaultAspectRatio = normalizeAspectRatio(parsed.data?.defaultAspectRatio);
    cfg.defaultSlogan =
      typeof parsed.data?.defaultSlogan === "string"
        ? parsed.data.defaultSlogan.trim().slice(0, 100)
        : DEFAULT_BRAND_SLOGAN;

    await saveAdminAiConfig(context.env.DB, cfg);
    const runtime = await resolveFullAiRuntime(context.env, context.env.DB);
    return jsonResponse({
      ok: true,
      model: runtime.model,
      fallbackModel: runtime.fallbackModel,
      defaultImageSize: runtime.defaultImageSize,
      defaultAspectRatio: runtime.defaultAspectRatio,
      defaultSlogan: runtime.defaultSlogan,
      keyCount: runtime.keyPool.length,
      slots: runtime.slots,
    });
  }

  return errorResponse(400, "INVALID_ACTION", "Hành động không hợp lệ (add_key, remove_key hoặc save_defaults).");
}
