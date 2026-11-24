import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchDriveImage,
  isDriveConfigured,
  resetDriveCachesForTest,
  trashDriveFile,
  uploadImageToDrive,
} from "../functions/_lib/drive.js";
import { onRequestGet as mediaProxyGet, onRequestHead as mediaProxyHead } from "../functions/api/media/drive/[id].js";

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
