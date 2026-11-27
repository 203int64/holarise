import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventFolderName,
  buildSizedDriveThumbnailUrl,
  ensureCategorySubfolder,
  fetchDriveImage,
  isDriveConfigured,
  normalizeDriveThumbWidth,
  purgeDriveThumbCache,
  resetDriveCachesForTest,
  trashDriveFile,
  uploadImageToDrive,
} from "../functions/_lib/drive.js";
import { imageAttrs } from "../functions/_lib/render.js";
import { onRequestGet as mediaProxyGet, onRequestHead as mediaProxyHead } from "../functions/api/media/drive/[id].js";
import { onRequestPost as adminMediaPost } from "../functions/api/admin/media.js";

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d,
  0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

const DRIVE_ENV = {
  GOOGLE_DRIVE_CLIENT_ID: "test-client-id",
  GOOGLE_DRIVE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_DRIVE_REFRESH_TOKEN: "test-refresh-token-12345678",
  GOOGLE_DRIVE_ROOT_FOLDER_ID: "rootFolder123456",
};

test("Google Drive API v3: token exchange, folder organization, uncompressed upload, proxy & trash", async () => {
  resetDriveCachesForTest();
  assert.equal(isDriveConfigured({}), false);
  assert.equal(isDriveConfigured(DRIVE_ENV), true);

  const calls = [];
  const mockFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {} });

    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.mock-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (String(url).includes("/drive/v3/files?q=")) {
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?fields=id")) {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: `folder_${body.name}_id` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (String(url).startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      assert.match(String(init.headers["Content-Type"]), /^multipart\/related; boundary=/);
      assert.ok(init.body instanceof Uint8Array);
      assert.ok(init.body.byteLength > TINY_PNG.byteLength);
      return new Response(
        JSON.stringify({
          id: "1AbCdEfGhIjKlMnOpQrStUv",
          name: "event-poster.png",
          mimeType: "image/png",
          size: String(TINY_PNG.byteLength),
          webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (String(url).includes("/drive/v3/files/1AbCdEfGhIjKlMnOpQrStUv?alt=media")) {
      return new Response(TINY_PNG, {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": String(TINY_PNG.byteLength) },
      });
    }

    if (String(url).includes("/drive/v3/files/nonImageFileId12345?alt=media")) {
      return new Response("not an image", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    }

    if (
      String(url).includes("/drive/v3/files/1AbCdEfGhIjKlMnOpQrStUv?supportsAllDrives=true") &&
      init.method === "PATCH"
    ) {
      const body = JSON.parse(init.body);
      assert.equal(body.trashed, true);
      return new Response(JSON.stringify({ id: "1AbCdEfGhIjKlMnOpQrStUv", trashed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  };

  // 1. Upload uncompressed original PNG into su-kien/
  const uploaded = await uploadImageToDrive(DRIVE_ENV, {
    bytes: TINY_PNG,
    mimeType: "image/png",
    filename: "event-poster.png",
    category: "su-kien",
    fetchImpl: mockFetch,
  });

  assert.equal(uploaded.storage, "google_drive");
  assert.equal(uploaded.id, "drive:1AbCdEfGhIjKlMnOpQrStUv");
  assert.equal(uploaded.url, "/api/media/drive/1AbCdEfGhIjKlMnOpQrStUv");
  assert.equal(uploaded.size, TINY_PNG.byteLength);

  // 2. Fetch valid image vs reject non-image
  const fetched = await fetchDriveImage(DRIVE_ENV, "1AbCdEfGhIjKlMnOpQrStUv", mockFetch);
  assert.equal(fetched.ok, true);
  assert.equal(fetched.contentType, "image/png");

  const rejected = await fetchDriveImage(DRIVE_ENV, "nonImageFileId12345", mockFetch);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 415);

  // 3. Trash file on delete
  const trashed = await trashDriveFile(DRIVE_ENV, "1AbCdEfGhIjKlMnOpQrStUv", mockFetch);
  assert.equal(trashed, true);

  // Token endpoint should only be called once thanks to isolate cache
  const tokenCalls = calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token"));
  assert.equal(tokenCalls.length, 1);
});

test("Public proxy /api/media/drive/:id validates IDs, sets immutable CDN cache & supports ?download=1", async () => {
  resetDriveCachesForTest();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.proxy-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/drive/v3/files/1AbCdEfGhIjKlMnOpQrStUv?alt=media")) {
      return new Response(TINY_PNG, {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": String(TINY_PNG.byteLength) },
      });
    }
    return new Response("Not Found", { status: 404 });
  };

  try {
    // Reject bad ID
    const badRes = await mediaProxyGet({
      request: new Request("https://holarise.org/api/media/drive/..bad"),
      env: DRIVE_ENV,
      params: { id: "..bad" },
    });
    assert.equal(badRes.status, 404);

    // Serve valid Drive image with immutable CDN cache
    const okRes = await mediaProxyGet({
      request: new Request("https://holarise.org/api/media/drive/1AbCdEfGhIjKlMnOpQrStUv"),
      env: DRIVE_ENV,
      params: { id: "1AbCdEfGhIjKlMnOpQrStUv" },
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get("Content-Type"), "image/png");
    assert.match(okRes.headers.get("Cache-Control") || "", /immutable/);
    assert.equal(okRes.headers.get("X-Content-Type-Options"), "nosniff");

    // Download mode sets Content-Disposition attachment
    const dlRes = await mediaProxyGet({
      request: new Request("https://holarise.org/api/media/drive/1AbCdEfGhIjKlMnOpQrStUv?download=1"),
      env: DRIVE_ENV,
      params: { id: "1AbCdEfGhIjKlMnOpQrStUv" },
    });
    assert.equal(dlRes.status, 200);
    assert.match(dlRes.headers.get("Content-Disposition") || "", /^attachment; filename="/);

    // HEAD returns empty body with headers
    const headRes = await mediaProxyHead({
      request: new Request("https://holarise.org/api/media/drive/1AbCdEfGhIjKlMnOpQrStUv", { method: "HEAD" }),
      env: DRIVE_ENV,
      params: { id: "1AbCdEfGhIjKlMnOpQrStUv" },
    });
    assert.equal(headRes.status, 200);
    assert.equal(await headRes.text(), "");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { onRequestPost as mediaGatePost } from "../functions/api/auth/media-gate.js";
import { onRequestPost as passkeyLoginOptionsPost } from "../functions/api/auth/passkey/login-options.js";

function createMockD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(fs.readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0003_media_portal.sql", import.meta.url), "utf8"));
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        _params: [],
        bind(...args) {
          this._params = args;
          return this;
        },
        async first() {
          return stmt.get(...this._params) ?? null;
        },
        async all() {
          return { results: stmt.all(...this._params) };
        },
        async run() {
          const info = stmt.run(...this._params);
          return { success: true, meta: { changes: info.changes } };
        },
      };
    },
  };
}

test("Media Gate enforces secret PIN, verified uploader profile, and WebAuthn passkey login challenge", async () => {
  const db = createMockD1();
  const env = { DB: db, MEDIA_ACCESS_PIN: "9999" };

  // 1. Wrong PIN rejected with 401
  const badPinRes = await mediaGatePost({
    request: new Request("https://holarise.org/api/auth/media-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        pin: "0000",
        fullName: "Nguyễn Minh Anh",
        phone: "0912345678",
        department: "Ban Hình Ảnh",
        email: "anh@holarise.org",
      }),
    }),
    env,
  });
  assert.equal(badPinRes.status, 401);

  // 2. Incomplete profile rejected with 400
  const badProfileRes = await mediaGatePost({
    request: new Request("https://holarise.org/api/auth/media-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        pin: "9999",
        fullName: "Anh",
        phone: "123",
        department: "",
        email: "not-an-email",
      }),
    }),
    env,
  });
  assert.equal(badProfileRes.status, 400);

  // 3. Valid PIN + verified profile creates media user, returns Set-Cookie & prompts Passkey setup
  const okRes = await mediaGatePost({
    request: new Request("https://holarise.org/api/auth/media-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        pin: "9999",
        fullName: "Nguyễn Minh Anh",
        phone: "0912345678",
        department: "Ban Hình Ảnh",
        email: "anh@holarise.org",
      }),
    }),
    env,
  });
  assert.equal(okRes.status, 200);
  const okData = await okRes.json();
  assert.equal(okData.ok, true);
  assert.equal(okData.user.name, "Nguyễn Minh Anh");
  assert.equal(okData.user.phone, "0912345678");
  assert.equal(okData.user.department, "Ban Hình Ảnh");
  assert.equal(okData.user.role, "media");
  assert.equal(okData.requiresPasskeySetup, true);
  assert.match(okRes.headers.get("Set-Cookie") || "", /holarise_session=/);

  // 4. Passkey login options returns challenge + rpId
  const optRes = await passkeyLoginOptionsPost({
    request: new Request("https://holarise.org/api/auth/passkey/login-options", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({ email: "anh@holarise.org" }),
    }),
    env,
  });
  assert.equal(optRes.status, 200);
  const optData = await optRes.json();
  assert.equal(optData.options.rpId, "holarise.org");
  assert.ok(optData.options.challenge.length >= 32);
});

import { onRequestPost as verifyGatePost } from "../functions/api/auth/verify-gate.js";

test("2-Step Vault: /api/auth/verify-gate issues HMAC gateToken accepted by Step 2 registration", async () => {
  const db = createMockD1();
  const env = { DB: db, MEDIA_ACCESS_PIN: "1948" };

  // Wrong PIN -> 401
  const wrong = await verifyGatePost({
    request: new Request("https://holarise.org/api/auth/verify-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({ pin: "0000" }),
    }),
    env,
  });
  assert.equal(wrong.status, 401);

  // Correct PIN -> 200 + HMAC gateToken
  const right = await verifyGatePost({
    request: new Request("https://holarise.org/api/auth/verify-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({ pin: "1948" }),
    }),
    env,
  });
  assert.equal(right.status, 200);
  const { gateToken } = await right.json();
  assert.ok(gateToken && gateToken.split(".").length === 3);

  // Step 2 registration using gateToken (without resending raw PIN)
  const reg = await mediaGatePost({
    request: new Request("https://holarise.org/api/auth/media-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        gateToken,
        fullName: "Trần Quốc Bảo",
        phone: "0987654321",
        department: "Ban Truyền Thông",
        email: "bao@holarise.org",
        password: "StrongPassword123",
      }),
    }),
    env,
  });
  assert.equal(reg.status, 200);
  const regData = await reg.json();
  assert.equal(regData.ok, true);
  assert.equal(regData.user.name, "Trần Quốc Bảo");

  // Duplicate email registration must be blocked with 409 EMAIL_EXISTS (no password overwrite)
  const dup = await mediaGatePost({
    request: new Request("https://holarise.org/api/auth/media-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        gateToken,
        fullName: "Kẻ Chiếm Quyền",
        phone: "0911223344",
        department: "Ban Khác",
        email: "bao@holarise.org",
        password: "HackedPassword999",
      }),
    }),
    env,
  });
  assert.equal(dup.status, 409);
  const dupData = await dup.json();
  assert.equal(dupData.error.code, "EMAIL_EXISTS");
});

import { onRequestPost as createEventPost } from "../functions/api/admin/events/index.js";
import { createSession } from "../functions/_lib/security.js";

test("Event & Album folder naming + auto-provision draft media album on event creation", async () => {
  resetDriveCachesForTest();

  // 1. Vietnamese folder naming with date prefix
  assert.equal(
    buildEventFolderName({ eventDate: "2026-11-29", title: "Cuộc Đời Của Cha" }),
    "2026-11-29 - Cuộc Đời Của Cha"
  );
  assert.equal(
    buildEventFolderName({ eventDate: "2026-12-05", title: "HolaGreen: Dọn rác / Hồ Tân Xã" }),
    "2026-12-05 - HolaGreen- Dọn rác - Hồ Tân Xã"
  );

  // 2. ensureCategorySubfolder creates <root>/album/<folderName> and returns Drive URL
  const createdFolders = [];
  const mockFetch = async (url, init = {}) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.folder-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/drive/v3/files?q=")) {
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?fields=id")) {
      const body = JSON.parse(init.body);
      createdFolders.push(body);
      return new Response(JSON.stringify({ id: `drvFolder_${createdFolders.length}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  };

  const folder = await ensureCategorySubfolder(DRIVE_ENV, {
    category: "album",
    subfolder: buildEventFolderName({ eventDate: "2026-11-29", title: "Cuộc Đời Của Cha" }),
    fetchImpl: mockFetch,
  });
  assert.equal(folder.folderName, "2026-11-29 - Cuộc Đời Của Cha");
  assert.equal(folder.folderUrl, "https://drive.google.com/drive/folders/drvFolder_2");
  assert.equal(createdFolders[0].name, "album");
  assert.equal(createdFolders[1].name, "2026-11-29 - Cuộc Đời Của Cha");

  // 3. Creating an event in /admin auto-provisions a matching draft album in media_albums
  const db = createMockD1();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO admin_users (id, email, name, password_hash, password_salt, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
    )
    .bind("usr_admin_1", "203int64@holarise.org", "Admin", "h", "s", "super_admin", now)
    .run();
  const { rawToken } = await createSession(db, "usr_admin_1");

  const evRes = await createEventPost({
    request: new Request("https://holarise.org/api/admin/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://holarise.org",
        Cookie: `holarise_session=${rawToken}`,
      },
      body: JSON.stringify({
        kind: "upcoming",
        type: "Workshop",
        title: "Cuộc Đời Của Cha",
        date: "2026-11-29",
        dateDisplay: "29/11/2026",
        time: "14:00 - 17:00",
        location: "Hòa Lạc",
        fee: "Miễn phí",
        summary: "Buổi trò chuyện về gia đình và lòng biết ơn.",
        filters: ["biet-on"],
      }),
    }),
    env: { DB: db },
  });
  assert.equal(evRes.status, 201);
  const evData = await evRes.json();
  assert.equal(evData.ok, true);
  assert.ok(evData.mediaAlbum);
  assert.equal(evData.mediaAlbum.folderName, "2026-11-29 - Cuộc Đời Của Cha");

  const albRow = await db
    .prepare("SELECT title, event_date, status FROM media_albums WHERE id = ?")
    .bind(evData.mediaAlbum.id)
    .first();
  assert.equal(albRow.title, "Cuộc Đời Của Cha");
  assert.equal(albRow.event_date, "2026-11-29");
  assert.equal(albRow.status, "draft");
});

import { onRequestGet as listAlbumsGet } from "../functions/api/admin/albums/index.js";

test("Migration 0012 fixes production D1 missing 0003: widens role CHECK, preserves admin/sessions, creates media tables", async () => {
  const sqlite = new DatabaseSync(":memory:");
  // Reproduce exact production D1 state: 0001_init + 0010 (WITHOUT 0003_media_portal)
  sqlite.exec(fs.readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  sqlite.exec(
    fs.readFileSync(new URL("../migrations/0010_admin_passkeys_and_profile.sql", import.meta.url), "utf8")
  );
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        _params: [],
        bind(...args) {
          this._params = args;
          return this;
        },
        async first() {
          return stmt.get(...this._params) ?? null;
        },
        async all() {
          return { results: stmt.all(...this._params) };
        },
        async run() {
          const info = stmt.run(...this._params);
          return { success: true, meta: { changes: info.changes } };
        },
      };
    },
  };

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at, phone, department)
       VALUES (?, ?, ?, 'super_admin', 'h', 's', 1, ?, '0987654321', 'Ban Điều Phối')`
    )
    .bind("usr_prod_1", "root@holarise.org", "Root Admin", now)
    .run();
  await createSession(db, "usr_prod_1");

  // Confirm bug before 0012: media-gate fails with CHECK constraint error
  await assert.rejects(
    () =>
      mediaGatePost({
        request: new Request("https://holarise.org/api/auth/media-gate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
          body: JSON.stringify({
            pin: "9999",
            fullName: "Lê Minh Quân",
            phone: "0912345678",
            department: "Ban Hình Ảnh",
            email: "quan@holarise.org",
          }),
        }),
        env: { DB: db, MEDIA_ACCESS_PIN: "9999" },
      }),
    /CHECK constraint failed/
  );

  // Apply 0012 inside a transaction (matching Cloudflare D1 --file behavior)
  sqlite.exec("BEGIN;");
  sqlite.exec(
    fs.readFileSync(new URL("../migrations/0012_fix_media_role_and_tables.sql", import.meta.url), "utf8")
  );
  sqlite.exec("COMMIT;");

  // Verify existing admin user (including phone/department) and active session survived intact
  const preservedAdmin = await db
    .prepare("SELECT email, phone, department, role FROM admin_users WHERE id = ?")
    .bind("usr_prod_1")
    .first();
  assert.deepEqual(
    { ...preservedAdmin },
    {
      email: "root@holarise.org",
      phone: "0987654321",
      department: "Ban Điều Phối",
      role: "super_admin",
    }
  );
  const preservedSessions = await db.prepare("SELECT COUNT(*) AS cnt FROM sessions").first();
  assert.equal(preservedSessions.cnt, 1);

  // Verify media registration now succeeds with 200 OK
  const okRes = await mediaGatePost({
    request: new Request("https://holarise.org/api/auth/media-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        pin: "9999",
        fullName: "Lê Minh Quân",
        phone: "0912345678",
        department: "Ban Hình Ảnh",
        email: "quan@holarise.org",
      }),
    }),
    env: { DB: db, MEDIA_ACCESS_PIN: "9999" },
  });
  assert.equal(okRes.status, 200);
  const okData = await okRes.json();
  assert.equal(okData.ok, true);
  assert.equal(okData.user.role, "media");

  // Verify /api/admin/albums also works with the newly registered media session
  const cookieHeader = (okRes.headers.get("Set-Cookie") || "").split(";")[0];
  const albRes = await listAlbumsGet({
    request: new Request("https://holarise.org/api/admin/albums", {
      method: "GET",
      headers: { Cookie: cookieHeader },
    }),
    env: { DB: db },
  });
  assert.equal(albRes.status, 200);
  const albData = await albRes.json();
  assert.equal(albData.ok, true);
  assert.deepEqual(albData.items, []);
});

test("Admin/Media WebAuthn Passkey end-to-end register-verify & login-verify with ECDSA P-256", async () => {
  const { onRequestPost: registerOptionsPost } = await import("../functions/api/auth/passkey/register-options.js");
  const { onRequestPost: registerVerifyPost } = await import("../functions/api/auth/passkey/register-verify.js");
  const { onRequestPost: loginVerifyPost } = await import("../functions/api/auth/passkey/login-verify.js");
  const { bytesToBase64Url } = await import("../functions/_lib/webauthn.js");

  const db = createMockD1();
  const env = { DB: db, MEDIA_ACCESS_PIN: "9999" };

  // 1. Register media account to obtain valid session cookie
  const gateRes = await mediaGatePost({
    request: new Request("https://holarise.org/api/auth/media-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        pin: "9999",
        fullName: "Trần Hải Yến",
        phone: "0988777666",
        department: "Ban Media",
        email: "yen@holarise.org",
      }),
    }),
    env,
  });
  assert.equal(gateRes.status, 200);
  const cookieHeader = (gateRes.headers.get("Set-Cookie") || "").split(";")[0];

  // 2. Request registration options
  const regOptRes = await registerOptionsPost({
    request: new Request("https://holarise.org/api/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org", Cookie: cookieHeader },
      body: JSON.stringify({}),
    }),
    env,
  });
  assert.equal(regOptRes.status, 200);
  const { options: regOpts } = await regOptRes.json();

  // 3. Generate real ECDSA P-256 keypair and build valid authenticatorData & clientDataJSON
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const spkiBuf = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("holarise.org")));
  const makeAuthData = (signCount) => {
    const out = new Uint8Array(37);
    out.set(rpIdHash, 0);
    out[32] = 0x05; // UP + UV
    out[33] = (signCount >>> 24) & 0xff;
    out[34] = (signCount >>> 16) & 0xff;
    out[35] = (signCount >>> 8) & 0xff;
    out[36] = signCount & 0xff;
    return out;
  };
  const regClientDataBytes = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.create", challenge: regOpts.challenge, origin: "https://holarise.org" })
  );
  const credentialId = "cred-test-p256-001";

  const regVerifyRes = await registerVerifyPost({
    request: new Request("https://holarise.org/api/auth/passkey/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org", Cookie: cookieHeader },
      body: JSON.stringify({
        credentialId,
        publicKeySpki: bytesToBase64Url(spkiBuf),
        algorithm: -7,
        clientDataJSON: bytesToBase64Url(regClientDataBytes),
        authenticatorData: bytesToBase64Url(makeAuthData(1)),
        challenge: regOpts.challenge,
        deviceLabel: "MacBook Touch ID",
      }),
    }),
    env,
  });
  assert.equal(regVerifyRes.status, 201);

  // 4. Request login options and sign real WebAuthn assertion
  const loginOptRes = await passkeyLoginOptionsPost({
    request: new Request("https://holarise.org/api/auth/passkey/login-options", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({}),
    }),
    env,
  });
  assert.equal(loginOptRes.status, 200);
  const { options: loginOpts } = await loginOptRes.json();

  const loginClientDataBytes = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.get", challenge: loginOpts.challenge, origin: "https://holarise.org" })
  );
  const loginAuthData = makeAuthData(2);
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", loginClientDataBytes));
  const payloadToSign = new Uint8Array(loginAuthData.length + clientDataHash.length);
  payloadToSign.set(loginAuthData, 0);
  payloadToSign.set(clientDataHash, loginAuthData.length);

  const rawSig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    payloadToSign
  );

  const loginVerifyRes = await loginVerifyPost({
    request: new Request("https://holarise.org/api/auth/passkey/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({
        credentialId,
        clientDataJSON: bytesToBase64Url(loginClientDataBytes),
        authenticatorData: bytesToBase64Url(loginAuthData),
        signature: bytesToBase64Url(rawSig),
        challenge: loginOpts.challenge,
      }),
    }),
    env,
  });
  assert.equal(loginVerifyRes.status, 200);
  const loginData = await loginVerifyRes.json();
  assert.equal(loginData.ok, true);
  assert.equal(loginData.user.email, "yen@holarise.org");
  assert.match(loginVerifyRes.headers.get("Set-Cookie") || "", /holarise_session=/);
});

const TINY_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
  0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
  0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe,
  0x07, 0x00,
]);

function createMockKv() {
  const store = new Map();
  return {
    _store: store,
    async put(key, value, opts = {}) {
      const buf = value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      store.set(key, { value: buf, metadata: opts.metadata || null });
    },
    async getWithMetadata(key) {
      const hit = store.get(key);
      if (!hit) return { value: null, metadata: null };
      return { value: hit.value, metadata: hit.metadata };
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

test("Drive thumbnail proxy: serves resized WebP thumbnails, warms MEDIA_KV cache, supports ?w=480 & ?raw=1, and purges cache", async () => {
  resetDriveCachesForTest();
  const kv = createMockKv();
  const env = { ...DRIVE_ENV, MEDIA_KV: kv };
  const fileId = "1FastThumbDriveFileId1234";

  assert.equal(normalizeDriveThumbWidth("300"), 480);
  assert.equal(normalizeDriveThumbWidth("900"), 960);
  assert.equal(normalizeDriveThumbWidth("1200"), 1280);
  assert.equal(normalizeDriveThumbWidth("2000"), 1600);
  assert.equal(
    buildSizedDriveThumbnailUrl("https://lh3.googleusercontent.com/drive-storage/abc=s220", 480, { preferWebp: true }),
    "https://lh3.googleusercontent.com/drive-storage/abc=s480-rw"
  );
  assert.equal(buildSizedDriveThumbnailUrl("http://evil.local/x=s220", 480), "");

  const attrs = imageAttrs(`/api/media/drive/${fileId}`, "480px");
  assert.match(attrs, /src="\/api\/media\/drive\/1FastThumbDriveFileId1234\?w=960"/);
  assert.match(attrs, /srcset="[^"]*\?w=480 480w[^"]*\?w=960 960w[^"]*\?w=1280 1280w"/);

  const fetchedUrls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const s = String(url);
    fetchedUrls.push(s);
    if (s.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.thumb-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (s.includes(`/drive/v3/files/${fileId}?fields=thumbnailLink,mimeType`)) {
      return new Response(
        JSON.stringify({
          thumbnailLink: "https://lh3.googleusercontent.com/drive-storage/mocked=s220",
          mimeType: "image/png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (s.startsWith("https://lh3.googleusercontent.com/drive-storage/mocked=s")) {
      return new Response(TINY_WEBP, {
        status: 200,
        headers: { "Content-Type": "image/webp", "Content-Length": String(TINY_WEBP.byteLength) },
      });
    }
    if (s.includes(`/drive/v3/files/${fileId}?alt=media`)) {
      return new Response(TINY_PNG, {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": String(TINY_PNG.byteLength) },
      });
    }
    return new Response("Not Found", { status: 404 });
  };

  try {
    const pendingTasks = [];
    const waitUntil = (p) => pendingTasks.push(p);

    // 1. First request (grid ?w=480, Accept: image/webp) fetches Drive thumbnail =s480-rw and warms KV
    const r1 = await mediaProxyGet({
      request: new Request(`https://holarise.org/api/media/drive/${fileId}?w=480`, {
        headers: { Accept: "image/webp,*/*" },
      }),
      env,
      params: { id: fileId },
      waitUntil,
    });
    await Promise.all(pendingTasks.splice(0));
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get("Content-Type"), "image/webp");
    assert.equal(r1.headers.get("X-Media-Optimized"), "drive-thumb-480");
    assert.equal(r1.headers.get("Vary"), "Accept");
    assert.ok(fetchedUrls.some((u) => u.endsWith("=s480-rw")));
    assert.ok(kv._store.has(`dthumb:${fileId}:480:webp`));

    // 2. Second request serves straight from MEDIA_KV warm cache with ZERO Drive API calls
    const countBefore = fetchedUrls.length;
    const r2 = await mediaProxyGet({
      request: new Request(`https://holarise.org/api/media/drive/${fileId}?w=480`, {
        headers: { Accept: "image/webp,*/*" },
      }),
      env,
      params: { id: fileId },
      waitUntil,
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get("X-Media-Optimized"), "kv-thumb-480");
    assert.equal(fetchedUrls.length, countBefore);

    // 3. ?raw=1 bypasses thumbnail & KV cache to return full original PNG
    const rRaw = await mediaProxyGet({
      request: new Request(`https://holarise.org/api/media/drive/${fileId}?raw=1`, {
        headers: { Accept: "image/webp,*/*" },
      }),
      env,
      params: { id: fileId },
      waitUntil,
    });
    assert.equal(rRaw.status, 200);
    assert.equal(rRaw.headers.get("Content-Type"), "image/png");
    assert.equal(rRaw.headers.get("X-Media-Optimized"), null);

    // 4. Purge cleans cached Drive thumbnails from KV
    await purgeDriveThumbCache(env, fileId);
    assert.equal(kv._store.has(`dthumb:${fileId}:480:webp`), false);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("Dual-upload /api/admin/media stores original on Drive + fast WebP on MEDIA_KV (preferWebUrl=1)", async () => {
  resetDriveCachesForTest();
  const db = createMockD1();
  const kv = createMockKv();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
    )
    .bind("adm-1", "203int64@gmail.com", "Admin", "super_admin", "hash", "salt", now)
    .run();

  const tokenBytes = crypto.getRandomValues(new Uint8Array(16));
  const rawToken = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    )
    .bind(tokenHash, "adm-1", new Date(Date.now() + 3600_000).toISOString(), now)
    .run();

  const env = { ...DRIVE_ENV, DB: db, MEDIA_KV: kv };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.dual-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (s.includes("/drive/v3/files?q=")) {
      return new Response(JSON.stringify({ files: [{ id: "folder_giao_dien" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (s.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      return new Response(
        JSON.stringify({
          id: "1DualUploadDriveFile12345",
          name: "pillar.png",
          mimeType: "image/png",
          size: String(TINY_PNG.byteLength),
          webViewLink: "https://drive.google.com/file/d/1DualUploadDriveFile12345/view",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Not Found", { status: 404 });
  };

  try {
    const form = new FormData();
    form.append("category", "giao-dien");
    form.append("preferWebUrl", "1");
    form.append("file", new Blob([TINY_PNG], { type: "image/png" }), "pillar.png");
    form.append("webFile", new Blob([TINY_WEBP], { type: "image/webp" }), "web.webp");

    const res = await adminMediaPost({
      request: new Request("https://holarise.org/api/admin/media", {
        method: "POST",
        headers: {
          Origin: "https://holarise.org",
          Cookie: `holarise_session=${rawToken}`,
        },
        body: form,
      }),
      env,
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.originalUrl, "/api/media/drive/1DualUploadDriveFile12345");
    assert.match(data.webUrl, /^\/api\/media\/web-\d{8}-[a-f0-9-]+\.webp$/);
    assert.equal(data.url, data.webUrl);
    assert.ok(kv._store.has(`media:${data.webMediaKey}`));
  } finally {
    globalThis.fetch = prevFetch;
  }
});
