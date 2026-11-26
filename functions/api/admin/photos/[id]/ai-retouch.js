/**
 * POST /api/admin/photos/[id]/ai-retouch
 * 1-click Authentic AI Photo Retouch Studio for /media/ & /admin/:
 * - action: "generate" -> generates 3 documentary film-style retouched variants in parallel via Gemini API
 * - action: "apply"    -> validates chosen variant bytes, stores in MEDIA_KV, updates web_url while preserving original Drive photo
 */

import {
  DEFAULT_GEMINI_IMAGE_MODEL,
  bytesToBase64,
  decodeDataUrl,
  generateThreeRetouchVariants,
  normalizeAspectRatio,
  normalizeImageSize,
} from "../../../../_lib/ai-retouch.js";
import {
  buildEventFolderName,
  extractDriveFolderId,
  fetchDriveImage,
  isDriveConfigured,
  uploadImageToDrive,
} from "../../../../_lib/drive.js";
import { ensureMediaApprovalSchema } from "../../../../_lib/media-approval-schema.js";
import {
  checkRateLimit,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  sniffImageMime,
} from "../../../../_lib/security.js";
import { serializePhotoRow } from "../../albums/[id]/index.js";

const ALLOWED_ROLES = ["super_admin", "editor", "media"];
const MAX_SOURCE_BYTES = 3 * 1024 * 1024; // 3 MB max for AI retouch input
const MAX_APPLY_BYTES = 2.5 * 1024 * 1024; // 2.5 MB max for KV web display copy
const MAX_DRIVE_4K_BYTES = 18 * 1024 * 1024; // 18 MB max for optional 4K Drive export

async function loadPhotoBytesFromStorage(env, photo, fetchImpl = fetch) {
  // 1. Prefer existing KV web copy (fast, <= 1280px)
  const kvCandidate = photo.web_media_key || (photo.media_key && !photo.media_key.startsWith("drive:") ? photo.media_key : "");
  if (kvCandidate && env?.MEDIA_KV) {
    const { value } = await env.MEDIA_KV.getWithMetadata(`media:${kvCandidate}`, {
      type: "arrayBuffer",
    });
    if (value) {
      const bytes = new Uint8Array(value);
      const sniffed = sniffImageMime(bytes);
      if (sniffed) return { bytes, mime: sniffed.mime };
    }
  }
  // 2. Fallback to Google Drive original
  if (photo.media_key && photo.media_key.startsWith("drive:") && isDriveConfigured(env)) {
    const fileId = photo.media_key.slice(6);
    const fetched = await fetchDriveImage(env, fileId, fetchImpl);
    if (fetched.ok && fetched.body) {
      const buf = await new Response(fetched.body).arrayBuffer();
      const bytes = new Uint8Array(buf);
      const sniffed = sniffImageMime(bytes);
      if (sniffed) return { bytes, mime: sniffed.mime };
    }
  }
  return null;
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: ALLOWED_ROLES });
  if (!auth.ok) return auth.response;

  const { request, env, params } = context;
  const fetchImpl = context.fetchImpl || fetch;
  await ensureMediaApprovalSchema(env.DB);

  const id = String(params?.id || "").trim();
  if (!id) {
    return errorResponse(400, "MISSING_ID", "Thiếu mã ảnh.");
  }

  const existing = await env.DB.prepare("SELECT * FROM media_photos WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy ảnh trong kho.");
  }
  if (String(existing.media_type || "image").toLowerCase() === "video") {
    return errorResponse(400, "UNSUPPORTED_MEDIA_TYPE", "Chỉnh màu AI chỉ hỗ trợ ảnh tĩnh, không áp dụng cho video.");
  }

  const parsed = await readJsonBody(request, 24 * 1024 * 1024);
  if (!parsed.ok) return parsed.response;

  const action = String(parsed.data?.action || "generate").trim().toLowerCase();

  if (action === "generate") {
    const apiKey = String(env?.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return errorResponse(
        503,
        "GEMINI_NOT_CONFIGURED",
        "Chưa cấu hình khóa GEMINI_API_KEY trên Cloudflare Pages (chạy: npx wrangler pages secret put GEMINI_API_KEY)."
      );
    }

    const rl = await checkRateLimit(env.DB, `ai_retouch:${auth.user.id}`, 20, 15 * 60 * 1000);
    if (!rl.allowed) {
      return errorResponse(
        429,
        "RATE_LIMITED",
        `Bạn đã tạo nhiều lượt ảnh AI liên tiếp. Vui lòng chờ ${rl.retryAfterSec} giây.`,
        null,
        { "Retry-After": String(rl.retryAfterSec) }
      );
    }

    let sourceBytes = null;
    let sourceMime = "image/jpeg";

    if (typeof parsed.data?.imageDataUrl === "string" && parsed.data.imageDataUrl) {
      const decoded = decodeDataUrl(parsed.data.imageDataUrl);
      if (!decoded || decoded.bytes.byteLength === 0 || decoded.bytes.byteLength > MAX_SOURCE_BYTES) {
        return errorResponse(400, "INVALID_IMAGE", "Ảnh nguồn gửi lên không hợp lệ hoặc vượt quá 3 MB.");
      }
      const sniffed = sniffImageMime(decoded.bytes);
      if (!sniffed) {
        return errorResponse(415, "UNSUPPORTED_IMAGE", "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.");
      }
      sourceBytes = decoded.bytes;
      sourceMime = sniffed.mime;
    } else {
      const loaded = await loadPhotoBytesFromStorage(env, existing, fetchImpl);
      if (!loaded) {
        return errorResponse(404, "SOURCE_UNAVAILABLE", "Không đọc được dữ liệu ảnh gốc để xử lý AI.");
      }
      if (loaded.bytes.byteLength > MAX_SOURCE_BYTES) {
        return errorResponse(
          413,
          "SOURCE_TOO_LARGE",
          "Ảnh gốc vượt quá 3 MB — vui lòng gửi ảnh đã thu nhỏ từ trình duyệt."
        );
      }
      sourceBytes = loaded.bytes;
      sourceMime = loaded.mime;
    }

    const model = String(env?.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_IMAGE_MODEL).trim();
    const imageSize = normalizeImageSize(parsed.data?.imageSize || env?.GEMINI_IMAGE_SIZE);
    const aspectRatio = normalizeAspectRatio(parsed.data?.aspectRatio);
    const presetId = String(parsed.data?.presetId || "").trim().slice(0, 40);
    const { variants, errors } = await generateThreeRetouchVariants({
      apiKey,
      model,
      imageBase64: bytesToBase64(sourceBytes),
      mimeType: sourceMime,
      imageSize,
      aspectRatio,
      presetId,
      fetchImpl,
    });

    if (variants.length === 0) {
      return errorResponse(
        502,
        "AI_RETOUCH_FAILED",
        `Không thể tạo mẫu ảnh AI lúc này (${errors[0] || "lỗi kết nối Gemini"}).`
      );
    }

    return jsonResponse({
      ok: true,
      photoId: id,
      model,
      imageSize,
      aspectRatio,
      variants,
      partialErrors: errors.length > 0 ? errors : undefined,
    });
  }

  if (action === "apply") {
    if (!env?.MEDIA_KV) {
      return errorResponse(503, "KV_UNAVAILABLE", "Kho lưu ảnh MEDIA_KV chưa được kết nối.");
    }
    const decoded = decodeDataUrl(parsed.data?.imageDataUrl || "");
    if (!decoded || decoded.bytes.byteLength === 0) {
      return errorResponse(400, "MISSING_IMAGE", "Thiếu dữ liệu ảnh đã chọn để lưu thay thế.");
    }
    if (decoded.bytes.byteLength > MAX_APPLY_BYTES) {
      return errorResponse(413, "FILE_TOO_LARGE", "Ảnh đã chỉnh vượt quá giới hạn 2.5 MB.");
    }
    const sniffed = sniffImageMime(decoded.bytes);
    if (!sniffed) {
      return errorResponse(415, "UNSUPPORTED_IMAGE", "Dữ liệu ảnh không hợp lệ (chỉ nhận JPEG/PNG/WebP).");
    }

    const now = new Date().toISOString();
    const newKey = `ai-${crypto.randomUUID().slice(0, 12)}.${sniffed.ext}`;
    const newUrl = `/api/media/${newKey}`;
    const presetId = String(parsed.data?.presetId || "ai-retouch").slice(0, 40);

    await env.MEDIA_KV.put(`media:${newKey}`, decoded.bytes.buffer, {
      metadata: {
        contentType: sniffed.mime,
        size: decoded.bytes.byteLength,
        sourcePhotoId: id,
        aiPreset: presetId,
        appliedBy: auth.user.email,
        appliedAt: now,
      },
    });

    const prevWebKey = existing.web_media_key || "";
    const isDriveOriginal = String(existing.media_key || "").startsWith("drive:");
    const nextUrl = isDriveOriginal ? existing.url : newUrl;
    const nextMediaKey = isDriveOriginal ? existing.media_key : newKey;

    await env.DB.prepare(
      `UPDATE media_photos
       SET url = ?, media_key = ?, web_url = ?, web_media_key = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(nextUrl, nextMediaKey, newUrl, newKey, now, id)
      .run();

    // Keep album cover synced if this photo was the cover
    const album = await env.DB.prepare("SELECT id, cover_url FROM media_albums WHERE id = ?")
      .bind(existing.album_id)
      .first();
    if (
      album &&
      (album.cover_url === existing.url || (existing.web_url && album.cover_url === existing.web_url))
    ) {
      await env.DB.prepare("UPDATE media_albums SET cover_url = ?, updated_at = ? WHERE id = ?")
        .bind(newUrl, now, existing.album_id)
        .run();
    }

    // Clean up replaced KV keys (never touches Google Drive original!)
    const keysToDelete = new Set();
    if (prevWebKey && prevWebKey !== newKey) keysToDelete.add(prevWebKey);
    if (!isDriveOriginal && existing.media_key && existing.media_key !== newKey) {
      keysToDelete.add(existing.media_key);
    }
    for (const k of keysToDelete) {
      await env.MEDIA_KV.delete(`media:${k}`).catch(() => {});
    }

    // Optional: archive full-res 4K branded copy to Google Drive inside ai-4k/ subfolder
    let driveExportUrl = "";
    if (typeof parsed.data?.highResDataUrl === "string" && parsed.data.highResDataUrl && isDriveConfigured(env)) {
      const hiRes = decodeDataUrl(parsed.data.highResDataUrl);
      if (hiRes && hiRes.bytes.byteLength > 0 && hiRes.bytes.byteLength <= MAX_DRIVE_4K_BYTES) {
        const hiSniffed = sniffImageMime(hiRes.bytes);
        if (hiSniffed) {
          try {
            const albRow = await env.DB.prepare("SELECT id, slug, title, event_date, drive_url FROM media_albums WHERE id = ?")
              .bind(existing.album_id)
              .first();
            const parentFolderId = extractDriveFolderId(albRow?.drive_url || "");
            const eventFolderName = buildEventFolderName({
              eventDate: albRow?.event_date || "",
              title: albRow?.title || "",
              fallback: albRow?.slug || existing.album_id,
            });
            const uploaded4k = await uploadImageToDrive(env, {
              bytes: hiRes.bytes,
              mimeType: hiSniffed.mime,
              filename: `${id}_${presetId}_4K.${hiSniffed.ext}`,
              category: "album",
              parentFolderId,
              subfolder: parentFolderId ? ["ai-4k"] : [eventFolderName, "ai-4k"],
              description: `HolaRise AI Studio 4K (${presetId}) · Áp dụng bởi ${auth.user.email} · Lúc ${now}`,
              fetchImpl,
            });
            driveExportUrl = uploaded4k.driveUrl || uploaded4k.url || "";
          } catch {
            // Non-fatal: web KV copy is already saved safely
          }
        }
      }
    }

    const updated = await env.DB.prepare("SELECT * FROM media_photos WHERE id = ?").bind(id).first();
    return jsonResponse({
      ok: true,
      item: serializePhotoRow(updated),
      appliedPreset: presetId,
      preservedDriveOriginal: isDriveOriginal,
      driveExportUrl: driveExportUrl || undefined,
    });
  }

  return errorResponse(400, "INVALID_ACTION", "Hành động không hợp lệ (chỉ hỗ trợ generate hoặc apply).");
}
