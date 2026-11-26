import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { AI_RETOUCH_PRESETS, bytesToBase64 } from "../functions/_lib/ai-retouch.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as aiRetouchPost } from "../functions/api/admin/photos/[id]/ai-retouch.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function createMockD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "migrations/0001_init.sql",
    "migrations/0002_seed.sql",
    "migrations/0003_media_portal.sql",
    "migrations/0006_member_auth_and_reflections.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0020_deep_member_media_event_control.sql",
    "migrations/0021_video_media_support.sql",
  ]) {
    db.exec(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }
  class Stmt {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Stmt(this.sql, params);
    }
    async first() {
      return db.prepare(this.sql).get(...this.params) ?? null;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.params) };
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.params);
      return { success: true, meta: { changes: Number(r.changes || 0) } };
    }
  }
  return {
    rawDb: db,
    prepare: (sql) => new Stmt(sql),
  };
}

function createMockKV() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts = {}) {
      store.set(key, { value, metadata: opts.metadata || {} });
    },
    async getWithMetadata(key) {
      const hit = store.get(key);
      return hit ? { value: hit.value, metadata: hit.metadata } : { value: null, metadata: null };
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function makeReq(urlPath, { body = null, cookie = "" } = {}) {
  const headers = new Headers({
    Origin: "https://holarise.org",
    "CF-Connecting-IP": "198.51.100.22",
  });
  if (cookie) headers.set("Cookie", cookie);
  const init = { method: "POST", headers };
  if (body !== null) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(`https://holarise.org${urlPath}`, init);
}

function extractCookie(res, name) {
  const raw = res.headers.get("Set-Cookie") || "";
  const m = raw.match(new RegExp(`${name}=([^;]+)`));
  return m ? `${name}=${m[1]}` : "";
}

const VALID_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 72]);
const VALID_JPEG_DATA_URL = `data:image/jpeg;base64,${bytesToBase64(VALID_JPEG_BYTES)}`;

test("AI Photo Retouch Studio: 1-click generates 3 authentic variants & applies chosen variant while preserving Drive original", async () => {
  const DB = createMockD1();
  const MEDIA_KV = createMockKV();
  const env = { DB, MEDIA_KV, GEMINI_API_KEY: "test-gemini-key" };
  const now = new Date().toISOString();

  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      body: { name: "Sole Admin", email: "203int64@holarise.org", password: "AdminPassword123!" },
    }),
    env,
  });
  const adminCookie = extractCookie(boot, "holarise_session");

  DB.rawDb
    .prepare(
      `INSERT INTO media_albums (id, slug, title, event_date, date_display, location, status, visibility, cover_url, sort_order, created_by, created_at, updated_at)
       VALUES ('alb-ai', 'holaheart-1', 'HolaHeart', '2026-11-15', '15/11/2026', 'Hòa Lạc', 'published', 'public', '/api/media/old-web.jpg', 1, 'admin', ?, ?)`
    )
    .run(now, now);

  DB.rawDb
    .prepare(
      `INSERT INTO media_photos (id, album_id, media_key, url, web_media_key, web_url, caption, alt, approval_status, media_type, created_at, updated_at)
       VALUES ('pho-1', 'alb-ai', 'drive:1AbCdEfGhIjKlMnOpQrSt', '/api/media/drive/1AbCdEfGhIjKlMnOpQrSt', 'old-web.jpg', '/api/media/old-web.jpg', 'Chia sẻ', 'Chia sẻ', 'approved', 'image', ?, ?)`
    )
    .run(now, now);

  await MEDIA_KV.put("media:old-web.jpg", VALID_JPEG_BYTES.buffer, {
    metadata: { contentType: "image/jpeg" },
  });

  // 1. Guest blocked with 401
  const guestRes = await aiRetouchPost({
    request: makeReq("/api/admin/photos/pho-1/ai-retouch", { body: { action: "generate" } }),
    params: { id: "pho-1" },
    env,
  });
  assert.equal(guestRes.status, 401);

  // 2. Missing GEMINI_API_KEY returns clean 503
  const noKeyRes = await aiRetouchPost({
    request: makeReq("/api/admin/photos/pho-1/ai-retouch", {
      cookie: adminCookie,
      body: { action: "generate", imageDataUrl: VALID_JPEG_DATA_URL },
    }),
    params: { id: "pho-1" },
    env: { DB, MEDIA_KV },
  });
  assert.equal(noKeyRes.status, 503);

  // 3. Generate 3 variants via mocked Gemini Interactions REST API
  const seenCalls = [];
  const mockGeminiFetch = async (url, init) => {
    seenCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        id: "int_123",
        status: "completed",
        steps: [
          {
            outputs: [
              {
                type: "image",
                mime_type: "image/jpeg",
                data: bytesToBase64(VALID_JPEG_BYTES),
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const genRes = await aiRetouchPost({
    request: makeReq("/api/admin/photos/pho-1/ai-retouch", {
      cookie: adminCookie,
      body: { action: "generate", imageDataUrl: VALID_JPEG_DATA_URL },
    }),
    params: { id: "pho-1" },
    env,
    fetchImpl: mockGeminiFetch,
  });
  assert.equal(genRes.status, 200);
  const genData = await genRes.json();
  assert.equal(genData.variants.length, AI_RETOUCH_PRESETS.length);
  assert.equal(seenCalls.length, 3);
  assert.equal(seenCalls[0].headers["x-goog-api-key"], "test-gemini-key");
  assert.equal(seenCalls[0].headers["Api-Revision"], "2026-05-20");
  assert.equal(seenCalls[0].body.model, "gemini-nano-banana-2.1");

  // 4. Apply rejects spoofed non-image bytes (magic bytes guard)
  const badApply = await aiRetouchPost({
    request: makeReq("/api/admin/photos/pho-1/ai-retouch", {
      cookie: adminCookie,
      body: {
        action: "apply",
        presetId: "warm_film",
        imageDataUrl: `data:image/jpeg;base64,${btoa("<svg onload=alert(1)>")}`,
      },
    }),
    params: { id: "pho-1" },
    env,
  });
  assert.equal(badApply.status, 415);

  // 5. Apply valid retouched variant -> writes to MEDIA_KV, deletes old-web.jpg, preserves Drive original, updates album cover
  const applyRes = await aiRetouchPost({
    request: makeReq("/api/admin/photos/pho-1/ai-retouch", {
      cookie: adminCookie,
      body: {
        action: "apply",
        presetId: "warm_film",
        imageDataUrl: genData.variants[0].dataUrl,
      },
    }),
    params: { id: "pho-1" },
    env,
  });
  assert.equal(applyRes.status, 200);
  const applyData = await applyRes.json();
  assert.equal(applyData.preservedDriveOriginal, true);
  assert.equal(applyData.item.url, "/api/media/drive/1AbCdEfGhIjKlMnOpQrSt");
  assert.match(applyData.item.webUrl, /^\/api\/media\/ai-/);
  assert.equal(MEDIA_KV.store.has("media:old-web.jpg"), false);
  assert.equal(MEDIA_KV.store.has(`media:${applyData.item.webMediaKey}`), true);

  const albAfter = DB.rawDb.prepare("SELECT cover_url FROM media_albums WHERE id = 'alb-ai'").get();
  assert.equal(albAfter.cover_url, applyData.item.webUrl);
});
