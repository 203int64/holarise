import {
  isDriveConfigured,
  normalizeDriveCategory,
  uploadImageToDrive,
} from "../../_lib/drive.js";
import { errorResponse, jsonResponse, requireAdmin, sniffImageMime } from "../../_lib/security.js";

const MAX_KV_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB fallback when using MEDIA_KV
const MAX_DRIVE_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB original uncompressed image on Google Drive
const ALLOWED_ROLES = ["super_admin", "editor", "media"];

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { allowedRoles: ALLOWED_ROLES });
  if (!auth.ok) return auth.response;

  const driveConfigured = isDriveConfigured(context.env);
  return jsonResponse({
    ok: true,
    storage: driveConfigured ? "google_drive" : "media_kv",
    driveConfigured,
    maxUploadBytes: driveConfigured ? MAX_DRIVE_UPLOAD_BYTES : MAX_KV_UPLOAD_BYTES,
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: ALLOWED_ROLES });
  if (!auth.ok) return auth.response;

  const useDrive = isDriveConfigured(context.env);
  if (!useDrive && !context.env?.MEDIA_KV) {
    return errorResponse(
      503,
      "STORAGE_UNAVAILABLE",
      "Chưa cấu hình Google Drive API hoặc kho lưu ảnh MEDIA_KV."
    );
  }

  const maxBytes = useDrive ? MAX_DRIVE_UPLOAD_BYTES : MAX_KV_UPLOAD_BYTES;
  const maxLabel = useDrive ? "25 MB" : "1.5 MB";
  const contentType = context.request.headers.get("Content-Type") || "";
  let bytes;
  let originalFilename = "";
  let category = "khac";
  let subfolder = "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await context.request.formData();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(400, "MISSING_FILE", "Không tìm thấy tệp ảnh trong yêu cầu tải lên.");
      }
      if (file.size > maxBytes) {
        return errorResponse(
          413,
          "FILE_TOO_LARGE",
          `Ảnh vượt quá giới hạn ${maxLabel}.`
        );
      }
      originalFilename = String(file.name || "");
      category = normalizeDriveCategory(formData.get("category"));
      subfolder = String(formData.get("subfolder") || "").trim().slice(0, 80);
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const buf = await context.request.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return errorResponse(413, "FILE_TOO_LARGE", `Ảnh vượt quá giới hạn ${maxLabel}.`);
      }
      bytes = new Uint8Array(buf);
    }
  } catch {
    return errorResponse(400, "INVALID_UPLOAD", "Không thể đọc dữ liệu tệp ảnh gửi lên.");
  }

  if (!bytes || bytes.byteLength === 0) {
    return errorResponse(400, "EMPTY_FILE", "Tệp ảnh rỗng.");
  }
  if (bytes.byteLength > maxBytes) {
    return errorResponse(413, "FILE_TOO_LARGE", `Ảnh vượt quá giới hạn ${maxLabel}.`);
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
  const fallbackName = `holarise-${stamp}-${crypto.randomUUID().slice(0, 8)}.${detected.ext}`;

  if (useDrive) {
    try {
      const uploaded = await uploadImageToDrive(context.env, {
        bytes,
        mimeType: detected.mime,
        filename: originalFilename || fallbackName,
        category,
        subfolder,
      });
      return jsonResponse({ ok: true, ...uploaded }, 201);
    } catch (err) {
      return errorResponse(
        502,
        "DRIVE_UPLOAD_FAILED",
        err?.message || "Không thể tải ảnh gốc lên Google Drive."
      );
    }
  }

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
      storage: "media_kv",
    },
    201
  );
}
