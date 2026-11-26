/**
 * Authentic Documentary AI Photo Retouch helper using Gemini Interactions REST API.
 * Strictly enforces HolaRise AGENTS.md Tầng 1 & Tầng 3:
 *   - Post-processes REAL event photographs only (light, dynamic range, film color grading).
 *   - NEVER invents, adds, removes, or distorts people, faces, expressions, or real locations.
 */

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-nano-banana-2.1";
export const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const GEMINI_API_REVISION = "2026-05-20";
export const AI_CONFIG_SETTING_KEY = "ai_image_config";
export const DEFAULT_BRAND_SLOGAN = "Together We Rise, Together We Serve.";

export const ALLOWED_IMAGE_SIZES = ["1K", "2K", "4K"];
export const DEFAULT_IMAGE_SIZE = "2K";
export const ALLOWED_ASPECT_RATIOS = ["auto", "16:9", "4:5", "3:2", "1:1", "9:16"];

export function normalizeImageSize(raw) {
  const val = String(raw || "").trim().toUpperCase();
  return ALLOWED_IMAGE_SIZES.includes(val) ? val : DEFAULT_IMAGE_SIZE;
}

export function normalizeAspectRatio(raw) {
  const val = String(raw || "").trim().toLowerCase();
  if (!val || val === "auto") return "auto";
  return ALLOWED_ASPECT_RATIOS.includes(val) ? val : "auto";
}

/**
 * Collects all configured Gemini API keys from env without ever exposing raw secrets to the client.
 * Supports:
 *   - GEMINI_API_KEYS="key1,key2,key3" (comma or newline separated)
 *   - GEMINI_API_KEY, GEMINI_API_KEY_2 .. GEMINI_API_KEY_5
 */
export function resolveGeminiKeyPool(env) {
  const rawEntries = [];
  const primary = String(env?.GEMINI_API_KEY || "").trim();
  if (primary) rawEntries.push({ key: primary, source: "GEMINI_API_KEY" });

  for (let i = 2; i <= 5; i += 1) {
    const k = String(env?.[`GEMINI_API_KEY_${i}`] || "").trim();
    if (k) rawEntries.push({ key: k, source: `GEMINI_API_KEY_${i}` });
  }

  const multi = String(env?.GEMINI_API_KEYS || "").trim();
  if (multi) {
    for (const part of multi.split(/[\r\n,;]+/)) {
      const k = part.trim();
      if (k) rawEntries.push({ key: k, source: "GEMINI_API_KEYS" });
    }
  }

  const seen = new Set();
  const pool = [];
  for (const entry of rawEntries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    const idx = pool.length + 1;
    const tail = entry.key.length >= 4 ? entry.key.slice(-4) : "****";
    pool.push({
      id: `key-${idx}`,
      label: `Gemini #${idx} (…${tail})`,
      source: entry.source,
      key: entry.key,
    });
  }
  return pool;
}

export function getPublicKeySlots(pool) {
  return (pool || []).map(({ id, label, source, masked, removable, addedAt }) => ({
    id,
    label,
    source,
    masked: masked || "",
    removable: Boolean(removable),
    addedAt: addedAt || "",
  }));
}

export async function loadAdminAiConfig(db) {
  const empty = {
    keys: [],
    model: "",
    fallbackModel: "",
    defaultImageSize: "",
    defaultAspectRatio: "auto",
    defaultSlogan: DEFAULT_BRAND_SLOGAN,
  };
  if (!db) return empty;
  try {
    const row = await db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .bind(AI_CONFIG_SETTING_KEY)
      .first();
    if (!row?.value) return empty;
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object") return empty;
    const keys = Array.isArray(parsed.keys)
      ? parsed.keys
          .filter((k) => k && typeof k.key === "string" && k.key.trim().length >= 8)
          .map((k) => ({
            id: String(k.id || `adm-${crypto.randomUUID().slice(0, 8)}`),
            label: String(k.label || "").trim().slice(0, 60),
            key: String(k.key).trim(),
            addedAt: String(k.addedAt || ""),
          }))
      : [];
    return {
      keys,
      model: String(parsed.model || "").trim().slice(0, 80),
      fallbackModel: String(parsed.fallbackModel || "").trim().slice(0, 80),
      defaultImageSize: parsed.defaultImageSize ? normalizeImageSize(parsed.defaultImageSize) : "",
      defaultAspectRatio: normalizeAspectRatio(parsed.defaultAspectRatio),
      defaultSlogan:
        typeof parsed.defaultSlogan === "string" ? parsed.defaultSlogan.trim().slice(0, 100) : DEFAULT_BRAND_SLOGAN,
    };
  } catch {
    return empty;
  }
}

export async function saveAdminAiConfig(db, config) {
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    keys: Array.isArray(config?.keys) ? config.keys : [],
    model: String(config?.model || "").trim().slice(0, 80),
    fallbackModel: String(config?.fallbackModel || "").trim().slice(0, 80),
    defaultImageSize: config?.defaultImageSize ? normalizeImageSize(config.defaultImageSize) : "",
    defaultAspectRatio: normalizeAspectRatio(config?.defaultAspectRatio),
    defaultSlogan:
      typeof config?.defaultSlogan === "string" ? config.defaultSlogan.trim().slice(0, 100) : DEFAULT_BRAND_SLOGAN,
  });
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(AI_CONFIG_SETTING_KEY, payload, now)
    .run();
}

export async function resolveFullAiRuntime(env, db) {
  const adminCfg = await loadAdminAiConfig(db);
  const envPool = resolveGeminiKeyPool(env);
  const seen = new Set();
  const keyPool = [];

  for (const item of adminCfg.keys) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const idx = keyPool.length + 1;
    const tail = item.key.length >= 4 ? item.key.slice(-4) : "****";
    const head = item.key.length >= 8 ? item.key.slice(0, 4) : "";
    const masked = head ? `${head}…${tail}` : `…${tail}`;
    keyPool.push({
      id: item.id,
      label: item.label ? `${item.label} (…${tail})` : `Admin Key #${idx} (…${tail})`,
      source: "admin",
      masked,
      removable: true,
      addedAt: item.addedAt || "",
      key: item.key,
    });
  }

  for (const item of envPool) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const tail = item.key.length >= 4 ? item.key.slice(-4) : "****";
    const head = item.key.length >= 8 ? item.key.slice(0, 4) : "";
    keyPool.push({
      ...item,
      masked: head ? `${head}…${tail}` : `…${tail}`,
      removable: false,
      addedAt: "",
    });
  }

  const model = adminCfg.model || String(env?.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_IMAGE_MODEL).trim();
  const fallbackModel = adminCfg.fallbackModel || String(env?.GEMINI_IMAGE_FALLBACK_MODEL || "").trim();
  const defaultImageSize = normalizeImageSize(adminCfg.defaultImageSize || env?.GEMINI_IMAGE_SIZE);
  const defaultAspectRatio = normalizeAspectRatio(adminCfg.defaultAspectRatio);
  const defaultSlogan = adminCfg.defaultSlogan;

  return {
    keyPool,
    slots: getPublicKeySlots(keyPool),
    model,
    fallbackModel,
    defaultImageSize,
    defaultAspectRatio,
    defaultSlogan,
  };
}

function isRetryableGeminiError(status, errMsg = "") {
  if (status === 429 || status === 403 || status === 408 || status >= 500) return true;
  if (/timeout|aborted|network|fetch failed|quota|rate/i.test(String(errMsg || ""))) return true;
  return false;
}

const STRICT_AUTHENTICITY_PREFIX =
  "STRICT DOCUMENTARY AUTHENTICITY RULES (NON-NEGOTIABLE): " +
  "Keep 100% of the exact same real people, faces, expressions, postures, clothing, furniture, architecture, trees, and objects. " +
  "Do NOT add, remove, replace, or invent any person, object, or text. " +
  "Zero plastic skin, zero AI sheen, zero fantasy glow. Perform ONLY authentic photographic color grading and light recovery: ";

export const AI_RETOUCH_PRESETS = [
  {
    id: "warm_film",
    label: "Phim ấm Hòa Lạc",
    subtitle: "Kodak Portra 400 · Ánh gỗ ấm, cứu vùng cháy sáng, hạt phim nhẹ",
    prompt:
      STRICT_AUTHENTICITY_PREFIX +
      "Apply a warm 35mm Kodak Portra 400 documentary film grade: recover blown outdoor highlights, warm up wooden/ambient indoor lighting softly, soften harsh floor glare, preserve natural Vietnamese skin tones, and add subtle organic 35mm film grain.",
  },
  {
    id: "natural_clean",
    label: "Sáng trong tự nhiên",
    subtitle: "Leica Natural · Cân bằng trắng chuẩn, khử nhiễu, màu trung thực",
    prompt:
      STRICT_AUTHENTICITY_PREFIX +
      "Apply a clean Leica full-frame editorial documentary grade: neutralize unnatural color casts, lift flat shadows gently, recover blown highlights, reduce smartphone noise and harsh glare, and keep colors crisp, bright, and true-to-life.",
  },
  {
    id: "cinematic_deep",
    label: "Điện ảnh trầm sâu",
    subtitle: "Fujifilm Classic Chrome · Tương phản sâu, tông xanh rừng & hổ phách",
    prompt:
      STRICT_AUTHENTICITY_PREFIX +
      "Apply a Fujifilm Classic Chrome editorial documentary grade: understated earthy greens and warm amber tones, richer natural shadow depth, gentle cinematic contrast, balanced highlights, and subtle authentic film texture.",
  },
];

export function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const cleanB64 = match[2].replace(/\s+/g, "");
  try {
    const bin = atob(cleanB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return { mime, bytes, base64: cleanB64 };
  } catch {
    return null;
  }
}

export function extractImageFromInteractionResponse(payload) {
  if (!payload || typeof payload !== "object") return null;

  // Shape 1: convenience `output_image`
  if (payload.output_image && typeof payload.output_image.data === "string" && payload.output_image.data) {
    return {
      data: payload.output_image.data,
      mimeType: payload.output_image.mime_type || payload.output_image.mimeType || "image/jpeg",
    };
  }

  // Shape 2: `outputs` array directly on interaction
  const pools = [];
  if (Array.isArray(payload.outputs)) pools.push(...payload.outputs);

  // Shape 3: `steps[].outputs[]` or `steps[].content[]` (canonical Interactions REST schema)
  if (Array.isArray(payload.steps)) {
    for (const step of payload.steps) {
      if (Array.isArray(step?.outputs)) pools.push(...step.outputs);
      if (Array.isArray(step?.content)) pools.push(...step.content);
    }
  }

  for (const item of pools) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "image" && typeof item.data === "string" && item.data) {
      return {
        data: item.data,
        mimeType: item.mime_type || item.mimeType || "image/jpeg",
      };
    }
  }

  // Shape 4: fallback for classic generateContent candidates structure if a proxy returns it
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        return {
          data: inline.data,
          mimeType: inline.mimeType || inline.mime_type || "image/jpeg",
        };
      }
    }
  }

  return null;
}

export async function runGeminiImageEdit({
  apiKey,
  model = DEFAULT_GEMINI_IMAGE_MODEL,
  imageBase64,
  mimeType = "image/jpeg",
  prompt,
  imageSize = DEFAULT_IMAGE_SIZE,
  aspectRatio = "auto",
  fetchImpl = fetch,
}) {
  const normSize = normalizeImageSize(imageSize);
  const normRatio = normalizeAspectRatio(aspectRatio);
  const responseFormat = {
    type: "image",
    mime_type: "image/jpeg",
    image_size: normSize,
  };
  if (normRatio !== "auto") {
    responseFormat.aspect_ratio = normRatio;
  }

  const res = await fetchImpl(GEMINI_INTERACTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": GEMINI_API_REVISION,
    },
    signal: AbortSignal.timeout(normSize === "4K" ? 90000 : 45000),
    body: JSON.stringify({
      model,
      input: [
        { type: "text", text: prompt },
        {
          type: "image",
          mime_type: mimeType,
          data: imageBase64,
        },
      ],
      response_format: responseFormat,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 160)}`);
    err.httpStatus = res.status;
    throw err;
  }

  const json = await res.json();
  const img = extractImageFromInteractionResponse(json);
  if (!img || !img.data) {
    throw new Error("Gemini không trả về dữ liệu ảnh hợp lệ.");
  }
  return img;
}

/**
 * Runs a single Gemini image edit with automatic key rotation & fallback across the pool.
 */
export async function runGeminiImageEditWithFallback({
  keyPool = [],
  startIndex = 0,
  preferredSlotId = "",
  model = DEFAULT_GEMINI_IMAGE_MODEL,
  fallbackModel = "",
  imageBase64,
  mimeType = "image/jpeg",
  prompt,
  imageSize = DEFAULT_IMAGE_SIZE,
  aspectRatio = "auto",
  fetchImpl = fetch,
}) {
  if (!Array.isArray(keyPool) || keyPool.length === 0) {
    throw new Error("Chưa cấu hình GEMINI_API_KEY.");
  }

  // Order keys: preferred slot first (if selected), otherwise rotated by startIndex
  let ordered = [];
  if (preferredSlotId && preferredSlotId !== "auto") {
    const pref = keyPool.find((k) => k.id === preferredSlotId);
    if (pref) {
      ordered = [pref, ...keyPool.filter((k) => k.id !== preferredSlotId)];
    }
  }
  if (ordered.length === 0) {
    const offset = ((startIndex % keyPool.length) + keyPool.length) % keyPool.length;
    ordered = [...keyPool.slice(offset), ...keyPool.slice(0, offset)];
  }

  const modelsToTry = [model];
  const fb = String(fallbackModel || "").trim();
  if (fb && fb !== model) modelsToTry.push(fb);

  const attemptErrors = [];
  for (const activeModel of modelsToTry) {
    for (const slot of ordered) {
      try {
        const img = await runGeminiImageEdit({
          apiKey: slot.key,
          model: activeModel,
          imageBase64,
          mimeType,
          prompt,
          imageSize,
          aspectRatio,
          fetchImpl,
        });
        return { ...img, usedSlotId: slot.id, usedSlotLabel: slot.label, usedModel: activeModel };
      } catch (err) {
        const status = Number(err?.httpStatus || 0);
        const msg = err?.message || "failed";
        attemptErrors.push(`${slot.id}/${activeModel}: ${msg}`);
        if (!isRetryableGeminiError(status, msg) && ordered.length === 1) {
          throw err;
        }
      }
    }
  }

  throw new Error(attemptErrors[attemptErrors.length - 1] || "Tất cả API key Gemini đều gặp lỗi.");
}

export async function generateThreeRetouchVariants({
  apiKey = "",
  keyPool = null,
  preferredSlotId = "auto",
  model = DEFAULT_GEMINI_IMAGE_MODEL,
  fallbackModel = "",
  imageBase64,
  mimeType = "image/jpeg",
  imageSize = DEFAULT_IMAGE_SIZE,
  aspectRatio = "auto",
  presetId = "",
  fetchImpl = fetch,
}) {
  const pool =
    Array.isArray(keyPool) && keyPool.length > 0
      ? keyPool
      : apiKey
        ? [{ id: "key-1", label: "Gemini #1", source: "GEMINI_API_KEY", key: apiKey }]
        : [];
  const normSize = normalizeImageSize(imageSize);
  const normRatio = normalizeAspectRatio(aspectRatio);
  const requestedId = String(presetId || "").trim();
  let targetPresets = AI_RETOUCH_PRESETS;
  if (requestedId) {
    const matched = AI_RETOUCH_PRESETS.filter((p) => p.id === requestedId);
    if (matched.length > 0) targetPresets = matched;
  } else if (normSize === "4K") {
    // 4K outputs are large (3-8 MB each); cap to 1 preset when unspecified to prevent Worker OOM/timeout
    targetPresets = [AI_RETOUCH_PRESETS[0]];
  }

  const settled = await Promise.allSettled(
    targetPresets.map(async (preset, idx) => {
      const out = await runGeminiImageEditWithFallback({
        keyPool: pool,
        startIndex: idx,
        preferredSlotId,
        model,
        fallbackModel,
        imageBase64,
        mimeType,
        prompt: preset.prompt,
        imageSize: normSize,
        aspectRatio: normRatio,
        fetchImpl,
      });
      return {
        id: preset.id,
        label: preset.label,
        subtitle: preset.subtitle,
        imageSize: normSize,
        aspectRatio: normRatio,
        usedSlotId: out.usedSlotId,
        usedSlotLabel: out.usedSlotLabel,
        usedModel: out.usedModel,
        mimeType: out.mimeType,
        dataUrl: `data:${out.mimeType};base64,${out.data}`,
      };
    })
  );

  const variants = [];
  const errors = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      variants.push(r.value);
    } else {
      errors.push(`${targetPresets[i].id}: ${r.reason?.message || "failed"}`);
    }
  }
  return { variants, errors, imageSize: normSize, aspectRatio: normRatio };
}
