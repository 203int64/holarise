/**
 * Public immutable image proxy backed by Google Drive API v3 + Cloudflare Edge Cache.
 * Serves original images stored in Google Drive at /api/media/drive/<fileId>
 * without exposing OAuth tokens or hitting Drive hotlink blocks in Zalo/Safari WebViews.
 */

import { fetchDriveImage, isDriveConfigured, isSafeDriveFileId } from "../../../_lib/drive.js";

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = String(params?.id || "");
  if (!isSafeDriveFileId(id)) {
    return new Response("Not Found", { status: 404 });
  }
  if (!isDriveConfigured(env)) {
    return new Response("Google Drive storage unavailable", { status: 503 });
  }

  const reqUrl = new URL(request.url);
  const isDownload = reqUrl.searchParams.get("download") === "1";

  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache && !isDownload) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }

  let fetched;
  try {
    fetched = await fetchDriveImage(env, id);
  } catch {
    return new Response("Unable to reach Google Drive", { status: 502 });
  }

  if (!fetched.ok) {
    return new Response(fetched.status === 404 ? "Not Found" : "Invalid Media", {
      status: fetched.status,
    });
  }

  const headers = {
    "Content-Type": fetched.contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (fetched.contentLength) {
    headers["Content-Length"] = fetched.contentLength;
  }
  if (isDownload) {
    const ext = fetched.contentType.includes("png")
      ? "png"
      : fetched.contentType.includes("webp")
        ? "webp"
        : "jpg";
    headers["Content-Disposition"] = `attachment; filename="holarise-${id.slice(0, 12)}.${ext}"`;
  }

  const response = new Response(fetched.body, { status: 200, headers });

  if (cache && !isDownload && typeof context.waitUntil === "function") {
    context.waitUntil(cache.put(request, response.clone()));
  }
  return response;
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
