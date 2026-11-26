/**
 * Authentic Documentary AI Photo Retouch helper using Gemini Interactions REST API.
 * Strictly enforces HolaRise AGENTS.md Tầng 1 & Tầng 3:
 *   - Post-processes REAL event photographs only (light, dynamic range, film color grading).
 *   - NEVER invents, adds, removes, or distorts people, faces, expressions, or real locations.
 */

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-nano-banana-2.1";
export const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const GEMINI_API_REVISION = "2026-05-20";

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
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 160)}`);
  }

  const json = await res.json();
  const img = extractImageFromInteractionResponse(json);
  if (!img || !img.data) {
    throw new Error("Gemini không trả về dữ liệu ảnh hợp lệ.");
  }
  return img;
}

export async function generateThreeRetouchVariants({
  apiKey,
  model = DEFAULT_GEMINI_IMAGE_MODEL,
  imageBase64,
  mimeType = "image/jpeg",
  imageSize = DEFAULT_IMAGE_SIZE,
  aspectRatio = "auto",
  presetId = "",
  fetchImpl = fetch,
}) {
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
    targetPresets.map(async (preset) => {
      const out = await runGeminiImageEdit({
        apiKey,
        model,
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
