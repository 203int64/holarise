import {
  buildEventFolderName,
  ensureCategorySubfolder,
  extractDriveFolderId,
  isDriveConfigured,
  sanitizeDriveName,
  uploadImageToDrive,
} from "../../../../_lib/drive.js";
import {
  canActorViewAlbum,
  ensureDeepControlSchema,
  getMemberPermissions,
} from "../../../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../../../_lib/media-approval-schema.js";
import {
  checkRateLimit,
  errorResponse,
  jsonResponse,
  requireMember,
  sniffMediaMime,
} from "../../../../_lib/security.js";
import { cleanStr, slugifyVi } from "../../../../_lib/validation.js";
import { serializePhotoRow } from "../../../admin/albums/[id]/index.js";

const MAX_DRIVE_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB original uncompressed photo
const MAX_DRIVE_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB original video clip on Google Drive
const MAX_KV_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB fallback when Drive is unconfigured
const MAX_KV_VIDEO_BYTES = 10 * 1024 * 1024;
const HOURLY_MEMBER_UPLOAD_LIMIT = 60;

export async function onRequestPost(context) {
  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;

  const { request, env, params } = context;
  await Promise.all([ensureMediaApprovalSchema(env.DB), ensureDeepControlSchema(env.DB)]);

  const albumId = String(params?.id || "").trim();
  if (!albumId) {
    return errorResponse(400, "MISSING_ALBUM_ID", "Thiếu mã bộ ảnh cần đóng góp.");
  }

  const album = await env.DB.prepare(
    `SELECT id, slug, title, event_id, event_date, drive_url, status, COALESCE(visibility, 'public') AS visibility
     FROM media_albums
     WHERE id = ? AND status = 'published'`
  )
    .bind(albumId)
    .first();

  if (!album) {
    return errorResponse(404, "ALBUM_NOT_FOUND", "Không tìm thấy bộ ảnh đang mở để đóng góp.");
  }

  const perms = await getMemberPermissions(env.DB, auth.member.id);
  const canView = await canActorViewAlbum(env.DB, album, {
    isSoleAdmin: false,
    isMediaTeam: false,
    isMediaViewer: perms.canAccessMediaPortal,
    canViewAllMedia: perms.canViewAllMedia,
    member: auth.member,
  });
  if (!canView) {
    return errorResponse(403, "ALBUM_FORBIDDEN", "Bạn chưa được cấp quyền truy cập bộ ảnh riêng tư này.");
  }

  const useDrive = isDriveConfigured(env);
  if (!useDrive && !env?.MEDIA_KV) {
    return errorResponse(
      503,
      "STORAGE_UNAVAILABLE",
      "Kho lưu ảnh gốc chưa được kết nối. Vui lòng thử lại sau."
    );
  }

  // Unlimited total album size, with a per-member hourly guardrail to protect Google Drive quota.
  const rl = await checkRateLimit(
    env.DB,
    `mbr_album_photo:${auth.member.id}`,
    HOURLY_MEMBER_UPLOAD_LIMIT,
    60 * 60 * 1000
  );
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      `Bạn đã gửi ${HOURLY_MEMBER_UPLOAD_LIMIT} ảnh trong giờ vừa qua. Vui lòng đợi ít phút rồi tiếp tục gửi thêm.`,
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const maxReadBytes = useDrive ? MAX_DRIVE_VIDEO_BYTES : MAX_KV_VIDEO_BYTES;
  const maxReadLabel = useDrive ? "50 MB" : "10 MB";
  const contentType = request.headers.get("Content-Type") || "";

  let bytes;
  let originalFilename = "";
  let caption = "";
  let photographer = "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(400, "MISSING_FILE", "Không tìm thấy tệp ảnh hoặc video tải lên.");
      }
      if (file.size > maxReadBytes) {
        return errorResponse(413, "FILE_TOO_LARGE", `Tệp vượt quá giới hạn tối đa ${maxReadLabel}.`);
      }
      originalFilename = String(file.name || "");
      caption = cleanStr(formData.get("caption"), 240);
      photographer = cleanStr(formData.get("photographer"), 100);
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > maxReadBytes) {
        return errorResponse(413, "FILE_TOO_LARGE", `Tệp vượt quá giới hạn tối đa ${maxReadLabel}.`);
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
      "UNSUPPORTED_IMAGE",
      "Chỉ hỗ trợ ảnh (JPEG, PNG, WebP) hoặc video (MP4, MOV, WebM) hợp lệ."
    );
  }

  const isVideo = detected.kind === "video";
  const maxAllowed = useDrive
    ? isVideo
      ? MAX_DRIVE_VIDEO_BYTES
      : MAX_DRIVE_IMAGE_BYTES
    : isVideo
      ? MAX_KV_VIDEO_BYTES
      : MAX_KV_UPLOAD_BYTES;
  if (bytes.byteLength > maxAllowed) {
    const label = isVideo ? `${Math.round(maxAllowed / (1024 * 1024))} MB` : useDrive ? "25 MB" : "1.5 MB";
    return errorResponse(413, "FILE_TOO_LARGE", `${isVideo ? "Video" : "Ảnh"} vượt quá giới hạn ${label}.`);
  }

  const now = new Date().toISOString();
  const stamp = now.slice(0, 10).replace(/-/g, "");
  const creditName = photographer || auth.member.name || "Thành viên HolaRise";
  const memberCode = sanitizeDriveName(auth.member.member_code || auth.member.id.slice(0, 8), "MEMBER");
  const memberSlug = slugifyVi(auth.member.name || "thanh-vien").slice(0, 32) || "thanh-vien";
  const memberFolder = sanitizeDriveName(`${stamp}_${memberCode}_${memberSlug}`, `${stamp}_${memberCode}`);
  const eventFolderName = buildEventFolderName({
    eventDate: album.event_date,
    title: album.title,
    fallback: album.slug || album.id,
  });

  // Deterministic sequential filename per contributor inside the event folder (never collides on IMG_0001.JPG)
  const seqRow = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM media_photos WHERE album_id = ? AND contributor_member_id = ?"
  )
    .bind(album.id, auth.member.id)
    .first()
    .catch(() => null);
  const seqNum = String(Number(seqRow?.cnt || 0) + 1).padStart(3, "0");
  const standardizedFilename = `${memberCode}_${seqNum}.${detected.ext}`;

  let mediaKey = "";
  let photoUrl = "";
  let storage = "media_kv";
  let folderPath = "";
  let drivePath = "";

  if (useDrive) {
    try {
      let eventFolderId = extractDriveFolderId(album.drive_url);
      if (!eventFolderId) {
        const ensured = await ensureCategorySubfolder(env, {
          category: "album",
          subfolder: eventFolderName,
        });
        if (ensured?.folderId) {
          eventFolderId = ensured.folderId;
          await env.DB.prepare("UPDATE media_albums SET drive_url = ?, updated_at = ? WHERE id = ?")
            .bind(ensured.folderUrl, now, album.id)
            .run()
            .catch(() => {});
        }
      }

      const uploaded = await uploadImageToDrive(env, {
        bytes,
        mimeType: detected.mime,
        filename: standardizedFilename,
        category: "album",
        parentFolderId: eventFolderId,
        subfolder: eventFolderId
          ? ["dong-gop", memberFolder]
          : [eventFolderName, "dong-gop", memberFolder],
        description: `Đóng góp Thành viên: ${creditName} (${memberCode}) · Tệp gốc: ${originalFilename || standardizedFilename} · Bộ ảnh: ${album.title} · Lúc: ${now}`,
      });

      mediaKey = uploaded.id; // drive:<fileId>
      photoUrl = isVideo ? `${uploaded.url}?kind=video` : uploaded.url; // /api/media/drive/<fileId>
      storage = "google_drive";
      folderPath = `${eventFolderName}/dong-gop/${memberFolder}`;
      drivePath = `${folderPath}/${standardizedFilename}`;
    } catch (err) {
      return errorResponse(
        502,
        "DRIVE_UPLOAD_FAILED",
        err?.message || "Chưa thể lưu ảnh vào thư mục Google Drive lúc này. Vui lòng thử lại."
      );
    }
  } else {
    const kvId = `mbr-alb-${stamp}-${crypto.randomUUID().slice(0, 10)}.${detected.ext}`;
    await env.MEDIA_KV.put(`media:${kvId}`, bytes.buffer, {
      metadata: {
        contentType: detected.mime,
        size: bytes.byteLength,
        albumId: album.id,
        uploadedByMember: auth.member.id,
        standardizedFilename,
        uploadedAt: now,
      },
    });
    mediaKey = kvId;
    photoUrl = `/api/media/${kvId}`;
    storage = "media_kv";
    folderPath = `media_kv/${album.slug}/dong-gop/${memberFolder}`;
    drivePath = `${folderPath}/${standardizedFilename}`;
  }

  const maxRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM media_photos WHERE album_id = ?"
  )
    .bind(album.id)
    .first();
  const nextSort = Number(maxRow?.max_sort || 0) + 1;

  const photoId = `pho-${crypto.randomUUID().slice(0, 12)}`;
  const uploadedByLabel = `${auth.member.name || "Thành viên"} (${memberCode})`;
  const altText = caption || `Khoảnh khắc ${album.title} — đóng góp bởi ${creditName}`;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO media_photos (
         id, album_id, media_key, url, caption, alt, photographer,
         is_featured_home, sort_order, uploaded_by, contributor_member_id,
         source_kind, drive_path, media_type,
         approval_status, web_url, web_media_key, approved_by, approved_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'member_contribution', ?, ?, 'pending', '', '', '', '', ?, ?)`
    ).bind(
      photoId,
      album.id,
      mediaKey,
      photoUrl,
      caption,
      altText,
      creditName,
      nextSort,
      uploadedByLabel,
      auth.member.id,
      drivePath,
      detected.kind,
      now,
      now
    ),
    env.DB.prepare("UPDATE media_albums SET updated_at = ? WHERE id = ?").bind(now, album.id),
  ]);

  const created = await env.DB.prepare("SELECT * FROM media_photos WHERE id = ?").bind(photoId).first();

  return jsonResponse(
    {
      ok: true,
      item: serializePhotoRow(created),
      storage,
      folderPath,
      drivePath,
      standardizedFilename,
      remainingHourly: rl.remaining,
    },
    201
  );
}
