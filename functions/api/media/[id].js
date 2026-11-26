/**
 * Public immutable image endpoint backed by Cloudflare KV + Edge Cache.
 * Serves uploaded CMS photos at /api/media/<id> (JPEG/PNG/WebP).
 */

import { checkMediaAssetAccess } from "../../_lib/media-access.js";

const SAFE_ID_RE = /^[a-zA-Z0-9._-]{6,96}$/;

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = String(params?.id || "");
  if (!SAFE_ID_RE.test(id)) {
    return new Response("Not Found", { status: 404 });
  }
  if (!env?.MEDIA_KV) {
    return new Response("Media store unavailable", { status: 503 });
  }

  const access = await checkMediaAssetAccess(env, request, { kvMediaKey: id });
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

  const rangeHeader = request.headers.get("Range") || "";
  const isRanged = Boolean(rangeHeader);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache && !access.restricted && !isRanged) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }

  const { value, metadata } = await env.MEDIA_KV.getWithMetadata(`media:${id}`, {
    type: "arrayBuffer",
  });
  if (!value) {
    return new Response("Not Found", { status: 404 });
  }

  const totalLength = value.byteLength;
  const contentType = metadata?.contentType || "image/jpeg";
  const baseHeaders = {
    "Content-Type": contentType,
    "Cache-Control": access.restricted ? "private, no-store" : "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  if (access.restricted) {
    baseHeaders.Vary = "Cookie";
  }

  if (isRanged) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!m || (!m[1] && !m[2])) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${totalLength}` },
      });
    }
    let start;
    let end;
    if (m[1] === "") {
      const suffixLen = Number.parseInt(m[2], 10);
      if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${totalLength}` },
        });
      }
      start = Math.max(0, totalLength - suffixLen);
      end = totalLength - 1;
    } else {
      start = Number.parseInt(m[1], 10);
      end = m[2] === "" ? totalLength - 1 : Math.min(totalLength - 1, Number.parseInt(m[2], 10));
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalLength || start > end) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${totalLength}` },
      });
    }
    const slice = value.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${totalLength}`,
        "Content-Length": String(slice.byteLength),
      },
    });
  }

  const response = new Response(value, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(totalLength),
    },
  });

  if (
    cache &&
    !access.restricted &&
    !contentType.startsWith("audio/") &&
    !contentType.startsWith("video/") &&
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
