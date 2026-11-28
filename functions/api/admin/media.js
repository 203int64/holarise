import { getAdminUserProfile } from "../../_lib/admin-passkey-schema.js";
import {
  createDriveResumableSession,
  getDriveFileMetadata,
  isDriveConfigured,
  isSafeDriveFileId,
  normalizeDriveCategory,
  uploadImageToDrive,
} from "../../_lib/drive.js";
import { resolveActorContext } from "../../_lib/media-access.js";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  sniffImageMime,
  sniffMediaMime,
  verifyCsrfOrigin,
} from "../../_lib/security.js";

const MAX_KV_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB image fallback when using MEDIA_KV
const MAX_KV_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB soundtrack audio on MEDIA_KV
const MAX_DRIVE_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB proxy upload image on Google Drive
const MAX_DRIVE_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB proxy upload soundtrack on Google Drive
const MAX_DRIVE_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB proxy upload video on Google Drive
const MAX_RESUMABLE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB direct browser->Drive resumable upload
const ALLOWED_ROLES = ["super_admin", "editor", "media"];

const ALLOWED_RESUMABLE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/3gpp",
  "video/mpeg",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
]);

async function resolveMediaUploader(context, { requireCsrf = false } = {}) {
  const auth = await requireAdmin(context, { allowedRoles: ALLOWED_ROLES });
  if (auth.ok) {
    const profile = context.env?.DB
      ? await getAdminUserProfile(context.env.DB, auth.user.id).catch(() => null)
      : null;
    const label = profile
      ? `${profile.name}${profile.department ? ` (${profile.department})` : ""} · ${profile.phone || profile.email}`
      : `${auth.user.name || auth.user.email} (${auth.user.role})`;
    return {
      ok: true,
      isNgv: false,
      user: auth.user,
      email: auth.user.email || "",
      label,
    };
  }

  if (requireCsrf && !verifyCsrfOrigin(context.request)) {
    return { ok: false, response: errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.") };
  }

  const actor = await resolveActorContext(context.env, context.request);
  if (actor.isMediaContributor && actor.member) {
    const m = actor.member;
    const contact = m.email || m.phone_display || m.member_code || m.id;
    return {
      ok: true,
      isNgv: true,
      member: m,
      email: contact,
      label: `${m.name || "Thành viên NGV"} (NGV · ${m.member_code || m.id}) · ${m.phone_display || m.email || ""}`,
    };
  }

  return { ok: false, response: auth.response };
}

function classifyMimeKind(mimeType = "", filename = "") {
  const m = String(mimeType || "").toLowerCase();
  const f = String(filename || "").toLowerCase();
  if (m.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|mpeg|mpg)$/.test(f)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|m4a|ogg|wav)$/.test(f)) return "audio";
  return "image";
}

function decodeWebThumbDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  try {
    const bin = atob(match[2]);
    if (bin.length === 0 || bin.length > MAX_KV_UPLOAD_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const uploader = await resolveMediaUploader(context, { requireCsrf: false });
  if (!uploader.ok) return uploader.response;

  const driveConfigured = isDriveConfigured(context.env);
  return jsonResponse({
    ok: true,
    storage: driveConfigured ? "google_drive" : "media_kv",
    driveConfigured,
    resumableSupported: driveConfigured,
    maxUploadBytes: driveConfigured ? MAX_DRIVE_UPLOAD_BYTES : MAX_KV_UPLOAD_BYTES,
    maxProxyVideoBytes: driveConfigured ? MAX_DRIVE_VIDEO_BYTES : MAX_KV_UPLOAD_BYTES,
    maxResumableBytes: driveConfigured ? MAX_RESUMABLE_BYTES : 0,
  });
}

export async function onRequestPost(context) {
  const uploader = await resolveMediaUploader(context, { requireCsrf: true });
  if (!uploader.ok) return uploader.response;

  const useDrive = isDriveConfigured(context.env);
  if (!useDrive && !context.env?.MEDIA_KV) {
    return errorResponse(
      503,
      "STORAGE_UNAVAILABLE",
      "Chưa cấu hình Google Drive API hoặc kho lưu ảnh MEDIA_KV."
    );
  }

  const contentType = context.request.headers.get("Content-Type") || "";

  // Direct Browser -> Google Drive Resumable Upload Control Actions (JSON)
  if (contentType.includes("application/json")) {
    const parsed = await readJsonBody(context.request, 2.5 * 1024 * 1024);
    if (!parsed.ok) return parsed.response;
    const action = String(parsed.data?.action || "").trim().toLowerCase();

    if (action === "init-resumable") {
      if (!useDrive) {
        return errorResponse(
          503,
          "DRIVE_NOT_CONFIGURED",
          "Google Drive chưa được cấu hình để tải tệp dung lượng lớn trực tiếp."
        );
      }
      const filename = String(parsed.data.filename || "").trim().slice(0, 180) || "media-upload";
      let mimeType = String(parsed.data.mimeType || "").trim().toLowerCase();
      if (mimeType === "image/jpg") mimeType = "image/jpeg";
      if (!mimeType) {
        const kind = classifyMimeKind("", filename);
        mimeType = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/jpeg";
      }
      if (!ALLOWED_RESUMABLE_MIMES.has(mimeType)) {
        return errorResponse(
          415,
          "UNSUPPORTED_MEDIA",
          "Định dạng tệp chưa được hỗ trợ (chấp nhận ảnh JPEG/PNG/WebP/HEIC và video MP4/MOV/WebM)."
        );
      }
      const fileSize = Number(parsed.data.fileSize || 0);
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        return errorResponse(400, "INVALID_SIZE", "Kích thước tệp không hợp lệ.");
      }
      if (fileSize > MAX_RESUMABLE_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Tệp vượt quá giới hạn tối đa 5 GB mỗi tệp.");
      }
      const category = normalizeDriveCategory(parsed.data.category || "album");
      const subfolder = String(parsed.data.subfolder || "").trim().slice(0, 120);
      const reqOrigin =
        context.request.headers.get("Origin") || new URL(context.request.url).origin;
      try {
        const session = await createDriveResumableSession(context.env, {
          filename,
          mimeType,
          fileSize,
          category,
          subfolder,
          origin: reqOrigin,
          description: `Người đăng: ${uploader.label} · Liên hệ: ${uploader.email} · Tải lên lúc: ${new Date().toISOString()}`,
        });
        return jsonResponse(
          {
            ok: true,
            ...session,
            mediaType: classifyMimeKind(mimeType, filename),
          },
          201
        );
      } catch (err) {
        return errorResponse(
          502,
          "DRIVE_RESUMABLE_INIT_FAILED",
          err?.message || "Không thể khởi tạo phiên tải trực tiếp lên Google Drive."
        );
      }
    }

    if (action === "finalize-resumable") {
      if (!useDrive) {
        return errorResponse(503, "DRIVE_NOT_CONFIGURED", "Google Drive chưa được cấu hình.");
      }
      const driveId = String(parsed.data.driveId || "").trim();
      if (!isSafeDriveFileId(driveId)) {
        return errorResponse(400, "INVALID_DRIVE_ID", "Mã tệp Google Drive không hợp lệ.");
      }
      try {
        const meta = await getDriveFileMetadata(context.env, driveId);
        const kind = classifyMimeKind(
          parsed.data.mimeType || meta.contentType,
          parsed.data.filename || meta.filename
        );
        const isVideo = kind === "video";
        const isAudio = kind === "audio";

        let webUrl = "";
        let webMediaKey = "";
        if (!isVideo && !isAudio && context.env?.MEDIA_KV && parsed.data.webThumbDataUrl) {
          const thumbBytes = decodeWebThumbDataUrl(parsed.data.webThumbDataUrl);
          if (thumbBytes) {
            const webDetected = sniffImageMime(thumbBytes);
            if (webDetected) {
              const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
              const kvWebId = `web-${stamp}-${crypto.randomUUID().slice(0, 10)}.${webDetected.ext}`;
              try {
                await context.env.MEDIA_KV.put(`media:${kvWebId}`, thumbBytes.buffer, {
                  metadata: {
                    contentType: webDetected.mime,
                    size: thumbBytes.byteLength,
                    mediaType: "image",
                    sourceDriveId: meta.driveId,
                    uploadedBy: uploader.email,
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
        }

        const driveMediaUrl = isVideo
          ? `${meta.url}?kind=video`
          : isAudio
            ? `${meta.url}?kind=audio`
            : meta.url;

        return jsonResponse(
          {
            ok: true,
            ...meta,
            url: driveMediaUrl,
            originalUrl: driveMediaUrl,
            webUrl,
            webMediaKey,
            mediaType: kind,
            uploadedBy: uploader.label,
          },
          201
        );
      } catch (err) {
        return errorResponse(
          502,
          "DRIVE_VERIFY_FAILED",
          err?.message || "Không thể xác nhận tệp vừa tải lên Google Drive."
        );
      }
    }

    return errorResponse(400, "UNKNOWN_ACTION", "Thao tác tải lên không hợp lệ.");
  }

  // Standard Multipart / Binary Proxy Upload (for small images/videos & MEDIA_KV fallback)
  const maxBytes = useDrive ? MAX_DRIVE_VIDEO_BYTES : MAX_KV_AUDIO_BYTES;
  const maxLabel = useDrive ? "50 MB" : "8 MB";
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
        return errorResponse(413, "FILE_TOO_LARGE", `Tệp vượt quá giới hạn ${maxLabel}.`);
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

  if (useDrive) {
    try {
      const uploaded = await uploadImageToDrive(context.env, {
        bytes,
        mimeType: detected.mime,
        filename: originalFilename || fallbackName,
        category,
        subfolder,
        description: `Người đăng: ${uploader.label} · Liên hệ: ${uploader.email} · Tải lên lúc: ${new Date().toISOString()}`,
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
                uploadedBy: uploader.email,
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
          uploadedBy: uploader.label,
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
      uploadedBy: uploader.email,
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
