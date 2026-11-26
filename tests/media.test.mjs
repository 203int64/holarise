import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  isSafeExternalHttpsUrl,
  validateAlbumInput,
  validatePhotoInput,
} from "../functions/_lib/validation.js";

import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as authLogin } from "../functions/api/auth/login.js";
import { onRequestPost as authChangePw } from "../functions/api/auth/change-password.js";
import { onRequestPost as usersCreate } from "../functions/api/admin/users/index.js";
import { onRequestGet as regsList } from "../functions/api/admin/registrations/index.js";
import { onRequestGet as postsList } from "../functions/api/admin/posts/index.js";
import { onRequestGet as eventsList } from "../functions/api/admin/events/index.js";
import { onRequestGet as settingsGet } from "../functions/api/admin/settings/index.js";
import { onRequestPost as mediaUpload } from "../functions/api/admin/media.js";
import {
  onRequestGet as albumsList,
  onRequestPost as albumsCreate,
} from "../functions/api/admin/albums/index.js";
import {
  onRequestGet as albumDetail,
  onRequestPatch as albumPatch,
  onRequestDelete as albumDelete,
} from "../functions/api/admin/albums/[id]/index.js";
import { onRequestPost as albumAddPhotos } from "../functions/api/admin/albums/[id]/photos/index.js";
import {
  onRequestPatch as photoPatch,
  onRequestDelete as photoDelete,
} from "../functions/api/admin/photos/[id].js";
import { onRequestGet as ssrJourney } from "../functions/hanh-trinh/index.js";
import { onRequestGet as ssrHome } from "../functions/index.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const ORIGIN = "https://holarise.org";

function createMockD1({ applyMediaMigration = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0001_init.sql"), "utf8"));
  if (applyMediaMigration) {
    db.exec(fs.readFileSync(path.join(ROOT, "migrations/0003_media_portal.sql"), "utf8"));
  }

  class Stmt {
    constructor(sql, bound = []) {
      this.sql = sql;
      this.bound = bound;
    }
    bind(...args) {
      return new Stmt(this.sql, args);
    }
    async first() {
      return db.prepare(this.sql).get(...this.bound) ?? null;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.bound) };
    }
    async run() {
      const info = db.prepare(this.sql).run(...this.bound);
      return { success: true, meta: { changes: Number(info.changes || 0) } };
    }
  }

  return {
    raw: db,
    prepare(sql) {
      return new Stmt(sql);
    },
    async batch(stmts) {
      const out = [];
      db.exec("BEGIN");
      try {
        for (const st of stmts) out.push(await st.run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
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
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return entry;
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function createMockAssets() {
  return {
    async fetch(req) {
      const url = new URL(req.url);
      const rel = url.pathname.replace(/^\/+/, "");
      const filePath = path.join(ROOT, "dist", rel);
      if (!fs.existsSync(filePath)) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(fs.readFileSync(filePath, "utf8"), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
}

function makeReq(urlPath, { method = "GET", cookie = "", json = null, body = null, headers = {} } = {}) {
  const h = new Headers({ Origin: ORIGIN, ...headers });
  if (cookie) h.set("Cookie", cookie);
  let finalBody = body;
  if (json !== null) {
    h.set("Content-Type", "application/json");
    finalBody = JSON.stringify(json);
  }
  return new Request(`${ORIGIN}${urlPath}`, { method, headers: h, body: finalBody });
}

function extractCookie(res) {
  const setCookie = res.headers.get("Set-Cookie") || "";
  return setCookie.split(";")[0];
}

function fakeJpegBytes() {
  // Minimal valid JPEG SOI + APP0 header (>= 12 bytes)
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
}

test("Validation: album & photo input + XSS/protocol guards on driveUrl", () => {
  assert.equal(isSafeExternalHttpsUrl("https://drive.google.com/drive/folders/abc123"), true);
  assert.equal(isSafeExternalHttpsUrl(""), true);
  assert.equal(isSafeExternalHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalHttpsUrl("http://drive.google.com/foo"), false);

  const badAlbum = validateAlbumInput({
    title: "Album Test",
    driveUrl: "javascript:alert(1)",
  });
  assert.equal(badAlbum.ok, false);
  assert.ok(badAlbum.fields.driveUrl);

  const goodAlbum = validateAlbumInput({
    title: "Ra quân Hồ Tân Xã",
    filters: ["sach", "tu-te", "invalid-token"],
    driveUrl: "https://drive.google.com/drive/folders/xyz",
  });
  assert.equal(goodAlbum.ok, true);
  assert.deepEqual(goodAlbum.value.filters, ["sach", "tu-te"]);
  assert.equal(goodAlbum.value.slug, "ra-quan-ho-tan-xa");

  const goodPhoto = validatePhotoInput({
    url: "/api/media/img-20261123-abc1234567.jpg",
    caption: "Ảnh dọn rác ven hồ",
    photographer: "Minh Anh",
    isFeaturedHome: true,
  });
  assert.equal(goodPhoto.ok, true);
  assert.equal(goodPhoto.value.media_key, "img-20261123-abc1234567.jpg");
  assert.equal(goodPhoto.value.is_featured_home, 1);
});

test("Migration 0003 safely preserves existing admin_users & sessions while widening role CHECK", async () => {
  const DB = createMockD1({ applyMediaMigration: false });
  const env = { DB };

  // Bootstrap super_admin BEFORE running migration 0003
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      json: { name: "Admin Chính", email: "203int64@holarise.org", password: "SuperPassword123!" },
    }),
    env,
  });
  assert.equal(bootRes.status, 201);
  const superCookie = extractCookie(bootRes);

  // Now run migration 0003 on live populated tables
  DB.raw.exec(fs.readFileSync(path.join(ROOT, "migrations/0003_media_portal.sql"), "utf8"));

  // Existing super_admin session must still work and be able to create a 'media' user!
  const createMediaRes = await usersCreate({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: superCookie,
      json: {
        name: "Lan Ban Hình Ảnh",
        email: "media@holarise.org",
        role: "media",
        password: "MediaPassword123!",
      },
    }),
    env,
  });
  assert.equal(createMediaRes.status, 201);
  const createdBody = await createMediaRes.json();
  assert.equal(createdBody.item.role, "media");
});

test("RBAC + Full Media Portal CRUD + KV cleanup on delete + SSR /hoat-dong/ & /", async () => {
  const DB = createMockD1({ applyMediaMigration: true });
  const MEDIA_KV = createMockKV();
  const ASSETS = createMockAssets();
  const env = { DB, MEDIA_KV, ASSETS };

  // 1. Bootstrap super_admin and create a 'media' role user
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      json: { name: "Admin Chính", email: "203int64@holarise.org", password: "SuperPassword123!" },
    }),
    env,
  });
  const superCookie = extractCookie(bootRes);

  const uRes = await usersCreate({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: superCookie,
      json: {
        name: "Tùng Nhiếp Ảnh",
        email: "tung.media@holarise.org",
        role: "media",
        password: "MediaPassword123!",
      },
    }),
    env,
  });
  assert.equal(uRes.status, 201);

  // 2. Login as 'media' user
  const loginRes = await authLogin({
    request: makeReq("/api/auth/login", {
      method: "POST",
      json: { email: "tung.media@holarise.org", password: "MediaPassword123!" },
    }),
    env,
  });
  assert.equal(loginRes.status, 200);
  const mediaCookie = extractCookie(loginRes);

  // 3. Strict RBAC: 'media' role MUST be blocked (403) from sensitive CMS endpoints
  const blockedRegs = await regsList({ request: makeReq("/api/admin/registrations", { cookie: mediaCookie }), env });
  const blockedPosts = await postsList({ request: makeReq("/api/admin/posts", { cookie: mediaCookie }), env });
  const blockedEvents = await eventsList({ request: makeReq("/api/admin/events", { cookie: mediaCookie }), env });
  const blockedSettings = await settingsGet({ request: makeReq("/api/admin/settings", { cookie: mediaCookie }), env });
  assert.equal(blockedRegs.status, 403);
  assert.equal(blockedPosts.status, 403);
  assert.equal(blockedEvents.status, 403);
  assert.equal(blockedSettings.status, 403);

  // 4. 'media' user CAN change their own password
  const pwRes = await authChangePw({
    request: makeReq("/api/auth/change-password", {
      method: "POST",
      cookie: mediaCookie,
      json: { currentPassword: "MediaPassword123!", newPassword: "NewMediaPassword456!" },
    }),
    env,
  });
  assert.equal(pwRes.status, 200);

  // 5. 'media' user creates a published album + a draft album
  const createAlbRes = await albumsCreate({
    request: makeReq("/api/admin/albums", {
      method: "POST",
      cookie: mediaCookie,
      json: {
        title: "Ra quân Hồ Tân Xã <script>alert(1)</script>",
        eventDate: "2026-11-22",
        location: "Hồ Tân Xã, Hòa Lạc",
        filters: ["sach", "tu-te"],
        driveUrl: "https://drive.google.com/drive/folders/holarise-tan-xa",
        status: "published",
      },
    }),
    env,
  });
  assert.equal(createAlbRes.status, 201);
  const album = (await createAlbRes.json()).item;

  const draftAlbRes = await albumsCreate({
    request: makeReq("/api/admin/albums", {
      method: "POST",
      cookie: mediaCookie,
      json: {
        title: "Album Nháp Nội Bộ",
        status: "draft",
      },
    }),
    env,
  });
  assert.equal(draftAlbRes.status, 201);
  const draftAlbum = (await draftAlbRes.json()).item;

  // 6. Upload 2 JPEG images to MEDIA_KV as 'media' user
  const up1 = await mediaUpload({
    request: makeReq("/api/admin/media", { method: "POST", cookie: mediaCookie, body: fakeJpegBytes() }),
    env,
  });
  const up2 = await mediaUpload({
    request: makeReq("/api/admin/media", { method: "POST", cookie: mediaCookie, body: fakeJpegBytes() }),
    env,
  });
  assert.equal(up1.status, 201);
  assert.equal(up2.status, 201);
  const img1 = await up1.json();
  const img2 = await up2.json();
  assert.equal(MEDIA_KV.store.size, 2);

  // 7. Attach both photos to the published album (auto-sets cover_url to img1)
  const attachRes = await albumAddPhotos({
    request: makeReq(`/api/admin/albums/${album.id}/photos`, {
      method: "POST",
      cookie: mediaCookie,
      json: {
        photos: [
          { url: img1.url, mediaKey: img1.id, caption: "Ảnh 1 ven hồ", photographer: "Tùng", isFeaturedHome: true },
          { url: img2.url, mediaKey: img2.id, caption: "Ảnh 2 phân loại rác", photographer: "Tùng", isFeaturedHome: false },
        ],
      },
    }),
    params: { id: album.id },
    env,
  });
  assert.equal(attachRes.status, 201);
  const attached = await attachRes.json();
  assert.equal(attached.items.length, 2);
  // CTV ('media') uploads enter 'pending' state and do NOT appear publicly until Admin approves
  assert.equal(attached.items[0].approvalStatus, "pending");
  assert.equal(attached.items[1].approvalStatus, "pending");

  const pendingActRes = await ssrJourney({ request: new Request(`${ORIGIN}/hanh-trinh/`), env });
  const pendingActHtml = await pendingActRes.text();
  assert.ok(!pendingActHtml.includes("Ra quân Hồ Tân Xã"));

  // 7b. CTV ('media') is blocked (403) from self-approving; Admin approves & stores compressed web copy
  const { onRequestPost: photoApprove } = await import("../functions/api/admin/photos/[id]/approve.js");
  const ctvApproveBlocked = await photoApprove({
    request: makeReq(`/api/admin/photos/${attached.items[0].id}/approve`, {
      method: "POST",
      cookie: mediaCookie,
      json: { action: "approve" },
    }),
    params: { id: attached.items[0].id },
    env,
  });
  assert.equal(ctvApproveBlocked.status, 403);

  // Admin approves photo 1 with compressed file (stored in MEDIA_KV as web_url) and photo 2 via JSON
  const fd = new FormData();
  fd.append("action", "approve");
  fd.append("file", new Blob([fakeJpegBytes()], { type: "image/jpeg" }), "compressed.jpg");
  const approveP1 = await photoApprove({
    request: new Request(`${ORIGIN}/api/admin/photos/${attached.items[0].id}/approve`, {
      method: "POST",
      headers: { Cookie: superCookie, Origin: ORIGIN },
      body: fd,
    }),
    params: { id: attached.items[0].id },
    env,
  });
  assert.equal(approveP1.status, 200);
  const approvedP1 = (await approveP1.json()).item;
  assert.equal(approvedP1.approvalStatus, "approved");
  assert.ok(approvedP1.webUrl.startsWith("/api/media/web-"));

  // Admin pins approved photo 1 to Home and approves photo 2
  const pinP1 = await photoPatch({
    request: makeReq(`/api/admin/photos/${attached.items[0].id}`, {
      method: "PATCH",
      cookie: superCookie,
      json: { isFeaturedHome: true },
    }),
    params: { id: attached.items[0].id },
    env,
  });
  assert.equal(pinP1.status, 200);

  const approveP2 = await photoApprove({
    request: makeReq(`/api/admin/photos/${attached.items[1].id}/approve`, {
      method: "POST",
      cookie: superCookie,
      json: { action: "approve" },
    }),
    params: { id: attached.items[1].id },
    env,
  });
  assert.equal(approveP2.status, 200);

  // 8. Verify SSR /hanh-trinh/ renders published album (XSS escaped!), uses compressed webUrl, excludes draft album, keeps static gallery
  const actRes = await ssrJourney({
    request: new Request(`${ORIGIN}/hanh-trinh/`),
    env,
  });
  assert.equal(actRes.status, 200);
  const actHtml = await actRes.text();
  assert.ok(actHtml.includes("Ra quân Hồ Tân Xã &lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(actHtml.includes(approvedP1.webUrl));
  assert.ok(!actHtml.includes("<script>alert(1)</script>"));
  // Public gallery strictly hides external Google Drive download links for member privacy (BP-03)
  assert.ok(!actHtml.includes("https://drive.google.com/drive/folders/holarise-tan-xa"));
  assert.ok(!actHtml.includes("Album Nháp Nội Bộ"));
  assert.ok(actHtml.includes("HolaHeart × MusicSpace"));

  // 9. Verify SSR / renders featured home photo in HORIZONTAL_GALLERY using compressed webUrl
  const homeRes = await ssrHome({
    request: new Request(`${ORIGIN}/`),
    env,
  });
  assert.equal(homeRes.status, 200);
  const homeHtml = await homeRes.text();
  assert.ok(homeHtml.includes(approvedP1.webUrl));
  assert.ok(homeHtml.includes("Ảnh 1 ven hồ"));

  // 10. Patch photo 2 as cover, then delete photo 2 -> KV key must be deleted & cover falls back to img1
  const patchP2 = await photoPatch({
    request: makeReq(`/api/admin/photos/${attached.items[1].id}`, {
      method: "PATCH",
      cookie: mediaCookie,
      json: { setAsCover: true, caption: "Ảnh 2 đã sửa" },
    }),
    params: { id: attached.items[1].id },
    env,
  });
  assert.equal(patchP2.status, 200);

  const delP2 = await photoDelete({
    request: makeReq(`/api/admin/photos/${attached.items[1].id}`, {
      method: "DELETE",
      cookie: mediaCookie,
    }),
    params: { id: attached.items[1].id },
    env,
  });
  assert.equal(delP2.status, 200);
  assert.equal(MEDIA_KV.store.has(`media:${img2.id}`), false);

  const detAfterDel = await albumDetail({
    request: makeReq(`/api/admin/albums/${album.id}`, { cookie: mediaCookie }),
    params: { id: album.id },
    env,
  });
  const detBody = await detAfterDel.json();
  assert.equal(detBody.album.coverUrl, img1.url);
  assert.equal(detBody.photos.length, 1);

  // 11. Delete entire album -> remaining KV key (img1) must also be cleaned up
  const delAlb = await albumDelete({
    request: makeReq(`/api/admin/albums/${album.id}`, {
      method: "DELETE",
      cookie: mediaCookie,
    }),
    params: { id: album.id },
    env,
  });
  assert.equal(delAlb.status, 200);
  assert.equal(MEDIA_KV.store.size, 0);

  // 12. List albums still works and shows seed + draft album
  const listRes = await albumsList({
    request: makeReq("/api/admin/albums", { cookie: mediaCookie }),
    env,
  });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.ok(listBody.items.some((a) => a.id === draftAlbum.id));
  assert.ok(listBody.items.some((a) => a.id === "album-khoanh-khac-hoa-lac"));
});
