import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  getSessionMember,
  jsonResponse,
  sniffImageMime,
  verifyCsrfOrigin,
} from "../../_lib/security.js";

const MAX_REFLECTION_UPLOAD_BYTES = 1.2 * 1024 * 1024; // 1.2 MB (client pre-compresses photo <= 1280px)

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn tải ảnh không hợp lệ.");
  }
  if (!env?.MEDIA_KV) {
    return errorResponse(503, "KV_UNAVAILABLE", "Kho lưu ảnh chưa sẵn sàng.");
  }

  const sessionMember = env?.DB ? await getSessionMember(env.DB, request).catch(() => null) : null;
  if (env?.DB) {
    const rateKey = sessionMember
      ? `ref_media_mbr:${sessionMember.id}`
      : `ref_media_ip:${await getClientIpHash(request)}`;
    const maxHits = sessionMember ? 12 : 8;
    const rl = await checkRateLimit(env.DB, rateKey, maxHits, 15 * 60 * 1000);
    if (!rl.allowed) {
      return errorResponse(
        429,
        "RATE_LIMITED",
        "Bạn đã tải nhiều ảnh liên tiếp. Vui lòng thử lại sau ít phút.",
        null,
        { "Retry-After": String(rl.retryAfterSec) }
      );
    }
  }

  const contentType = request.headers.get("Content-Type") || "";
  let bytes;

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(400, "MISSING_FILE", "Không tìm thấy tệp ảnh tải lên.");
      }
      if (file.size > MAX_REFLECTION_UPLOAD_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Ảnh vượt quá giới hạn 1.2 MB.");
      }
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_REFLECTION_UPLOAD_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Ảnh vượt quá giới hạn 1.2 MB.");
      }
      bytes = new Uint8Array(buf);
    }
  } catch {
    return errorResponse(400, "INVALID_UPLOAD", "Không thể đọc dữ liệu ảnh gửi lên.");
  }

  if (!bytes || bytes.byteLength === 0) {
    return errorResponse(400, "EMPTY_FILE", "Tệp ảnh rỗng.");
  }
  if (bytes.byteLength > MAX_REFLECTION_UPLOAD_BYTES) {
    return errorResponse(413, "FILE_TOO_LARGE", "Ảnh vượt quá giới hạn 1.2 MB.");
  }

  const detected = sniffImageMime(bytes);
  if (!detected) {
    return errorResponse(415, "UNSUPPORTED_IMAGE", "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP hợp lệ.");
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const id = `ref-${stamp}-${crypto.randomUUID().slice(0, 10)}.${detected.ext}`;

  await env.MEDIA_KV.put(`media:${id}`, bytes.buffer, {
    metadata: {
      contentType: detected.mime,
      size: bytes.byteLength,
      scope: "reflection",
      uploadedByMember: sessionMember ? sessionMember.id : "",
      uploadedAt: new Date().toISOString(),
    },
  });

  return jsonResponse(
    {
      ok: true,
      id,
      url: `/api/media/${id}`,
      contentType: detected.mime,
      size: bytes.byteLength,
    },
    201
  );
}
