import { ensureMediaApprovalSchema } from "../../../../_lib/media-approval-schema.js";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  sniffImageMime,
} from "../../../../_lib/security.js";
import { serializePhotoRow } from "../../albums/[id]/index.js";

const APPROVER_ROLES = ["super_admin", "editor"];
const MAX_COMPRESSED_BYTES = 1.5 * 1024 * 1024; // 1.5 MB max for web-optimized KV copy

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { allowedRoles: APPROVER_ROLES });
  if (!auth.ok) return auth.response;

  await ensureMediaApprovalSchema(context.env.DB);

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM media_photos WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy ảnh cần duyệt.");
  }

  const contentType = context.request.headers.get("Content-Type") || "";
  const now = new Date().toISOString();

  // Case 1: Multipart upload of compressed web-optimized image (WebP / JPEG <= 1280px)
  if (contentType.includes("multipart/form-data")) {
    let bytes;
    let action = "approve";
    try {
      const formData = await context.request.formData();
      action = String(formData.get("action") || "approve").trim();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(400, "MISSING_FILE", "Thiếu tệp ảnh đã nén để duyệt lên web.");
      }
      if (file.size > MAX_COMPRESSED_BYTES) {
        return errorResponse(413, "FILE_TOO_LARGE", "Ảnh nén web vượt quá 1.5 MB.");
      }
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return errorResponse(400, "INVALID_FORM", "Không thể đọc dữ liệu ảnh nén gửi lên.");
    }

    if (!bytes || bytes.byteLength === 0) {
      return errorResponse(400, "EMPTY_FILE", "Tệp ảnh nén rỗng.");
    }
    const detected = sniffImageMime(bytes);
    if (!detected) {
      return errorResponse(415, "UNSUPPORTED_IMAGE", "Định dạng ảnh nén không hợp lệ (chỉ hỗ trợ WebP/JPEG/PNG).");
    }

    let webUrl = existing.web_url || "";
    let webMediaKey = existing.web_media_key || "";

    if (context.env?.MEDIA_KV) {
      const prevKey = existing.web_media_key || "";
      const newKey = `web-${crypto.randomUUID().slice(0, 12)}.${detected.ext}`;
      await context.env.MEDIA_KV.put(`media:${newKey}`, bytes.buffer, {
        metadata: {
          contentType: detected.mime,
          size: bytes.byteLength,
          sourcePhotoId: id,
          approvedBy: auth.user.email,
          approvedAt: now,
        },
      });
      if (prevKey && prevKey !== newKey) {
        await context.env.MEDIA_KV.delete(`media:${prevKey}`).catch(() => {});
      }
      webMediaKey = newKey;
      webUrl = `/api/media/${newKey}`;
    }

    const nextStatus = action === "pending" ? "pending" : "approved";
    await context.env.DB.prepare(
      `UPDATE media_photos
       SET approval_status = ?, web_url = ?, web_media_key = ?, approved_by = ?, approved_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(nextStatus, webUrl, webMediaKey, auth.user.email, now, now, id)
      .run();

    // Update album cover to web-optimized image if album has no cover yet
    if (nextStatus === "approved") {
      const album = await context.env.DB.prepare("SELECT id, cover_url FROM media_albums WHERE id = ?")
        .bind(existing.album_id)
        .first();
      if (album && !album.cover_url) {
        await context.env.DB.prepare("UPDATE media_albums SET cover_url = ?, updated_at = ? WHERE id = ?")
          .bind(webUrl || existing.url, now, existing.album_id)
          .run();
      }
    }

    const updated = await context.env.DB.prepare("SELECT * FROM media_photos WHERE id = ?").bind(id).first();
    return jsonResponse({
      ok: true,
      item: serializePhotoRow(updated),
      compressedBytes: bytes.byteLength,
    });
  }

  // Case 2: JSON status transition (approve without recompress, reject, or revert to pending)
  const parsed = await readJsonBody(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;

  const action = String(parsed.data.action || "approve").trim().toLowerCase();
  if (!["approve", "reject", "pending"].includes(action)) {
    return errorResponse(400, "INVALID_ACTION", "Hành động duyệt không hợp lệ.");
  }

  const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending";

  // If hiding/rejecting, clean up compressed KV copy while keeping original Drive file intact
  let webUrl = existing.web_url || "";
  let webMediaKey = existing.web_media_key || "";
  if (nextStatus !== "approved" && webMediaKey && context.env?.MEDIA_KV) {
    await context.env.MEDIA_KV.delete(`media:${webMediaKey}`).catch(() => {});
    webUrl = "";
    webMediaKey = "";
  }

  await context.env.DB.prepare(
    `UPDATE media_photos
     SET approval_status = ?, web_url = ?, web_media_key = ?,
         approved_by = ?, approved_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nextStatus,
      webUrl,
      webMediaKey,
      nextStatus === "approved" ? auth.user.email : "",
      nextStatus === "approved" ? now : "",
      now,
      id
    )
    .run();

  if (nextStatus === "approved" && String(existing.media_type || "image") !== "video") {
    const album = await context.env.DB.prepare("SELECT id, cover_url FROM media_albums WHERE id = ?")
      .bind(existing.album_id)
      .first();
    if (album && !album.cover_url) {
      await context.env.DB.prepare("UPDATE media_albums SET cover_url = ?, updated_at = ? WHERE id = ?")
        .bind(webUrl || existing.url, now, existing.album_id)
        .run();
    }
  }

  const updated = await context.env.DB.prepare("SELECT * FROM media_photos WHERE id = ?").bind(id).first();
  return jsonResponse({
    ok: true,
    item: serializePhotoRow(updated),
  });
}
