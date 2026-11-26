/**
 * Google Drive API v3 storage driver for Cloudflare Pages Functions.
 * Pure Web Standards (fetch + TextEncoder) — zero external dependencies.
 *
 * Required Cloudflare Secrets (OAuth2 Refresh Token — works with personal @gmail.com & Workspace):
 *   - GOOGLE_DRIVE_CLIENT_ID (fallback: GOOGLE_CLIENT_ID)
 *   - GOOGLE_DRIVE_CLIENT_SECRET (fallback: GOOGLE_CLIENT_SECRET)
 *   - GOOGLE_DRIVE_REFRESH_TOKEN
 * Optional:
 *   - GOOGLE_DRIVE_ROOT_FOLDER_ID (organizes uploads into su-kien/, bai-viet/, album/, giao-dien/)
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

const SAFE_DRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;
const ALLOWED_CATEGORIES = new Set(["su-kien", "bai-viet", "album", "giao-dien", "khac"]);

// Isolate-local caches (safe across requests within a single Worker isolate)
let cachedToken = { key: "", token: "", expiresAt: 0 };
const folderCache = new Map();

export function resetDriveCachesForTest() {
  cachedToken = { key: "", token: "", expiresAt: 0 };
  folderCache.clear();
}

export function getDriveConfig(env) {
  const clientId = String(env?.GOOGLE_DRIVE_CLIENT_ID || env?.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env?.GOOGLE_DRIVE_CLIENT_SECRET || env?.GOOGLE_CLIENT_SECRET || "").trim();
  const refreshToken = String(env?.GOOGLE_DRIVE_REFRESH_TOKEN || "").trim();
  const rootFolderId = String(env?.GOOGLE_DRIVE_ROOT_FOLDER_ID || "").trim();
  return { clientId, clientSecret, refreshToken, rootFolderId };
}

export function isDriveConfigured(env) {
  const cfg = getDriveConfig(env);
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.refreshToken);
}

export function isSafeDriveFileId(id) {
  return typeof id === "string" && SAFE_DRIVE_ID_RE.test(id);
}

export function extractDriveFolderId(url) {
  const m = String(url || "").match(/\/folders\/([a-zA-Z0-9_-]{10,128})(?:[/?#]|$)/);
  return m && isSafeDriveFileId(m[1]) ? m[1] : "";
}

export function normalizeDriveCategory(raw) {
  const val = String(raw || "").trim().toLowerCase();
  return ALLOWED_CATEGORIES.has(val) ? val : "khac";
}

export function sanitizeDriveName(raw, fallback = "media") {
  const clean = String(raw || "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

export function buildEventFolderName({ eventDate = "", title = "", fallback = "su-kien" } = {}) {
  const dateMatch = String(eventDate || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  const datePart = dateMatch ? dateMatch[1] : "";
  const cleanTitle = sanitizeDriveName(title, "");
  if (datePart && cleanTitle) {
    return sanitizeDriveName(`${datePart} - ${cleanTitle}`, fallback);
  }
  return cleanTitle || datePart || sanitizeDriveName(fallback, "su-kien");
}

export async function getDriveAccessToken(env, fetchImpl = fetch) {
  const cfg = getDriveConfig(env);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error("Thiếu cấu hình Google Drive OAuth2 (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN).");
  }

  const cacheKey = `${cfg.clientId}:${cfg.refreshToken.slice(-8)}`;
  const now = Date.now();
  if (cachedToken.key === cacheKey && cachedToken.token && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Không thể lấy Google Drive access token: ${detail}`);
  }

  const ttlMs = Math.max(300, Number(data.expires_in || 3600)) * 1000;
  cachedToken = {
    key: cacheKey,
    token: data.access_token,
    expiresAt: now + ttlMs,
  };
  return data.access_token;
}

async function ensureSubfolder(folderName, parentId, accessToken, fetchImpl = fetch) {
  const safeName = sanitizeDriveName(folderName, "khac");
  const cacheKey = `${parentId || "root"}:${safeName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  const escaped = safeName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and trashed = false${parentClause}`;
  const searchUrl = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const searchRes = await fetchImpl(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (searchRes.ok) {
    const searchData = await searchRes.json().catch(() => ({}));
    const existing = Array.isArray(searchData.files) && searchData.files[0];
    if (existing?.id) {
      folderCache.set(cacheKey, existing.id);
      return existing.id;
    }
  }

  const meta = {
    name: safeName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) meta.parents = [parentId];

  const createRes = await fetchImpl(`${DRIVE_FILES_URL}?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(meta),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.id) {
    throw new Error(`Không thể tạo thư mục Google Drive '${safeName}' (HTTP ${createRes.status}).`);
  }

  folderCache.set(cacheKey, created.id);
  return created.id;
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/**
 * Ensure a Drive folder exists at <ROOT>/<category>/<subfolder> and return its ID + shareable link.
 * Returns null if Drive is not configured or subfolder is empty.
 */
export async function ensureCategorySubfolder(
  env,
  { category = "album", subfolder = "", fetchImpl = fetch } = {}
) {
  if (!isDriveConfigured(env)) return null;
  const sub = sanitizeDriveName(subfolder, "");
  if (!sub) return null;

  const cfg = getDriveConfig(env);
  const accessToken = await getDriveAccessToken(env, fetchImpl);
  const cat = normalizeDriveCategory(category);

  let parentId = cfg.rootFolderId || "";
  parentId = await ensureSubfolder(cat, parentId, accessToken, fetchImpl);
  const folderId = await ensureSubfolder(sub, parentId, accessToken, fetchImpl);

  return {
    folderId,
    folderName: sub,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
  };
}

/**
 * Upload original uncompressed image bytes to Google Drive via multipart/related API v3.
 * Supports nested subfolder paths via `subfolder: ["event-folder", "dong-gop", "member-name"]`
 * and/or uploading directly beneath an existing `parentFolderId`.
 */
export async function uploadImageToDrive(
  env,
  {
    bytes,
    mimeType,
    filename,
    category = "khac",
    subfolder = "",
    parentFolderId = "",
    description = "",
    fetchImpl = fetch,
  }
) {
  const cfg = getDriveConfig(env);
  const accessToken = await getDriveAccessToken(env, fetchImpl);

  const subSegments = Array.isArray(subfolder)
    ? subfolder.map((s) => String(s || "").trim()).filter(Boolean)
    : String(subfolder || "").trim()
      ? [String(subfolder).trim()]
      : [];

  let parentId = "";
  if (parentFolderId && isSafeDriveFileId(parentFolderId)) {
    parentId = parentFolderId;
    for (const seg of subSegments) {
      parentId = await ensureSubfolder(seg, parentId, accessToken, fetchImpl);
    }
  } else {
    const cat = normalizeDriveCategory(category);
    parentId = cfg.rootFolderId || "";
    if (parentId || subSegments.length > 0) {
      parentId = await ensureSubfolder(cat, parentId, accessToken, fetchImpl);
      for (const seg of subSegments) {
        parentId = await ensureSubfolder(seg, parentId, accessToken, fetchImpl);
      }
    }
  }

  const metadata = {
    name: sanitizeDriveName(filename, `holarise-${Date.now()}.jpg`),
    mimeType,
  };
  if (description) {
    metadata.description = String(description).slice(0, 500);
  }
  if (parentId) {
    metadata.parents = [parentId];
  }

  const boundary = `holarise_${crypto.randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
  );
  const epilogue = encoder.encode(`\r\n--${boundary}--`);
  const payload = concatUint8Arrays([preamble, bytes, epilogue]);

  const uploadUrl =
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true` +
    `&fields=id,name,mimeType,size,webViewLink,webContentLink`;

  const res = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: payload,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    const detail = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Tải ảnh lên Google Drive thất bại: ${detail}`);
  }

  return {
    driveId: data.id,
    id: `drive:${data.id}`,
    url: `/api/media/drive/${data.id}`,
    driveUrl: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
    downloadUrl: `/api/media/drive/${data.id}?download=1`,
    contentType: data.mimeType || mimeType,
    size: Number(data.size || bytes.byteLength),
    storage: "google_drive",
  };
}

/**
 * Fetch image or video binary from Google Drive for Edge CDN proxy (/api/media/drive/:id).
 * Supports HTTP Range forwarding (206 Partial Content) for smooth iOS Safari & Zalo WebView video playback.
 */
export async function fetchDriveImage(env, fileId, fetchImpl = fetch, { range = "" } = {}) {
  if (!isSafeDriveFileId(fileId)) {
    return { ok: false, status: 404, error: "INVALID_ID" };
  }
  const accessToken = await getDriveAccessToken(env, fetchImpl);
  const url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const reqHeaders = { Authorization: `Bearer ${accessToken}` };
  if (range && /^bytes=\d*-\d*(?:,\s*\d*-\d*)*$/i.test(String(range).trim())) {
    reqHeaders.Range = String(range).trim();
  }

  const res = await fetchImpl(url, { headers: reqHeaders });

  if (res.status === 404) {
    return { ok: false, status: 404, error: "NOT_FOUND" };
  }
  if (res.status === 416) {
    return { ok: false, status: 416, error: "RANGE_NOT_SATISFIABLE" };
  }
  if (!res.ok && res.status !== 206) {
    return { ok: false, status: 502, error: `DRIVE_HTTP_${res.status}` };
  }

  const contentType = String(res.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    return { ok: false, status: 415, error: "UNSUPPORTED_MEDIA" };
  }

  return {
    ok: true,
    status: res.status === 206 ? 206 : 200,
    contentType,
    body: res.body,
    contentLength: res.headers.get("Content-Length") || "",
    contentRange: res.headers.get("Content-Range") || "",
    acceptRanges: res.headers.get("Accept-Ranges") || "bytes",
  };
}

/**
 * Move a Drive file to Trash (recoverable for 30 days) when deleted from HolaRise CMS.
 */
export async function trashDriveFile(env, fileId, fetchImpl = fetch) {
  if (!isDriveConfigured(env) || !isSafeDriveFileId(fileId)) {
    return false;
  }
  try {
    const accessToken = await getDriveAccessToken(env, fetchImpl);
    const res = await fetchImpl(
      `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trashed: true }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
