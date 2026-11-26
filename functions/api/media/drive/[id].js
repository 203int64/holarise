/**
 * Public immutable image proxy backed by Google Drive API v3 + Cloudflare Edge Cache.
 * Serves original images stored in Google Drive at /api/media/drive/<fileId>
 * without exposing OAuth tokens or hitting Drive hotlink blocks in Zalo/Safari WebViews.
 */

import { fetchDriveImage, isDriveConfigured, isSafeDriveFileId } from "../../../_lib/drive.js";
import { checkMediaAssetAccess } from "../../../_lib/media-access.js";

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
  const rangeHeader = request.headers.get("Range") || "";
  const isRanged = Boolean(rangeHeader);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache && !isDownload && !access.restricted && !isRanged) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }

  const kindHint = String(reqUrl.searchParams.get("kind") || "").toLowerCase();
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
    !isDownload &&
    !access.restricted &&
    !isRanged &&
    !isVideo &&
    !isAudio &&
    fetched.status === 200 &&
    typeof context.waitUntil === "function"
  ) {
    context.waitUntil(cache.put(request, response.clone()));
  }
  return response;
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
