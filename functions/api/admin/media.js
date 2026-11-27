import { getAdminUserProfile } from "../../_lib/admin-passkey-schema.js";
import {
  isDriveConfigured,
  normalizeDriveCategory,
  uploadImageToDrive,
} from "../../_lib/drive.js";
import { errorResponse, jsonResponse, requireAdmin, sniffImageMime, sniffMediaMime } from "../../_lib/security.js";

const MAX_KV_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB image fallback when using MEDIA_KV
const MAX_KV_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB soundtrack audio on MEDIA_KV
const MAX_DRIVE_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB original uncompressed image on Google Drive
const MAX_DRIVE_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB event soundtrack on Google Drive
const MAX_DRIVE_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB video clip on Google Drive
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

  const maxBytes = useDrive ? MAX_DRIVE_VIDEO_BYTES : MAX_KV_AUDIO_BYTES;
  const maxLabel = useDrive ? "50 MB" : "8 MB";
  const contentType = context.request.headers.get("Content-Type") || "";
  let bytes;
  let webBytes = null;
  let preferWebUrl = false;
  let originalFilename = "";
  let category = "khac";
  let subfolder = "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await context.request.formData();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(400, "MISSING_FILE", "Không tìm thấy tệp trong yêu cầu tải lên.");
      }
      if (file.size > maxBytes) {
        return errorResponse(
          413,
          "FILE_TOO_LARGE",
          `Tệp vượt quá giới hạn ${maxLabel}.`
        );
      }
      originalFilename = String(file.name || "");
      category = normalizeDriveCategory(formData.get("category"));
      subfolder = String(formData.get("subfolder") || "").trim().slice(0, 120);
      preferWebUrl = String(formData.get("preferWebUrl") || "").trim() === "1";
      bytes = new Uint8Array(await file.arrayBuffer());

      const rawWebFile = formData.get("webFile");
      if (
        rawWebFile &&
        typeof rawWebFile.arrayBuffer === "function" &&
        rawWebFile.size > 0 &&
        rawWebFile.size <= MAX_KV_UPLOAD_BYTES
      ) {
        webBytes = new Uint8Array(await rawWebFile.arrayBuffer());
      }
    } else {
      const buf = await context.request.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return errorResponse(413, "FILE_TOO_LARGE", `Tệp vượt quá giới hạn ${maxLabel}.`);
      }
      bytes = new Uint8Array(buf);
    }
  } catch {
    return errorResponse(400, "INVALID_UPLOAD", "Không thể đọc dữ liệu tệp gửi lên.");
  }

  if (!bytes || bytes.byteLength === 0) {
    return errorResponse(400, "EMPTY_FILE", "Tệp gửi lên rỗng.");
  }
  if (bytes.byteLength > maxBytes) {
    return errorResponse(413, "FILE_TOO_LARGE", `Tệp vượt quá giới hạn ${maxLabel}.`);
  }

  const detected = sniffMediaMime(bytes);
  if (!detected) {
    return errorResponse(
      415,
      "UNSUPPORTED_IMAGE",
      "Chỉ hỗ trợ định dạng ảnh (JPEG, PNG, WebP), nhạc (MP3, M4A, OGG, WAV) hoặc video (MP4, MOV, WebM) hợp lệ."
    );
  }
  const isVideo = detected.kind === "video";
  const isAudio = detected.kind === "audio";
  if (isAudio) {
    const audioLimit = useDrive ? MAX_DRIVE_AUDIO_BYTES : MAX_KV_AUDIO_BYTES;
    if (bytes.byteLength > audioLimit) {
      return errorResponse(413, "FILE_TOO_LARGE", `Tệp nhạc vượt quá giới hạn ${useDrive ? "15 MB" : "8 MB"}.`);
    }
  } else if (isVideo) {
    if (!useDrive && bytes.byteLength > MAX_KV_UPLOAD_BYTES) {
      return errorResponse(413, "FILE_TOO_LARGE", "Video vượt quá giới hạn 1.5 MB (hãy cấu hình Google Drive).");
    }
  } else {
    const imgLimit = useDrive ? MAX_DRIVE_UPLOAD_BYTES : MAX_KV_UPLOAD_BYTES;
    if (bytes.byteLength > imgLimit) {
      return errorResponse(413, "FILE_TOO_LARGE", `Ảnh vượt quá giới hạn ${useDrive ? "25 MB" : "1.5 MB"}.`);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fallbackName = `holarise-${stamp}-${crypto.randomUUID().slice(0, 8)}.${detected.ext}`;
  const uploaderProfile = context.env?.DB
    ? await getAdminUserProfile(context.env.DB, auth.user.id).catch(() => null)
    : null;
  const uploaderLabel = uploaderProfile
    ? `${uploaderProfile.name}${uploaderProfile.department ? ` (${uploaderProfile.department})` : ""} · ${uploaderProfile.phone || uploaderProfile.email}`
    : `${auth.user.name || auth.user.email} (${auth.user.role})`;

  if (useDrive) {
    try {
      const uploaded = await uploadImageToDrive(context.env, {
        bytes,
        mimeType: detected.mime,
        filename: originalFilename || fallbackName,
        category,
        subfolder,
        description: `Người đăng: ${uploaderLabel} · Email: ${auth.user.email} · Tải lên lúc: ${new Date().toISOString()}`,
      });
      let webUrl = "";
      let webMediaKey = "";
      if (
        !isVideo &&
        !isAudio &&
        context.env?.MEDIA_KV &&
        webBytes &&
        webBytes.byteLength > 0 &&
        webBytes.byteLength <= MAX_KV_UPLOAD_BYTES
      ) {
        const webDetected = sniffImageMime(webBytes);
        if (webDetected) {
          const kvWebId = `web-${stamp}-${crypto.randomUUID().slice(0, 10)}.${webDetected.ext}`;
          try {
            await context.env.MEDIA_KV.put(`media:${kvWebId}`, webBytes.buffer, {
              metadata: {
                contentType: webDetected.mime,
                size: webBytes.byteLength,
                mediaType: "image",
                sourceDriveId: uploaded.driveId,
                uploadedBy: auth.user.email,
                uploadedAt: new Date().toISOString(),
              },
            });
            webMediaKey = kvWebId;
            webUrl = `/api/media/${kvWebId}`;
          } catch {
            // Non-fatal: Drive thumbnail proxy remains available
          }
        }
      }

      const driveMediaUrl = isVideo
        ? `${uploaded.url}?kind=video`
        : isAudio
          ? `${uploaded.url}?kind=audio`
          : uploaded.url;
      const finalUrl = preferWebUrl && webUrl ? webUrl : driveMediaUrl;
      return jsonResponse(
        {
          ok: true,
          ...uploaded,
          url: finalUrl,
          originalUrl: driveMediaUrl,
          webUrl,
          webMediaKey,
          mediaType: detected.kind,
          uploadedBy: uploaderLabel,
        },
        201
      );
    } catch (err) {
      return errorResponse(
        502,
        "DRIVE_UPLOAD_FAILED",
        err?.message || "Không thể tải tệp lên Google Drive."
      );
    }
  }

  const prefix = isAudio ? "aud" : isVideo ? "vid" : "img";
  const id = `${prefix}-${stamp}-${crypto.randomUUID().slice(0, 10)}.${detected.ext}`;
  await context.env.MEDIA_KV.put(`media:${id}`, bytes.buffer, {
    metadata: {
      contentType: detected.mime,
      size: bytes.byteLength,
      mediaType: detected.kind,
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
      mediaType: detected.kind,
      size: bytes.byteLength,
      storage: "media_kv",
    },
    201
  );
}
