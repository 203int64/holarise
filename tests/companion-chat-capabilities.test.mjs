import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canAdminGrantCapability, maskPhoneForCheckin } from "../functions/_lib/capabilities.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import { onRequestGet as memberDashboard } from "../functions/api/member/dashboard.js";
import { onRequestPost as regCreate } from "../functions/api/registrations.js";
import { onRequestPost as eventFeedbackCreate } from "../functions/api/event-feedback/index.js";
import {
  onRequestGet as chatThreadsGet,
  onRequestPost as chatThreadsPost,
  onRequestPatch as chatThreadsPatch,
} from "../functions/api/chat/threads.js";
import {
  onRequestGet as chatMessagesGet,
  onRequestPost as chatMessagesPost,
} from "../functions/api/chat/messages.js";
import {
  onRequestGet as chatCapsGet,
  onRequestPost as chatCapsPost,
} from "../functions/api/chat/capabilities.js";
import {
  onRequestGet as memberCheckinGet,
  onRequestPost as memberCheckinPost,
} from "../functions/api/member/checkin.js";
import { onRequestGet as ssrEventPage } from "../functions/su-kien/[slug].js";
import { onRequestGet as ssrEnEventPage } from "../functions/en/events/[slug].js";
import { createSession, hashPassword } from "../functions/_lib/security.js";

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
    "migrations/0008_cms_members_and_reflections.sql",
    "migrations/0011_event_seats_and_slugs.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0017_member_photo_contributions.sql",
    "migrations/0018_event_zalo_url.sql",
    "migrations/0019_event_memory_stage.sql",
    "migrations/0020_deep_member_media_event_control.sql",
    "migrations/0021_video_media_support.sql",
    "migrations/0025_companion_chat_and_capabilities.sql",
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

function createMockAssets() {
  return {
    async fetch(req) {
      const pathname = new URL(req.url).pathname;
      const filePath = path.join(ROOT, "dist", pathname.replace(/^\/+/, ""));
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

function makeReq(urlPath, { method = "GET", body, cookie = "", origin = "https://holarise.org" } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  if (method !== "GET" && method !== "HEAD" && origin) headers.set("Origin", origin);
  return new Request(`https://holarise.org${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function extractCookie(res, name) {
  const raw = res.headers.get("Set-Cookie") || "";
  const m = raw.match(new RegExp(`${name}=([^;]+)`));
  return m ? `${name}=${m[1]}` : "";
}

test("Delegation Matrix & Nghị định 13 phone masking invariants", () => {
  assert.equal(canAdminGrantCapability({ role: "super_admin" }, "event.companion"), true);
  assert.equal(canAdminGrantCapability({ role: "editor" }, "event.checkin"), true);
  assert.equal(canAdminGrantCapability({ role: "media" }, "album.view_private"), true);
  assert.equal(canAdminGrantCapability({ role: "media" }, "event.companion"), false);
  assert.equal(canAdminGrantCapability({ role: "media" }, "event.checkin"), false);
  assert.equal(canAdminGrantCapability({ role: "media" }, "media.portal"), false);
  assert.equal(canAdminGrantCapability(null, "album.view_private"), false);

  assert.equal(maskPhoneForCheckin("0987 654 321"), "••••••4321");
  assert.equal(maskPhoneForCheckin("+84 912-345-678"), "••••••5678");
  assert.equal(maskPhoneForCheckin(""), "—");
});

test("End-to-end Companion Chat, Scoped Capabilities, Consent, Privacy Check-in & SSR Companions", async () => {
  const DB = createMockD1();
  const env = { DB, ASSETS: createMockAssets() };

  // Seed a future event & private album (using real events schema: id IS the canonical slug source)
  const nowIso = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO events (id, title, title_en, type, kind, date, date_display, time, location, summary, summary_en, fee, seats, image, image_alt, status, sort_order, created_at, updated_at)
     VALUES ('buoi-gap-2027', 'Vòng tròn Lắng nghe 2027', 'Listening Circle 2027', 'HolaHeart · Nội lực', 'upcoming', '2027-05-10', '10/05/2027', '08:30 – 11:00', 'Đồi Thông Hòa Lạc', 'Buổi gặp gỡ đầu hè.', 'Early summer circle.', 'Miễn phí', '40 chỗ', '/assets/images/og-cover.jpg', 'HolaHeart', 'published', 1, ?, ?)`
  )
    .bind(nowIso, nowIso)
    .run();

  await DB.prepare(
    `INSERT INTO media_albums (id, slug, title, event_id, visibility, status, created_at, updated_at)
     VALUES ('alb-priv-2027', 'album-2027', 'Album Gốc 2027', 'buoi-gap-2027', 'private', 'published', ?, ?)`
  )
    .bind(nowIso, nowIso)
    .run();

  // 1. Bootstrap Super Admin & create a Media Admin
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { name: "Founder Hola", email: "203int64@holarise.org", password: "StrongPassword!2026" },
    }),
    env,
  });
  assert.equal(bootRes.status, 201);
  const adminCookie = extractCookie(bootRes, "holarise_session");
  assert.ok(adminCookie);

  const mediaHash = await hashPassword("MediaPass!2026");
  await DB.prepare(
    `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, created_at)
     VALUES ('adm_media_1', 'media@holarise.org', 'Lan Media', 'media', ?, ?, ?)`
  )
    .bind(mediaHash.hash, mediaHash.salt, nowIso)
    .run();
  const mediaSess = await createSession(DB, "adm_media_1");
  const mediaCookie = `holarise_session=${mediaSess.rawToken}`;

  // 2. Register 2 members (Minh = Companion/Check-in, Binh = unrelated member)
  const regMinh = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        name: "Nguyễn Minh",
        identifier: "0988111222",
        password: "MemberPass!2026",
        pillarChoice: "holaheart",
      },
    }),
    env,
  });
  assert.equal(regMinh.status, 201);
  const minhData = await regMinh.json();
  const minhId = minhData.member.id;
  const minhCookie = extractCookie(regMinh, "holarise_member_session");

  const regBinh = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        name: "Trần Bình",
        identifier: "0988333444",
        password: "MemberPass!2026",
        pillarChoice: "holagreen",
      },
    }),
    env,
  });
  assert.equal(regBinh.status, 201);
  const binhCookie = extractCookie(regBinh, "holarise_member_session");

  // 3. Delegation Matrix check: Media admin CANNOT grant event.companion (403), CAN grant album.view_private (201)
  const mediaForbidden = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: mediaCookie,
      body: { action: "grant", memberId: minhId, capability: "event.companion", scopeId: "buoi-gap-2027" },
    }),
    env,
  });
  assert.equal(mediaForbidden.status, 403);

  const mediaAlbumGrant = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: mediaCookie,
      body: { action: "grant", memberId: minhId, capability: "album.view_private", scopeId: "alb-priv-2027" },
    }),
    env,
  });
  assert.equal(mediaAlbumGrant.status, 201);
  const albGrantRow = await DB.prepare(
    "SELECT 1 AS ok FROM member_album_grants WHERE member_id = ? AND album_id = ?"
  )
    .bind(minhId, "alb-priv-2027")
    .first();
  assert.equal(albGrantRow?.ok, 1, "album.view_private grant immediately syncs member_album_grants");

  // 4. Super Admin grants `event.companion`, `event.checkin`, and `media.portal` to Minh inside chat
  const grantCompRes = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: adminCookie,
      body: {
        action: "grant",
        memberId: minhId,
        capability: "event.companion",
        scopeId: "buoi-gap-2027",
        note: "Minh đón mấy bạn đi một mình giúp mình nhé.",
      },
    }),
    env,
  });
  assert.equal(grantCompRes.status, 201);
  const compCap = (await grantCompRes.json()).capability;
  assert.equal(compCap.status, "pending_accept");

  const grantCheckinRes = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: adminCookie,
      body: {
        action: "grant",
        memberId: minhId,
        capability: "event.checkin",
        scopeId: "buoi-gap-2027",
      },
    }),
    env,
  });
  assert.equal(grantCheckinRes.status, 201);
  const checkinCap = (await grantCheckinRes.json()).capability;

  // 5. Consent-first & authorization checks
  const noConsentRes = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: minhCookie,
      body: { action: "accept", capabilityId: compCap.id, consentAccepted: false },
    }),
    env,
  });
  assert.equal(noConsentRes.status, 400);

  const wrongMemberAccept = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: binhCookie,
      body: { action: "accept", capabilityId: compCap.id, consentAccepted: true },
    }),
    env,
  });
  assert.equal(wrongMemberAccept.status, 403);

  // Minh accepts both with consent + custom welcoming greeting
  const acceptComp = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: minhCookie,
      body: {
        action: "accept",
        capabilityId: compCap.id,
        consentAccepted: true,
        greeting: "Mình đứng ở cổng đồi thông từ 8h15 để đón các bạn đi một mình nhé.",
      },
    }),
    env,
  });
  assert.equal(acceptComp.status, 200);

  const acceptCheckin = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: minhCookie,
      body: { action: "accept", capabilityId: checkinCap.id, consentAccepted: true },
    }),
    env,
  });
  assert.equal(acceptCheckin.status, 200);

  // 6. SSR /su-kien/buoi-gap-2027/ and /en/events/buoi-gap-2027/ render Minh as welcoming host!
  const ssrVi = await ssrEventPage({
    request: makeReq("/su-kien/buoi-gap-2027/"),
    env,
    params: { slug: "buoi-gap-2027" },
  });
  assert.equal(ssrVi.status, 200);
  const htmlVi = await ssrVi.text();
  assert.ok(htmlVi.includes("Nguyễn Minh"), "VN SSR invitation renders active companion name");
  assert.ok(htmlVi.includes("cổng đồi thông"), "VN SSR invitation renders custom greeting");
  assert.ok(htmlVi.includes("data-open-event-chat"), "VN SSR invitation includes lazy chat trigger");

  const ssrEn = await ssrEnEventPage({
    request: makeReq("/en/events/buoi-gap-2027/"),
    env,
    params: { slug: "buoi-gap-2027" },
  });
  assert.equal(ssrEn.status, 200);
  const htmlEn = await ssrEn.text();
  assert.ok(htmlEn.includes("Nguyễn Minh"), "EN SSR invitation renders active companion name");

  // 7. Unauthenticated Guest asks a question (no login wall!) -> HttpOnly guest cookie issued
  const guestStart = await chatThreadsPost({
    request: makeReq("/api/chat/threads", {
      method: "POST",
      body: {
        kind: "event_support",
        eventId: "buoi-gap-2027",
        guestName: "Lê Lan",
        guestContact: "0977555666",
        body: "Em đi từ KTX FPT thì gửi xe ở cổng nào ạ?",
      },
    }),
    env,
  });
  assert.equal(guestStart.status, 201);
  const guestCookie = extractCookie(guestStart, "holarise_guest_chat");
  assert.ok(guestCookie, "Guest chat issues HttpOnly session cookie");
  const guestThread = (await guestStart.json()).thread;

  // 8. Companion Minh sees the guest thread (with PII minimized) & replies -> auto-claims thread!
  const compInbox = await chatThreadsGet({
    request: makeReq("/api/chat/threads?scope=companion", { cookie: minhCookie }),
    env,
  });
  assert.equal(compInbox.status, 200);
  const compInboxData = await compInbox.json();
  assert.equal(compInboxData.threads.length, 1);
  assert.equal(compInboxData.threads[0].contact, "", "Companion does not receive raw guest phone/email");

  // Unrelated member Binh CANNOT read the guest thread
  const binhBlocked = await chatMessagesGet({
    request: makeReq(`/api/chat/messages?threadId=${guestThread.id}`, { cookie: binhCookie }),
    env,
  });
  assert.equal(binhBlocked.status, 403);

  const compReply = await chatMessagesPost({
    request: makeReq("/api/chat/messages", {
      method: "POST",
      cookie: minhCookie,
      body: { threadId: guestThread.id, body: "Em gửi ở cổng B rồi đi bộ 50m có anh mặc áo xanh đón nhé." },
    }),
    env,
  });
  assert.equal(compReply.status, 201);

  // Admin adds an Internal Whisper Note -> invisible to guest & companion, visible to admin!
  const whisperRes = await chatMessagesPost({
    request: makeReq("/api/chat/messages", {
      method: "POST",
      cookie: adminCookie,
      body: { threadId: guestThread.id, body: "Ghi chú nội bộ: ưu tiên xếp bạn này ngồi bàn đầu.", isInternal: true },
    }),
    env,
  });
  assert.equal(whisperRes.status, 201);

  const guestMsgsRes = await chatMessagesGet({
    request: makeReq(`/api/chat/messages?threadId=${guestThread.id}`, { cookie: guestCookie }),
    env,
  });
  const guestMsgs = (await guestMsgsRes.json()).messages;
  assert.equal(guestMsgs.length, 2, "Guest sees only own question + companion reply");
  assert.ok(!guestMsgs.some((m) => m.body.includes("Ghi chú nội bộ")), "Internal whisper note never leaks to guest");

  const adminMsgsRes = await chatMessagesGet({
    request: makeReq(`/api/chat/messages?threadId=${guestThread.id}`, { cookie: adminCookie }),
    env,
  });
  const adminMsgs = (await adminMsgsRes.json()).messages;
  assert.equal(adminMsgs.length, 3, "Admin sees internal whisper note");

  // 9. When guest Lan later creates a Member account with the same phone, guest thread auto-merges!
  const regLan = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        name: "Lê Lan",
        identifier: "0977555666",
        password: "MemberPass!2026",
        pillarChoice: "holaheart",
      },
    }),
    env,
  });
  assert.equal(regLan.status, 201);
  const lanCookie = extractCookie(regLan, "holarise_member_session");
  const lanDash = await memberDashboard({
    request: makeReq("/api/member/dashboard", { cookie: lanCookie }),
    env,
  });
  assert.equal(lanDash.status, 200);
  const lanThreadsRes = await chatThreadsGet({
    request: makeReq("/api/chat/threads", { cookie: lanCookie }),
    env,
  });
  const lanThreads = (await lanThreadsRes.json()).threads;
  assert.ok(
    lanThreads.some((th) => th.id === guestThread.id),
    "Guest thread auto-merges into member account by normalized phone"
  );

  // 10. Anonymous feedback safeguarding check (Nghị định 13): CANNOT link anonymous feedback into member thread
  const anonFb = await eventFeedbackCreate({
    request: makeReq("/api/event-feedback", {
      method: "POST",
      body: {
        eventId: "buoi-gap-2027",
        eventSlug: "buoi-gap-2027",
        category: "cai-thien",
        content: "Mình muốn góp ý ẩn danh về ánh sáng phòng họp.",
        isAnonymous: true,
      },
    }),
    env,
  });
  assert.equal(anonFb.status, 201);
  const anonFbId = (await anonFb.json()).id;

  const linkAnonAttempt = await chatThreadsPost({
    request: makeReq("/api/chat/threads", {
      method: "POST",
      cookie: adminCookie,
      body: {
        kind: "member_direct",
        memberId: minhId,
        body: "Phản hồi góp ý",
        contextCard: { type: "event_feedback", id: anonFbId, title: "Góp ý" },
      },
    }),
    env,
  });
  assert.equal(linkAnonAttempt.status, 403, "Anonymous feedback cannot be linked into a named member thread");

  // 11. Privacy-minimized Event Check-in (`event.checkin`) & Expiry lock
  const regGuestEvent = await regCreate({
    request: makeReq("/api/registrations", {
      method: "POST",
      body: {
        source: "event_modal",
        eventId: "buoi-gap-2027",
        activityTitle: "Vòng tròn Lắng nghe 2027",
        fullName: "Phạm Bảo",
        phone: "0912349876",
        email: "bao@example.com",
        note: "Tâm sự cá nhân tuyệt mật",
      },
    }),
    env,
  });
  assert.equal(regGuestEvent.status, 201);
  const regBaoId = (await regGuestEvent.json()).id;

  // Binh (no event.checkin) is blocked
  const binhCheckin = await memberCheckinGet({
    request: makeReq("/api/member/checkin?eventId=buoi-gap-2027", { cookie: binhCookie }),
    env,
  });
  assert.equal(binhCheckin.status, 403);

  // Minh (active event.checkin) sees ONLY masked phone and NO email/note
  const minhCheckin = await memberCheckinGet({
    request: makeReq("/api/member/checkin?eventId=buoi-gap-2027", { cookie: minhCookie }),
    env,
  });
  assert.equal(minhCheckin.status, 200);
  const checkinPayload = await minhCheckin.json();
  const baoRow = checkinPayload.attendees.find((a) => a.id === regBaoId);
  assert.ok(baoRow);
  assert.equal(baoRow.maskedPhone, "••••••9876");
  assert.equal("email" in baoRow, false, "Check-in list must not expose email");
  assert.equal("note" in baoRow, false, "Check-in list must not expose private notes");

  // Minh checks Bao in
  const markAttended = await memberCheckinPost({
    request: makeReq("/api/member/checkin", {
      method: "POST",
      cookie: minhCookie,
      body: { eventId: "buoi-gap-2027", registrationId: regBaoId, checkedIn: true },
    }),
    env,
  });
  assert.equal(markAttended.status, 200);
  assert.equal((await markAttended.json()).checkedIn, true);

  // Force expiry on event.checkin -> immediately blocked!
  await DB.prepare("UPDATE member_capabilities SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
    .bind(checkinCap.id)
    .run();
  const expiredCheckin = await memberCheckinGet({
    request: makeReq("/api/member/checkin?eventId=buoi-gap-2027", { cookie: minhCookie }),
    env,
  });
  assert.equal(expiredCheckin.status, 403, "Expired check-in capability is immediately locked");

  // 12. Revoking `event.companion` immediately removes Minh from SSR event invitation
  const revokeComp = await chatCapsPost({
    request: makeReq("/api/chat/capabilities", {
      method: "POST",
      cookie: adminCookie,
      body: { action: "revoke", capabilityId: compCap.id },
    }),
    env,
  });
  assert.equal(revokeComp.status, 200);

  const ssrAfterRevoke = await ssrEventPage({
    request: makeReq("/su-kien/buoi-gap-2027/"),
    env,
    params: { slug: "buoi-gap-2027" },
  });
  const htmlAfterRevoke = await ssrAfterRevoke.text();
  assert.ok(!htmlAfterRevoke.includes("cổng đồi thông"), "Revoked companion immediately disappears from SSR page");

  // Thread status update by admin works cleanly
  const resolveThread = await chatThreadsPatch({
    request: makeReq("/api/chat/threads", {
      method: "PATCH",
      cookie: adminCookie,
      body: { threadId: guestThread.id, status: "resolved", claim: true },
    }),
    env,
  });
  assert.equal(resolveThread.status, 200);
  assert.equal((await resolveThread.json()).thread.status, "resolved");

  // Capabilities list endpoint works for admin
  const capsListRes = await chatCapsGet({
    request: makeReq(`/api/chat/capabilities?memberId=${minhId}`, { cookie: adminCookie }),
    env,
  });
  assert.equal(capsListRes.status, 200);
  assert.ok((await capsListRes.json()).capabilities.length >= 3);
});
