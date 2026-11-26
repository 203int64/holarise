import { isDriveConfigured, uploadImageToDrive } from "../../_lib/drive.js";
import {
  checkRateLimit,
  errorResponse,
  jsonResponse,
  requireMember,
  sniffMediaMime,
} from "../../_lib/security.js";

const MAX_REFLECTION_IMAGE_BYTES = 1.2 * 1024 * 1024; // 1.2 MB compressed image on MEDIA_KV
const MAX_REFLECTION_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB short video on Google Drive
const MAX_REFLECTION_KV_VIDEO_BYTES = 10 * 1024 * 1024; // 10 MB fallback when Drive unconfigured

export async function onRequestPost(context) {
  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  const useDrive = isDriveConfigured(env);
  if (!useDrive && !env?.MEDIA_KV) {
    return errorResponse(503, "KV_UNAVAILABLE", "Kho lưu ảnh/video chưa sẵn sàng.");
  }

  const rl = await checkRateLimit(env.DB, `ref_media_mbr:${auth.member.id}`, 21, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Bạn đã tải nhiều tệp liên tiếp. Vui lòng thử lại sau ít phút.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const contentType = request.headers.get("Content-Type") || "";
  let bytes;
  let originalFilename = "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(400, "MISSING_FILE", "Không tìm thấy tệp ảnh hoặc video tải lên.");
      }
      if (file.size > MAX_REFLECTION_VIDEO_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Tệp vượt quá giới hạn tối đa 25 MB.");
      }
      originalFilename = String(file.name || "");
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_REFLECTION_VIDEO_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Tệp vượt quá giới hạn tối đa 25 MB.");
      }
      bytes = new Uint8Array(buf);
    }
  } catch {
    return errorResponse(400, "INVALID_UPLOAD", "Không thể đọc dữ liệu tệp gửi lên.");
  }

  if (!bytes || bytes.byteLength === 0) {
    return errorResponse(400, "EMPTY_FILE", "Tệp tải lên rỗng.");
  }

  const detected = sniffMediaMime(bytes);
  if (!detected) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA",
      "Chỉ hỗ trợ ảnh (JPEG, PNG, WebP) hoặc video ngắn (MP4, MOV, WebM)."
    );
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (detected.kind === "video") {
    const maxVideo = useDrive ? MAX_REFLECTION_VIDEO_BYTES : MAX_REFLECTION_KV_VIDEO_BYTES;
    if (bytes.byteLength > maxVideo) {
      return errorResponse(
        413,
        "FILE_TOO_LARGE",
        `Video hương khí vượt quá giới hạn ${Math.round(maxVideo / (1024 * 1024))} MB.`
      );
    }
    const memberCode = auth.member.member_code || auth.member.id.slice(0, 8);
    if (useDrive) {
      try {
        const uploaded = await uploadImageToDrive(env, {
          bytes,
          mimeType: detected.mime,
          filename: originalFilename || `huong-khi-${stamp}-${memberCode}-${crypto.randomUUID().slice(0, 6)}.${detected.ext}`,
          category: "album",
          subfolder: ["huong-khi", stamp],
          description: `Video hương khí: ${auth.member.name} (${memberCode}) · Lúc: ${new Date().toISOString()}`,
        });
        return jsonResponse(
          {
            ok: true,
            id: uploaded.id,
            url: `${uploaded.url}?kind=video`,
            mediaType: "video",
            contentType: detected.mime,
            size: bytes.byteLength,
          },
          201
        );
      } catch (err) {
        return errorResponse(502, "DRIVE_UPLOAD_FAILED", err?.message || "Chưa thể lưu video lên Google Drive.");
      }
    }
    const vidId = `ref-vid-${stamp}-${crypto.randomUUID().slice(0, 10)}.${detected.ext}`;
    await env.MEDIA_KV.put(`media:${vidId}`, bytes.buffer, {
      metadata: {
        contentType: detected.mime,
        size: bytes.byteLength,
        scope: "reflection",
        mediaType: "video",
        uploadedByMember: auth.member.id,
        uploadedAt: new Date().toISOString(),
      },
    });
    return jsonResponse(
      {
        ok: true,
        id: vidId,
        url: `/api/media/${vidId}`,
        mediaType: "video",
        contentType: detected.mime,
        size: bytes.byteLength,
      },
      201
    );
  }

  // Image branch (<= 1.2 MB on MEDIA_KV)
  if (bytes.byteLength > MAX_REFLECTION_IMAGE_BYTES) {
    return errorResponse(413, "FILE_TOO_LARGE", "Ảnh vượt quá giới hạn 1.2 MB.");
  }
  if (!env?.MEDIA_KV) {
    return errorResponse(503, "KV_UNAVAILABLE", "Kho lưu ảnh chưa sẵn sàng.");
  }

  const id = `ref-${stamp}-${crypto.randomUUID().slice(0, 10)}.${detected.ext}`;

  await env.MEDIA_KV.put(`media:${id}`, bytes.buffer, {
    metadata: {
      contentType: detected.mime,
      size: bytes.byteLength,
      scope: "reflection",
      mediaType: "image",
      uploadedByMember: auth.member.id,
      uploadedAt: new Date().toISOString(),
    },
  });

  return jsonResponse(
    {
      ok: true,
      id,
      url: `/api/media/${id}`,
      mediaType: "image",
      contentType: detected.mime,
      size: bytes.byteLength,
    },
    201
  );
}
