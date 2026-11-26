import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resetDriveCachesForTest } from "../functions/_lib/drive.js";
import { isEventFinished, splitEventsByDate } from "../functions/_lib/render.js";
import { hashPassword, createSession, sniffMediaMime } from "../functions/_lib/security.js";
import { onRequestGet as eventPageGet } from "../functions/su-kien/[slug].js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import {
  onRequestGet as reflectionsGet,
  onRequestPost as reflectionsCreate,
} from "../functions/api/reflections/index.js";
import { onRequestPost as reflectionMediaUpload } from "../functions/api/reflections/media.js";
import { onRequestPost as reflectionReact } from "../functions/api/reflections/[id]/heart.js";
import { onRequestPatch as adminReflectionPatch } from "../functions/api/admin/reflections/[id].js";
import { onRequestPost as eventFeedbackCreate } from "../functions/api/event-feedback/index.js";
import { onRequestGet as adminEventFeedbackList } from "../functions/api/admin/event-feedback/index.js";
import {
  onRequestPatch as adminEventFeedbackPatch,
  onRequestDelete as adminEventFeedbackDelete,
} from "../functions/api/admin/event-feedback/[id].js";
import { onRequestPost as memberAlbumPhotoUpload } from "../functions/api/member/albums/[id]/photos.js";
import { onRequestGet as adminAlbumDetailGet } from "../functions/api/admin/albums/[id]/index.js";
import { onRequestPost as adminPhotoApprove } from "../functions/api/admin/photos/[id]/approve.js";
import { onRequestGet as driveMediaGet } from "../functions/api/media/drive/[id].js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function createMockD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "migrations/0001_init.sql",
    "migrations/0002_seed.sql",
    "migrations/0003_media_portal.sql",
    "migrations/0004_holaheart_first_event.sql",
    "migrations/0005_cuoc_doi_cua_cha_event.sql",
    "migrations/0006_member_auth_and_reflections.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0017_member_photo_contributions.sql",
    "migrations/0019_event_memory_stage.sql",
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
      return { success: true, meta: { changes: r.changes } };
    }
  }

  return {
    rawDb: db,
    prepare(sql) {
      return new Stmt(sql);
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

function createMockAssets() {
  const memoryShell = `<!DOCTYPE html><html><head><title>__SSR_PAGE_TITLE__</title></head><body data-stage="memory" data-album="__SSR_MEMORY_ALBUM_ID__"><h1>__SSR_EVENT_TITLE__</h1><div id="stats">__SSR_MEMORY_STATS_TEXT__</div><div id="gallery">__SSR_MEMORY_GALLERY_HTML__</div></body></html>`;
  const inviteShell = `<!DOCTYPE html><html><head><title>__SSR_PAGE_TITLE__</title></head><body data-stage="invite"><h1>__SSR_EVENT_TITLE__</h1></body></html>`;
  return {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/_templates/event-memory-shell.tpl") {
        return new Response(memoryShell, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (p === "/_templates/event-invitation-shell.tpl") {
        return new Response(inviteShell, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (p.endsWith("/index.html")) {
        return new Response(`<!DOCTYPE html><html><body data-stage="static-invite">static</body></html>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  };
}

function makeReq(urlPath, { method = "GET", body, cookie = "", headers = {} } = {}) {
  const h = new Headers({ Origin: "https://holarise.org", ...headers });
  if (cookie) h.set("Cookie", cookie);
  let payload = body;
  if (body && typeof body === "object" && !(body instanceof Uint8Array) && !(body instanceof FormData)) {
    h.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  return new Request(`https://holarise.org${urlPath}`, { method, headers: h, body: payload });
}

function extractCookie(res, name) {
  const raw = res.headers.get("Set-Cookie") || "";
  const m = raw.match(new RegExp(`${name}=([^;]+)`));
  return m ? `${name}=${m[1]}` : "";
}

test("Post-Event Memory Stage: upcoming stays invite, finished event auto-transforms with approved gallery & hides pending", async () => {
  const DB = createMockD1();
  const ASSETS = createMockAssets();
  const now = new Date().toISOString();

  // Seed 1 upcoming event (2099) and 1 finished event (2025)
  DB.rawDb
    .prepare(
      `INSERT INTO events (id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, image, image_alt, status, sort_order, created_at, updated_at)
       VALUES (?, 'upcoming', 'HolaHeart', '["holaheart"]', '2099-12-20', '20/12/2099', '19:00', 'Hòa Lạc', 'Miễn phí', '20 chỗ', 'Sự kiện tương lai', 'Mô tả tương lai', '[]', '/assets/images/og-cover.jpg', 'alt', 'published', 1, ?, ?)`
    )
    .run("ev-future-demo", now, now);

  DB.rawDb
    .prepare(
      `INSERT INTO events (id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, image, image_alt, status, sort_order, created_at, updated_at)
       VALUES (?, 'past', 'HolaHeart', '["holaheart"]', '2025-11-10', '10/11/2025', '19:00', 'Mây Lang Thang', 'Miễn phí', '', 'Đêm Nhạc Kỷ Niệm', 'Buổi gặp thật ấm áp', '[]', '/assets/images/og-cover.jpg', 'alt', 'published', 2, ?, ?)`
    )
    .run("ev-past-memory", now, now);

  // Create linked album with 1 approved photo and 1 pending photo
  DB.rawDb
    .prepare(
      `INSERT INTO media_albums (id, slug, title, event_date, date_display, location, status, sort_order, event_id, created_by, created_at, updated_at)
       VALUES ('alb-past-1', 'dem-nhac-ky-niem', 'Đêm Nhạc Kỷ Niệm', '2025-11-10', '10/11/2025', 'Mây Lang Thang', 'published', 1, 'ev-past-memory', 'admin', ?, ?)`
    )
    .run(now, now);

  DB.rawDb
    .prepare(
      `INSERT INTO media_photos (id, album_id, url, caption, photographer, approval_status, created_at, updated_at)
       VALUES ('p-ok', 'alb-past-1', '/api/media/approved-1.jpg', 'Ánh đèn vàng', 'Lan Anh', 'approved', ?, ?),
              ('p-pend', 'alb-past-1', '/api/media/pending-secret.jpg', 'Chưa duyệt', 'Ẩn', 'pending', ?, ?)`
    )
    .run(now, now, now, now);

  // Upcoming event still renders invitation (never Memory Stage)
  const upRes = await eventPageGet({
    request: makeReq("/su-kien/ev-future-demo/"),
    params: { slug: "ev-future-demo" },
    env: { DB, ASSETS },
  });
  assert.equal(upRes.status, 200);
  const upHtml = await upRes.text();
  assert.match(upHtml, /data-stage="static-invite"|data-stage="invite"/);

  // Finished event auto-renders Memory Stage with approved photo only (hides pending!)
  const pastRes = await eventPageGet({
    request: makeReq("/su-kien/ev-past-memory/"),
    params: { slug: "ev-past-memory" },
    env: { DB, ASSETS },
  });
  assert.equal(pastRes.status, 200);
  const pastHtml = await pastRes.text();
  assert.match(pastHtml, /data-stage="memory"/);
  assert.match(pastHtml, /data-album="alb-past-1"/);
  assert.match(pastHtml, /Kỷ niệm · Đêm Nhạc Kỷ Niệm/);
  assert.match(pastHtml, /\/api\/media\/approved-1\.jpg/);
  assert.match(pastHtml, /Ảnh: Lan Anh/);
  assert.doesNotMatch(pastHtml, /pending-secret\.jpg/);
});

test("Vivid reflections (mood + 3-emotion reactions switch/toggle) & Guest/Anonymous Event Feedback + Admin RBAC", async () => {
  const DB = createMockD1();
  const env = { DB };

  // Bootstrap super_admin + create a 'media' role user
  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { name: "Admin", email: "203int64@holarise.org", password: "AdminPassword123!" },
    }),
    env,
  });
  assert.equal(boot.status, 201);
  const adminCookie = extractCookie(boot, "holarise_session");

  const { hash, salt } = await hashPassword("MediaPass123!");
  const now = new Date().toISOString();
  DB.rawDb
    .prepare(
      `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at)
       VALUES ('usr-media-1', 'media@holarise.org', 'Ban Hinh Anh', 'media', ?, ?, 1, ?)`
    )
    .run(hash, salt, now);
  const { rawToken: mediaTok } = await createSession(DB, "usr-media-1");
  const mediaCookie = `holarise_session=${mediaTok}`;

  // Register a member
  const reg = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { identifier: "vivid@holarise.org", password: "Password123!", name: "Nguyễn Thảo Vy", organization: "FPT" },
    }),
    env,
  });
  assert.equal(reg.status, 201);
  const memberCookie = extractCookie(reg, "holarise_member_session");

  // 1. Member posts reflection with mood 'cham-sau' and pullQuote
  const postRef = await reflectionsCreate({
    request: makeReq("/api/reflections", {
      method: "POST",
      cookie: memberCookie,
      body: {
        activitySlug: "dem-nhac-ky-niem",
        mood: "cham-sau",
        pullQuote: "Một buổi tối thật bình yên giữa Hòa Lạc",
        content: "Mình đi một mình nhưng cảm thấy rất gần gũi, ai cũng lắng nghe nhau chân thành.",
      },
    }),
    env,
  });
  assert.equal(postRef.status, 201);
  const refData = await postRef.json();
  assert.equal(refData.reflection.mood, "cham-sau");

  // Approve reflection
  const appRef = await adminReflectionPatch({
    request: makeReq(`/api/admin/reflections/${refData.reflection.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { status: "approved" },
    }),
    params: { id: refData.reflection.id },
    env,
  });
  assert.equal(appRef.status, 200);

  // React: heart -> switch to warm -> switch to inspire -> toggle off inspire
  const r1 = await reflectionReact({
    request: makeReq(`/api/reflections/${refData.reflection.id}/heart`, {
      method: "POST",
      cookie: memberCookie,
      body: { reaction: "heart" },
    }),
    params: { id: refData.reflection.id },
    env,
  });
  const j1 = await r1.json();
  assert.equal(j1.myReaction, "heart");
  assert.deepEqual(j1.reactions, { heart: 1, warm: 0, inspire: 0 });

  const r2 = await reflectionReact({
    request: makeReq(`/api/reflections/${refData.reflection.id}/heart`, {
      method: "POST",
      cookie: memberCookie,
      body: { reaction: "warm" },
    }),
    params: { id: refData.reflection.id },
    env,
  });
  const j2 = await r2.json();
  assert.equal(j2.myReaction, "warm");
  assert.deepEqual(j2.reactions, { heart: 0, warm: 1, inspire: 0 });

  // Verify GET /api/reflections returns mood + reactions + myReaction
  const getRefs = await reflectionsGet({
    request: makeReq("/api/reflections?slug=dem-nhac-ky-niem", { cookie: memberCookie }),
    env,
  });
  const listJson = await getRefs.json();
  assert.equal(listJson.items[0].mood, "cham-sau");
  assert.equal(listJson.items[0].myReaction, "warm");
  assert.deepEqual(listJson.items[0].reactions, { heart: 0, warm: 1, inspire: 0 });

  // Toggle off warm
  const r3 = await reflectionReact({
    request: makeReq(`/api/reflections/${refData.reflection.id}/heart`, {
      method: "POST",
      cookie: memberCookie,
      body: { reaction: "warm" },
    }),
    params: { id: refData.reflection.id },
    env,
  });
  const j3 = await r3.json();
  assert.equal(j3.myReaction, "");
  assert.equal(j3.heartCount, 0);

  // 2. Guest submits open event feedback (no login required)
  const guestFb = await eventFeedbackCreate({
    request: makeReq("/api/event-feedback", {
      method: "POST",
      body: {
        eventId: "ev-past-memory",
        eventSlug: "dem-nhac-ky-niem",
        eventTitle: "Đêm Nhạc Kỷ Niệm",
        category: "cai-thien",
        content: "Khâu đón tiếp ở cổng nên có biển chỉ dẫn rõ hơn một chút.",
        isAnonymous: true,
      },
    }),
    env,
  });
  assert.equal(guestFb.status, 201);

  // Member submits ANONYMOUS feedback -> backend MUST strip member_id & contact completely
  const anonMemberFb = await eventFeedbackCreate({
    request: makeReq("/api/event-feedback", {
      method: "POST",
      cookie: memberCookie,
      body: {
        eventId: "ev-past-memory",
        eventSlug: "dem-nhac-ky-niem",
        eventTitle: "Đêm Nhạc Kỷ Niệm",
        category: "dong-vien",
        content: "Cảm ơn ban tổ chức đã chuẩn bị buổi tối rất chỉn chu và ấm cúng.",
        isAnonymous: true,
        authorName: "Nguyễn Thảo Vy",
        authorContact: "0988111222",
      },
    }),
    env,
  });
  assert.equal(anonMemberFb.status, 201);
  const anonId = (await anonMemberFb.json()).id;
  const rawAnonRow = DB.rawDb.prepare("SELECT * FROM event_feedbacks WHERE id = ?").get(anonId);
  assert.equal(rawAnonRow.member_id, "");
  assert.equal(rawAnonRow.author_name, "Ẩn danh");
  assert.equal(rawAnonRow.author_contact, "");
  assert.equal(rawAnonRow.is_anonymous, 1);

  // Role 'media' is BLOCKED from reading private event feedbacks (403)
  const mediaFbList = await adminEventFeedbackList({
    request: makeReq("/api/admin/event-feedback", { cookie: mediaCookie }),
    env,
  });
  assert.equal(mediaFbList.status, 403);

  // Super Admin reads, filters, resolves, and deletes event feedback
  const adminFbList = await adminEventFeedbackList({
    request: makeReq("/api/admin/event-feedback?eventId=ev-past-memory", { cookie: adminCookie }),
    env,
  });
  assert.equal(adminFbList.status, 200);
  const adminFbJson = await adminFbList.json();
  assert.equal(adminFbJson.items.length, 2);

  const patchFb = await adminEventFeedbackPatch({
    request: makeReq(`/api/admin/event-feedback/${anonId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { status: "resolved" },
    }),
    params: { id: anonId },
    env,
  });
  assert.equal(patchFb.status, 200);
  assert.equal((await patchFb.json()).item.status, "resolved");

  const delFb = await adminEventFeedbackDelete({
    request: makeReq(`/api/admin/event-feedback/${anonId}`, {
      method: "DELETE",
      cookie: adminCookie,
    }),
    params: { id: anonId },
    env,
  });
  assert.equal(delFb.status, 200);
});

test("Standardized Drive contribution folder/filename + /media/ team visibility vs approver RBAC", async () => {
  const DB = createMockD1();
  const now = new Date().toISOString();

  // Bootstrap super_admin + media role
  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { name: "Admin", email: "203int64@holarise.org", password: "AdminPassword123!" },
    }),
    env: { DB },
  });
  const adminCookie = extractCookie(boot, "holarise_session");

  const { hash, salt } = await hashPassword("MediaPass123!");
  DB.rawDb
    .prepare(
      `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at)
       VALUES ('usr-media-2', 'media2@holarise.org', 'Ban Hinh Anh 2', 'media', ?, ?, 1, ?)`
    )
    .run(hash, salt, now);
  const { rawToken: mediaTok } = await createSession(DB, "usr-media-2");
  const mediaCookie = `holarise_session=${mediaTok}`;

  DB.rawDb
    .prepare(
      `INSERT INTO media_albums (id, slug, title, event_date, date_display, location, drive_url, status, sort_order, created_by, created_at, updated_at)
       VALUES ('alb-std', 'dem-nhac-ky-niem', 'Đêm Nhạc Kỷ Niệm', '2026-11-20', '20/11/2026', 'Hòa Lạc', 'https://drive.google.com/drive/folders/EvFolderStd123456', 'published', 1, 'admin', ?, ?)`
    )
    .run(now, now);

  const env = {
    DB,
    GOOGLE_DRIVE_CLIENT_ID: "cid",
    GOOGLE_DRIVE_CLIENT_SECRET: "csec",
    GOOGLE_DRIVE_REFRESH_TOKEN: "rtok",
  };

  const reg = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { identifier: "std-photo@holarise.org", password: "PhotoPass123!", name: "Lê Minh Quân" },
    }),
    env,
  });
  const regData = await reg.json();
  const memberCookie = extractCookie(reg, "holarise_member_session");
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

  resetDriveCachesForTest();
  const uploadedNames = [];
  const createdFolders = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("/drive/v3/files") && (!init.method || init.method === "GET")) {
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }
    if (u.includes("/drive/v3/files") && init.method === "POST" && !u.includes("/upload/")) {
      const body = JSON.parse(String(init.body || "{}"));
      const fid = `StdFolder_${createdFolders.length + 1}_abcdefghij`;
      createdFolders.push({ id: fid, name: body.name, parents: body.parents || [] });
      return new Response(JSON.stringify({ id: fid }), { status: 200 });
    }
    if (u.includes("/upload/drive/v3/files") && init.method === "POST") {
      const raw = new TextDecoder().decode(init.body);
      const nm = raw.match(/"name":"([^"]+)"/);
      uploadedNames.push(nm ? nm[1] : "");
      return new Response(
        JSON.stringify({
          id: `DriveStdFile_${uploadedNames.length}_abcdef`,
          name: nm ? nm[1] : "file.jpg",
          mimeType: "image/jpeg",
          size: fakeJpeg.byteLength,
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  try {
    const uploadOnce = async (origName) => {
      const fd = new FormData();
      fd.append("file", new Blob([fakeJpeg], { type: "image/jpeg" }), origName);
      return memberAlbumPhotoUpload({
        request: new Request("https://holarise.org/api/member/albums/alb-std/photos", {
          method: "POST",
          headers: { Origin: "https://holarise.org", Cookie: memberCookie },
          body: fd,
        }),
        params: { id: "alb-std" },
        env,
      });
    };

    const up1 = await uploadOnce("IMG_9991.JPG");
    const up2 = await uploadOnce("IMG_9992.JPG");
    assert.equal(up1.status, 201);
    assert.equal(up2.status, 201);
    const d1 = await up1.json();
    const d2 = await up2.json();

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const code = regData.member.memberCode;
    assert.equal(createdFolders[0].name, "dong-gop");
    assert.equal(createdFolders[1].name, `${stamp}_${code}_le-minh-quan`);
    assert.equal(uploadedNames[0], `dem-nhac-ky-niem_${stamp}_${code}_001.jpg`);
    assert.equal(uploadedNames[1], `dem-nhac-ky-niem_${stamp}_${code}_002.jpg`);
    assert.equal(d1.item.sourceKind, "member_contribution");
    assert.equal(d1.item.approvalStatus, "pending");
    assert.match(d1.item.drivePath, /dong-gop\/.*_001\.jpg$/);

    // Role 'media' CAN view pending contributed photos inside /media/
    const mediaView = await adminAlbumDetailGet({
      request: makeReq("/api/admin/albums/alb-std", { cookie: mediaCookie }),
      params: { id: "alb-std" },
      env,
    });
    assert.equal(mediaView.status, 200);
    const mediaViewJson = await mediaView.json();
    assert.equal(mediaViewJson.photos.length, 2);
    assert.equal(mediaViewJson.photos[0].sourceKind, "member_contribution");

    // Role 'media' CANNOT approve photos (strictly super_admin & editor)
    const mediaApprove = await adminPhotoApprove({
      request: makeReq(`/api/admin/photos/${d1.item.id}/approve`, {
        method: "POST",
        cookie: mediaCookie,
        body: { action: "approve" },
      }),
      params: { id: d1.item.id },
      env,
    });
    assert.equal(mediaApprove.status, 403);

    // Admin approves cleanly
    const adminApprove = await adminPhotoApprove({
      request: makeReq(`/api/admin/photos/${d1.item.id}/approve`, {
        method: "POST",
        cookie: adminCookie,
        body: { action: "approve" },
      }),
      params: { id: d1.item.id },
      env,
    });
    assert.equal(adminApprove.status, 200);
    assert.equal((await adminApprove.json()).item.approvalStatus, "approved");
    assert.ok(d2.item.id);
  } finally {
    globalThis.fetch = origFetch;
    resetDriveCachesForTest();
  }
});

test("Same-day event cutoff: switches to finished/past right after end time in Asia/Ho_Chi_Minh (+07:00)", () => {
  const ev = {
    id: "holaconnect-leo-nui-lam-nghiep-2026-11-26",
    kind: "upcoming",
    date: "2026-11-26",
    time: "14:30 – 17:30",
    title: "HolaConnect · Leo Núi Luốt",
  };
  const beforeEnd = new Date("2026-11-26T16:45:00+07:00");
  const atEnd = new Date("2026-11-26T17:30:00+07:00");
  const afterEnd = new Date("2026-11-26T19:45:00+07:00");

  assert.equal(isEventFinished(ev, beforeEnd), false);
  assert.equal(isEventFinished(ev, atEnd), true);
  assert.equal(isEventFinished(ev, afterEnd), true);

  const splitBefore = splitEventsByDate([ev], beforeEnd);
  assert.equal(splitBefore.upcoming.length, 1);
  assert.equal(splitBefore.past.length, 0);

  const splitAfter = splitEventsByDate([ev], afterEnd);
  assert.equal(splitAfter.upcoming.length, 0);
  assert.equal(splitAfter.past.length, 1);
});

test("Video media sniffing (MP4/MOV/WebM), reflection & album video uploads, and Drive 206 Range streaming", async () => {
  // 1. Magic-byte sniffing for MP4, MOV, WebM, and rejection of garbage bytes
  const mp4Bytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // ftyp
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // isom
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  ]);
  const movBytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, // ftyp
    0x71, 0x74, 0x20, 0x20, 0x00, 0x00, 0x00, 0x00, // qt  
  ]);
  const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x00, 0x00, 0x00]);
  const badBytes = new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e, 0x31, 0x32, 0x33, 0x34]);

  assert.deepEqual(sniffMediaMime(mp4Bytes), { mime: "video/mp4", ext: "mp4", kind: "video" });
  assert.deepEqual(sniffMediaMime(movBytes), { mime: "video/quicktime", ext: "mov", kind: "video" });
  assert.deepEqual(sniffMediaMime(webmBytes), { mime: "video/webm", ext: "webm", kind: "video" });
  assert.equal(sniffMediaMime(badBytes), null);

  // 2. Reflection video upload + Member album video upload + Range 206 streaming proxy
  const DB = createMockD1();
  const now = new Date().toISOString();
  DB.rawDb
    .prepare(
      `INSERT INTO media_albums (id, slug, title, event_date, date_display, location, drive_url, status, sort_order, created_by, created_at, updated_at)
       VALUES ('alb-vid', 'dem-nhac-video', 'Đêm Nhạc Video', '2026-11-26', '26/11/2026', 'Hòa Lạc', 'https://drive.google.com/drive/folders/EvFolderVid123456', 'published', 1, 'admin', ?, ?)`
    )
    .run(now, now);

  const env = {
    DB,
    GOOGLE_DRIVE_CLIENT_ID: "cid",
    GOOGLE_DRIVE_CLIENT_SECRET: "csec",
    GOOGLE_DRIVE_REFRESH_TOKEN: "rtok",
  };

  const reg = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { identifier: "video-member@holarise.org", password: "VideoPass123!", name: "Trần Gia Huy" },
    }),
    env,
  });
  const memberCookie = extractCookie(reg, "holarise_member_session");

  resetDriveCachesForTest();
  let forwardedRange = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("/drive/v3/files") && u.includes("alt=media")) {
      forwardedRange = init.headers?.Range || init.headers?.range || "";
      return new Response(mp4Bytes.slice(0, 12), {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-11/24",
          "Accept-Ranges": "bytes",
        },
      });
    }
    if (u.includes("/drive/v3/files") && (!init.method || init.method === "GET")) {
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }
    if (u.includes("/drive/v3/files") && init.method === "POST" && !u.includes("/upload/")) {
      return new Response(JSON.stringify({ id: "DriveVidFolder_123456789" }), { status: 200 });
    }
    if (u.includes("/upload/drive/v3/files") && init.method === "POST") {
      return new Response(
        JSON.stringify({
          id: "DriveVidFile_1234567890",
          name: "clip.mp4",
          mimeType: "video/mp4",
          size: mp4Bytes.byteLength,
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  try {
    // 2a. Reflection short video upload -> Drive URL with ?kind=video
    const refFd = new FormData();
    refFd.append("file", new Blob([mp4Bytes], { type: "video/mp4" }), "moment.mp4");
    const refVidRes = await reflectionMediaUpload({
      request: new Request("https://holarise.org/api/reflections/media", {
        method: "POST",
        headers: { Origin: "https://holarise.org", Cookie: memberCookie },
        body: refFd,
      }),
      env,
    });
    assert.equal(refVidRes.status, 201);
    const refVidJson = await refVidRes.json();
    assert.equal(refVidJson.mediaType, "video");
    assert.match(refVidJson.url, /\?kind=video$/);

    // 2b. Member album contribution video upload -> pending + media_type='video'
    const albFd = new FormData();
    albFd.append("file", new Blob([mp4Bytes], { type: "video/mp4" }), "IMG_001.MP4");
    const albVidRes = await memberAlbumPhotoUpload({
      request: new Request("https://holarise.org/api/member/albums/alb-vid/photos", {
        method: "POST",
        headers: { Origin: "https://holarise.org", Cookie: memberCookie },
        body: albFd,
      }),
      params: { id: "alb-vid" },
      env,
    });
    assert.equal(albVidRes.status, 201);
    const albVidJson = await albVidRes.json();
    assert.equal(albVidJson.item.mediaType, "video");
    assert.equal(albVidJson.item.approvalStatus, "pending");
    assert.match(albVidJson.standardizedFilename, /\.mp4$/);

    // 2c. Pending video is blocked publicly (403 safeguarding lock)
    const blockedRes = await driveMediaGet({
      request: new Request("https://holarise.org/api/media/drive/DriveVidFile_1234567890?kind=video", {
        method: "GET",
        headers: { Range: "bytes=0-11" },
      }),
      params: { id: "DriveVidFile_1234567890" },
      env,
    });
    assert.equal(blockedRes.status, 403);

    // 2d. Once approved, Drive media proxy forwards Range header and responds 206 Partial Content
    DB.rawDb
      .prepare("UPDATE media_photos SET approval_status = 'approved' WHERE id = ?")
      .run(albVidJson.item.id);
    const rangeRes = await driveMediaGet({
      request: new Request("https://holarise.org/api/media/drive/DriveVidFile_1234567890?kind=video", {
        method: "GET",
        headers: { Range: "bytes=0-11" },
      }),
      params: { id: "DriveVidFile_1234567890" },
      env,
    });
    assert.equal(forwardedRange, "bytes=0-11");
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get("Accept-Ranges"), "bytes");
    assert.equal(rangeRes.headers.get("Content-Range"), "bytes 0-11/24");
    assert.equal(rangeRes.headers.get("Content-Type"), "video/mp4");
  } finally {
    globalThis.fetch = origFetch;
    resetDriveCachesForTest();
  }
});
