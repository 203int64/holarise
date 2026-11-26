import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { sniffAudioMime, sniffMediaMime, createSession, hashPassword } from "../functions/_lib/security.js";
import { isSafeReelAudioUrl } from "../functions/_lib/validation.js";
import { onRequestPost as adminMediaPost } from "../functions/api/admin/media.js";
import { onRequestGet as mediaKvGet } from "../functions/api/media/[id].js";
import { onRequestPatch as adminEventCmdPatch } from "../functions/api/admin/events/[id]/command.js";
import { onRequestGet as vnEventGet } from "../functions/su-kien/[slug].js";
import { onRequestGet as enEventGet } from "../functions/en/events/[slug].js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function createMockD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "migrations/0001_init.sql",
    "migrations/0002_seed.sql",
    "migrations/0003_media_portal.sql",
    "migrations/0004_holaheart_first_event.sql",
    "migrations/0006_member_auth_and_reflections.sql",
    "migrations/0011_event_seats_and_slugs.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0018_event_zalo_url.sql",
    "migrations/0019_event_memory_stage.sql",
    "migrations/0020_deep_member_media_event_control.sql",
    "migrations/0021_video_media_support.sql",
    "migrations/0023_event_reel_music.sql",
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
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

function createMockKv() {
  const store = new Map();
  return {
    async put(key, buf, opts = {}) {
      const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf.slice(0)) : new Uint8Array(buf);
      store.set(key, { value: bytes.buffer, metadata: opts.metadata || {} });
    },
    async getWithMetadata(key) {
      const hit = store.get(key);
      if (!hit) return { value: null, metadata: null };
      return { value: hit.value.slice(0), metadata: hit.metadata };
    },
  };
}

async function seedSoleAdminSession(db) {
  const { hash, salt } = await hashPassword("AdminPass123!");
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at)
       VALUES (?, ?, ?, 'super_admin', ?, ?, 1, ?)`
    )
    .bind("adm-1", "203int64@gmail.com", "Admin", hash, salt, now)
    .run();
  const sess = await createSession(db, "adm-1");
  return `holarise_session=${sess.rawToken}`;
}

test("sniffAudioMime & sniffMediaMime detect MP3/M4A/OGG/WAV and reject SVG/HTML", () => {
  const mp3Id3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0xff, 0xfb]);
  const mp3Raw = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const m4a = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
  const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

  assert.deepEqual(sniffAudioMime(mp3Id3), { mime: "audio/mpeg", ext: "mp3", kind: "audio" });
  assert.deepEqual(sniffAudioMime(mp3Raw), { mime: "audio/mpeg", ext: "mp3", kind: "audio" });
  assert.deepEqual(sniffMediaMime(m4a), { mime: "audio/mp4", ext: "m4a", kind: "audio" });
  assert.deepEqual(sniffMediaMime(ogg), { mime: "audio/ogg", ext: "ogg", kind: "audio" });
  assert.deepEqual(sniffMediaMime(wav), { mime: "audio/wav", ext: "wav", kind: "audio" });
  assert.equal(sniffAudioMime(svg), null);
  assert.equal(sniffMediaMime(svg), null);
});

test("isSafeReelAudioUrl validates presets, safe URLs, and blocks XSS schemes", () => {
  assert.equal(isSafeReelAudioUrl(""), true);
  assert.equal(isSafeReelAudioUrl("preset:holaheart"), true);
  assert.equal(isSafeReelAudioUrl("preset:holagreen"), true);
  assert.equal(isSafeReelAudioUrl("preset:holaconnect"), true);
  assert.equal(isSafeReelAudioUrl("preset:silent"), true);
  assert.equal(isSafeReelAudioUrl("/api/media/aud-20261126-abc123.mp3"), true);
  assert.equal(isSafeReelAudioUrl("/api/media/drive/1AbCdEfGhIjKlMn?kind=audio"), true);
  assert.equal(isSafeReelAudioUrl("https://cdn.example.com/score.mp3"), true);

  assert.equal(isSafeReelAudioUrl("preset:unknown"), false);
  assert.equal(isSafeReelAudioUrl("javascript:alert(1)"), false);
  assert.equal(isSafeReelAudioUrl("data:audio/mp3;base64,AAA"), false);
  assert.equal(isSafeReelAudioUrl("http://insecure.example.com/a.mp3"), false);
  assert.equal(isSafeReelAudioUrl("//evil.example.com/a.mp3"), false);
  assert.equal(isSafeReelAudioUrl("/api/media/../secret.mp3"), false);
});

test("Admin MP3 upload to MEDIA_KV + Safari HTTP Range 206 playback", async () => {
  const db = createMockD1();
  const kv = createMockKv();
  const cookie = await seedSoleAdminSession(db);
  const env = { DB: db, MEDIA_KV: kv };

  // Build 128-byte mock MP3 with ID3 header
  const mp3Bytes = new Uint8Array(128);
  mp3Bytes.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0xff, 0xfb], 0);
  for (let i = 12; i < mp3Bytes.length; i += 1) mp3Bytes[i] = i & 0xff;

  const form = new FormData();
  form.append("category", "su-kien");
  form.append("file", new Blob([mp3Bytes], { type: "audio/mpeg" }), "chieu-rung-thong.mp3");

  const uploadReq = new Request("https://holarise.org/api/admin/media", {
    method: "POST",
    headers: { Origin: "https://holarise.org", Cookie: cookie },
    body: form,
  });
  const uploadRes = await adminMediaPost({ request: uploadReq, env });
  assert.equal(uploadRes.status, 201);
  const uploaded = await uploadRes.json();
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.mediaType, "audio");
  assert.equal(uploaded.contentType, "audio/mpeg");
  assert.match(uploaded.url, /^\/api\/media\/aud-.*\.mp3$/);

  const mediaId = uploaded.id;

  // Full GET returns 200 + Accept-Ranges: bytes
  const fullRes = await mediaKvGet({
    request: new Request(`https://holarise.org/api/media/${mediaId}`),
    env,
    params: { id: mediaId },
  });
  assert.equal(fullRes.status, 200);
  assert.equal(fullRes.headers.get("Accept-Ranges"), "bytes");
  assert.equal(fullRes.headers.get("Content-Type"), "audio/mpeg");
  assert.equal((await fullRes.arrayBuffer()).byteLength, 128);

  // Safari probe Range: bytes=0-15 returns 206 Partial Content
  const rangeRes = await mediaKvGet({
    request: new Request(`https://holarise.org/api/media/${mediaId}`, {
      headers: { Range: "bytes=0-15" },
    }),
    env,
    params: { id: mediaId },
  });
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get("Content-Range"), "bytes 0-15/128");
  assert.equal(rangeRes.headers.get("Content-Length"), "16");
  const chunk = new Uint8Array(await rangeRes.arrayBuffer());
  assert.equal(chunk.byteLength, 16);
  assert.equal(chunk[0], 0x49);
  assert.equal(chunk[15], 15);

  // Out-of-range returns 416
  const badRangeRes = await mediaKvGet({
    request: new Request(`https://holarise.org/api/media/${mediaId}`, {
      headers: { Range: "bytes=500-600" },
    }),
    env,
    params: { id: mediaId },
  });
  assert.equal(badRangeRes.status, 416);
});

test("Event Command PATCH saves per-event soundtrack & VN/EN Memory Stage SSR injects it", async () => {
  const db = createMockD1();
  const cookie = await seedSoleAdminSession(db);

  // Pick a seeded event and force it into memory stage
  const ev = await db.prepare("SELECT * FROM events WHERE status = 'published' LIMIT 1").first();
  assert.ok(ev, "Expected at least one seeded event");

  const env = {
    DB: db,
    ASSETS: {
      async fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/_templates/event-memory-shell.tpl") {
          const tpl = fs.readFileSync(path.join(ROOT, "dist/_templates/event-memory-shell.tpl"), "utf8");
          return new Response(tpl, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        if (p === "/_templates/en-event-memory-shell.tpl") {
          const tpl = fs.readFileSync(path.join(ROOT, "dist/_templates/en-event-memory-shell.tpl"), "utf8");
          return new Response(tpl, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        return new Response("Not Found", { status: 404 });
      },
    },
  };

  // Reject unsafe javascript: URL
  const badPatch = await adminEventCmdPatch({
    request: new Request(`https://holarise.org/api/admin/events/${ev.id}/command`, {
      method: "PATCH",
      headers: {
        Origin: "https://holarise.org",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stageOverride: "memory",
        reelAudioUrl: "javascript:alert(1)",
        reelAudioTitle: "Bad",
      }),
    }),
    env,
    params: { id: ev.id },
  });
  assert.equal(badPatch.status, 400);

  // Save valid custom soundtrack + title
  const okPatch = await adminEventCmdPatch({
    request: new Request(`https://holarise.org/api/admin/events/${ev.id}/command`, {
      method: "PATCH",
      headers: {
        Origin: "https://holarise.org",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stageOverride: "memory",
        reelAudioUrl: "/api/media/aud-20261126-pineforest.mp3",
        reelAudioTitle: "Chiều rừng thông · Acoustic",
      }),
    }),
    env,
    params: { id: ev.id },
  });
  assert.equal(okPatch.status, 200);
  const patchData = await okPatch.json();
  assert.equal(patchData.event.reelAudioUrl, "/api/media/aud-20261126-pineforest.mp3");
  assert.equal(patchData.event.reelAudioTitle, "Chiều rừng thông · Acoustic");

  // VN Memory Stage SSR includes data-reel-audio-url and data-reel-audio-title
  const vnRes = await vnEventGet({
    request: new Request(`https://holarise.org/su-kien/${ev.id}/`),
    env,
    params: { slug: ev.id },
  });
  assert.equal(vnRes.status, 200);
  const vnHtml = await vnRes.text();
  assert.match(vnHtml, /data-reel-audio-url="\/api\/media\/aud-20261126-pineforest\.mp3"/);
  assert.match(vnHtml, /data-reel-audio-title="Chiều rừng thông · Acoustic"/);

  // EN Memory Stage SSR also includes data-reel-audio-url and data-reel-audio-title
  const enRes = await enEventGet({
    request: new Request(`https://holarise.org/en/events/${ev.id}/`),
    env,
    params: { slug: ev.id },
  });
  assert.equal(enRes.status, 200);
  const enHtml = await enRes.text();
  assert.match(enHtml, /data-reel-audio-url="\/api\/media\/aud-20261126-pineforest\.mp3"/);
  assert.match(enHtml, /data-reel-audio-title="Chiều rừng thông · Acoustic"/);
});
