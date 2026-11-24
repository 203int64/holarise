/**
 * Security, Auth (PBKDF2-SHA256 + D1 Sessions), CSRF Origin Check, Rate Limit & Media Sniffing.
 * Zero external dependencies — pure Web Crypto API (Cloudflare Workers + Node 20+ compatible).
 */

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
  return row || null;
}

export async function requireAdmin(
  context,
  { superAdminOnly = false, allowedRoles = null } = {}
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
  const roles = Array.isArray(allowedRoles) && allowedRoles.length > 0
    ? allowedRoles
    : superAdminOnly
      ? ["super_admin"]
      : ["super_admin", "editor"];
  if (!roles.includes(user.role)) {
    const msg = superAdminOnly
      ? "Chỉ Quản trị viên chính (Super Admin) mới được thực hiện thao tác này."
      : "Tài khoản của bạn không có quyền truy cập khu vực này.";
    return { ok: false, response: errorResponse(403, "FORBIDDEN", msg) };
  }
  return { ok: true, user };
}

export function generateMemberCode(year = 2026) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += MEMBER_CODE_ALPHABET[bytes[i] % MEMBER_CODE_ALPHABET.length];
  }
  return `HOLA-${year}-${suffix}`;
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
