/**
 * Security, Auth (PBKDF2-SHA256 + D1 Sessions), CSRF Origin Check, Rate Limit & Media Sniffing.
 * Zero external dependencies — pure Web Crypto API (Cloudflare Workers + Node 20+ compatible).
 */
import { getRolePermissions, normalizeRole, roleHasPermission } from "./rbac.js";

export const SESSION_COOKIE_NAME = "holarise_session";
export const MEMBER_SESSION_COOKIE_NAME = "holarise_member_session";
export const READER_ID_COOKIE_NAME = "holarise_reader_id";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days (Admin/Media)
const MEMBER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days (Community Member)
const READER_ID_TTL_SECONDS = 60 * 60 * 24 * 365; // 365 days (Heart reaction actor)
const PBKDF2_ITERATIONS = 100000;
const MEMBER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const enc = new TextEncoder();

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function timingSafeEqualHex(aHex, bHex) {
  const a = fromHex(aHex);
  const b = fromHex(bHex);
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function randomTokenHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(text)));
  return toHex(new Uint8Array(digest));
}

export async function hashPassword(password, saltHex = randomTokenHex(16)) {
  const saltBytes = fromHex(saltHex);
  if (!saltBytes) throw new Error("Invalid salt");
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(password)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  );
  return {
    hash: toHex(new Uint8Array(derived)),
    salt: saltHex,
  };
}

export async function verifyPassword(password, expectedHashHex, saltHex) {
  if (!password || !expectedHashHex || !saltHex) return false;
  try {
    const { hash } = await hashPassword(password, saltHex);
    return timingSafeEqualHex(hash, expectedHashHex);
  } catch {
    return false;
  }
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const map = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        map[key] = decodeURIComponent(val);
      } catch {
        map[key] = val;
      }
    }
  }
  return map;
}

export function buildSessionCookie(token, request, clear = false) {
  const isHttps = new URL(request.url).protocol === "https:";
  const attrs = [
    `${SESSION_COOKIE_NAME}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

export function verifyCsrfOrigin(request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }
  const reqOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) {
    return origin === reqOrigin;
  }
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === reqOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

export async function getClientIpHash(request) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "unknown";
  return (await sha256Hex(`holarise-rl:${ip}`)).slice(0, 24);
}

export async function checkRateLimit(db, bucketKey, maxRequests, windowMs) {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN (? - window_start) >= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN (? - window_start) >= ? THEN ? ELSE window_start END
       RETURNING count, window_start`
    )
    .bind(bucketKey, now, now, windowMs, now, windowMs, now)
    .first();

  const count = Number(row?.count || 1);
  const windowStart = Number(row?.window_start || now);
  if (count > maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - windowStart)) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  return { allowed: true, remaining: Math.max(0, maxRequests - count), retryAfterSec: 0 };
}

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function errorResponse(status, code, message, fields = null, extraHeaders = {}) {
  const body = { ok: false, error: { code, message } };
  if (fields) body.error.fields = fields;
  return jsonResponse(body, status, extraHeaders);
}

export async function readJsonBody(request, maxBytes = 256 * 1024) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxBytes) {
    return { ok: false, response: errorResponse(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên vượt quá dung lượng cho phép.") };
  }
  const raw = await request.text();
  if (enc.encode(raw).byteLength > maxBytes) {
    return { ok: false, response: errorResponse(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên vượt quá dung lượng cho phép.") };
  }
  if (!raw.trim()) {
    return { ok: true, data: {} };
  }
  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, response: errorResponse(400, "INVALID_JSON", "Dữ liệu JSON phải là đối tượng hợp lệ.") };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, response: errorResponse(400, "INVALID_JSON", "Không thể đọc dữ liệu JSON gửi lên.") };
  }
}

export async function createSession(db, userId) {
  const rawToken = randomTokenHex(32);
  const hashedId = await sha256Hex(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(hashedId, userId, expiresAt, now.toISOString())
    .run();
  return { rawToken, expiresAt };
}

export async function getSessionUser(db, request) {
  const cookies = parseCookies(request);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;
  const hashedId = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.is_active, s.id AS session_id
       FROM sessions s
       JOIN admin_users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`
    )
    .bind(hashedId, nowIso)
    .first();
  if (!row) return null;
  let department = "";
  let phone = "";
  try {
    const ext = await db
      .prepare("SELECT department, phone FROM admin_users WHERE id = ?")
      .bind(row.id)
      .first();
    department = ext?.department || "";
    phone = ext?.phone || "";
  } catch {
    // Legacy schema before 0010 may not have department/phone
  }
  return { ...row, department, phone, canonicalRole: normalizeRole(row.role) || row.role };
}

export function getSoleAdminPrefix(env) {
  return String(env?.SOLE_ADMIN_PREFIX || "203int64").trim().toLowerCase() || "203int64";
}

export function isSoleAdminAccount(user, env) {
  if (!user || user.role !== "super_admin") return false;
  const email = String(user.email || "").trim().toLowerCase();
  const atIdx = email.indexOf("@");
  const localPart = atIdx > 0 ? email.slice(0, atIdx) : email;
  return Boolean(localPart) && localPart === getSoleAdminPrefix(env);
}

function matchesAllowedRole(canonicalRole, allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return false;
  const normalizedAllowed = new Set();
  for (const r of allowedRoles) {
    const raw = String(r || "").trim().toLowerCase();
    if (!raw) continue;
    normalizedAllowed.add(raw);
    const mapped = normalizeRole(raw);
    if (mapped) normalizedAllowed.add(mapped);
    // Legacy 'media' in allowedRoles covers both media_ctv & media_manager
    if (raw === "media") {
      normalizedAllowed.add("media_ctv");
      normalizedAllowed.add("media_manager");
    }
    if (raw === "editor") {
      normalizedAllowed.add("content_editor");
    }
  }
  return normalizedAllowed.has(canonicalRole);
}

export async function requireAdmin(
  context,
  { superAdminOnly = false, permission = null, allowedRoles = null } = {}
) {
  const { request, env } = context;
  if (!env?.DB) {
    return { ok: false, response: errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.") };
  }
  if (!verifyCsrfOrigin(request)) {
    return { ok: false, response: errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ (CSRF guard).") };
  }
  const user = await getSessionUser(env.DB, request);
  if (!user) {
    return { ok: false, response: errorResponse(401, "UNAUTHORIZED", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.") };
  }
  const soleAdmin = isSoleAdminAccount(user, env);
  const canonicalRole = normalizeRole(user.role);

  // Security invariant: a rogue `super_admin` row whose email prefix != SOLE_ADMIN_PREFIX is NEVER trusted.
  if (canonicalRole === "super_admin" && !soleAdmin) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "FORBIDDEN",
        "Tài khoản quản trị chính không khớp cấu hình bảo mật hệ thống."
      ),
    };
  }

  const permissions = getRolePermissions(canonicalRole, soleAdmin);

  if (superAdminOnly) {
    if (!soleAdmin) {
      return {
        ok: false,
        response: errorResponse(
          403,
          "FORBIDDEN",
          "Chức năng này chỉ mở cho Chủ nhiệm (Quản trị chính)."
        ),
      };
    }
    return { ok: true, user, canonicalRole, permissions, isSoleAdmin: true };
  }

  if (permission) {
    if (!soleAdmin && !roleHasPermission(canonicalRole, permission, soleAdmin)) {
      return {
        ok: false,
        response: errorResponse(
          403,
          "FORBIDDEN",
          "Vai trò của bạn chưa có quyền thực hiện thao tác này."
        ),
      };
    }
    return { ok: true, user, canonicalRole, permissions, isSoleAdmin: soleAdmin };
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    if (!soleAdmin && !matchesAllowedRole(canonicalRole, allowedRoles)) {
      return {
        ok: false,
        response: errorResponse(
          403,
          "FORBIDDEN",
          "Tài khoản của bạn không có quyền truy cập khu vực này."
        ),
      };
    }
    return { ok: true, user, canonicalRole, permissions, isSoleAdmin: soleAdmin };
  }

  // Fail-closed default: endpoints without explicit permission/allowedRoles stay locked to soleAdmin.
  if (!soleAdmin) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "FORBIDDEN",
        "Khu vực quản trị này chỉ mở cho tài khoản Chủ nhiệm (Quản trị chính)."
      ),
    };
  }
  return { ok: true, user, canonicalRole, permissions, isSoleAdmin: true };
}

export function formatVnDateYYMMDD(nowDate = new Date()) {
  const vn = new Date(nowDate.getTime() + 7 * 60 * 60 * 1000);
  const yy = String(vn.getUTCFullYear()).slice(-2);
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

export function generateMemberCode(nowDateOrYear = new Date(), seq = 1) {
  const dateObj = nowDateOrYear instanceof Date ? nowDateOrYear : new Date();
  const yymmdd = formatVnDateYYMMDD(dateObj);
  const safeSeq = Math.max(1, Number(seq) || 1);
  return `HR-${yymmdd}-${safeSeq}`;
}

export async function generateSequentialMemberCode(db, nowDate = new Date(), offset = 0) {
  const yymmdd = formatVnDateYYMMDD(nowDate);
  const prefix = `HR-${yymmdd}-`;
  let maxSeq = 0;
  if (db) {
    const rows = await db
      .prepare("SELECT member_code FROM members WHERE member_code LIKE ?")
      .bind(`${prefix}%`)
      .all()
      .catch(() => ({ results: [] }));
    for (const r of rows?.results || []) {
      const tail = String(r.member_code || "").slice(prefix.length);
      const n = Number.parseInt(tail, 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return `${prefix}${maxSeq + 1 + Math.max(0, Number(offset) || 0)}`;
}

export function buildMemberSessionCookie(token, request, clear = false) {
  const isHttps = new URL(request.url).protocol === "https:";
  const attrs = [
    `${MEMBER_SESSION_COOKIE_NAME}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${MEMBER_SESSION_TTL_SECONDS}`,
  ];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildReaderIdCookie(readerId, request) {
  const isHttps = new URL(request.url).protocol === "https:";
  const attrs = [
    `${READER_ID_COOKIE_NAME}=${encodeURIComponent(readerId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${READER_ID_TTL_SECONDS}`,
  ];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

export function serializePublicMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberCode: row.member_code,
    name: row.name,
    email: row.email || "",
    phoneDisplay: row.phone_display || "",
    organization: row.organization || "",
    pillarChoice: row.pillar_choice || "holaheart",
    avatarUrl: row.avatar_url || "",
    isActive: Number(row.is_active ?? 1) === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export async function createMemberSession(db, memberId) {
  const rawToken = randomTokenHex(32);
  const hashedId = await sha256Hex(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_SECONDS * 1000).toISOString();
  await db
    .prepare("INSERT INTO member_sessions (id, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(hashedId, memberId, expiresAt, now.toISOString())
    .run();
  return { rawToken, expiresAt };
}

export async function getSessionMember(db, request) {
  if (!db) return null;
  const cookies = parseCookies(request);
  const rawToken = cookies[MEMBER_SESSION_COOKIE_NAME];
  if (!rawToken) return null;
  const hashedId = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();
  try {
    const row = await db
      .prepare(
        `SELECT m.id, m.member_code, m.email, m.phone_norm, m.phone_display, m.name,
                m.organization, m.pillar_choice, m.avatar_url, m.avatar_media_key,
                m.is_active, m.created_at, m.updated_at, m.last_login_at,
                s.id AS session_id
         FROM member_sessions s
         JOIN members m ON m.id = s.member_id
         WHERE s.id = ? AND s.expires_at > ? AND m.is_active = 1`
      )
      .bind(hashedId, nowIso)
      .first();
    return row || null;
  } catch {
    return null;
  }
}

export async function requireMember(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return { ok: false, response: errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.") };
  }
  if (!verifyCsrfOrigin(request)) {
    return { ok: false, response: errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ (CSRF guard).") };
  }
  const member = await getSessionMember(env.DB, request);
  if (!member) {
    return {
      ok: false,
      response: errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên Hola để tiếp tục."),
    };
  }
  return { ok: true, member };
}

export async function resolveHeartActor(context) {
  const { request, env } = context;
  const member = env?.DB ? await getSessionMember(env.DB, request) : null;
  if (member) {
    return { actorKey: `mbr:${member.id}`, setCookie: null, isNewReader: false };
  }
  const cookies = parseCookies(request);
  const existing = String(cookies[READER_ID_COOKIE_NAME] || "").trim();
  if (/^[a-f0-9]{24,64}$/.test(existing)) {
    return { actorKey: `rdr:${existing}`, setCookie: null, isNewReader: false };
  }
  const fresh = randomTokenHex(16);
  return {
    actorKey: `rdr:${fresh}`,
    setCookie: buildReaderIdCookie(fresh, request),
    isNewReader: true,
  };
}

/**
 * Sniff image format using magic bytes only (blocks SVG XSS and spoofed Content-Type).
 */
export function sniffImageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/**
 * Sniff audio format (MP3, M4A, OGG, WAV) using magic bytes only (blocks SVG/HTML/JS spoofing).
 */
export function sniffAudioMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  // MP3 with ID3v2 tag: 'ID3'
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { mime: "audio/mpeg", ext: "mp3", kind: "audio" };
  }
  // MP3 raw MPEG-1/2 Layer III frame sync: FF FB / FF F3 / FF F2 / FF E3
  if (
    bytes[0] === 0xff &&
    (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2 || bytes[1] === 0xe3)
  ) {
    return { mime: "audio/mpeg", ext: "mp3", kind: "audio" };
  }
  // M4A / M4B ISO Base Media audio: bytes[4..7] === 'ftyp' && brand === 'M4A ' or 'M4B '
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    bytes[8] === 0x4d &&
    bytes[9] === 0x34 &&
    (bytes[10] === 0x41 || bytes[10] === 0x42) &&
    bytes[11] === 0x20
  ) {
    return { mime: "audio/mp4", ext: "m4a", kind: "audio" };
  }
  // OGG container: 'OggS'
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return { mime: "audio/ogg", ext: "ogg", kind: "audio" };
  }
  // WAV: RIFF....WAVE
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return { mime: "audio/wav", ext: "wav", kind: "audio" };
  }
  return null;
}

/**
 * Sniff image (JPEG/PNG/WebP), audio (MP3/M4A/OGG/WAV), and video (MP4/MOV/WebM) using magic bytes only.
 */
export function sniffMediaMime(bytes) {
  const img = sniffImageMime(bytes);
  if (img) return { ...img, kind: "image" };
  const aud = sniffAudioMime(bytes);
  if (aud) return aud;
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;

  // ISO Base Media (MP4 / MOV): bytes[4..7] === 'ftyp'
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const isQuickTime =
      bytes[8] === 0x71 && bytes[9] === 0x74 && bytes[10] === 0x20 && bytes[11] === 0x20;
    return isQuickTime
      ? { mime: "video/quicktime", ext: "mov", kind: "video" }
      : { mime: "video/mp4", ext: "mp4", kind: "video" };
  }

  // WebM / Matroska EBML header: 1A 45 DF A3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mime: "video/webm", ext: "webm", kind: "video" };
  }

  return null;
}


/**
 * Self-healing schema guard: ensures v8 Member & Guestbook tables exist on D1
 * even if migration 0006 has not been manually executed yet on production.
 */
let memberSchemaEnsured = false;
export async function ensureMemberSchema(db) {
  if (!db || memberSchemaEnsured) return;
  let allGood = true;
  try {
    await db.prepare("SELECT id FROM members LIMIT 1").first();
    await db.prepare("SELECT id FROM member_sessions LIMIT 1").first();
    await db.prepare("SELECT credential_id FROM member_passkeys LIMIT 1").first();
    await db.prepare("SELECT challenge FROM passkey_challenges LIMIT 1").first();
  } catch (_missing) {
    allGood = false;
  }
  if (allGood) {
    memberSchemaEnsured = true;
    return;
  }
  // If member_sessions was created with wrong column name (token_hash instead of id), recreate it cleanly
  try {
    await db.prepare("SELECT id FROM member_sessions LIMIT 1").first();
  } catch (err) {
    if (String(err?.message || "").includes("no such column")) {
      await db.prepare("DROP TABLE IF EXISTS member_sessions").run().catch(() => {});
    }
  }
  const stmts = [
    `CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      member_code TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      phone_norm TEXT UNIQUE,
      phone_display TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      pillar_choice TEXT NOT NULL DEFAULT 'holaheart' CHECK(pillar_choice IN ('holaheart','holagreen','holaconnect')),
      avatar_url TEXT NOT NULL DEFAULT '',
      avatar_media_key TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS member_sessions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS activity_reflections (
      id TEXT PRIMARY KEY,
      activity_slug TEXT NOT NULL,
      member_id TEXT NOT NULL,
      participant_role TEXT NOT NULL DEFAULT 'member' CHECK(participant_role IN ('member','volunteer','speaker')),
      pull_quote TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      photo_url TEXT NOT NULL DEFAULT '',
      photo_media_key TEXT NOT NULL DEFAULT '',
      photos_json TEXT NOT NULL DEFAULT '[]',
      heart_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      admin_note TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(activity_slug, member_id),
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS reflection_hearts (
      reflection_id TEXT NOT NULL,
      actor_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (reflection_id, actor_key),
      FOREIGN KEY (reflection_id) REFERENCES activity_reflections(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS member_passkeys (
      credential_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      public_key_spki TEXT NOT NULL,
      algorithm INTEGER NOT NULL DEFAULT -7,
      sign_count INTEGER NOT NULL DEFAULT 0,
      device_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS passkey_challenges (
      challenge TEXT PRIMARY KEY,
      member_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('register', 'login')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ];
  for (const sql of stmts) {
    await db.prepare(sql).run().catch(() => {});
  }
  await ensureReflectionsSchema(db);
  memberSchemaEnsured = true;
}

const ensuredReflectionsDbs = new WeakSet();

export async function ensureReflectionsSchema(db) {
  if (!db || ensuredReflectionsDbs.has(db)) return;
  try {
    const info = await db.prepare("PRAGMA table_info(activity_reflections)").all();
    const cols = new Set((info?.results || []).map((c) => String(c.name || "").toLowerCase()));
    if (cols.size === 0) {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS activity_reflections (
            id TEXT PRIMARY KEY,
            activity_slug TEXT NOT NULL,
            member_id TEXT NOT NULL,
            participant_role TEXT NOT NULL DEFAULT 'member' CHECK(participant_role IN ('member','volunteer','speaker')),
            pull_quote TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            photo_url TEXT NOT NULL DEFAULT '',
            photo_media_key TEXT NOT NULL DEFAULT '',
            photos_json TEXT NOT NULL DEFAULT '[]',
            mood TEXT NOT NULL DEFAULT '',
            heart_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
            admin_note TEXT NOT NULL DEFAULT '',
            reviewed_by TEXT NOT NULL DEFAULT '',
            reviewed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(activity_slug, member_id),
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
          )`
        )
        .run()
        .catch(() => {});
      ensuredReflectionsDbs.add(db);
      return;
    }
    if (!cols.has("heart_count")) {
      await db.prepare("ALTER TABLE activity_reflections ADD COLUMN heart_count INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
      if (cols.has("hearts_count")) {
        await db.prepare("UPDATE activity_reflections SET heart_count = COALESCE(hearts_count, 0)").run().catch(() => {});
      }
    }
    if (!cols.has("reviewed_by")) {
      await db.prepare("ALTER TABLE activity_reflections ADD COLUMN reviewed_by TEXT NOT NULL DEFAULT ''").run().catch(() => {});
    }
    if (!cols.has("reviewed_at")) {
      await db.prepare("ALTER TABLE activity_reflections ADD COLUMN reviewed_at TEXT").run().catch(() => {});
    }
    if (!cols.has("photo_url")) {
      await db.prepare("ALTER TABLE activity_reflections ADD COLUMN photo_url TEXT NOT NULL DEFAULT ''").run().catch(() => {});
    }
    if (!cols.has("photo_media_key")) {
      await db.prepare("ALTER TABLE activity_reflections ADD COLUMN photo_media_key TEXT NOT NULL DEFAULT ''").run().catch(() => {});
    }
    if (!cols.has("photos_json")) {
      await db.prepare("ALTER TABLE activity_reflections ADD COLUMN photos_json TEXT NOT NULL DEFAULT '[]'").run().catch(() => {});
    }
    if (!cols.has("mood")) {
      await db.prepare("ALTER TABLE activity_reflections ADD COLUMN mood TEXT NOT NULL DEFAULT ''").run().catch(() => {});
    }
    const heartInfo = await db.prepare("PRAGMA table_info(reflection_hearts)").all().catch(() => ({ results: [] }));
    const heartCols = new Set((heartInfo?.results || []).map((c) => String(c.name || "").toLowerCase()));
    if (heartCols.size > 0 && !heartCols.has("reaction_type")) {
      await db.prepare("ALTER TABLE reflection_hearts ADD COLUMN reaction_type TEXT NOT NULL DEFAULT 'heart'").run().catch(() => {});
    }
  } catch (_err) {
    // Non-fatal: let caller surface concrete DB error cleanly
  }
  ensuredReflectionsDbs.add(db);
}

const ensuredEventFeedbackDbs = new WeakSet();

export async function ensureEventFeedbackSchema(db) {
  if (!db || ensuredEventFeedbackDbs.has(db)) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS event_feedbacks (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL DEFAULT '',
          event_slug TEXT NOT NULL DEFAULT '',
          event_title TEXT NOT NULL DEFAULT '',
          source_kind TEXT NOT NULL DEFAULT 'event',
          topic_label TEXT NOT NULL DEFAULT '',
          page_url TEXT NOT NULL DEFAULT '',
          attachment_url TEXT NOT NULL DEFAULT '',
          diagnostics TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'cai-thien' CHECK(category IN ('cai-thien', 'dong-vien', 'de-xuat', 'khac')),
          content TEXT NOT NULL,
          author_name TEXT NOT NULL DEFAULT 'Ẩn danh',
          author_contact TEXT NOT NULL DEFAULT '',
          member_id TEXT NOT NULL DEFAULT '',
          is_anonymous INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'resolved')),
          admin_note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .run();
    const extraCols = [
      "ALTER TABLE event_feedbacks ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'event'",
      "ALTER TABLE event_feedbacks ADD COLUMN topic_label TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE event_feedbacks ADD COLUMN page_url TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE event_feedbacks ADD COLUMN attachment_url TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE event_feedbacks ADD COLUMN diagnostics TEXT NOT NULL DEFAULT ''",
    ];
    for (const ddl of extraCols) {
      await db.prepare(ddl).run().catch(() => {});
    }
    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_event_feedbacks_event_status ON event_feedbacks(event_id, status, created_at DESC)")
      .run()
      .catch(() => {});
    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_event_feedbacks_source_status ON event_feedbacks(source_kind, status, created_at DESC)")
      .run()
      .catch(() => {});
  } catch (_err) {
    // Non-fatal
  }
  ensuredEventFeedbackDbs.add(db);
}
