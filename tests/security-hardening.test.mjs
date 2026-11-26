import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequest as middlewareOnRequest } from "../functions/_middleware.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as adminPasskeyLoginOptions } from "../functions/api/auth/passkey/login-options.js";
import { onRequestGet as kvMediaGet } from "../functions/api/media/[id].js";
import { onRequestPost as memberLookup } from "../functions/api/member/auth/lookup.js";
import { onRequestPost as memberLogin } from "../functions/api/member/auth/login.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import { onRequestGet as memberStatus } from "../functions/api/member/auth/status.js";
import { onRequestPatch as memberProfilePatch } from "../functions/api/member/profile.js";
import { onRequestGet as memberCardGet } from "../functions/tv/[code].js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function createMockD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "migrations/0001_init.sql",
    "migrations/0002_seed.sql",
    "migrations/0003_media_portal.sql",
    "migrations/0006_member_auth_and_reflections.sql",
    "migrations/0007_passkeys.sql",
    "migrations/0008_cms_members_and_reflections.sql",
    "migrations/0010_admin_passkeys_and_profile.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0017_member_photo_contributions.sql",
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
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

function createMockKV() {
  const store = new Map();
  return {
    async put(key, value, opts = {}) {
      store.set(key, { value, metadata: opts.metadata || {} });
    },
    async getWithMetadata(key) {
      const item = store.get(key);
      if (!item) return { value: null, metadata: null };
      return { value: item.value, metadata: item.metadata };
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function makeReq(urlPath, { method = "GET", body = null, cookie = "", ip = "198.51.100.10" } = {}) {
  const headers = new Headers({
    Origin: "https://holarise.org",
    "CF-Connecting-IP": ip,
  });
  if (cookie) headers.set("Cookie", cookie);
  const init = { method, headers };
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

test("Security Hardening: anti-enumeration on /api/member/auth/lookup & /api/auth/passkey/login-options", async () => {
  const DB = createMockD1();
  const env = { DB };

  // Create real admin + real member
  await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { name: "Sole Admin", email: "203int64@holarise.org", password: "SuperPassword123!" },
    }),
    env,
  });
  await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { name: "Minh Anh", identifier: "minhanh@example.com", password: "Password123!" },
    }),
    env,
  });

  // Lookup must NEVER return `exists` for registered or unregistered identifiers
  const existingRes = await memberLookup({
    request: makeReq("/api/member/auth/lookup", {
      method: "POST",
      body: { identifier: "minhanh@example.com" },
    }),
    env,
  });
  assert.equal(existingRes.status, 200);
  const existingData = await existingRes.json();
  assert.equal("exists" in existingData, false);
  assert.equal(existingData.normalized, "minhanh@example.com");

  const missingRes = await memberLookup({
    request: makeReq("/api/member/auth/lookup", {
      method: "POST",
      body: { identifier: "nobody@example.com" },
    }),
    env,
  });
  assert.equal(missingRes.status, 200);
  const missingData = await missingRes.json();
  assert.equal("exists" in missingData, false);
  assert.equal(missingData.normalized, "nobody@example.com");

  // Insert an admin passkey and verify login-options NEVER leaks allowCredentials by email
  const now = new Date().toISOString();
  const adminRow = DB.rawDb.prepare("SELECT id FROM admin_users LIMIT 1").get();
  DB.rawDb
    .prepare(
      `INSERT INTO admin_passkeys (credential_id, user_id, public_key_spki, algorithm, sign_count, device_label, created_at)
       VALUES ('cred-secret-admin', ?, 'spki', -7, 0, 'MacBook', ?)`
    )
    .run(adminRow.id, now);

  const optRes = await adminPasskeyLoginOptions({
    request: makeReq("/api/auth/passkey/login-options", {
      method: "POST",
      body: { email: "203int64@holarise.org" },
    }),
    env,
  });
  assert.equal(optRes.status, 200);
  const optData = await optRes.json();
  assert.deepEqual(optData.options.allowCredentials, []);
});

test("Security Hardening: pending/rejected photos & draft albums are blocked (403 no-store) on /api/media/[id]", async () => {
  const DB = createMockD1();
  const MEDIA_KV = createMockKV();
  const env = { DB, MEDIA_KV };
  const now = new Date().toISOString();

  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { name: "Sole Admin", email: "203int64@holarise.org", password: "SuperPassword123!" },
    }),
    env,
  });
  const adminCookie = extractCookie(boot, "holarise_session");

  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]).buffer;
  await MEDIA_KV.put("media:pending-photo-1.jpg", fakeJpeg, { metadata: { contentType: "image/jpeg" } });
  await MEDIA_KV.put("media:draft-photo-1.jpg", fakeJpeg, { metadata: { contentType: "image/jpeg" } });
  await MEDIA_KV.put("media:approved-photo-1.jpg", fakeJpeg, { metadata: { contentType: "image/jpeg" } });

  DB.rawDb
    .prepare(
      `INSERT INTO media_albums (id, slug, title, event_date, date_display, location, status, visibility, sort_order, created_by, created_at, updated_at)
       VALUES ('alb-pub', 'pub', 'Public Album', '2026-11-15', '15/11/2026', 'Hòa Lạc', 'published', 'public', 1, 'admin', ?, ?),
              ('alb-draft', 'draft', 'Draft Album', '2026-11-15', '15/11/2026', 'Hòa Lạc', 'draft', 'public', 2, 'admin', ?, ?)`
    )
    .run(now, now, now, now);

  DB.rawDb
    .prepare(
      `INSERT INTO media_photos (id, album_id, url, media_key, approval_status, created_at, updated_at)
       VALUES ('p-pend', 'alb-pub', '/api/media/pending-photo-1.jpg', 'pending-photo-1.jpg', 'pending', ?, ?),
              ('p-draft', 'alb-draft', '/api/media/draft-photo-1.jpg', 'draft-photo-1.jpg', 'approved', ?, ?),
              ('p-ok', 'alb-pub', '/api/media/approved-photo-1.jpg', 'approved-photo-1.jpg', 'approved', ?, ?)`
    )
    .run(now, now, now, now, now, now);

  // Guest blocked from pending photo
  const guestPending = await kvMediaGet({
    request: makeReq("/api/media/pending-photo-1.jpg"),
    params: { id: "pending-photo-1.jpg" },
    env,
  });
  assert.equal(guestPending.status, 403);
  assert.equal(guestPending.headers.get("Cache-Control"), "private, no-store");

  // Guest blocked from draft album photo
  const guestDraft = await kvMediaGet({
    request: makeReq("/api/media/draft-photo-1.jpg"),
    params: { id: "draft-photo-1.jpg" },
    env,
  });
  assert.equal(guestDraft.status, 403);

  // Admin can inspect pending photo, and response MUST remain private, no-store
  const adminPending = await kvMediaGet({
    request: makeReq("/api/media/pending-photo-1.jpg", { cookie: adminCookie }),
    params: { id: "pending-photo-1.jpg" },
    env,
  });
  assert.equal(adminPending.status, 200);
  assert.equal(adminPending.headers.get("Cache-Control"), "private, no-store");
  assert.equal(adminPending.headers.get("Vary"), "Cookie");

  // Approved photo in published public album stays public immutable
  const guestApproved = await kvMediaGet({
    request: makeReq("/api/media/approved-photo-1.jpg"),
    params: { id: "approved-photo-1.jpg" },
    env,
  });
  assert.equal(guestApproved.status, 200);
  assert.match(guestApproved.headers.get("Cache-Control") || "", /immutable/);
});

test("Security Hardening: password change revokes other member sessions & /tv/[code] isolates by member_id", async () => {
  const DB = createMockD1();
  const env = { DB };

  // Register member A (session 1)
  const regA = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { name: "Nguyễn Minh Anh", identifier: "anh1@example.com", password: "OldPassword123!" },
    }),
    env,
  });
  const cookieA1 = extractCookie(regA, "holarise_member_session");
  const dataA = await regA.json();

  // Login on second device (session 2)
  const loginA2 = await memberLogin({
    request: makeReq("/api/member/auth/login", {
      method: "POST",
      body: { identifier: "anh1@example.com", password: "OldPassword123!" },
    }),
    env,
  });
  const cookieA2 = extractCookie(loginA2, "holarise_member_session");

  // Change password on session 1 -> session 2 must be revoked, session 1 stays valid
  const pwRes = await memberProfilePatch({
    request: makeReq("/api/member/profile", {
      method: "PATCH",
      cookie: cookieA1,
      body: { currentPassword: "OldPassword123!", newPassword: "NewPassword456!" },
    }),
    env,
  });
  assert.equal(pwRes.status, 200);

  const st1 = await (await memberStatus({ request: makeReq("/api/member/auth/status", { cookie: cookieA1 }), env })).json();
  const st2 = await (await memberStatus({ request: makeReq("/api/member/auth/status", { cookie: cookieA2 }), env })).json();
  assert.equal(st1.authenticated, true);
  assert.equal(st2.authenticated, false);

  // Register member B with IDENTICAL Vietnamese name
  const regB = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { name: "Nguyễn Minh Anh", identifier: "anh2@example.com", password: "Password123!" },
    }),
    env,
  });
  const dataB = await regB.json();

  // Add approved reflection for member A + unsafe avatar_url directly in DB for member B
  const now = new Date().toISOString();
  DB.rawDb
    .prepare(
      `INSERT INTO activity_reflections (id, activity_slug, member_id, participant_role, pull_quote, content, status, created_at, updated_at)
       VALUES ('ref-a', 'holaheart-1', ?, 'member', 'Riêng của A', 'Nội dung riêng của thành viên A', 'approved', ?, ?)`
    )
    .run(dataA.member.id, now, now);
  DB.rawDb
    .prepare("UPDATE members SET avatar_url = 'javascript:alert(1)' WHERE id = ?")
    .run(dataB.member.id);

  // Member B card must NOT show Member A's reflection and must strip javascript: avatar URL
  const cardB = await memberCardGet({
    request: makeReq(`/tv/${dataB.member.memberCode}`),
    params: { code: dataB.member.memberCode },
    env,
  });
  assert.equal(cardB.status, 200);
  const htmlB = await cardB.text();
  assert.doesNotMatch(htmlB, /Nội dung riêng của thành viên A/);
  assert.doesNotMatch(htmlB, /javascript:alert/);

  // Middleware baseline headers check
  const mwRes = await middlewareOnRequest({
    request: new Request("https://holarise.org/"),
    next: async () => new Response("ok"),
  });
  assert.match(mwRes.headers.get("Permissions-Policy") || "", /geolocation=\(\)/);
  assert.match(mwRes.headers.get("Strict-Transport-Security") || "", /max-age=31536000/);
});
