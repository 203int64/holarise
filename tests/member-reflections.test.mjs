import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parseMemberIdentifier, validateReflectionInput } from "../functions/_lib/validation.js";
import { resetDriveCachesForTest } from "../functions/_lib/drive.js";
import { generateQrSvg } from "../functions/_lib/qr.js";
import { onRequestGet as memberPassGet } from "../functions/tv/[code].js";
import { onRequestPost as adminMemberCreate } from "../functions/api/admin/members/index.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import { onRequestPost as memberLogin } from "../functions/api/member/auth/login.js";
import { onRequestPost as memberLogout } from "../functions/api/member/auth/logout.js";
import { onRequestGet as memberStatus } from "../functions/api/member/auth/status.js";
import { onRequestGet as memberDashboard } from "../functions/api/member/dashboard.js";
import { onRequestPatch as memberProfilePatch } from "../functions/api/member/profile.js";
import { onRequestPost as memberMediaUpload } from "../functions/api/member/media.js";
import { onRequestGet as memberAlbumsGet } from "../functions/api/member/albums/index.js";
import { onRequestPost as memberAlbumPhotoUpload } from "../functions/api/member/albums/[id]/photos.js";
import { onRequestPost as adminPhotoApprove } from "../functions/api/admin/photos/[id]/approve.js";
import { onRequestPost as publicRegister } from "../functions/api/registrations.js";
import {
  onRequestGet as reflectionsGet,
  onRequestPost as reflectionsCreate,
} from "../functions/api/reflections/index.js";
import { onRequestPost as reflectionMediaUpload } from "../functions/api/reflections/media.js";
import {
  onRequestPatch as reflectionPatch,
  onRequestDelete as reflectionDelete,
} from "../functions/api/reflections/[id].js";
import { onRequestPost as reflectionHeart } from "../functions/api/reflections/[id]/heart.js";
import { onRequestGet as adminReflectionsList } from "../functions/api/admin/reflections/index.js";
import {
  onRequestPatch as adminReflectionPatch,
  onRequestDelete as adminReflectionDelete,
} from "../functions/api/admin/reflections/[id].js";
import { onRequestGet as adminMembersList } from "../functions/api/admin/members/index.js";
import {
  onRequestPatch as adminMemberPatch,
  onRequestDelete as adminMemberDelete,
} from "../functions/api/admin/members/[id].js";
import {
  onRequestGet as adminVisualsGet,
  onRequestPut as adminVisualsPut,
} from "../functions/api/admin/visuals.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function createFullMockD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "migrations/0001_init.sql",
    "migrations/0002_seed.sql",
    "migrations/0003_media_portal.sql",
    "migrations/0004_holaheart_first_event.sql",
    "migrations/0005_cuoc_doi_cua_cha_event.sql",
    "migrations/0006_member_auth_and_reflections.sql",
  ]) {
    db.exec(fs.readFileSync(path.join(ROOT, file), "utf8"));
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
    rawDb: db,
    prepare(sql) {
      return new Stmt(sql);
    },
    async batch(stmts) {
      const out = [];
      db.exec("BEGIN");
      try {
        for (const st of stmts) {
          out.push(await st.run());
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return out;
    },
  };
}

function createMockKV() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts = {}) {
      const buf = value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : new Uint8Array(value);
      store.set(key, { value: buf.buffer, metadata: opts.metadata || null });
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

function makeReq(
  urlPath,
  { method = "GET", body, cookie, origin = "https://holarise.org", ip = "10.0.0.1", headers = {} } = {}
) {
  const h = new Headers({
    Origin: origin,
    "CF-Connecting-IP": ip,
    ...headers,
  });
  if (cookie) h.set("Cookie", cookie);
  let payload;
  if (body !== undefined && !(body instanceof FormData) && !(body instanceof Uint8Array)) {
    h.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  } else {
    payload = body;
  }
  return new Request(`https://holarise.org${urlPath}`, { method, headers: h, body: payload });
}

function extractCookie(res, name) {
  const setCookie = res.headers.get("Set-Cookie") || "";
  const re = new RegExp(`${name}=([^;]+)`);
  const m = setCookie.match(re);
  return m ? `${name}=${m[1]}` : "";
}

const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

test("Migration 0006 cleans seeded AI album/photos in D1 & parses Email/Phone smart identifier", async () => {
  const DB = createFullMockD1();
  const seededAlbum = await DB.prepare("SELECT status FROM media_albums WHERE id = 'album-khoanh-khac-hoa-lac'").first();
  assert.equal(seededAlbum.status, "draft");

  const featuredSeeds = await DB.prepare("SELECT COUNT(*) AS cnt FROM media_photos WHERE is_featured_home = 1").first();
  assert.equal(Number(featuredSeeds.cnt), 0);

  const fatherEvent = await DB.prepare("SELECT title_en FROM events WHERE id = 'holaheart-cuoc-doi-cua-cha-2026-11-29'").first();
  assert.ok(fatherEvent.title_en.includes("Father"));

  const pPhone = parseMemberIdentifier("+84 912.345.678");
  assert.equal(pPhone.ok, true);
  assert.equal(pPhone.kind, "phone");
  assert.equal(pPhone.phoneNorm, "0912345678");

  const pEmail = parseMemberIdentifier("  MinhAnh@FPT.edu.vn ");
  assert.equal(pEmail.ok, true);
  assert.equal(pEmail.kind, "email");
  assert.equal(pEmail.email, "minhanh@fpt.edu.vn");

  const badRef = validateReflectionInput({ activitySlug: "test", content: "Quá ngắn" });
  assert.equal(badRef.ok, false);
});

test("Unified Member Auth (Email & Phone), Strict Admin Isolation, Avatar Upload & 1-Tap Event Booking", async () => {
  const DB = createFullMockD1();
  const MEDIA_KV = createMockKV();
  const env = { DB, MEDIA_KV };

  // Bootstrap admin
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "admin@holarise.org", name: "Admin Hola", password: "AdminStrongPassword123!" },
    }),
    env,
  });
  assert.equal(bootRes.status, 201);
  const adminCookie = extractCookie(bootRes, "holarise_session");
  assert.ok(adminCookie.startsWith("holarise_session="));

  // Register Member #1 using Email + autoRegisterEvent in a single 10s step!
  const regRes = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      ip: "10.0.0.2",
      body: {
        name: "Nguyễn Minh Anh",
        identifier: "MinhAnh@fpt.edu.vn",
        password: "holaPassword123",
        organization: "ĐH FPT Hòa Lạc",
        pillarChoice: "holaheart",
        autoRegisterEvent: {
          eventId: "holaheart-cuoc-doi-cua-cha-2026-11-29",
          activityTitle: 'Workshop "Cuộc Đời Của Cha"',
          note: "Đi 1 mình",
        },
      },
    }),
    env,
  });
  assert.equal(regRes.status, 201);
  const regBody = await regRes.json();
  assert.equal(regBody.ok, true);
  assert.match(regBody.member.memberCode, /^HR-\d{6}-\d+$/);
  assert.ok(regBody.autoRegistration?.id);
  const member1Cookie = extractCookie(regRes, "holarise_member_session");
  assert.ok(member1Cookie.startsWith("holarise_member_session="));

  // Member session MUST be rejected (401) by /api/admin/* endpoints!
  const forbiddenAdmin = await adminMembersList({
    request: makeReq("/api/admin/members", { cookie: member1Cookie }),
    env,
  });
  assert.equal(forbiddenAdmin.status, 401);

  // Admin session MUST NOT authenticate as a community member!
  const statusWithAdminCookie = await memberStatus({
    request: makeReq("/api/member/auth/status", { cookie: adminCookie }),
    env,
  });
  const statusAdminJson = await statusWithAdminCookie.json();
  assert.equal(statusAdminJson.authenticated, false);

  // Duplicate Email registration rejected cleanly with 409
  const dupRes = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      ip: "10.0.0.3",
      body: { name: "Người Khác", identifier: "minhanh@fpt.edu.vn", password: "holaPassword123" },
    }),
    env,
  });
  assert.equal(dupRes.status, 409);

  // Register Member #2 using Phone number (+84 format) and login using 09... format!
  const regPhoneRes = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      ip: "10.0.0.4",
      body: {
        name: "Trần Quốc Bảo",
        identifier: "+84 988 111 222",
        password: "baoPassword99",
        pillarChoice: "holagreen",
      },
    }),
    env,
  });
  assert.equal(regPhoneRes.status, 201);

  const loginPhoneRes = await memberLogin({
    request: makeReq("/api/member/auth/login", {
      method: "POST",
      ip: "10.0.0.5",
      body: { identifier: "0988.111.222", password: "baoPassword99" },
    }),
    env,
  });
  assert.equal(loginPhoneRes.status, 200);
  const member2Cookie = extractCookie(loginPhoneRes, "holarise_member_session");
  assert.ok(member2Cookie);

  // Block SVG XSS upload on member media endpoint
  const svgBytes = new TextEncoder().encode("<svg onload='alert(1)'></svg>");
  const badMediaRes = await memberMediaUpload({
    request: makeReq("/api/member/media", {
      method: "POST",
      cookie: member1Cookie,
      body: svgBytes,
      headers: { "Content-Type": "image/svg+xml" },
    }),
    env,
  });
  assert.equal(badMediaRes.status, 415);

  // Upload real PNG avatar & replace it (old KV key cleaned automatically!)
  const av1Res = await memberMediaUpload({
    request: makeReq("/api/member/media", {
      method: "POST",
      cookie: member1Cookie,
      body: VALID_PNG_BYTES,
      headers: { "Content-Type": "image/png" },
    }),
    env,
  });
  assert.equal(av1Res.status, 201);
  const av1 = await av1Res.json();
  assert.equal(MEDIA_KV.store.has(`media:${av1.id}`), true);

  const patchProf1 = await memberProfilePatch({
    request: makeReq("/api/member/profile", {
      method: "PATCH",
      cookie: member1Cookie,
      body: { name: "Nguyễn Minh Anh", avatarUrl: av1.url, pillarChoice: "holaconnect" },
    }),
    env,
  });
  assert.equal(patchProf1.status, 200);

  const av2Res = await memberMediaUpload({
    request: makeReq("/api/member/media", {
      method: "POST",
      cookie: member1Cookie,
      body: VALID_PNG_BYTES,
      headers: { "Content-Type": "image/png" },
    }),
    env,
  });
  const av2 = await av2Res.json();
  await memberProfilePatch({
    request: makeReq("/api/member/profile", {
      method: "PATCH",
      cookie: member1Cookie,
      body: { name: "Nguyễn Minh Anh", avatarUrl: av2.url },
    }),
    env,
  });
  assert.equal(MEDIA_KV.store.has(`media:${av1.id}`), false);
  assert.equal(MEDIA_KV.store.has(`media:${av2.id}`), true);

  // 1-Tap Event Booking for Email-only Member #1 (no phone required!) + Idempotency on double-tap
  const oneTapRes1 = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      cookie: member1Cookie,
      ip: "10.0.0.6",
      body: {
        source: "event_modal",
        eventId: "holaconnect-leo-nui-lam-nghiep-2026-11-26",
        activity: "HolaConnect · Chiều Leo Núi",
      },
    }),
    env,
  });
  assert.equal(oneTapRes1.status, 201);
  const oneTapJson1 = await oneTapRes1.json();

  const oneTapDup = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      cookie: member1Cookie,
      ip: "10.0.0.6",
      body: {
        source: "event_modal",
        eventId: "holaconnect-leo-nui-lam-nghiep-2026-11-26",
        activity: "HolaConnect · Chiều Leo Núi",
      },
    }),
    env,
  });
  assert.equal(oneTapDup.status, 200);
  const oneTapDupJson = await oneTapDup.json();
  assert.equal(oneTapDupJson.duplicate, true);
  assert.equal(oneTapDupJson.id, oneTapJson1.id);

  // Dashboard returns member's 2 booked events in parallel
  const dashRes = await memberDashboard({
    request: makeReq("/api/member/dashboard", { cookie: member1Cookie }),
    env,
  });
  assert.equal(dashRes.status, 200);
  const dashJson = await dashRes.json();
  assert.equal(dashJson.registrations.length, 2);

  // Logout invalidates session
  const logoutRes = await memberLogout({
    request: makeReq("/api/member/auth/logout", { method: "POST", cookie: member2Cookie }),
    env,
  });
  assert.equal(logoutRes.status, 200);
  const afterLogout = await memberDashboard({
    request: makeReq("/api/member/dashboard", { cookie: member2Cookie }),
    env,
  });
  assert.equal(afterLogout.status, 401);
});

test("Editorial Guestbook Lifecycle (Create -> Pending -> Admin Approve -> Heart Toggle -> Edit Reverts to Pending -> Delete Cleans KV) & CMS Visuals Override", async () => {
  const DB = createFullMockD1();
  const MEDIA_KV = createMockKV();
  const env = { DB, MEDIA_KV };

  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "admin@holarise.org", name: "Admin", password: "AdminStrongPassword123!" },
    }),
    env,
  });
  const adminCookie = extractCookie(bootRes, "holarise_session");

  const regRes = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      ip: "10.0.1.1",
      body: { name: "Lê Thu Hà", identifier: "thuha@vnu.edu.vn", password: "haPassword123" },
    }),
    env,
  });
  const memberCookie = extractCookie(regRes, "holarise_member_session");

  // Upload reflection memory photo
  const photoUpRes = await memberMediaUpload({
    request: makeReq("/api/member/media", {
      method: "POST",
      cookie: memberCookie,
      body: VALID_PNG_BYTES,
      headers: { "Content-Type": "image/png" },
    }),
    env,
  });
  const photoUp = await photoUpRes.json();

  const slug = "tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart";
  const createRefRes = await reflectionsCreate({
    request: makeReq("/api/reflections", {
      method: "POST",
      cookie: memberCookie,
      ip: "10.0.1.2",
      body: {
        activitySlug: slug,
        participantRole: "volunteer",
        pullQuote: "Một buổi chiều ngồi lại để thấy mình cần gọi về cho Mẹ ngay.",
        content: "Không gian ấm áp tại Mây Lang Thang giúp mình lắng lại thật sự giữa mùa thi cử căng thẳng.",
        photoUrl: photoUp.url,
      },
    }),
    env,
  });
  assert.equal(createRefRes.status, 201);
  const createdRef = (await createRefRes.json()).reflection;
  assert.equal(createdRef.status, "pending");

  // 1 reflection per member per activity enforced (409)
  const secondTry = await reflectionsCreate({
    request: makeReq("/api/reflections", {
      method: "POST",
      cookie: memberCookie,
      ip: "10.0.1.2",
      body: { activitySlug: slug, content: "Thử gửi bài thứ hai cho cùng hoạt động này." },
    }),
    env,
  });
  assert.equal(secondTry.status, 409);

  // Before Admin approval: public anonymous GET sees 0 approved items, author sees myReflection
  const anonBefore = await (await reflectionsGet({ request: makeReq(`/api/reflections?slug=${slug}`), env })).json();
  assert.equal(anonBefore.items.length, 0);
  assert.equal(anonBefore.myReflection, null);

  const ownerBefore = await (
    await reflectionsGet({ request: makeReq(`/api/reflections?slug=${slug}`, { cookie: memberCookie }), env })
  ).json();
  assert.equal(ownerBefore.items.length, 0);
  assert.equal(ownerBefore.myReflection.id, createdRef.id);

  // Admin lists pending & approves 1-click
  const adminList = await (
    await adminReflectionsList({ request: makeReq("/api/admin/reflections?status=pending", { cookie: adminCookie }), env })
  ).json();
  assert.equal(adminList.items.length, 1);

  const approveRes = await adminReflectionPatch({
    request: makeReq(`/api/admin/reflections/${createdRef.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { status: "approved" },
    }),
    env,
    params: { id: createdRef.id },
  });
  assert.equal(approveRes.status, 200);

  // Public anonymous reader sees approved reflection & toggles Heart ♥ cleanly without negative drift
  const anonAfter = await (await reflectionsGet({ request: makeReq(`/api/reflections?slug=${slug}`), env })).json();
  assert.equal(anonAfter.items.length, 1);
  assert.equal(anonAfter.items[0].pullQuote, "Một buổi chiều ngồi lại để thấy mình cần gọi về cho Mẹ ngay.");
  assert.equal(anonAfter.items[0].email, undefined); // Zero PII leak!

  const heart1Res = await reflectionHeart({
    request: makeReq(`/api/reflections/${createdRef.id}/heart`, { method: "POST", ip: "10.0.2.1" }),
    env,
    params: { id: createdRef.id },
  });
  assert.equal(heart1Res.status, 200);
  const readerCookie = extractCookie(heart1Res, "holarise_reader_id");
  const heart1Json = await heart1Res.json();
  assert.equal(heart1Json.hearted, true);
  assert.equal(heart1Json.heartCount, 1);

  // Second click with same reader cookie un-hearts back to 0 cleanly
  const heart2Res = await reflectionHeart({
    request: makeReq(`/api/reflections/${createdRef.id}/heart`, {
      method: "POST",
      cookie: readerCookie,
      ip: "10.0.2.1",
    }),
    env,
    params: { id: createdRef.id },
  });
  const heart2Json = await heart2Res.json();
  assert.equal(heart2Json.hearted, false);
  assert.equal(heart2Json.heartCount, 0);

  // Editing an approved reflection AUTOMATICALLY reverts status to 'pending'!
  const editRes = await reflectionPatch({
    request: makeReq(`/api/reflections/${createdRef.id}`, {
      method: "PATCH",
      cookie: memberCookie,
      body: {
        participantRole: "volunteer",
        pullQuote: "Câu trích dẫn đã cập nhật mới.",
        content: "Nội dung chia sẻ được chỉnh sửa thêm chi tiết kỷ niệm đẹp tại Hòa Lạc.",
        photoUrl: photoUp.url,
      },
    }),
    env,
    params: { id: createdRef.id },
  });
  assert.equal(editRes.status, 200);
  const editedRef = (await editRes.json()).reflection;
  assert.equal(editedRef.status, "pending");

  const anonAfterEdit = await (await reflectionsGet({ request: makeReq(`/api/reflections?slug=${slug}`), env })).json();
  assert.equal(anonAfterEdit.items.length, 0);

  // Deleting reflection cleans up photo from MEDIA_KV!
  assert.equal(MEDIA_KV.store.has(`media:${photoUp.id}`), true);
  const delRes = await reflectionDelete({
    request: makeReq(`/api/reflections/${createdRef.id}`, { method: "DELETE", cookie: memberCookie }),
    env,
    params: { id: createdRef.id },
  });
  assert.equal(delRes.status, 200);
  assert.equal(MEDIA_KV.store.has(`media:${photoUp.id}`), false);

  // CMS Site Visuals Override (/api/admin/visuals) allows replacing Hero & Pillar photos dynamically
  const putVisRes = await adminVisualsPut({
    request: makeReq("/api/admin/visuals", {
      method: "PUT",
      cookie: adminCookie,
      body: {
        heroImage: "/api/media/img-20261124-realhero01.jpg",
        heroImageAlt: "Ảnh chụp thật bình minh Hòa Lạc mới tải lên từ CMS",
        heroIsIllustration: false,
        pillars: {
          holagreen: {
            image: "/api/media/img-20261124-realgreen1.jpg",
            imageAlt: "Buổi trồng cây thực tế đầu tiên của HolaGreen",
            isIllustration: false,
          },
        },
      },
    }),
    env,
  });
  assert.equal(putVisRes.status, 200);
  const getVis = await (await adminVisualsGet({ request: makeReq("/api/admin/visuals", { cookie: adminCookie }), env })).json();
  assert.equal(getVis.visuals.heroImage, "/api/media/img-20261124-realhero01.jpg");
  assert.equal(getVis.visuals.pillars.holagreen.image, "/api/media/img-20261124-realgreen1.jpg");
  assert.equal(getVis.visuals.pillars.holagreen.isIllustration, false);

  // Admin member management: lock account & delete cleanup
  const membersList = await (await adminMembersList({ request: makeReq("/api/admin/members", { cookie: adminCookie }), env })).json();
  assert.equal(membersList.items.length, 1);
  const targetMemberId = membersList.items[0].id;

  const lockRes = await adminMemberPatch({
    request: makeReq(`/api/admin/members/${targetMemberId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { isActive: false },
    }),
    env,
    params: { id: targetMemberId },
  });
  assert.equal(lockRes.status, 200);

  const lockedDash = await memberDashboard({
    request: makeReq("/api/member/dashboard", { cookie: memberCookie }),
    env,
  });
  assert.equal(lockedDash.status, 401);

  const delMemberRes = await adminMemberDelete({
    request: makeReq(`/api/admin/members/${targetMemberId}`, { method: "DELETE", cookie: adminCookie }),
    env,
    params: { id: targetMemberId },
  });
  assert.equal(delMemberRes.status, 200);
});

test("HR-YYMMDD-STT sequential member codes, QR SVG & /tv/[code] privacy-safe achievement page", async () => {
  const DB = createFullMockD1();
  const MEDIA_KV = createMockKV();
  const env = { DB, MEDIA_KV };
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "admin@holarise.org", name: "Admin Hola", password: "AdminStrongPassword123!" },
    }),
    env,
  });
  assert.equal(bootRes.status, 201);
  const adminCookie = extractCookie(bootRes, "holarise_session");

  // Create 2 sequential members via Admin API
  const m1Res = await adminMemberCreate({
    request: makeReq("/api/admin/members", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Phạm Thu Hà",
        phone: "0981 222 333",
        email: "thuha.secret@example.com",
        organization: "Đại học FPT Hà Nội (Hòa Lạc)",
        pillarChoice: "holaheart",
        roleTitle: "Thành viên đồng hành",
        notes: "Ghi chú nội bộ tuyệt mật không được lộ",
      },
    }),
    env,
  });
  assert.equal(m1Res.status, 201);
  const m1 = (await m1Res.json()).item;
  assert.match(m1.memberCode, /^HR-\d{6}-1$/);

  const m2Res = await adminMemberCreate({
    request: makeReq("/api/admin/members", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Lê Quang Huy",
        phone: "0982 444 555",
        organization: "Đại học Quốc gia Hà Nội – Cơ sở Hòa Lạc (ĐHQGHN)",
        pillarChoice: "holaconnect",
      },
    }),
    env,
  });
  assert.equal(m2Res.status, 201);
  const m2 = (await m2Res.json()).item;
  assert.match(m2.memberCode, /^HR-\d{6}-2$/);

  // Verify QR SVG generator produces valid crisp SVG
  const svg = generateQrSvg(`https://holarise.org/tv/${m1.memberCode}`);
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.includes("<path d=\"M"));
  assert.ok(svg.endsWith("</svg>"));

  // Verify /tv/[code] SSR renders public achievement card + QR and NEVER leaks PII
  const tvRes = await memberPassGet({
    request: makeReq(`/tv/${m1.memberCode}`),
    params: { code: m1.memberCode },
    env,
  });
  assert.equal(tvRes.status, 200);
  const tvHtml = await tvRes.text();
  assert.ok(tvHtml.includes("Phạm Thu Hà"));
  assert.ok(tvHtml.includes(m1.memberCode));
  assert.ok(tvHtml.includes("Đại học FPT Hà Nội (Hòa Lạc)"));
  assert.ok(tvHtml.includes("<svg xmlns=\"http://www.w3.org/2000/svg\""));
  // Strict Nghị định 13 privacy checks
  assert.ok(!tvHtml.includes("0981 222 333"));
  assert.ok(!tvHtml.includes("0981222333"));
  assert.ok(!tvHtml.includes("thuha.secret@example.com"));
  assert.ok(!tvHtml.includes("Ghi chú nội bộ tuyệt mật"));

  // Unknown member code returns 404
  const notFoundRes = await memberPassGet({
    request: makeReq("/tv/HR-990101-99"),
    params: { code: "HR-990101-99" },
    env,
  });
  assert.equal(notFoundRes.status, 404);
});

test("Member Journey Wallet: joins events metadata & auto-matches unlinked guest registrations by email/phone without leaking other members", async () => {
  const DB = createFullMockD1();
  const MEDIA_KV = createMockKV();
  const env = { DB, MEDIA_KV };

  // Seed an event in D1
  await DB.prepare(
    `INSERT OR REPLACE INTO events (id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at)
     VALUES ('holaconnect-leo-nui-lam-nghiep-2026-11-26', 'upcoming', 'HolaConnect · Tri thức & Phụng sự', '["holaconnect"]', '2026-11-26', 'Thứ Năm, 26/11/2026', '14:30 – 17:30', 'Đồi Lâm Nghiệp, Hòa Lạc', 'Miễn phí', '', 'Chiều Leo Núi & Kết Nối Giữa Rừng', 'Cùng nhau đi bộ đường rừng và trò chuyện.', '[]', '', '/assets/images/activity-workshop.jpg', '', 'published', 1, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`
  ).run();

  // Register a member with phone 0912345678
  const regRes = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        identifier: "0912 345 678",
        password: "MemberWalletPass123!",
        name: "Nguyễn Minh Anh",
        organization: "ĐH FPT",
      },
    }),
    env,
  });
  assert.equal(regRes.status, 201);
  const memberCookie = extractCookie(regRes, "holarise_member_session");

  // Insert an unlinked guest registration with +84 formatted phone
  await DB.prepare(
    `INSERT INTO registrations (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
     VALUES ('REG-261125-GUEST1', '', 'event_modal', 'holaconnect-leo-nui-lam-nghiep-2026-11-26', 'Chiều Leo Núi & Kết Nối Giữa Rừng', 'Nguyễn Minh Anh', '+84 912 345 678', '', 'Người tham dự', 'ĐH FPT', 'Đi 1 mình', 'attended', '', 'skipped', '', 'hash1', '2026-11-25T02:00:00.000Z', '2026-11-25T02:00:00.000Z')`
  ).run();

  // Insert another member's linked registration (must NOT appear in this member's wallet)
  await DB.prepare(
    `INSERT INTO registrations (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
     VALUES ('REG-261125-OTHER1', 'other-member-id', 'event_modal', 'holaconnect-leo-nui-lam-nghiep-2026-11-26', 'Chiều Leo Núi & Kết Nối Giữa Rừng', 'Người Khác', '0912345678', '', 'Người tham dự', 'ĐHQG', '', 'new', '', 'skipped', '', 'hash2', '2026-11-25T03:00:00.000Z', '2026-11-25T03:00:00.000Z')`
  ).run();

  const dashRes = await memberDashboard({
    request: makeReq("/api/member/dashboard", { cookie: memberCookie }),
    env,
  });
  assert.equal(dashRes.status, 200);
  const dash = await dashRes.json();

  assert.equal(dash.registrations.length, 1);
  const card = dash.registrations[0];
  assert.equal(card.id, "REG-261125-GUEST1");
  assert.equal(card.activityTitle, "Chiều Leo Núi & Kết Nối Giữa Rừng");
  assert.equal(card.eventPillar, "holaconnect");
  assert.equal(card.eventDateDisplay, "Thứ Năm, 26/11/2026");
  assert.equal(card.eventTime, "14:30 – 17:30");
  assert.equal(card.eventLocation, "Đồi Lâm Nghiệp, Hòa Lạc");
  assert.equal(card.eventHref, "/su-kien/leo-nui-luot/");
  assert.equal(card.status, "attended");
});

test("Member-only reflections (guest 401, up to 7 photos + KV cleanup, drifted schema self-heal)", async () => {
  const DB = createFullMockD1();
  const MEDIA_KV = createMockKV();
  const env = { DB, MEDIA_KV };

  // 1. Unauthenticated guest is blocked on both reflection photo upload and reflection submit
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const guestUpload = await reflectionMediaUpload({
    request: makeReq("/api/reflections/media", {
      method: "POST",
      body: fakeJpeg,
      headers: { "Content-Type": "image/jpeg" },
    }),
    env,
  });
  assert.equal(guestUpload.status, 401);

  const guestPost = await reflectionsCreate({
    request: makeReq("/api/reflections", {
      method: "POST",
      body: {
        activitySlug: "tinh-yeu-thuong-cua-me",
        authorName: "Minh Quân",
        content: "Buổi tối rất ấm áp, mọi người lắng nghe nhau thật trọn vẹn.",
      },
    }),
    env,
  });
  assert.equal(guestPost.status, 401);

  // 2. Simulate legacy drifted D1 table (hearts_count instead of heart_count, missing reviewed_by/photos_json)
  DB.rawDb.exec("DROP TABLE IF EXISTS reflection_hearts; DROP TABLE IF EXISTS activity_reflections;");
  DB.rawDb.exec(`
    CREATE TABLE activity_reflections (
      id TEXT PRIMARY KEY,
      activity_slug TEXT NOT NULL,
      member_id TEXT NOT NULL,
      participant_role TEXT NOT NULL DEFAULT 'member',
      pull_quote TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      photo_url TEXT NOT NULL DEFAULT '',
      photo_media_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      hearts_count INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(activity_slug, member_id)
    );
  `);

  const regRes = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        identifier: "drifted-member@holarise.org",
        password: "DriftedPass123!",
        name: "Nguyễn Minh Anh",
        organization: "FPTU",
      },
    }),
    env,
  });
  assert.equal(regRes.status, 201);
  const memberCookie = extractCookie(regRes, "holarise_member_session");

  // 3. Authenticated member uploads 7 photos
  const uploadedUrls = [];
  for (let i = 0; i < 7; i++) {
    const upRes = await reflectionMediaUpload({
      request: makeReq("/api/reflections/media", {
        method: "POST",
        cookie: memberCookie,
        body: fakeJpeg,
        headers: { "Content-Type": "image/jpeg" },
      }),
      env,
    });
    assert.equal(upRes.status, 201);
    const upData = await upRes.json();
    assert.match(upData.url, /^\/api\/media\/ref-\d{8}-[a-z0-9-]+\.jpg$/);
    uploadedUrls.push(upData.url);
  }
  assert.equal(MEDIA_KV.store.size, 7);

  // 8 photos must be rejected with 400 VALIDATION_ERROR
  const tooMany = await reflectionsCreate({
    request: makeReq("/api/reflections", {
      method: "POST",
      cookie: memberCookie,
      body: {
        activitySlug: "tinh-yeu-thuong-cua-me",
        content: "Kỷ niệm đẹp cùng mọi người trong buổi gặp gỡ cuối tuần tại Hòa Lạc.",
        photoUrls: [...uploadedUrls, "/api/media/extra-8.jpg"],
      },
    }),
    env,
  });
  assert.equal(tooMany.status, 400);

  // Exactly 7 photos must self-heal drifted schema and return 201
  const memberPost = await reflectionsCreate({
    request: makeReq("/api/reflections", {
      method: "POST",
      cookie: memberCookie,
      body: {
        activitySlug: "tinh-yeu-thuong-cua-me",
        content: "Kỷ niệm đẹp cùng mọi người trong buổi gặp gỡ cuối tuần tại Hòa Lạc.",
        photoUrls: uploadedUrls,
      },
    }),
    env,
  });
  assert.equal(memberPost.status, 201);
  const memberJson = await memberPost.json();
  assert.equal(memberJson.ok, true);
  assert.equal(memberJson.reflection.photoUrl, uploadedUrls[0]);
  assert.deepEqual(memberJson.reflection.photoUrls, uploadedUrls);

  // Deleting the reflection cleans up ALL 7 KV photos
  const delRes = await reflectionDelete({
    request: makeReq(`/api/reflections/${memberJson.reflection.id}`, {
      method: "DELETE",
      cookie: memberCookie,
    }),
    params: { id: memberJson.reflection.id },
    env,
  });
  assert.equal(delRes.status, 200);
  assert.equal(MEDIA_KV.store.size, 0);
});

test("Member album photo contribution: auth gate, Drive nested dong-gop/<member> folder, pending queue & admin approve", async () => {
  const DB = createFullMockD1();
  const MEDIA_KV = createMockKV();

  // Bootstrap admin for final approval check
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: {
        name: "Admin HolaRise",
        email: "203int64@holarise.org",
        password: "AdminPassword123!",
      },
    }),
    env: { DB },
  });
  assert.equal(bootRes.status, 201);
  const adminCookie = extractCookie(bootRes, "holarise_session");

  // Publish an album with an existing Drive folder URL
  const now = new Date().toISOString();
  DB.rawDb
    .prepare(
      `INSERT INTO media_albums (id, slug, title, event_date, date_display, location, drive_url, status, sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', 1, 'admin', ?, ?)`
    )
    .run(
      "alb-test-event",
      "cuoc-doi-cua-cha-2026-11-29",
      "Workshop Cuộc Đời Của Cha",
      "2026-11-29",
      "29/11/2026",
      "Mây Lang Thang, Hòa Lạc",
      "https://drive.google.com/drive/folders/EventFolderId123456",
      now,
      now
    );

  const env = {
    DB,
    MEDIA_KV,
    GOOGLE_DRIVE_CLIENT_ID: "cid",
    GOOGLE_DRIVE_CLIENT_SECRET: "csec",
    GOOGLE_DRIVE_REFRESH_TOKEN: "rtok",
    GOOGLE_DRIVE_ROOT_FOLDER_ID: "RootFolder123456",
  };

  // 1. Guest blocked on GET /api/member/albums and POST /api/member/albums/:id/photos
  const guestList = await memberAlbumsGet({
    request: makeReq("/api/member/albums"),
    env,
  });
  assert.equal(guestList.status, 401);

  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const guestUpload = await memberAlbumPhotoUpload({
    request: makeReq("/api/member/albums/alb-test-event/photos", {
      method: "POST",
      body: fakeJpeg,
      headers: { "Content-Type": "image/jpeg" },
    }),
    params: { id: "alb-test-event" },
    env,
  });
  assert.equal(guestUpload.status, 401);

  // 2. Register Member
  const regRes = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        identifier: "photographer@holarise.org",
        password: "PhotoPass123!",
        name: "Trần Hải Đăng",
        organization: "ĐH FPT",
      },
    }),
    env,
  });
  assert.equal(regRes.status, 201);
  const regData = await regRes.json();
  const memberCookie = extractCookie(regRes, "holarise_member_session");

  // 3. Member lists published albums
  const listRes = await memberAlbumsGet({
    request: makeReq("/api/member/albums", { cookie: memberCookie }),
    env,
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.ok, true);
  assert.equal(listData.driveConfigured, true);
  assert.ok(listData.items.some((a) => a.id === "alb-test-event"));

  // 4. Mock Google Drive API calls and verify nested folder creation: EventFolder -> dong-gop -> <Member>
  resetDriveCachesForTest();
  const createdFolders = [];
  let uploadedParents = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("/drive/v3/files") && (!init.method || init.method === "GET")) {
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }
    if (u.includes("/drive/v3/files") && init.method === "POST" && !u.includes("/upload/")) {
      const body = JSON.parse(String(init.body || "{}"));
      const fid = `FolderId_${createdFolders.length + 1}_abcdefghij`;
      createdFolders.push({ id: fid, name: body.name, parents: body.parents || [] });
      return new Response(JSON.stringify({ id: fid }), { status: 200 });
    }
    if (u.includes("/upload/drive/v3/files") && init.method === "POST") {
      const rawText = new TextDecoder().decode(init.body);
      const match = rawText.match(/"parents":\["([^"]+)"\]/);
      uploadedParents = match ? [match[1]] : [];
      return new Response(
        JSON.stringify({
          id: "DrivePhotoFile123456",
          name: "anh-su-kien.jpg",
          mimeType: "image/jpeg",
          size: fakeJpeg.byteLength,
          webViewLink: "https://drive.google.com/file/d/DrivePhotoFile123456/view",
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  try {
    const fd = new FormData();
    fd.append("file", new Blob([fakeJpeg], { type: "image/jpeg" }), "anh-su-kien.jpg");
    fd.append("photographer", "Hải Đăng (FPT)");

    const upRes = await memberAlbumPhotoUpload({
      request: new Request("https://holarise.org/api/member/albums/alb-test-event/photos", {
        method: "POST",
        headers: {
          Origin: "https://holarise.org",
          Cookie: memberCookie,
        },
        body: fd,
      }),
      params: { id: "alb-test-event" },
      env,
    });

    assert.equal(upRes.status, 201);
    const upData = await upRes.json();
    assert.equal(upData.ok, true);
    assert.equal(upData.storage, "google_drive");
    assert.equal(upData.item.approvalStatus, "pending");
    assert.equal(upData.item.photographer, "Hải Đăng (FPT)");
    assert.equal(upData.item.contributorMemberId, regData.member.id);
    assert.equal(upData.item.url, "/api/media/drive/DrivePhotoFile123456");

    // Verify nested Drive folder structure: EventFolderId123456 -> dong-gop -> <YYYYMMDD>_<Code>_tran-hai-dang
    const expectedStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    assert.equal(createdFolders.length, 2);
    assert.equal(createdFolders[0].name, "dong-gop");
    assert.deepEqual(createdFolders[0].parents, ["EventFolderId123456"]);
    assert.equal(createdFolders[1].name, `${expectedStamp}_${regData.member.memberCode}_tran-hai-dang`);
    assert.deepEqual(createdFolders[1].parents, [createdFolders[0].id]);
    assert.deepEqual(uploadedParents, [createdFolders[1].id]);

    // Non-image upload must be rejected (415)
    const badFd = new FormData();
    badFd.append("file", new Blob(["not an image"], { type: "text/plain" }), "notes.txt");
    const badRes = await memberAlbumPhotoUpload({
      request: new Request("https://holarise.org/api/member/albums/alb-test-event/photos", {
        method: "POST",
        headers: { Origin: "https://holarise.org", Cookie: memberCookie },
        body: badFd,
      }),
      params: { id: "alb-test-event" },
      env,
    });
    assert.equal(badRes.status, 415);

    // Draft album cannot receive member uploads (404)
    const draftRes = await memberAlbumPhotoUpload({
      request: makeReq("/api/member/albums/album-khoanh-khac-hoa-lac/photos", {
        method: "POST",
        cookie: memberCookie,
        body: fakeJpeg,
        headers: { "Content-Type": "image/jpeg" },
      }),
      params: { id: "album-khoanh-khac-hoa-lac" },
      env,
    });
    assert.equal(draftRes.status, 404);

    // Admin approves the pending member photo cleanly via existing /media/ endpoint
    const appRes = await adminPhotoApprove({
      request: makeReq(`/api/admin/photos/${upData.item.id}/approve`, {
        method: "POST",
        cookie: adminCookie,
        body: { action: "approve" },
      }),
      params: { id: upData.item.id },
      env,
    });
    assert.equal(appRes.status, 200);
    const appData = await appRes.json();
    assert.equal(appData.item.approvalStatus, "approved");
  } finally {
    globalThis.fetch = origFetch;
    resetDriveCachesForTest();
  }
});

test("Member phone flow: auto-save on first RSVP + profile phone update & duplicate guard", async () => {
  const DB = createFullMockD1();
  const env = { DB };

  // 1. Register an email-only member (no phone yet, same as Google OAuth)
  const regA = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        identifier: "email-only@holarise.org",
        password: "Password123!",
        name: "Minh Khôi",
        organization: "ĐH FPT",
      },
    }),
    env,
  });
  assert.equal(regA.status, 201);
  const cookieA = extractCookie(regA, "holarise_member_session");

  // 2. First event RSVP includes a valid phone -> registration succeeds AND auto-saves phone onto member
  const rsvpRes = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      cookie: cookieA,
      body: {
        source: "event_modal",
        eventId: "ev-phone-autosave",
        activity: "Vòng tròn lắng nghe",
        fullName: "Minh Khôi",
        phone: "0912 345 678",
      },
    }),
    env,
  });
  assert.equal(rsvpRes.status, 201);
  const rsvpData = await rsvpRes.json();
  assert.equal(rsvpData.ok, true);
  assert.equal(rsvpData.savedMemberPhone, "0912.345.678");

  const statusAfterRsvp = await memberStatus({
    request: makeReq("/api/member/auth/status", { method: "GET", cookie: cookieA }),
    env,
  });
  const statusJson = await statusAfterRsvp.json();
  assert.equal(statusJson.member.phoneDisplay, "0912.345.678");

  // 3. Member updates phone in profile -> succeeds with normalized format; invalid phone -> 400
  const badPatch = await memberProfilePatch({
    request: makeReq("/api/member/profile", {
      method: "PATCH",
      cookie: cookieA,
      body: { phone: "123" },
    }),
    env,
  });
  assert.equal(badPatch.status, 400);

  const okPatch = await memberProfilePatch({
    request: makeReq("/api/member/profile", {
      method: "PATCH",
      cookie: cookieA,
      body: { phone: "+84 988 777 666" },
    }),
    env,
  });
  assert.equal(okPatch.status, 200);
  const okPatchData = await okPatch.json();
  assert.equal(okPatchData.member.phoneDisplay, "0988.777.666");

  // 4. Second member trying to claim same phone in profile -> 409 DUPLICATE_PHONE
  const regB = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: {
        identifier: "second-member@holarise.org",
        password: "Password123!",
        name: "Lan Anh",
      },
    }),
    env,
  });
  assert.equal(regB.status, 201);
  const cookieB = extractCookie(regB, "holarise_member_session");

  const dupPatch = await memberProfilePatch({
    request: makeReq("/api/member/profile", {
      method: "PATCH",
      cookie: cookieB,
      body: { phone: "0988 777 666" },
    }),
    env,
  });
  assert.equal(dupPatch.status, 409);

  // 5. Second member submitting an event RSVP with someone else's phone still succeeds (skips auto-save safely)
  const rsvpDupRes = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      cookie: cookieB,
      body: {
        source: "event_modal",
        eventId: "ev-phone-autosave",
        activity: "Vòng tròn lắng nghe",
        fullName: "Lan Anh",
        phone: "0988 777 666",
      },
    }),
    env,
  });
  assert.equal(rsvpDupRes.status, 201);
  const rsvpDupData = await rsvpDupRes.json();
  assert.equal(rsvpDupData.ok, true);
  assert.equal(rsvpDupData.savedMemberPhone, "");
});
