import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ensureDeepControlSchema } from "../functions/_lib/media-access.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestGet as authStatus } from "../functions/api/auth/status.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import { onRequestGet as memberDashboard } from "../functions/api/member/dashboard.js";
import { onRequestGet as memberAlbumsList } from "../functions/api/member/albums/index.js";
import { onRequestPost as memberAlbumPhotoUpload } from "../functions/api/member/albums/[id]/photos.js";
import { onRequestGet as mediaKvGet } from "../functions/api/media/[id].js";
import { onRequestPost as regCreate } from "../functions/api/registrations.js";
import { onRequestGet as adminMembersList } from "../functions/api/admin/members/index.js";
import {
  onRequestGet as adminMember360Get,
  onRequestPatch as adminMemberPatch,
} from "../functions/api/admin/members/[id].js";
import { onRequestPost as adminMemberActions } from "../functions/api/admin/members/[id]/actions.js";
import {
  onRequestGet as adminEventCmdGet,
  onRequestPatch as adminEventCmdPatch,
  onRequestPost as adminEventCmdPost,
} from "../functions/api/admin/events/[id]/command.js";
import {
  onRequestGet as adminAlbumsList,
  onRequestPost as adminAlbumsCreate,
} from "../functions/api/admin/albums/index.js";
import {
  onRequestGet as adminAlbumDetailGet,
  onRequestPatch as adminAlbumDetailPatch,
  onRequestDelete as adminAlbumDetailDelete,
} from "../functions/api/admin/albums/[id]/index.js";
import { onRequestPost as eventFeedbackCreate } from "../functions/api/event-feedback/index.js";
import { onRequestGet as adminEventFeedbackList } from "../functions/api/admin/event-feedback/index.js";
import { onRequestGet as ssrHome } from "../functions/index.js";
import { onRequestGet as ssrEnHome } from "../functions/en/index.js";
import { onRequestGet as ssrJourney } from "../functions/hanh-trinh/index.js";
import { onRequestGet as ssrEnJourney } from "../functions/en/journey/index.js";
import { onRequestGet as ssrEventPage } from "../functions/su-kien/[slug].js";

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
    "migrations/0011_event_seats_and_slugs.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0017_member_photo_contributions.sql",
    "migrations/0018_event_zalo_url.sql",
    "migrations/0019_event_memory_stage.sql",
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

function createMockAssets() {
  const memoryShell = `<!DOCTYPE html><html><head><title>__SSR_PAGE_TITLE__</title><meta property="og:image" content="__SSR_OG_IMAGE__"></head><body data-stage="memory" data-album="__SSR_MEMORY_ALBUM_ID__"><h1>__SSR_EVENT_TITLE__</h1><div id="gallery">__SSR_MEMORY_GALLERY_HTML__</div></body></html>`;
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
      const rel = p.replace(/^\/+/, "");
      const filePath = path.join(ROOT, "dist", rel);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return new Response(fs.readFileSync(filePath, "utf8"), {
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

async function setupEnvAndActors() {
  const d1 = createMockD1();
  const kv = createMockKV();
  const assets = createMockAssets();
  const env = { DB: d1, MEDIA_KV: kv, ASSETS: assets };

  // Sole Admin (203int64@holarise.org)
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { name: "Sole Admin", email: "203int64@holarise.org", password: "StrongPassword123!" },
    }),
    env,
  });
  assert.equal(bootRes.status, 201);
  const adminCookie = extractCookie(bootRes, "holarise_session");

  // Two regular members
  const m1Res = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { name: "Nguyễn Minh Anh", phone: "0912345601", password: "MemberPass123" },
    }),
    env,
  });
  assert.equal(m1Res.status, 201);
  const m1Data = await m1Res.json();
  const m1Cookie = extractCookie(m1Res, "holarise_member_session");

  const m2Res = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { name: "Trần Quốc Bảo", phone: "0912345602", password: "MemberPass123" },
    }),
    env,
  });
  assert.equal(m2Res.status, 201);
  const m2Data = await m2Res.json();
  const m2Cookie = extractCookie(m2Res, "holarise_member_session");

  return { env, d1, kv, adminCookie, m1: m1Data.member, m1Cookie, m2: m2Data.member, m2Cookie };
}

test("Deep Media Access Control: 4 visibility tiers enforced on /api/media/[id], Home/Journey SSR & Member uploads", async () => {
  const { env, d1, kv, adminCookie, m1, m1Cookie, m2, m2Cookie } = await setupEnvAndActors();
  await ensureDeepControlSchema(d1);

  const now = new Date().toISOString();
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  await kv.put("media:secret-photo.jpg", jpegBytes.buffer, { metadata: { contentType: "image/jpeg" } });

  // Seed a published album linked to event + 1 featured photo
  const eventId = "holaheart-cuoc-doi-cua-cha-2026-11-29";
  const albumId = "alb-deep-control-test";
  await d1
    .prepare(
      `INSERT INTO media_albums (id, slug, title, description, event_id, event_date, date_display, location, filters_json, drive_url, cover_url, status, visibility, sort_order, created_at, updated_at)
       VALUES (?, 'alb-deep-control', 'Album Riêng Tư Thử Nghiệm', '', ?, '2026-11-29', '29/11/2026', 'Hòa Lạc', '["holaheart"]', 'https://drive.google.com/drive/folders/abc123', '/api/media/secret-photo.jpg', 'published', 'public', 0, ?, ?)`
    )
    .bind(albumId, eventId, now, now)
    .run();

  await d1
    .prepare(
      `INSERT INTO media_photos (id, album_id, url, web_url, media_key, caption, alt, photographer, is_featured_home, approval_status, sort_order, created_at, updated_at)
       VALUES ('ph-secret-1', ?, '/api/media/secret-photo.jpg', '/api/media/secret-photo.jpg', 'secret-photo.jpg', 'Khoảnh khắc nội bộ', 'Ảnh thử nghiệm', 'Ban Hình Ảnh', 1, 'approved', 0, ?, ?)`
    )
    .bind(albumId, now, now)
    .run();

  // 1. visibility = public -> guest gets 200 + immutable Edge cache
  const pubRes = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg"),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(pubRes.status, 200);
  assert.match(pubRes.headers.get("Cache-Control") || "", /public, max-age=31536000, immutable/);

  // 2. visibility = members_only -> guest gets 403 + private, no-store; member gets 200 + private, no-store
  await d1.prepare("UPDATE media_albums SET visibility = 'members_only' WHERE id = ?").bind(albumId).run();

  const guestMemOnly = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg"),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(guestMemOnly.status, 403);
  assert.equal(guestMemOnly.headers.get("Cache-Control"), "private, no-store");
  assert.equal(guestMemOnly.headers.get("Vary"), "Cookie");

  // Home (VN & EN) and Journey (VN & EN) must NOT leak restricted album photo to guest!
  const homeGuestHtml = await (await ssrHome({ request: makeReq("/"), env })).text();
  assert.ok(!homeGuestHtml.includes("secret-photo.jpg"), "VN Home must not leak non-public album photo");
  const enHomeGuestHtml = await (await ssrEnHome({ request: makeReq("/en/"), env })).text();
  assert.ok(!enHomeGuestHtml.includes("secret-photo.jpg"), "EN Home must not leak non-public album photo");
  const journeyGuestHtml = await (await ssrJourney({ request: makeReq("/hanh-trinh/"), env })).text();
  assert.ok(!journeyGuestHtml.includes("Album Riêng Tư Thử Nghiệm"), "VN Journey must hide members_only album from guest");
  const enJourneyGuestHtml = await (await ssrEnJourney({ request: makeReq("/en/journey/"), env })).text();
  assert.ok(!enJourneyGuestHtml.includes("Album Riêng Tư Thử Nghiệm"), "EN Journey must hide members_only album from guest");

  // Authenticated member CAN view members_only photo & Journey
  const m1MemOnly = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg", { cookie: m1Cookie }),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(m1MemOnly.status, 200);
  assert.equal(m1MemOnly.headers.get("Cache-Control"), "private, no-store");

  const journeyM1Res = await ssrJourney({ request: makeReq("/hanh-trinh/", { cookie: m1Cookie }), env });
  assert.equal(journeyM1Res.headers.get("Cache-Control"), "private, no-store");
  assert.ok((await journeyM1Res.text()).includes("Album Riêng Tư Thử Nghiệm"));

  // 3. visibility = attendees_only -> non-attendee member gets 403, assigned attendee gets 200
  await d1.prepare("UPDATE media_albums SET visibility = 'attendees_only' WHERE id = ?").bind(albumId).run();

  const m1BeforeAttend = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg", { cookie: m1Cookie }),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(m1BeforeAttend.status, 403);

  // Member without access cannot upload to restricted album
  const deniedUpload = await memberAlbumPhotoUpload({
    request: makeReq(`/api/member/albums/${albumId}/photos`, { method: "POST", cookie: m1Cookie }),
    params: { id: albumId },
    env,
  });
  assert.equal(deniedUpload.status, 403);

  // Assign m1 to event via Member 360 action
  const assignRes = await adminMemberActions({
    request: makeReq(`/api/admin/members/${m1.id}/actions`, {
      method: "POST",
      cookie: adminCookie,
      body: { action: "assign_event", eventId, status: "attended" },
    }),
    params: { id: m1.id },
    env,
  });
  assert.equal(assignRes.status, 201);

  const m1AfterAttend = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg", { cookie: m1Cookie }),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(m1AfterAttend.status, 200);

  // 4. visibility = private -> even attendee m1 gets 403 until explicitly granted; m2 with canViewAllMedia gets 200
  await d1.prepare("UPDATE media_albums SET visibility = 'private' WHERE id = ?").bind(albumId).run();

  const m1PrivateDenied = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg", { cookie: m1Cookie }),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(m1PrivateDenied.status, 403);

  // Member albums API hides private album from ungranted m1
  const m1AlbumsBefore = await (await memberAlbumsList({ request: makeReq("/api/member/albums", { cookie: m1Cookie }), env })).json();
  assert.ok(!m1AlbumsBefore.items.some((a) => a.id === albumId), "Private album must be hidden from ungranted member");

  // Grant album specifically to m1 via Member 360 set_album_grants
  const grantRes = await adminMemberActions({
    request: makeReq(`/api/admin/members/${m1.id}/actions`, {
      method: "POST",
      cookie: adminCookie,
      body: { action: "set_album_grants", canViewAllMedia: false, canAccessMediaPortal: false, albumIds: [albumId] },
    }),
    params: { id: m1.id },
    env,
  });
  assert.equal(grantRes.status, 200);

  const m1PrivateAllowed = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg", { cookie: m1Cookie }),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(m1PrivateAllowed.status, 200);

  const m1AlbumsAfter = await (await memberAlbumsList({ request: makeReq("/api/member/albums", { cookie: m1Cookie }), env })).json();
  const grantedAlb = m1AlbumsAfter.items.find((a) => a.id === albumId);
  assert.ok(grantedAlb && grantedAlb.canView === true && grantedAlb.driveUrl.includes("drive.google.com"));

  // Toggle canViewAllMedia = true on m2 -> m2 can view private album without explicit album grant
  const m2PatchRes = await adminMemberPatch({
    request: makeReq(`/api/admin/members/${m2.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { canViewAllMedia: true },
    }),
    params: { id: m2.id },
    env,
  });
  assert.equal(m2PatchRes.status, 200);

  const m2PrivateAllowed = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg", { cookie: m2Cookie }),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(m2PrivateAllowed.status, 200);

  // Sole Admin always has access
  const adminPrivateAllowed = await mediaKvGet({
    request: makeReq("/api/media/secret-photo.jpg", { cookie: adminCookie }),
    params: { id: "secret-photo.jpg" },
    env,
  });
  assert.equal(adminPrivateAllowed.status, 200);
});

test("Member 360° Dossier, Force Revoke Sessions & /media/ Viewer-Only Portal Mode", async () => {
  const { env, d1, adminCookie, m1, m1Cookie } = await setupEnvAndActors();
  const now = new Date().toISOString();

  // Seed published album with 1 approved photo and 1 pending photo
  await d1
    .prepare(
      `INSERT INTO media_albums (id, slug, title, description, event_id, event_date, date_display, location, filters_json, drive_url, cover_url, status, visibility, sort_order, created_at, updated_at)
       VALUES ('alb-viewer-1', 'alb-viewer-1', 'Album Kỷ Niệm', '', '', '2026-11-15', '15/11/2026', 'Hòa Lạc', '[]', '', '', 'published', 'private', 0, ?, ?)`
    )
    .bind(now, now)
    .run();
  await d1
    .prepare(
      `INSERT INTO media_photos (id, album_id, url, web_url, media_key, caption, alt, photographer, is_featured_home, approval_status, sort_order, created_at, updated_at)
       VALUES ('ph-v-ok', 'alb-viewer-1', '/assets/images/logo-mark.png', '/assets/images/logo-mark.png', '', 'Đã duyệt', '', '', 0, 'approved', 0, ?, ?),
              ('ph-v-pend', 'alb-viewer-1', '/assets/images/logo-mark.png', '/assets/images/logo-mark.png', '', 'Chờ duyệt', '', '', 0, 'pending', 1, ?, ?)`
    )
    .bind(now, now, now, now)
    .run();

  // Before granting portal access, auth/status has mediaViewer = null and /api/admin/albums returns 401/403
  const stBefore = await (await authStatus({ request: makeReq("/api/auth/status", { cookie: m1Cookie }), env })).json();
  assert.equal(stBefore.mediaViewer, null);
  const albBefore = await adminAlbumsList({ request: makeReq("/api/admin/albums", { cookie: m1Cookie }), env });
  assert.equal(albBefore.status, 401);

  // Grant canAccessMediaPortal = true via Member 360 actions
  const grantPortal = await adminMemberActions({
    request: makeReq(`/api/admin/members/${m1.id}/actions`, {
      method: "POST",
      cookie: adminCookie,
      body: { action: "set_album_grants", canViewAllMedia: false, canAccessMediaPortal: true, albumIds: ["alb-viewer-1"] },
    }),
    params: { id: m1.id },
    env,
  });
  assert.equal(grantPortal.status, 200);

  // Now auth/status returns mediaViewer object
  const stAfter = await (await authStatus({ request: makeReq("/api/auth/status", { cookie: m1Cookie }), env })).json();
  assert.equal(stAfter.mediaViewer?.role, "media_viewer");
  assert.equal(stAfter.mediaViewer?.id, m1.id);

  // Viewer can GET /api/admin/albums and /api/admin/albums/:id (strictly read-only, approved photos only!)
  const albListRes = await adminAlbumsList({ request: makeReq("/api/admin/albums", { cookie: m1Cookie }), env });
  assert.equal(albListRes.status, 200);
  const albList = await albListRes.json();
  assert.equal(albList.viewerOnly, true);
  assert.ok(albList.items.some((a) => a.id === "alb-viewer-1"));

  const albDetailRes = await adminAlbumDetailGet({
    request: makeReq("/api/admin/albums/alb-viewer-1", { cookie: m1Cookie }),
    params: { id: "alb-viewer-1" },
    env,
  });
  assert.equal(albDetailRes.status, 200);
  const albDetail = await albDetailRes.json();
  assert.equal(albDetail.viewerOnly, true);
  assert.equal(albDetail.photos.length, 1, "Viewer must only see approved photos, not pending");
  assert.equal(albDetail.photos[0].id, "ph-v-ok");

  // Viewer is strictly blocked from mutating albums or accessing /api/admin/members
  const createDenied = await adminAlbumsCreate({
    request: makeReq("/api/admin/albums", { method: "POST", cookie: m1Cookie, body: { title: "Hack Album" } }),
    env,
  });
  assert.ok(createDenied.status === 401 || createDenied.status === 403);

  const patchDenied = await adminAlbumDetailPatch({
    request: makeReq("/api/admin/albums/alb-viewer-1", { method: "PATCH", cookie: m1Cookie, body: { title: "Hacked" } }),
    params: { id: "alb-viewer-1" },
    env,
  });
  assert.ok(patchDenied.status === 401 || patchDenied.status === 403);

  const delDenied = await adminAlbumDetailDelete({
    request: makeReq("/api/admin/albums/alb-viewer-1", { method: "DELETE", cookie: m1Cookie }),
    params: { id: "alb-viewer-1" },
    env,
  });
  assert.ok(delDenied.status === 401 || delDenied.status === 403);

  const adminMembersDenied = await adminMembersList({ request: makeReq("/api/admin/members", { cookie: m1Cookie }), env });
  assert.ok(adminMembersDenied.status === 401 || adminMembersDenied.status === 403);

  // Member 360° GET returns complete dossier
  const dossierRes = await adminMember360Get({
    request: makeReq(`/api/admin/members/${m1.id}`, { cookie: adminCookie }),
    params: { id: m1.id },
    env,
  });
  assert.equal(dossierRes.status, 200);
  const dossier = await dossierRes.json();
  assert.equal(dossier.member.canAccessMediaPortal, true);
  assert.equal(dossier.security.activeSessionCount, 1);
  assert.ok(dossier.mediaAccess.grantedAlbumIds.includes("alb-viewer-1"));

  // Force revoke sessions invalidates m1Cookie immediately!
  const revokeRes = await adminMemberActions({
    request: makeReq(`/api/admin/members/${m1.id}/actions`, {
      method: "POST",
      cookie: adminCookie,
      body: { action: "revoke_sessions" },
    }),
    params: { id: m1.id },
    env,
  });
  assert.equal(revokeRes.status, 200);
  const revokeJson = await revokeRes.json();
  assert.equal(revokeJson.revokedCount, 1);

  const meAfterRevoke = await memberDashboard({ request: makeReq("/api/member/dashboard", { cookie: m1Cookie }), env });
  assert.equal(meAfterRevoke.status, 401);
});

test("Event Command Center: rsvpClosed (409), stageOverride (memory/invite), add_attendee, album grants & anonymous feedback", async () => {
  const { env, d1, adminCookie, m1 } = await setupEnvAndActors();
  const eventId = "holaheart-cuoc-doi-cua-cha-2026-11-29";
  const slug = "cuoc-doi-cua-cha";
  // Shift event date far into future so default stage = invite
  await d1.prepare("UPDATE events SET date = '2099-11-29', kind = 'upcoming' WHERE id = ?").bind(eventId).run();

  const now = new Date().toISOString();
  await d1
    .prepare(
      `INSERT INTO media_albums (id, slug, title, description, event_id, event_date, date_display, location, filters_json, drive_url, cover_url, status, visibility, sort_order, created_at, updated_at)
       VALUES ('alb-cmd-1', ?, 'Ảnh Buổi Cha', '', ?, '2099-11-29', '29/11/2099', 'Hòa Lạc', '[]', '', '', 'published', 'public', 0, ?, ?)`
    )
    .bind(slug, eventId, now, now)
    .run();
  await d1
    .prepare(
      `INSERT INTO media_photos (id, album_id, url, web_url, media_key, caption, alt, photographer, is_featured_home, approval_status, sort_order, created_at, updated_at)
       VALUES ('ph-cmd-1', 'alb-cmd-1', '/assets/images/logo-mark.png', '/assets/images/logo-mark.png', '', 'Ảnh sân khấu', '', '', 0, 'approved', 0, ?, ?)`
    )
    .bind(now, now)
    .run();

  // 1. Add walk-in attendee & member attendee
  const addWalkin = await adminEventCmdPost({
    request: makeReq(`/api/admin/events/${eventId}/command`, {
      method: "POST",
      cookie: adminCookie,
      body: { action: "add_attendee", fullName: "Lê Hoàng Nam", phone: "0988777666", organization: "ĐH FPT", status: "attended" },
    }),
    params: { id: eventId },
    env,
  });
  assert.equal(addWalkin.status, 201);

  // 2. Lock RSVP (rsvpClosed = true) + force stageOverride = 'memory' + set album visibility = 'private'
  const patchCmd = await adminEventCmdPatch({
    request: makeReq(`/api/admin/events/${eventId}/command`, {
      method: "PATCH",
      cookie: adminCookie,
      body: {
        rsvpClosed: true,
        stageOverride: "memory",
        albumId: "alb-cmd-1",
        albumVisibility: "private",
      },
    }),
    params: { id: eventId },
    env,
  });
  assert.equal(patchCmd.status, 200);
  const patchData = await patchCmd.json();
  assert.equal(patchData.event.rsvpClosed, true);
  assert.equal(patchData.event.stageOverride, "memory");

  // 3. Public registration on locked event returns 409 RSVP_CLOSED
  const lockedReg = await regCreate({
    request: makeReq("/api/registrations", {
      method: "POST",
      body: {
        source: "event_modal",
        eventId,
        activityTitle: "Cuộc Đời Của Cha",
        fullName: "Khách Bị Chặn",
        phone: "0911222333",
      },
    }),
    env,
  });
  assert.equal(lockedReg.status, 409);
  const lockedJson = await lockedReg.json();
  assert.equal(lockedJson.error.code, "RSVP_CLOSED");

  // 4. SSR /su-kien/cuoc-doi-cua-cha/ is forced into Memory Stage AND hides private album with unlock message for guest
  const ssrMemRes = await ssrEventPage({
    request: makeReq(`/su-kien/${slug}/`),
    params: { slug },
    env,
  });
  assert.equal(ssrMemRes.status, 200);
  assert.equal(ssrMemRes.headers.get("Cache-Control"), "private, no-store");
  const ssrMemHtml = await ssrMemRes.text();
  assert.ok(ssrMemHtml.includes('data-stage="memory"'), "stageOverride=memory must force Memory Stage on future event");
  assert.ok(ssrMemHtml.includes("Đăng nhập Thành viên để mở khóa ảnh"), "Private album must show unlock prompt to guest");
  assert.ok(!ssrMemHtml.includes("Ảnh sân khấu"), "Private photo caption must not render to guest");

  // 5. Force stageOverride = 'invite' on a past event keeps Invitation Stage
  await d1.prepare("UPDATE events SET date = '2020-01-01', kind = 'past' WHERE id = ?").bind(eventId).run();
  await adminEventCmdPatch({
    request: makeReq(`/api/admin/events/${eventId}/command`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { stageOverride: "invite" },
    }),
    params: { id: eventId },
    env,
  });
  const ssrInvRes = await ssrEventPage({
    request: makeReq(`/su-kien/${slug}/`),
    params: { slug },
    env,
  });
  const ssrInvHtml = await ssrInvRes.text();
  assert.ok(!ssrInvHtml.includes('data-stage="memory"'), "stageOverride=invite must keep Invitation Stage even if past");

  // 6. Grant & revoke album member from Event Command Center + anonymous feedback privacy check
  await adminEventCmdPost({
    request: makeReq(`/api/admin/events/${eventId}/command`, {
      method: "POST",
      cookie: adminCookie,
      body: { action: "grant_album_member", albumId: "alb-cmd-1", memberId: m1.id },
    }),
    params: { id: eventId },
    env,
  });

  const fbSubmit = await eventFeedbackCreate({
    request: makeReq("/api/event-feedback", {
      method: "POST",
      body: {
        eventId,
        eventSlug: slug,
        eventTitle: "Cuộc Đời Của Cha",
        category: "cai-thien",
        content: "Âm thanh góc cuối hơi nhỏ một chút, mong buổi sau tăng nhẹ mic.",
        isAnonymous: true,
        authorName: "Tên Bí Mật Không Được Lộ",
        authorContact: "0999888777",
      },
    }),
    env,
  });
  assert.equal(fbSubmit.status, 201);

  const cmdRes = await adminEventCmdGet({
    request: makeReq(`/api/admin/events/${eventId}/command`, { cookie: adminCookie }),
    params: { id: eventId },
    env,
  });
  assert.equal(cmdRes.status, 200);
  const cmdData = await cmdRes.json();
  assert.equal(cmdData.stats.attended, 1);
  assert.equal(cmdData.album.visibility, "private");
  assert.equal(cmdData.album.grantedMembers.length, 1);
  assert.equal(cmdData.album.grantedMembers[0].memberId, m1.id);
  assert.equal(cmdData.feedbacks.length, 1);
  assert.equal(cmdData.feedbacks[0].isAnonymous, true);
  assert.equal(cmdData.feedbacks[0].authorName, "Ẩn danh");
  assert.equal(cmdData.feedbacks[0].authorContact, "");

  // Global feedback list matches & protects anonymity
  const globalFb = await (await adminEventFeedbackList({ request: makeReq("/api/admin/event-feedback", { cookie: adminCookie }), env })).json();
  assert.equal(globalFb.items[0].authorName, "Ẩn danh");
  assert.equal(globalFb.items[0].authorContact, "");

  // Revoke album member grant
  await adminEventCmdPost({
    request: makeReq(`/api/admin/events/${eventId}/command`, {
      method: "POST",
      cookie: adminCookie,
      body: { action: "revoke_album_member", albumId: "alb-cmd-1", memberId: m1.id },
    }),
    params: { id: eventId },
    env,
  });
  const cmdAfterRevoke = await (
    await adminEventCmdGet({ request: makeReq(`/api/admin/events/${eventId}/command`, { cookie: adminCookie }), params: { id: eventId }, env })
  ).json();
  assert.equal(cmdAfterRevoke.album.grantedMembers.length, 0);
});

test("Admin members list auto-heals missing registrations.member_id and events.zalo_group_url columns", async () => {
  const { env, d1, adminCookie } = await setupEnvAndActors();

  // Simulate legacy production D1 where migration 0006/0018 columns were not applied on registrations/events
  d1.rawDb.exec("DROP INDEX IF EXISTS idx_registrations_member;");
  d1.rawDb.exec("DROP INDEX IF EXISTS idx_registrations_member_event;");
  d1.rawDb.exec("ALTER TABLE registrations DROP COLUMN member_id;");
  d1.rawDb.exec("ALTER TABLE events DROP COLUMN zalo_group_url;");

  // Use a fresh wrapper object so WeakSet cache in ensureDeepControlSchema runs against the degraded schema
  const freshDb = {
    prepare: (sql) => d1.prepare(sql),
    batch: (stmts) => d1.batch(stmts),
  };
  const freshEnv = { ...env, DB: freshDb };

  const res = await adminMembersList({
    request: makeReq("/api/admin/members", { cookie: adminCookie }),
    env: freshEnv,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.items));
  assert.ok(data.items.length >= 2);

  const regCols = d1.rawDb.prepare("PRAGMA table_info(registrations)").all().map((c) => c.name);
  const eventCols = d1.rawDb.prepare("PRAGMA table_info(events)").all().map((c) => c.name);
  assert.ok(regCols.includes("member_id"));
  assert.ok(eventCols.includes("zalo_group_url"));
});
