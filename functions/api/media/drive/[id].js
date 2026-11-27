/**
 * Public immutable image proxy backed by Google Drive API v3 + Cloudflare Edge Cache + MEDIA_KV warm cache.
 * Serves fast resized web thumbnails by default (?w=480|960|1280|1600, default 1280) so multi-MB Drive
 * originals load in <150ms, while preserving 100% uncompressed originals for ?raw=1 and ?download=1
 * (and Range-streamed video/audio).
 */

import {
  fetchDriveImage,
  fetchDriveThumbnail,
  isDriveConfigured,
  isSafeDriveFileId,
  normalizeDriveThumbWidth,
} from "../../../_lib/drive.js";
import { checkMediaAssetAccess } from "../../../_lib/media-access.js";

const MAX_KV_THUMB_BYTES = 1.5 * 1024 * 1024;
const KV_THUMB_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function buildNormalizedCacheRequest(reqUrl, id, { width = 0, fmt = "orig" } = {}) {
  const cleanUrl = new URL(reqUrl.origin);
  cleanUrl.pathname = `/api/media/drive/${encodeURIComponent(id)}`;
  if (width > 0) {
    cleanUrl.searchParams.set("w", String(width));
    cleanUrl.searchParams.set("fmt", fmt);
  }
  return new Request(cleanUrl.toString(), { method: "GET" });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = String(params?.id || "");
  if (!isSafeDriveFileId(id)) {
    return new Response("Not Found", { status: 404 });
  }
  if (!isDriveConfigured(env)) {
    return new Response("Google Drive storage unavailable", { status: 503 });
  }

  const access = await checkMediaAssetAccess(env, request, { driveFileId: id });
  if (access.restricted && !access.allowed) {
    return new Response("Forbidden — Bạn chưa được cấp quyền xem ảnh trong bộ ảnh này.", {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  }

  const reqUrl = new URL(request.url);
  const isDownload = reqUrl.searchParams.get("download") === "1";
  const isRaw = reqUrl.searchParams.get("raw") === "1";
  const rangeHeader = request.headers.get("Range") || "";
  const isRanged = Boolean(rangeHeader);
  const kindHint = String(reqUrl.searchParams.get("kind") || "").toLowerCase();
  const requestedWidth = normalizeDriveThumbWidth(reqUrl.searchParams.get("w"));
  const shouldResize =
    !isDownload && !isRaw && !isRanged && kindHint !== "video" && kindHint !== "audio";
  const effectiveWidth = shouldResize ? requestedWidth || 1280 : 0;
  const preferWebp =
    shouldResize && /\bimage\/webp\b/i.test(String(request.headers.get("Accept") || ""));
  const fmtKey = preferWebp ? "webp" : "img";

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheRequest =
    cache && !isDownload && !access.restricted && !isRanged
      ? buildNormalizedCacheRequest(reqUrl, id, {
          width: effectiveWidth,
          fmt: shouldResize ? fmtKey : "raw",
        })
      : null;

  if (cache && cacheRequest) {
    const cached = await cache.match(cacheRequest);
    if (cached) return cached;
  }

  // Layer 2: Global Cloudflare MEDIA_KV warm cache for public resized Drive thumbnails
  const kvThumbKey = shouldResize && !access.restricted ? `dthumb:${id}:${effectiveWidth}:${fmtKey}` : "";
  if (kvThumbKey && env?.MEDIA_KV) {
    try {
      const kvHit = await env.MEDIA_KV.getWithMetadata(kvThumbKey, { type: "arrayBuffer" });
      if (kvHit?.value && kvHit.value.byteLength > 0) {
        const kvContentType = String(kvHit.metadata?.contentType || (preferWebp ? "image/webp" : "image/jpeg"));
        const kvRes = new Response(kvHit.value, {
          status: 200,
          headers: {
            "Content-Type": kvContentType,
            "Content-Length": String(kvHit.value.byteLength),
            "Cache-Control": "public, max-age=31536000, immutable",
            Vary: "Accept",
            "X-Content-Type-Options": "nosniff",
            "X-Media-Optimized": `kv-thumb-${effectiveWidth}`,
          },
        });
        if (cache && cacheRequest && typeof context.waitUntil === "function") {
          context.waitUntil(cache.put(cacheRequest, kvRes.clone()));
        }
        return kvRes;
      }
    } catch {
      // Non-fatal: continue to Drive fetch
    }
  }

  // Layer 3: Fetch resized lightweight thumbnail from Google Drive (40-160 KB vs 3-15 MB original)
  if (shouldResize) {
    try {
      const thumb = await fetchDriveThumbnail(env, id, fetch, {
        width: effectiveWidth,
        preferWebp,
      });
      if (thumb.ok && thumb.body) {
        const bytes = await new Response(thumb.body).arrayBuffer();
        if (bytes.byteLength > 0) {
          const thumbHeaders = {
            "Content-Type": thumb.contentType,
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": access.restricted
              ? "private, no-store"
              : "public, max-age=31536000, immutable",
            Vary: access.restricted ? "Cookie" : "Accept",
            "X-Content-Type-Options": "nosniff",
            "X-Media-Optimized": `drive-thumb-${effectiveWidth}`,
          };
          const thumbRes = new Response(bytes, { status: 200, headers: thumbHeaders });

          if (!access.restricted && typeof context.waitUntil === "function") {
            if (cache && cacheRequest) {
              context.waitUntil(cache.put(cacheRequest, thumbRes.clone()));
            }
            if (kvThumbKey && env?.MEDIA_KV && bytes.byteLength <= MAX_KV_THUMB_BYTES) {
              context.waitUntil(
                env.MEDIA_KV.put(kvThumbKey, bytes, {
                  expirationTtl: KV_THUMB_TTL_SECONDS,
                  metadata: {
                    contentType: thumb.contentType,
                    size: bytes.byteLength,
                    width: effectiveWidth,
                  },
                }).catch(() => {})
              );
            }
          }
          return thumbRes;
        }
      }
    } catch {
      // Fall back transparently to full Drive binary stream
    }
  }

  // Layer 4: Full uncompressed original stream (?raw=1, ?download=1, video/audio, or fallback)
  let fetched;
  try {
    fetched = await fetchDriveImage(env, id, fetch, { range: rangeHeader, fallbackKind: kindHint });
  } catch {
    return new Response("Unable to reach Google Drive", { status: 502 });
  }

  if (!fetched.ok) {
    return new Response(fetched.status === 404 ? "Not Found" : "Invalid Media", {
      status: fetched.status,
    });
  }

  const isVideo = fetched.contentType.startsWith("video/");
  const isAudio = fetched.contentType.startsWith("audio/");
  const headers = {
    "Content-Type": fetched.contentType,
    "Cache-Control": access.restricted ? "private, no-store" : "public, max-age=31536000, immutable",
    "Accept-Ranges": fetched.acceptRanges || "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  if (access.restricted) {
    headers.Vary = "Cookie";
  }
  if (fetched.contentLength) {
    headers["Content-Length"] = fetched.contentLength;
  }
  if (fetched.contentRange) {
    headers["Content-Range"] = fetched.contentRange;
  }
  if (isDownload) {
    const ext = isAudio
      ? fetched.contentType.includes("mpeg")
        ? "mp3"
        : fetched.contentType.includes("ogg")
          ? "ogg"
          : fetched.contentType.includes("wav")
            ? "wav"
            : "m4a"
      : fetched.contentType.includes("mp4")
        ? "mp4"
        : fetched.contentType.includes("quicktime")
          ? "mov"
          : fetched.contentType.includes("webm")
            ? "webm"
            : fetched.contentType.includes("png")
              ? "png"
              : fetched.contentType.includes("webp")
                ? "webp"
                : "jpg";
    headers["Content-Disposition"] = `attachment; filename="holarise-${id.slice(0, 12)}.${ext}"`;
  }

  const response = new Response(fetched.body, { status: fetched.status || 200, headers });

  if (
    cache &&
    cacheRequest &&
    !isDownload &&
    !access.restricted &&
    !isRanged &&
    !isVideo &&
    !isAudio &&
    fetched.status === 200 &&
    typeof context.waitUntil === "function"
  ) {
    context.waitUntil(cache.put(cacheRequest, response.clone()));
  }
  return response;
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
