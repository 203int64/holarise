import { errorResponse, jsonResponse, requireAdmin, sniffImageMime } from "../../_lib/security.js";

const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB (client auto-compresses JPEG to ~150 KB)

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: ["super_admin", "editor", "media"] });
  if (!auth.ok) return auth.response;

  if (!context.env?.MEDIA_KV) {
    return errorResponse(503, "KV_UNAVAILABLE", "Kho lưu ảnh MEDIA_KV chưa được kết nối.");
  }

  const contentType = context.request.headers.get("Content-Type") || "";
  let bytes;

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await context.request.formData();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(400, "MISSING_FILE", "Không tìm thấy tệp ảnh trong yêu cầu tải lên.");
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Ảnh vượt quá 1.5 MB. Hệ thống hỗ trợ ảnh đã nén tối đa 1.5 MB.");
      }
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const buf = await context.request.arrayBuffer();
      if (buf.byteLength > MAX_UPLOAD_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Ảnh vượt quá 1.5 MB.");
      }
      bytes = new Uint8Array(buf);
    }
  } catch {
    return errorResponse(400, "INVALID_UPLOAD", "Không thể đọc dữ liệu tệp ảnh gửi lên.");
  }

  if (!bytes || bytes.byteLength === 0) {
    return errorResponse(400, "EMPTY_FILE", "Tệp ảnh rỗng.");
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return errorResponse(413, "FILE_TOO_LARGE", "Ảnh vượt quá giới hạn 1.5 MB.");
  }

  const detected = sniffImageMime(bytes);
  if (!detected) {
    return errorResponse(
      415,
      "UNSUPPORTED_IMAGE",
      "Chỉ hỗ trợ định dạng ảnh JPEG, PNG hoặc WebP hợp lệ."
    );
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const id = `img-${stamp}-${crypto.randomUUID().slice(0, 10)}.${detected.ext}`;

  await context.env.MEDIA_KV.put(`media:${id}`, bytes.buffer, {
    metadata: {
      contentType: detected.mime,
      size: bytes.byteLength,
      uploadedBy: auth.user.email,
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
