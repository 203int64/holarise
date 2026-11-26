import assert from "node:assert/strict";
import test from "node:test";

import { validateRegistrationInput } from "../functions/_lib/validation.js";
import { onRequestPost as registrationsPost } from "../functions/api/registrations.js";
import { onRequestGet as bugScreenshotGet } from "../functions/api/admin/bug-screenshot/[id].js";
import { randomTokenHex, SESSION_COOKIE_NAME, sha256Hex } from "../functions/_lib/security.js";

const TINY_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from(TINY_JPEG).toString("base64")}`;

function createMockKv() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts = {}) {
      store.set(key, { value, opts });
    },
    async getWithMetadata(key) {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: entry.value, metadata: entry.opts?.metadata || null };
    },
  };
}

function createMockDb(adminTokenHash = "") {
  const inserted = [];
  return {
    inserted,
    prepare(sql) {
      const q = String(sql);
      return {
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        async first() {
          if (q.includes("FROM sessions") && adminTokenHash && this._binds[0] === adminTokenHash) {
            return {
              session_id: "sess-1",
              user_id: "u-1",
              email: "203int64@holarise.org",
              name: "Admin",
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
              username: "203int64",
              display_name: "Admin",
              role: "super_admin",
              is_active: 1,
            };
          }
          if (q.includes("FROM rate_limits")) {
            return null;
          }
          if (q.includes("FROM settings")) {
            return null;
          }
          return null;
        },
        async run() {
          if (q.includes("INSERT INTO registrations")) {
            inserted.push(this._binds);
          }
          return { success: true };
        },
      };
    },
  };
}

test("validateRegistrationInput: accepts feedback with diagnostics & valid JPEG screenshotDataUrl", () => {
  const res = validateRegistrationInput({
    source: "feedback",
    role: "Báo lỗi kỹ thuật",
    note: "Nút đăng ký bị lệch trên màn hình iPhone SE.",
    diagnostics: "Trang: /su-kien/demo\nKhung hình: 375x667",
    screenshotDataUrl: TINY_JPEG_DATA_URL,
  });

  assert.equal(res.ok, true);
  assert.equal(res.value.is_feedback, true);
  assert.equal(res.value.screenshot_data_url, TINY_JPEG_DATA_URL);
  assert.match(res.value.diagnostics, /\/su-kien\/demo/);
});

test("validateRegistrationInput: rejects invalid screenshot format and strips screenshot on non-feedback", () => {
  const bad = validateRegistrationInput({
    source: "feedback",
    note: "Lỗi hiển thị phần tiêu đề trang chủ.",
    screenshotDataUrl: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.fields.screenshotDataUrl);

  const nonFeedback = validateRegistrationInput({
    source: "join_page",
    fullName: "Nguyễn Văn An",
    phone: "0987654321",
    screenshotDataUrl: TINY_JPEG_DATA_URL,
    diagnostics: "should-be-ignored",
  });
  assert.equal(nonFeedback.ok, true);
  assert.equal(nonFeedback.value.is_feedback, false);
  assert.equal(nonFeedback.value.screenshot_data_url, "");
  assert.equal(nonFeedback.value.diagnostics, "");
});

test("POST /api/registrations (feedback) saves private bug screenshot to MEDIA_KV & admin endpoint gates access", async () => {
  const rawToken = randomTokenHex(32);
  const tokenHash = await sha256Hex(rawToken);
  const kv = createMockKv();
  const db = createMockDb(tokenHash);

  const req = new Request("https://holarise.org/api/registrations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://holarise.org",
    },
    body: JSON.stringify({
      source: "feedback",
      activity: "Đóng góp · Báo lỗi kỹ thuật",
      role: "Báo lỗi kỹ thuật",
      note: "Màn hình sự kiện bị tràn ngang khi mở trong Zalo.",
      organization: "/su-kien/test",
      diagnostics: "Trang: /su-kien/test\nMôi trường: Zalo WebView / iOS",
      screenshotDataUrl: TINY_JPEG_DATA_URL,
    }),
  });

  const postRes = await registrationsPost({ request: req, env: { DB: db, MEDIA_KV: kv } });
  assert.equal(postRes.status, 201);
  const postJson = await postRes.json();
  assert.equal(postJson.ok, true);
  assert.equal(postJson.screenshotSaved, true);

  assert.equal(kv.store.size, 1);
  const [[kvKey, kvEntry]] = Array.from(kv.store.entries());
  assert.match(kvKey, /^bugshot:bug-.*\.jpg$/);
  assert.equal(kvEntry.opts.expirationTtl, 60 * 60 * 24 * 30);

  const shotId = kvKey.replace(/^bugshot:/, "");
  assert.equal(db.inserted.length, 1);
  const savedNote = String(db.inserted[0][10]);
  assert.match(savedNote, new RegExp(`/api/admin/bug-screenshot/${shotId}`));
  assert.match(savedNote, /Zalo WebView/);

  // 1) Unauthenticated access MUST be blocked (401)
  const unauthRes = await bugScreenshotGet({
    request: new Request(`https://holarise.org/api/admin/bug-screenshot/${shotId}`),
    env: { DB: db, MEDIA_KV: kv },
    params: { id: shotId },
  });
  assert.equal(unauthRes.status, 401);

  // 2) Authenticated admin access MUST succeed with private no-store header
  const authRes = await bugScreenshotGet({
    request: new Request(`https://holarise.org/api/admin/bug-screenshot/${shotId}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${rawToken}` },
    }),
    env: { DB: db, MEDIA_KV: kv },
    params: { id: shotId },
  });
  assert.equal(authRes.status, 200);
  assert.equal(authRes.headers.get("Content-Type"), "image/jpeg");
  assert.equal(authRes.headers.get("Cache-Control"), "private, no-store");
  const returnedBytes = new Uint8Array(await authRes.arrayBuffer());
  assert.deepEqual(returnedBytes, TINY_JPEG);
});
