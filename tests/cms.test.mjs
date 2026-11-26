import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { hashPassword, verifyPassword, sniffImageMime } from "../functions/_lib/security.js";
import {
  slugifyVi,
  buildRegistrationsCsv,
  isSafeGasWebhookUrl,
  isSafeMediaUrl,
} from "../functions/_lib/validation.js";
import { renderSafeArticleBody, replaceMarker } from "../functions/_lib/render.js";

import { onRequestGet as authStatus } from "../functions/api/auth/status.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as authLogin } from "../functions/api/auth/login.js";
import { onRequestPost as authLogout } from "../functions/api/auth/logout.js";
import { onRequestPost as authChangePw } from "../functions/api/auth/change-password.js";
import { onRequestPost as publicRegister } from "../functions/api/registrations.js";
import { onRequestPost as mediaUpload } from "../functions/api/admin/media.js";
import { onRequestGet as mediaGet } from "../functions/api/media/[id].js";
import { onRequestGet as postsList, onRequestPost as postsCreate } from "../functions/api/admin/posts/index.js";
import { onRequestPut as postsUpdate, onRequestDelete as postsDelete } from "../functions/api/admin/posts/[id].js";
import { onRequestGet as eventsList, onRequestPost as eventsCreate } from "../functions/api/admin/events/index.js";
import { onRequestPut as eventsUpdate, onRequestDelete as eventsDelete } from "../functions/api/admin/events/[id].js";
import { onRequestGet as regsList } from "../functions/api/admin/registrations/index.js";
import { onRequestPatch as regsPatch, onRequestDelete as regsDelete } from "../functions/api/admin/registrations/[id]/index.js";
import { onRequestPost as regsResync } from "../functions/api/admin/registrations/[id]/resync.js";
import { onRequestGet as regsExport } from "../functions/api/admin/registrations/export.js";
import { onRequestGet as usersList, onRequestPost as usersCreate } from "../functions/api/admin/users/index.js";
import { onRequestPatch as usersPatch, onRequestDelete as usersDelete } from "../functions/api/admin/users/[id].js";
import { onRequestGet as settingsGet, onRequestPut as settingsPut } from "../functions/api/admin/settings/index.js";
import { onRequest as rootMiddleware } from "../functions/_middleware.js";
import { onRequestGet as ssrHome } from "../functions/index.js";
import { onRequestGet as ssrAbout } from "../functions/gioi-thieu/index.js";
import { onRequestGet as ssrSchedule } from "../functions/lich-hoat-dong/index.js";
import { onRequestGet as ssrJoin } from "../functions/tham-gia/index.js";
import { onRequestGet as ssrJourneyList } from "../functions/hanh-trinh/index.js";
import { onRequestGet as ssrPostDetail, onRequestHead as ssrPostHead } from "../functions/hanh-trinh/[slug].js";
import { onRequestGet as partnersGet, onRequestPut as partnersPut } from "../functions/api/admin/partners.js";
import { onRequestGet as overviewGet } from "../functions/api/admin/overview.js";
import { onRequestGet as ssrEventInvite } from "../functions/su-kien/[slug].js";
import { onRequestHead as mediaHead } from "../functions/api/media/[id].js";
import { onRequestGet as ssrSitemap } from "../functions/sitemap.xml.js";
import { callGasWebhook } from "../functions/_lib/gas.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

/** Minimal Cloudflare D1 adapter backed by real in-memory SQLite */
function createMockD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0001_init.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0002_seed.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0003_media_portal.sql"), "utf8"));

  class Stmt {
    constructor(sql, bound = []) {
      this.sql = sql;
      this.bound = bound;
    }
    bind(...args) {
      return new Stmt(this.sql, args);
    }
    async first() {
      const s = db.prepare(this.sql);
      return s.get(...this.bound) ?? null;
    }
    async all() {
      const s = db.prepare(this.sql);
      return { results: s.all(...this.bound) };
    }
    async run() {
      const s = db.prepare(this.sql);
      const info = s.run(...this.bound);
      return { success: true, meta: { changes: Number(info.changes || 0) } };
    }
  }

  return {
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
    async put(key, value, opts = {}) {
      const buf = value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : new Uint8Array(value);
      store.set(key, { value: buf.buffer, metadata: opts.metadata || null });
    },
    async getWithMetadata(key) {
      const hit = store.get(key);
      if (!hit) return { value: null, metadata: null };
      return { value: hit.value, metadata: hit.metadata };
    },
  };
}

function makeReq(urlPath, { method = "GET", body, cookie, origin = "https://holarise.org", ip = "1.2.3.4", headers = {} } = {}) {
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

function extractSessionCookie(res) {
  const setCookie = res.headers.get("Set-Cookie") || "";
  const match = setCookie.match(/holarise_session=([^;]+)/);
  return match ? `holarise_session=${match[1]}` : "";
}

test("Vietnamese slugify, URL guards, CSV formula injection & XSS sanitization", () => {
  assert.equal(slugifyVi("Đêm Trăng Hòa Lạc #19 — Tân Xã!"), "dem-trang-hoa-lac-19-tan-xa");
  assert.equal(isSafeMediaUrl("/api/media/img-123.jpg"), true);
  assert.equal(isSafeMediaUrl("javascript:alert(1)"), false);
  assert.equal(isSafeMediaUrl("//evil.com/a.jpg"), false);
  assert.equal(isSafeMediaUrl("/\\evil.com/a.jpg"), false);
  assert.equal(isSafeGasWebhookUrl("https://script.google.com/macros/s/AKfycb/exec"), true);
  assert.equal(isSafeGasWebhookUrl("http://127.0.0.1:8080/hook"), false);
  assert.equal(isSafeGasWebhookUrl("https://evil.example/hook"), false);

  const html = renderSafeArticleBody([
    "## Tiêu đề phụ **nổi bật**",
    "<script>alert('xss')</script> an toàn",
    "Xem thêm [Lịch Workshop cuối tuần](/workshop/) và [Hoạt động](/hoat-dong/#moi-truong).",
    "Chặn link độc [x](javascript:alert(1)), [y](//evil.com/) và [z](https://evil.com/).",
    "- Mục một",
    "- Mục hai",
    "> Trích dẫn hay",
  ]);
  assert.ok(html.includes("<h2>Tiêu đề phụ <strong>nổi bật</strong></h2>"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;"));
  assert.ok(html.includes('<a href="/workshop/">Lịch Workshop cuối tuần</a>'));
  assert.ok(html.includes('<a href="/hoat-dong/#moi-truong">Hoạt động</a>'));
  assert.ok(!html.includes("javascript:alert(1)\">"));
  assert.ok(!html.includes('href="//evil.com'));
  assert.ok(!html.includes('href="https://evil.com'));
  assert.ok(html.includes('<ul class="clean-list">'));
  assert.ok(html.includes("<blockquote>Trích dẫn hay</blockquote>"));

  const csv = buildRegistrationsCsv([
    {
      id: "REG-1",
      created_at: "2026-11-21T10:00:00Z",
      source: "join_page",
      activity_title: "Workshop",
      full_name: "=CMD|' /C calc'!A0",
      phone: "+84987654321",
      email: "user@example.com",
      role: "Tình nguyện viên",
      organization: "FPT, Hòa Lạc",
      note: 'Có "ngoặc kép"',
      status: "new",
      admin_note: "",
      sync_status: "synced",
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=CMD"));
  assert.ok(csv.includes("'+84987654321"));
  assert.ok(csv.includes('"FPT, Hòa Lạc"'));
  assert.ok(csv.includes('"Có ""ngoặc kép"""'));

  const replaced = replaceMarker("A<!-- CMS:X:START -->old<!-- CMS:X:END -->B", "X", "new");
  assert.equal(replaced, "A<!-- CMS:X:START -->\nnew\n<!-- CMS:X:END -->B");
});

test("PBKDF2 password hashing & image magic bytes sniffing", async () => {
  const { hash, salt } = await hashPassword("HolaRise@2026");
  assert.equal(await verifyPassword("HolaRise@2026", hash, salt), true);
  assert.equal(await verifyPassword("WrongPass@2026", hash, salt), false);

  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const fakeSvg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
  assert.deepEqual(sniffImageMime(fakeJpeg), { mime: "image/jpeg", ext: "jpg" });
  assert.equal(sniffImageMime(fakeSvg), null);
});

test("Full end-to-end CMS & Registration API flow on real SQLite D1 mock", async () => {
  const env = { DB: createMockD1(), MEDIA_KV: createMockKV() };

  // 1. Initial auth status -> not initialized
  const st0 = await (await authStatus({ request: makeReq("/api/auth/status"), env })).json();
  assert.equal(st0.initialized, false);
  assert.equal(st0.authenticated, false);

  // 2. Bootstrap sole super admin (203int64)
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "203int64@holarise.org", name: "Nguyễn Lan", password: "StrongPassword123" },
    }),
    env,
  });
  assert.equal(bootRes.status, 201);
  const adminCookie = extractSessionCookie(bootRes);
  assert.ok(adminCookie.includes("holarise_session="));
  assert.ok(bootRes.headers.get("Set-Cookie").includes("HttpOnly"));
  assert.ok(bootRes.headers.get("Set-Cookie").includes("SameSite=Lax"));

  // Second bootstrap blocked with 409
  const boot2 = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "hacker@evil.com", name: "Hacker", password: "StrongPassword123" },
    }),
    env,
  });
  assert.equal(boot2.status, 409);

  // 3. CSRF origin guard rejects cross-origin mutation
  const csrfRes = await postsCreate({
    request: makeReq("/api/admin/posts", {
      method: "POST",
      origin: "https://evil.example",
      cookie: adminCookie,
      body: { title: "CSRF Test" },
    }),
    env,
  });
  assert.equal(csrfRes.status, 403);

  // 4. Media upload (valid JPEG accepted, SVG rejected)
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01]);
  const upRes = await mediaUpload({
    request: makeReq("/api/admin/media", {
      method: "POST",
      cookie: adminCookie,
      body: jpegBytes,
      headers: { "Content-Type": "image/jpeg" },
    }),
    env,
  });
  assert.equal(upRes.status, 201);
  const upData = await upRes.json();
  assert.ok(upData.url.startsWith("/api/media/img-"));

  const getMedia = await mediaGet({
    request: makeReq(upData.url),
    env,
    params: { id: upData.id },
  });
  assert.equal(getMedia.status, 200);
  assert.equal(getMedia.headers.get("Content-Type"), "image/jpeg");
  assert.ok(getMedia.headers.get("Cache-Control").includes("immutable"));

  const svgRes = await mediaUpload({
    request: makeReq("/api/admin/media", {
      method: "POST",
      cookie: adminCookie,
      body: new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
      headers: { "Content-Type": "image/svg+xml" },
    }),
    env,
  });
  assert.equal(svgRes.status, 415);

  // 5. Posts CRUD + duplicate slug check
  const pCreate = await postsCreate({
    request: makeReq("/api/admin/posts", {
      method: "POST",
      cookie: adminCookie,
      body: {
        title: "Trồng 100 cây xanh tại Tân Xã mùa đông 2026",
        category: "HolaGreen · Sạch",
        filters: ["sach"],
        date: "2026-11-22",
        image: upData.url,
        excerpt: "Hơn 40 bạn trẻ Hòa Lạc cùng trồng 100 cây xanh ven tuyến đường Tân Xã.",
        content: "Đoạn một giới thiệu buổi sáng.\n\n## Kết quả nổi bật\n\n- 100 cây bản địa",
        status: "published",
      },
    }),
    env,
  });
  assert.equal(pCreate.status, 201);
  const createdPost = (await pCreate.json()).item;
  assert.equal(createdPost.slug, "trong-100-cay-xanh-tai-tan-xa-mua-dong-2026");

  const pDup = await postsCreate({
    request: makeReq("/api/admin/posts", {
      method: "POST",
      cookie: adminCookie,
      body: {
        title: "Trồng 100 cây xanh tại Tân Xã mùa đông 2026",
        excerpt: "Mô tả trùng slug để kiểm tra chặn 409.",
        content: "Nội dung bất kỳ.",
      },
    }),
    env,
  });
  assert.equal(pDup.status, 409);

  const pUpdate = await postsUpdate({
    request: makeReq(`/api/admin/posts/${createdPost.id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { ...createdPost, title: "Trồng 120 cây xanh tại Tân Xã mùa đông 2026" },
    }),
    env,
    params: { id: createdPost.id },
  });
  assert.equal(pUpdate.status, 200);
  const listPosts = await (await postsList({ request: makeReq("/api/admin/posts", { cookie: adminCookie }), env })).json();
  assert.equal(listPosts.items.length, 10); // 9 seeded + 1 created

  const pDel = await postsDelete({
    request: makeReq(`/api/admin/posts/${createdPost.id}`, { method: "DELETE", cookie: adminCookie }),
    env,
    params: { id: createdPost.id },
  });
  assert.equal(pDel.status, 200);

  // 6. Events CRUD
  const evCreate = await eventsCreate({
    request: makeReq("/api/admin/events", {
      method: "POST",
      cookie: adminCookie,
      body: {
        kind: "upcoming",
        title: "Cuối Tuần Xanh #20: Dọn sạch công viên Hòa Lạc",
        type: "HolaGreen · Sạch",
        filters: ["sach"],
        date: "2026-12-20",
        time: "07:00 – 09:30",
        location: "Tân Xã, Hòa Lạc",
        fee: "Miễn phí",
        seats: "Còn 30/30 chỗ",
        summary: "Cùng nhau làm sạch khuôn viên xanh và phân loại nhựa tái chế sáng Chủ Nhật.",
        image: upData.url,
      },
    }),
    env,
  });
  assert.equal(evCreate.status, 201);
  const createdEvent = (await evCreate.json()).item;
  assert.equal(createdEvent.dateDisplay, "CN, 20/12/2026");

  const evUpd = await eventsUpdate({
    request: makeReq(`/api/admin/events/${createdEvent.id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { ...createdEvent, seats: "Còn 20/30 chỗ" },
    }),
    env,
    params: { id: createdEvent.id },
  });
  assert.equal(evUpd.status, 200);
  const evList = await (await eventsList({ request: makeReq("/api/admin/events", { cookie: adminCookie }), env })).json();
  assert.equal(evList.items.length, 11); // 10 seeded + 1 created

  // 7. Public registration (honeypot ignored, real submission stored + status updated + CSV exported)
  const hpRes = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      body: { fullName: "Spam Bot", phone: "0999999999", website: "https://spam.biz" },
    }),
    env,
  });
  assert.equal(hpRes.status, 200);

  const regRes = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      body: {
        fullName: "Trần Minh Quân",
        phone: "0912 345 678",
        email: "quan.tran@gmail.com",
        activity: createdEvent.title,
        eventId: createdEvent.id,
        organization: "ĐH FPT Hòa Lạc",
        note: "Mình đi cùng 1 bạn.",
      },
    }),
    env,
  });
  assert.equal(regRes.status, 201);
  const regData = await regRes.json();
  assert.ok(regData.id.startsWith("REG-"));

  const regs = await (await regsList({ request: makeReq("/api/admin/registrations?q=Quân", { cookie: adminCookie }), env })).json();
  assert.equal(regs.items.length, 1);
  assert.equal(regs.counts.new, 1);
  assert.equal(regs.items[0].sync_status, "skipped"); // GAS URL empty by default

  const patchReg = await regsPatch({
    request: makeReq(`/api/admin/registrations/${regData.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { status: "contacted", admin_note: "Đã mời vào nhóm Zalo." },
    }),
    env,
    params: { id: regData.id },
  });
  assert.equal(patchReg.status, 200);
  assert.equal((await patchReg.json()).item.status, "contacted");

  const csvRes = await regsExport({
    request: makeReq("/api/admin/registrations/export", { cookie: adminCookie }),
    env,
  });
  assert.equal(csvRes.status, 200);
  const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
  assert.deepEqual(Array.from(csvBytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  const csvText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes);
  assert.ok(csvText.startsWith("\uFEFF"));
  assert.ok(csvText.includes("Trần Minh Quân"));

  // 8. Sole-admin role isolation: creating editor/super_admin is blocked (403); creating media works & is blocked from /admin/*
  const blockedEditor = await usersCreate({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: adminCookie,
      body: { email: "editor@holarise.org", name: "Minh Anh", role: "editor", password: "EditorPass123" },
    }),
    env,
  });
  assert.equal(blockedEditor.status, 403);

  const uCreate = await usersCreate({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: adminCookie,
      body: { email: "media@holarise.org", name: "Minh Anh", role: "media", password: "MediaPass123" },
    }),
    env,
  });
  assert.equal(uCreate.status, 201);
  const editorId = (await uCreate.json()).item.id;

  const editorLogin = await authLogin({
    request: makeReq("/api/auth/login", {
      method: "POST",
      body: { email: "media@holarise.org", password: "MediaPass123" },
    }),
    env,
  });
  assert.equal(editorLogin.status, 200);
  const editorCookie = extractSessionCookie(editorLogin);

  const forbiddenUsers = await usersList({
    request: makeReq("/api/admin/users", { cookie: editorCookie }),
    env,
  });
  assert.equal(forbiddenUsers.status, 403);

  const forbiddenSettings = await settingsGet({
    request: makeReq("/api/admin/settings", { cookie: editorCookie }),
    env,
  });
  assert.equal(forbiddenSettings.status, 403);

  // Settings update SSRF guard
  const badWebhook = await settingsPut({
    request: makeReq("/api/admin/settings", {
      method: "PUT",
      cookie: adminCookie,
      body: { gas_webhook_url: "http://169.254.169.254/latest/meta-data" },
    }),
    env,
  });
  assert.equal(badWebhook.status, 400);

  const goodWebhook = await settingsPut({
    request: makeReq("/api/admin/settings", {
      method: "PUT",
      cookie: adminCookie,
      body: {
        notify_email: "phungsu@holarise.org",
        gas_webhook_url: "https://script.google.com/macros/s/AKfycb123456/exec",
        gas_webhook_secret: "secret-abc",
      },
    }),
    env,
  });
  assert.equal(goodWebhook.status, 200);
  assert.equal((await goodWebhook.json()).settings.has_webhook_secret, true);

  // Clean up test event & editor + test logout + password change
  const selfDel = await usersDelete({
    request: makeReq(`/api/admin/users/${(await (await authStatus({ request: makeReq("/api/auth/status", { cookie: adminCookie }), env })).json()).user.id}`, {
      method: "DELETE",
      cookie: adminCookie,
    }),
    env,
    params: { id: (await (await authStatus({ request: makeReq("/api/auth/status", { cookie: adminCookie }), env })).json()).user.id },
  });
  assert.equal(selfDel.status, 400);

  const edDel = await usersDelete({
    request: makeReq(`/api/admin/users/${editorId}`, { method: "DELETE", cookie: adminCookie }),
    env,
    params: { id: editorId },
  });
  assert.equal(edDel.status, 200);

  const pwChange = await authChangePw({
    request: makeReq("/api/auth/change-password", {
      method: "POST",
      cookie: adminCookie,
      body: { currentPassword: "StrongPassword123", newPassword: "NewStrongPassword456" },
    }),
    env,
  });
  assert.equal(pwChange.status, 200);

  const evDel = await eventsDelete({
    request: makeReq(`/api/admin/events/${createdEvent.id}`, { method: "DELETE", cookie: adminCookie }),
    env,
    params: { id: createdEvent.id },
  });
  assert.equal(evDel.status, 200);

  const outRes = await authLogout({
    request: makeReq("/api/auth/logout", { method: "POST", cookie: adminCookie }),
    env,
  });
  assert.equal(outRes.status, 200);

  const afterLogout = await (await authStatus({ request: makeReq("/api/auth/status", { cookie: adminCookie }), env })).json();
  assert.equal(afterLogout.authenticated, false);
});

test("SSR Pages Functions inject live D1 events, brand-new articles with OG/JSON-LD, sitemap & block /_templates", async () => {
  const db = createMockD1();
  const assets = {
    async fetch(req) {
      const p = new URL(req.url).pathname.replace(/^\/+/, "");
      const filePath = path.join(ROOT, "dist", p);
      if (!fs.existsSync(filePath)) return new Response("Not Found", { status: 404 });
      return new Response(fs.readFileSync(filePath, "utf8"), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
  const env = { DB: db, ASSETS: assets };

  // Middleware blocks direct access to /_templates/*
  const blocked = await rootMiddleware({
    request: makeReq("/_templates/news-detail-shell.tpl"),
    next: async () => new Response("should-not-run"),
  });
  assert.equal(blocked.status, 404);

  // Insert brand-new event & brand-new article directly into D1
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at)
       VALUES ('ev-live-ssr', 'upcoming', 'HolaGreen · Sạch', '["sach"]', '2026-12-27', 'CN, 27/12/2026', '07:00 – 09:00', 'Tân Xã', 'Miễn phí', 'Mở đăng ký', 'Chiến dịch SSR Live Test', 'Mô tả sự kiện mới đăng tức thì.', '[]', '', '/api/media/img-live.jpg', 'Ảnh live', 'published', -1, ?, ?)`
    )
    .bind(now, now)
    .run();

  await db
    .prepare(
      `INSERT INTO posts (id, slug, title, category, category_slug, filters_json, date, date_display, read_time, author, image, image_alt, excerpt, content_json, status, created_at, updated_at)
       VALUES ('post-live-ssr', 'bai-viet-moi-tuc-thi', 'Bài viết mới xuất bản tức thì', 'HolaHeart · Biết ơn', 'workshop', '["biet-on"]', '2026-11-25', '25/11/2026', '1 phút đọc', 'Ban Nội Dung', '/api/media/img-cover.jpg', 'Ảnh bìa mới', 'Tóm tắt hiển thị trên Zalo và Facebook ngay lập tức.', '["Đoạn mở đầu có **chữ đậm**.", "## Điểm nhấn", "- Kết quả 1"]', 'published', ?, ?)`
    )
    .bind(now, now)
    .run();

  // SSR home page includes the new live event in both next bar and rail
  const homeRes = await ssrHome({ request: makeReq("/"), env });
  assert.equal(homeRes.status, 200);
  const homeHtml = await homeRes.text();
  assert.ok(homeHtml.includes("Chiến dịch SSR Live Test"));
  assert.ok(homeHtml.includes('data-event-id="ev-live-ssr"'));

  // SSR article detail renders full SEO, Open Graph JPEG URL, JSON-LD & safe HTML
  const postRes = await ssrPostDetail({
    request: makeReq("/hanh-trinh/bai-viet-moi-tuc-thi/"),
    env,
    params: { slug: "bai-viet-moi-tuc-thi" },
  });
  assert.equal(postRes.status, 200);
  const postHtml = await postRes.text();
  assert.ok(!postHtml.includes("__SSR_"), "All __SSR_ placeholders must be replaced");
  assert.ok(postHtml.includes('<meta property="og:image" content="https://holarise.org/api/media/img-cover.jpg">'));
  assert.ok(postHtml.includes("https://holarise.org/hanh-trinh/bai-viet-moi-tuc-thi/"));
  assert.ok(postHtml.includes("<strong>chữ đậm</strong>"));
  assert.ok(postHtml.includes("<h2>Điểm nhấn</h2>"));
  assert.ok(postHtml.includes('"@type": "Article"'));

  // Non-existent slug returns 404
  const notFound = await ssrPostDetail({
    request: makeReq("/hanh-trinh/khong-ton-tai/"),
    env,
    params: { slug: "khong-ton-tai" },
  });
  assert.equal(notFound.status, 404);

  // Dynamic sitemap includes newly published post URL & new canonical routes
  const smRes = await ssrSitemap({ request: makeReq("/sitemap.xml"), env });
  assert.equal(smRes.status, 200);
  const smXml = await smRes.text();
  assert.ok(smXml.includes("https://holarise.org/hanh-trinh/bai-viet-moi-tuc-thi/"));
  assert.ok(smXml.includes("https://holarise.org/lich-hoat-dong/"));
  assert.ok(!smXml.includes("https://holarise.org/workshop/"));
  assert.ok(!smXml.includes("https://holarise.org/hoat-dong/"));

  // HEAD request on article & SSR on /lich-hoat-dong/ and /hanh-trinh/ + bare /_templates block
  const headPost = await ssrPostHead({
    request: makeReq("/hanh-trinh/bai-viet-moi-tuc-thi/", { method: "HEAD" }),
    env,
    params: { slug: "bai-viet-moi-tuc-thi" },
  });
  assert.equal(headPost.status, 200);
  assert.equal(await headPost.text(), "");

  const bareBlocked = await rootMiddleware({
    request: makeReq("/_templates"),
    next: async () => new Response("nope"),
  });
  assert.equal(bareBlocked.status, 404);

  const wsRes = await ssrSchedule({ request: makeReq("/lich-hoat-dong/"), env });
  assert.equal(wsRes.status, 200);
  const wsHtml = await wsRes.text();
  assert.ok(wsHtml.includes("Chiến dịch SSR Live Test"));
  assert.ok(wsHtml.includes('"@type": "Event"'));

  const joinRes = await ssrJoin({ request: makeReq("/tham-gia/"), env });
  assert.equal(joinRes.status, 200);
  const joinHtml = await joinRes.text();
  assert.ok(joinHtml.includes("Chiến dịch SSR Live Test"));
  assert.ok(joinHtml.includes('id="join-ev-ev-live-ssr"'));
  assert.ok(!joinHtml.includes("Chủ nhật gần nhất (nhận lịch qua Zalo)"));
  assert.ok(!joinHtml.includes("Thứ Bảy"));

  // Join Studio packaged registration payload stores cleanly in existing D1 schema
  const packagedJoinReg = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      ip: "5.5.5.5",
      body: {
        source: "join_page",
        eventId: "ev-live-ssr",
        activity: "Chiến dịch SSR Live Test",
        fullName: "Lê Minh Hoàng",
        phone: "0912345678",
        email: "hoang@fpt.edu.vn",
        role: "Tình nguyện viên chiến dịch môi trường",
        organization: "ĐH FPT",
        note: "[Tâm thế: Đi cùng bạn bè | Hứng thú: Trồng cây xanh | Rủ bởi: Minh Anh] Hẹn gặp cuối tuần!",
      },
    }),
    env,
  });
  assert.equal(packagedJoinReg.status, 201);
  const packagedBody = await packagedJoinReg.json();
  assert.ok(packagedBody.id.startsWith("REG-"));
  const storedJoinReg = await db
    .prepare("SELECT * FROM registrations WHERE id = ?")
    .bind(packagedBody.id)
    .first();
  assert.equal(storedJoinReg.event_id, "ev-live-ssr");
  assert.equal(storedJoinReg.activity_title, "Chiến dịch SSR Live Test");
  assert.ok(storedJoinReg.note.includes("Rủ bởi: Minh Anh"));

  const nlRes = await ssrJourneyList({ request: makeReq("/hanh-trinh/"), env });
  assert.equal(nlRes.status, 200);
  assert.ok((await nlRes.text()).includes("Bài viết mới xuất bản tức thì"));

  // Single-pass template substitution prevents token injection from title/excerpt
  await db
    .prepare(
      `INSERT INTO posts (id, slug, title, category, category_slug, filters_json, date, date_display, read_time, author, image, image_alt, excerpt, content_json, status, created_at, updated_at)
       VALUES ('post-token-xss', 'token-test', 'Tiêu đề chứa __SSR_EXTRA_JSON_LD__ an toàn', 'HolaGreen · Sạch', 'moi-truong', '["sach"]', '2026-11-26', '26/11/2026', '1 phút đọc', 'Admin', '/api/media/img-cover.jpg', 'Alt', 'Mô tả __SSR_ARTICLE_BODY__', '["Nội dung bình thường"]', 'published', ?, ?)`
    )
    .bind(now, now)
    .run();
  const tokRes = await ssrPostDetail({
    request: makeReq("/hanh-trinh/token-test/"),
    env,
    params: { slug: "token-test" },
  });
  const tokHtml = await tokRes.text();
  assert.ok(tokHtml.includes("<title>Tiêu đề chứa __SSR_EXTRA_JSON_LD__ an toàn"));
  assert.ok(!tokHtml.includes("<title>Tiêu đề chứa <script"));

  // Auto-past UTC+7 & empty-state hiding: mark all events past or expired in past -> Home & Join hide upcoming, Schedule shows Value-Driven Empty State
  await db.prepare("UPDATE events SET date = '2020-01-01' WHERE kind = 'upcoming'").run();
  const emptyHomeHtml = await (await ssrHome({ request: makeReq("/"), env })).text();
  assert.ok(!emptyHomeHtml.includes('id="lich-hen"'), "Home must hide upcoming section when no upcoming events remain");
  const emptyJoinHtml = await (await ssrJoin({ request: makeReq("/tham-gia/"), env })).text();
  assert.ok(!emptyJoinHtml.includes("data-join-events-step"), "Join must hide Step 02 when no upcoming events remain");
  const emptySchedHtml = await (await ssrSchedule({ request: makeReq("/lich-hoat-dong/"), env })).text();
  assert.ok(emptySchedHtml.includes("schedule-empty-flagship"), "Schedule must render Value-Driven Empty State");
  assert.ok(emptySchedHtml.includes("Chiến dịch SSR Live Test"), "Expired event automatically moves to Past list");
});

test("Security & reliability regressions: rate limits (429), resync, event edit preservation, session revoke on pw reset, GAS bridge, Vietnamese search & HEAD media", async () => {
  const env = { DB: createMockD1(), MEDIA_KV: createMockKV() };

  // Bootstrap sole admin (203int64)
  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "203int64@holarise.org", name: "Super", password: "SuperPassword123" },
    }),
    env,
  });
  const superCookie = extractSessionCookie(boot);

  // Create media user & log them in
  const edRes = await usersCreate({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: superCookie,
      body: { email: "ed2@holarise.org", name: "Ed2", role: "media", password: "EditorPass123" },
    }),
    env,
  });
  const edId = (await edRes.json()).item.id;
  const edLogin = await authLogin({
    request: makeReq("/api/auth/login", {
      method: "POST",
      ip: "9.9.9.1",
      body: { email: "ed2@holarise.org", password: "EditorPass123" },
    }),
    env,
  });
  const edCookie = extractSessionCookie(edLogin);

  // Admin resets editor's password -> editor's existing session must be revoked immediately!
  const resetRes = await usersPatch({
    request: makeReq(`/api/admin/users/${edId}`, {
      method: "PATCH",
      cookie: superCookie,
      body: { newPassword: "ResetPassword999" },
    }),
    env,
    params: { id: edId },
  });
  assert.equal(resetRes.status, 200);
  const edStatusAfterReset = await (await authStatus({ request: makeReq("/api/auth/status", { cookie: edCookie }), env })).json();
  assert.equal(edStatusAfterReset.authenticated, false);

  // Event edit without sortOrder/highlights/imageAlt preserves seeded fields
  const seededBefore = await env.DB.prepare("SELECT * FROM events WHERE id = 'cleanup-ho-tan-xa-thang-12'").first();
  assert.equal(seededBefore.sort_order, 1);
  const evEdit = await eventsUpdate({
    request: makeReq("/api/admin/events/cleanup-ho-tan-xa-thang-12", {
      method: "PUT",
      cookie: superCookie,
      body: {
        kind: "upcoming",
        title: seededBefore.title,
        type: seededBefore.type,
        date: seededBefore.date,
        summary: seededBefore.summary,
        seats: "Còn 12 chỗ",
      },
    }),
    env,
    params: { id: "cleanup-ho-tan-xa-thang-12" },
  });
  assert.equal(evEdit.status, 200);
  const evAfter = (await evEdit.json()).item;
  assert.equal(evAfter.sortOrder, 1);
  assert.equal(evAfter.highlights.length, 3);
  assert.equal(evAfter.imageAlt, seededBefore.image_alt);

  // Registration rate limit (6 allowed, 7th returns 429)
  let lastRegId = "";
  for (let i = 1; i <= 6; i++) {
    const r = await publicRegister({
      request: makeReq("/api/registrations", {
        method: "POST",
        ip: "8.8.8.8",
        body: { fullName: `Nguyễn Thị Ánh Tuyết ${i}`, phone: `098765432${i}`, email: `u${i}@gmail.com` },
      }),
      env,
    });
    assert.equal(r.status, 201);
    lastRegId = (await r.json()).id;
  }
  const r7 = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      ip: "8.8.8.8",
      body: { fullName: "Thứ 7 bị chặn", phone: "0987654329" },
    }),
    env,
  });
  assert.equal(r7.status, 429);

  // Login brute-force rate limit (10 attempts allowed, 11th returns 429)
  for (let i = 1; i <= 10; i++) {
    const lr = await authLogin({
      request: makeReq("/api/auth/login", {
        method: "POST",
        ip: "7.7.7.7",
        body: { email: "nobody@holarise.org", password: "wrongpassword" },
      }),
      env,
    });
    assert.equal(lr.status, 401);
  }
  const lr11 = await authLogin({
    request: makeReq("/api/auth/login", {
      method: "POST",
      ip: "7.7.7.7",
      body: { email: "nobody@holarise.org", password: "wrongpassword" },
    }),
    env,
  });
  assert.equal(lr11.status, 429);

  // Long multi-byte Vietnamese search + % wildcard escaping works cleanly
  const longViSearch = await regsList({
    request: makeReq(
      `/api/admin/registrations?q=${encodeURIComponent("Nguyễn Thị Ánh Tuyết Hòa Lạc Thạch Thất % _ 2026")}`,
      { cookie: superCookie }
    ),
    env,
  });
  assert.equal(longViSearch.status, 200);

  // Resync endpoint returns 200 skipped when unconfigured, 404 on unknown id; DELETE removes record
  const rsOk = await regsResync({
    request: makeReq(`/api/admin/registrations/${lastRegId}/resync`, { method: "POST", cookie: superCookie }),
    env,
    params: { id: lastRegId },
  });
  assert.equal(rsOk.status, 200);
  assert.equal((await rsOk.json()).sync_status, "skipped");

  const rs404 = await regsResync({
    request: makeReq("/api/admin/registrations/REG-NOPE/resync", { method: "POST", cookie: superCookie }),
    env,
    params: { id: "REG-NOPE" },
  });
  assert.equal(rs404.status, 404);

  const delReg = await regsDelete({
    request: makeReq(`/api/admin/registrations/${lastRegId}`, { method: "DELETE", cookie: superCookie }),
    env,
    params: { id: lastRegId },
  });
  assert.equal(delReg.status, 200);

  // Media HEAD request returns 200 with empty body
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const up = await (await mediaUpload({
    request: makeReq("/api/admin/media", {
      method: "POST",
      cookie: superCookie,
      body: jpegBytes,
      headers: { "Content-Type": "image/jpeg" },
    }),
    env,
  })).json();
  const hMedia = await mediaHead({ request: makeReq(up.url, { method: "HEAD" }), env, params: { id: up.id } });
  assert.equal(hMedia.status, 200);
  assert.equal(hMedia.headers.get("Content-Type"), "image/jpeg");

  // GAS webhook bridge mocked fetch tests (SSRF block, synced, failed)
  const gasSsrf = await callGasWebhook({ url: "http://127.0.0.1/hook", secret: "s", payload: {} });
  assert.equal(gasSsrf.status, "failed");
  const gasOk = await callGasWebhook({
    url: "https://script.google.com/macros/s/demo/exec",
    secret: "s",
    payload: { action: "ping" },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });
  assert.equal(gasOk.status, "synced");
  const gasFail = await callGasWebhook({
    url: "https://script.google.com/macros/s/demo/exec",
    secret: "s",
    payload: { action: "ping" },
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "Sai secret" }), { status: 200 }),
  });
  assert.equal(gasFail.status, "failed");
});

test("SEO edge middleware: www + legacy route 301 redirects and pages.dev noindex guard", async () => {
  const wwwRes = await rootMiddleware({
    request: new Request("https://www.holarise.org/tin-tuc/?ref=fb"),
    next: async () => new Response("should-not-run", { status: 200 }),
  });
  assert.equal(wwwRes.status, 301);
  assert.equal(wwwRes.headers.get("Location"), "https://holarise.org/hanh-trinh/?ref=fb");

  const legacyRedirects = [
    ["https://holarise.org/workshop/", "https://holarise.org/lich-hoat-dong/"],
    ["https://holarise.org/workshop", "https://holarise.org/lich-hoat-dong/"],
    ["https://holarise.org/hoat-dong/", "https://holarise.org/gioi-thieu/#chuong-trinh"],
    ["https://holarise.org/tin-tuc/", "https://holarise.org/hanh-trinh/"],
    ["https://holarise.org/tin-tuc/bai-viet-a/?utm=zalo", "https://holarise.org/hanh-trinh/bai-viet-a/?utm=zalo"],
  ];
  for (const [fromUrl, toUrl] of legacyRedirects) {
    const r = await rootMiddleware({
      request: new Request(fromUrl),
      next: async () => new Response("should-not-run", { status: 200 }),
    });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("Location"), toUrl);
  }

  const pagesDevRes = await rootMiddleware({
    request: new Request("https://holarise.pages.dev/"),
    next: async () => new Response("ok", { status: 200 }),
  });
  assert.equal(pagesDevRes.status, 200);
  assert.equal(pagesDevRes.headers.get("X-Robots-Tag"), "noindex, nofollow");

  const prodRes = await rootMiddleware({
    request: new Request("https://holarise.org/"),
    next: async () => new Response("ok", { status: 200 }),
  });
  assert.equal(prodRes.status, 200);
  assert.equal(prodRes.headers.get("X-Robots-Tag"), null);
});

test("Partners CMS API & SSR strip injection on Home and About", async () => {
  const db = createMockD1();
  const assets = {
    async fetch(req) {
      const p = new URL(req.url).pathname.replace(/^\/+/, "");
      const filePath = path.join(ROOT, "dist", p);
      if (!fs.existsSync(filePath)) return new Response("Not Found", { status: 404 });
      return new Response(fs.readFileSync(filePath, "utf8"), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
  const env = { DB: db, ASSETS: assets };

  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "203int64@holarise.org", name: "Admin", password: "StrongPassword123" },
    }),
    env,
  });
  const cookie = extractSessionCookie(boot);

  // Initially unconfigured in D1 -> Home preserves static partners fallback from dist/, About has no partners strip
  const home0 = await (await ssrHome({ request: makeReq("/"), env })).text();
  const about0 = await (await ssrAbout({ request: makeReq("/gioi-thieu/"), env })).text();
  assert.ok(home0.includes('id="doi-tac"'));
  assert.ok(!about0.includes('id="doi-tac"'));

  // Reject unsafe javascript: website URL
  const badRes = await partnersPut({
    request: makeReq("/api/admin/partners", {
      method: "PUT",
      cookie,
      body: { items: [{ name: "Bad Partner", websiteUrl: "javascript:alert(1)" }] },
    }),
    env,
  });
  assert.equal(badRes.status, 400);

  // Explicitly saving empty list in CMS hides partners strip on Home
  const emptyRes = await partnersPut({
    request: makeReq("/api/admin/partners", {
      method: "PUT",
      cookie,
      body: { items: [] },
    }),
    env,
  });
  assert.equal(emptyRes.status, 200);
  const homeEmpty = await (await ssrHome({ request: makeReq("/"), env })).text();
  assert.ok(!homeEmpty.includes('id="doi-tac"'));

  // Save 1 active + 1 inactive partner
  const putRes = await partnersPut({
    request: makeReq("/api/admin/partners", {
      method: "PUT",
      cookie,
      body: {
        items: [
          { name: "MusicSpace", role: "Không gian Đồng hành", logoUrl: "/assets/images/logo-musicspace.png", websiteUrl: "https://musicspace.edu.vn", isActive: true },
          { name: "Hidden Partner", role: "Nhà trường & CLB", isActive: false },
        ],
      },
    }),
    env,
  });
  assert.equal(putRes.status, 200);
  const getList = await (await partnersGet({ request: makeReq("/api/admin/partners", { cookie }), env })).json();
  assert.equal(getList.items.length, 2);

  // Active partner renders on Home; inactive stays hidden
  const home1 = await (await ssrHome({ request: makeReq("/"), env })).text();
  assert.ok(home1.includes("MusicSpace"));
  assert.ok(home1.includes("https://musicspace.edu.vn"));
  assert.ok(!home1.includes("Hidden Partner"));
});

test("Workshop 'Cuộc Đời Của Cha' migration 0005, SSR links, sitemap & seat reservation flow", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0001_init.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0002_seed.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0004_holaheart_first_event.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0005_cuoc_doi_cua_cha_event.sql"), "utf8"));
  // Re-run 0005 to verify strict idempotency
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0005_cuoc_doi_cua_cha_event.sql"), "utf8"));
  // Verify seeded dates exist, then shift in-memory dates to future so SSR upcoming assertions never flake after 2026-11-26
  assert.equal(db.prepare("SELECT date FROM events WHERE id = 'holaheart-cuoc-doi-cua-cha-2026-11-29'").get()?.date, "2026-11-29");
  db.exec("UPDATE events SET date = '2099-11-26' WHERE id = 'holaconnect-leo-nui-lam-nghiep-2026-11-26'");
  db.exec("UPDATE events SET date = '2099-11-29' WHERE id = 'holaheart-cuoc-doi-cua-cha-2026-11-29'");

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
  const d1 = { prepare: (sql) => new Stmt(sql) };
  const assets = {
    async fetch(req) {
      const p = new URL(req.url).pathname.replace(/^\/+/, "");
      const filePath = path.join(ROOT, "dist", p);
      if (!fs.existsSync(filePath)) return new Response("Not Found", { status: 404 });
      return new Response(fs.readFileSync(filePath, "utf8"), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
  const env = { DB: d1, ASSETS: assets };

  // 1. Placeholder Sunday event is draft; "Cuộc Đời Của Cha" is #1 on Home, Schedule & Join
  const homeHtml = await (await ssrHome({ request: makeReq("/"), env })).text();
  assert.ok(homeHtml.includes("Cuộc Đời Của Cha"));
  assert.ok(homeHtml.includes('href="/su-kien/cuoc-doi-cua-cha/"'));
  assert.ok(homeHtml.includes('data-event-href="/su-kien/cuoc-doi-cua-cha/"'));
  assert.ok(!homeHtml.includes("Người trẻ cùng ngồi lại"));
  assert.ok(homeHtml.includes("Chiều Leo Núi"));

  const schedHtml = await (await ssrSchedule({ request: makeReq("/lich-hoat-dong/"), env })).text();
  assert.ok(schedHtml.includes("Cuộc Đời Của Cha"));
  assert.ok(schedHtml.includes("19:15"));
  assert.ok(schedHtml.includes("Quán Cafe Mây Lang Thang, Hòa Lạc"));
  assert.ok(!schedHtml.includes("Người trẻ cùng ngồi lại"));

  const joinHtml = await (await ssrJoin({ request: makeReq("/tham-gia/"), env })).text();
  assert.ok(joinHtml.includes('id="join-ev-holaheart-cuoc-doi-cua-cha-2026-11-29"'));

  // 2. Sitemap SSR includes dedicated invitation URL
  const smXml = await (await ssrSitemap({ request: makeReq("/sitemap.xml"), env })).text();
  assert.ok(smXml.includes("https://holarise.org/su-kien/cuoc-doi-cua-cha/"));

  // 3. Dedicated static page exists in dist/ with custom OG 1200x630 & Event JSON-LD
  const inviteStaticPath = path.join(ROOT, "dist/su-kien/cuoc-doi-cua-cha/index.html");
  assert.ok(fs.existsSync(inviteStaticPath), "Static /su-kien/cuoc-doi-cua-cha/index.html must exist");
  const inviteHtml = fs.readFileSync(inviteStaticPath, "utf8");
  assert.ok(inviteHtml.includes("https://holarise.org/assets/images/events/cuoc-doi-cua-cha-og.jpg"));
  assert.ok(inviteHtml.includes("Tình thương của người cha hiếm khi cất thành lời."));
  assert.ok(inviteHtml.includes("https://zalo.me/g/7fock88aizzrdkmr9ggf"));
  assert.ok(inviteHtml.includes("2026-11-29T19:15:00+07:00"));
  assert.ok(fs.existsSync(path.join(ROOT, "dist/su-kien/leo-nui-luot/index.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "dist/en/index.html")));

  // 4. Seat reservation payload from Workshop Studio stores cleanly & returns seat confirmation
  const regRes = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      ip: "4.4.4.4",
      body: {
        source: "event_modal",
        eventId: "holaheart-cuoc-doi-cua-cha-2026-11-29",
        activity: 'Workshop "Cuộc Đời Của Cha"',
        role: "Tham dự Workshop Cuộc Đời Của Cha",
        fullName: "Nguyễn Hoàng Nam",
        phone: "0988 123 456",
        email: "nam.nh@fpt.edu.vn",
        organization: "ĐH FPT",
        note: "[Số chỗ: Đi cùng 1 bạn (2 chỗ) | Tâm sự về Cha: Cho phép đọc ẩn danh | Rủ bởi: Minh Anh] Con cảm ơn Cha vì tất cả những năm tháng thầm lặng.",
      },
    }),
    env,
  });
  assert.equal(regRes.status, 201);
  const regJson = await regRes.json();
  assert.ok(regJson.id.startsWith("REG-"));
  assert.ok(regJson.message.includes("đã ghi nhận giữ chỗ"));
  assert.ok(!regJson.message.includes("chưa phải xác nhận"));

  const row = await d1.prepare("SELECT * FROM registrations WHERE id = ?").bind(regJson.id).first();
  assert.equal(row.event_id, "holaheart-cuoc-doi-cua-cha-2026-11-29");
  assert.ok(row.note.includes("Số chỗ: Đi cùng 1 bạn (2 chỗ)"));
  assert.ok(row.note.includes("Tâm sự về Cha: Cho phép đọc ẩn danh"));
});

test("Full English mirror (/en/*): static EN purity, Edge SSR routes, sitemap & email-only international RSVP/Partnership", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0001_init.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0002_seed.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0004_holaheart_first_event.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0005_cuoc_doi_cua_cha_event.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0006_member_auth_and_reflections.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0011_event_seats_and_slugs.sql"), "utf8"));

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
  const d1 = { prepare: (sql) => new Stmt(sql) };
  const assets = {
    async fetch(req) {
      const p = new URL(req.url).pathname.replace(/^\/+/, "");
      const filePath = path.join(ROOT, "dist", p);
      if (!fs.existsSync(filePath)) return new Response("Not Found", { status: 404 });
      return new Response(fs.readFileSync(filePath, "utf8"), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
  const env = { DB: d1, ASSETS: assets };

  // 1. All core static EN routes exist and contain zero Vietnamese diacritics
  const vnRe = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/;
  const enStaticPages = [
    "dist/en/index.html",
    "dist/en/about/index.html",
    "dist/en/schedule/index.html",
    "dist/en/journey/index.html",
    "dist/en/join/index.html",
    "dist/en/privacy/index.html",
    "dist/en/events/cuoc-doi-cua-cha/index.html",
    "dist/en/events/leo-nui-luot/index.html",
    "dist/en/journey/tinh-yeu-thuong-cua-me/index.html",
    "dist/en/journey/holaheart-musicspace/index.html",
  ];
  for (const rel of enStaticPages) {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `Missing static EN page: ${rel}`);
    const html = fs.readFileSync(abs, "utf8");
    assert.ok(html.includes('<html lang="en" data-lang="en">'), `${rel} missing lang=en`);
    assert.ok(!vnRe.test(html), `${rel} leaked Vietnamese diacritics`);
  }

  // 2. Insert a live bilingual event in D1 and verify Edge SSR on /en/, /en/schedule/, /en/events/<slug>/, /en/join/
  const futureDate = "2027-03-14";
  await d1
    .prepare(
      `INSERT INTO events (id, kind, type, date, date_display, time, location, fee, seats, title, title_en, summary, summary_en, highlights_json, filters_json, image, image_alt, status, sort_order, created_at, updated_at)
       VALUES (?, 'upcoming', 'HolaConnect · Community', ?, 'Sunday, 14 Mar 2027', '15:00 – 17:30', 'VJU Hoa Lac Campus', 'Free admission', '30 seats', ?, ?, ?, ?, '[]', '["holaconnect"]', '/assets/images/events/activity-nature-trail.jpg', 'Campus dialogue', 'published', 1, ?, ?)`
    )
    .bind(
      "holaconnect-international-cafe-2027",
      futureDate,
      "HolaConnect · Gặp gỡ Sinh viên Quốc tế",
      "HolaConnect · International Youth Coffee Circle",
      "Buổi giao lưu song ngữ tại Hòa Lạc.",
      "A welcoming bilingual coffee circle connecting Vietnamese and international students in Hoa Lac.",
      "2026-11-26T00:00:00Z",
      "2026-11-26T00:00:00Z"
    )
    .run();

  const { onRequestGet: ssrEnHome } = await import("../functions/en/index.js");
  const { onRequestGet: ssrEnAbout } = await import("../functions/en/about/index.js");
  const { onRequestGet: ssrEnSchedule } = await import("../functions/en/schedule/index.js");
  const { onRequestGet: ssrEnJoin } = await import("../functions/en/join/index.js");
  const { onRequestGet: ssrEnJourney } = await import("../functions/en/journey/index.js");
  const { onRequestGet: ssrEnEventDetail } = await import("../functions/en/events/[slug].js");

  const enHomeHtml = await (await ssrEnHome({ request: makeReq("/en/"), env })).text();
  assert.ok(enHomeHtml.includes("International Youth Coffee Circle"));
  assert.ok(enHomeHtml.includes("/en/events/holaconnect-international-cafe-2027/"));

  const enSchedHtml = await (await ssrEnSchedule({ request: makeReq("/en/schedule/"), env })).text();
  assert.ok(enSchedHtml.includes("International Youth Coffee Circle"));

  const enJoinHtml = await (await ssrEnJoin({ request: makeReq("/en/join/"), env })).text();
  assert.ok(enJoinHtml.includes("International Youth Coffee Circle"));

  const enAboutRes = await ssrEnAbout({ request: makeReq("/en/about/"), env });
  assert.equal(enAboutRes.status, 200);

  const enJourneyRes = await ssrEnJourney({ request: makeReq("/en/journey/"), env });
  assert.equal(enJourneyRes.status, 200);

  const enEvRes = await ssrEnEventDetail({
    request: makeReq("/en/events/holaconnect-international-cafe-2027/"),
    env,
    params: { slug: "holaconnect-international-cafe-2027" },
  });
  assert.equal(enEvRes.status, 200);
  const enEvHtml = await enEvRes.text();
  assert.ok(enEvHtml.includes("International Youth Coffee Circle"));
  assert.ok(enEvHtml.includes("welcoming bilingual coffee circle"));

  // 3. Sitemap includes /en/* static and dynamic routes
  const smXml = await (await ssrSitemap({ request: makeReq("/sitemap.xml"), env })).text();
  assert.ok(smXml.includes("https://holarise.org/en/about/"));
  assert.ok(smXml.includes("https://holarise.org/en/schedule/"));
  assert.ok(smXml.includes("https://holarise.org/en/events/holaconnect-international-cafe-2027/"));

  // 4. International email-only RSVP & Partnership submission with lang='en' returns English confirmation
  const intlRes = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      ip: "5.5.5.5",
      body: {
        source: "event_modal",
        lang: "en",
        eventId: "holaconnect-international-cafe-2027",
        activity: "HolaConnect · International Youth Coffee Circle",
        fullName: "Hannah Sato",
        phone: "hannah.sato@vju.ac.vn",
        organization: "Vietnam Japan University",
        note: "International student excited to join!",
      },
    }),
    env,
  });
  assert.equal(intlRes.status, 201);
  const intlJson = await intlRes.json();
  assert.ok(intlJson.message.includes("Thank you, Hannah Sato!"));
  assert.ok(intlJson.message.includes("is confirmed"));

  // 5. Validation error with lang='en' returns English field errors
  const badRes = await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      ip: "5.5.5.6",
      body: {
        source: "join_page",
        lang: "en",
        fullName: "A",
        phone: "123",
      },
    }),
    env,
  });
  assert.equal(badRes.status, 400);
  const badJson = await badRes.json();
  assert.ok(badJson.error.message.includes("Please check"));
  assert.ok(badJson.error.fields.phone.includes("valid phone number"));
});

test("CMS v2: Sole-admin 203int64 lock, /api/admin/overview, migration 0018 zaloGroupUrl SSR & bug_screenshot_url", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0001_init.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0002_seed.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0003_media_portal.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0006_member_auth_and_reflections.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0011_event_seats_and_slugs.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0016_media_approval_workflow.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0018_event_zalo_url.sql"), "utf8"));

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
  const d1 = {
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  const assets = {
    async fetch(req) {
      const p = new URL(req.url).pathname.replace(/^\/+/, "");
      const filePath = path.join(ROOT, "dist", p);
      if (!fs.existsSync(filePath)) return new Response("Not Found", { status: 404 });
      return new Response(fs.readFileSync(filePath, "utf8"), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
  const env = { DB: d1, MEDIA_KV: createMockKV(), ASSETS: assets };

  // 1. Bootstrap sole admin 203int64
  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "203int64@gmail.com", name: "Sole Admin", password: "StrongPassword123" },
    }),
    env,
  });
  assert.equal(boot.status, 201);
  const soleCookie = extractSessionCookie(boot);

  const stSole = await (await authStatus({ request: makeReq("/api/auth/status", { cookie: soleCookie }), env })).json();
  assert.equal(stSole.isSoleAdmin, true);

  // 2. Insert a rogue super_admin with another email directly in D1 -> MUST be blocked (403)
  const { hash, salt } = await hashPassword("RoguePass123!");
  const now = new Date().toISOString();
  await d1
    .prepare(
      "INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, is_active, created_at) VALUES (?, ?, ?, 'super_admin', ?, ?, 1, ?)"
    )
    .bind("rogue-1", "other@holarise.org", "Other", hash, salt, now)
    .run();
  const rogueLogin = await authLogin({
    request: makeReq("/api/auth/login", {
      method: "POST",
      ip: "7.7.7.7",
      body: { email: "other@holarise.org", password: "RoguePass123!" },
    }),
    env,
  });
  const rogueBody = await rogueLogin.json();
  assert.equal(rogueBody.isSoleAdmin, false);
  const rogueCookie = extractSessionCookie(rogueLogin);
  const rogueOverview = await overviewGet({ request: makeReq("/api/admin/overview", { cookie: rogueCookie }), env });
  assert.equal(rogueOverview.status, 403);

  // 3. Create an event with custom per-event zaloGroupUrl -> persisted & rendered on /su-kien/<slug>/
  const evCreate = await eventsCreate({
    request: makeReq("/api/admin/events", {
      method: "POST",
      cookie: soleCookie,
      body: {
        kind: "upcoming",
        type: "HolaHeart · Giá trị sống",
        title: "HolaHeart Đêm Cuối Năm",
        date: "2027-04-10",
        time: "19:00 – 21:00",
        location: "Hòa Lạc",
        fee: "Miễn phí",
        seatCapacity: 30,
        showSeatBar: true,
        zaloGroupUrl: "https://zalo.me/g/custom-event-group-2027",
        summary: "Buổi trò chuyện ấm cúng dành cho người trẻ tại Hòa Lạc.",
        highlights: ["Đón khách", "Chia sẻ nhóm nhỏ"],
        filters: ["biet-on"],
      },
    }),
    env,
  });
  assert.equal(evCreate.status, 201);
  const createdEv = (await evCreate.json()).item;
  assert.equal(createdEv.zaloGroupUrl, "https://zalo.me/g/custom-event-group-2027");

  const inviteRes = await ssrEventInvite({
    request: makeReq(`/su-kien/${createdEv.slug}/`),
    env,
    params: { slug: createdEv.slug },
  });
  assert.equal(inviteRes.status, 200);
  const inviteHtml = await inviteRes.text();
  assert.ok(inviteHtml.includes("https://zalo.me/g/custom-event-group-2027"));

  // 4. Add 1 registration for the event + 1 pending photo in media_photos + 1 bug screenshot note -> verify overview & registrations API
  await publicRegister({
    request: makeReq("/api/registrations", {
      method: "POST",
      ip: "7.7.7.8",
      body: {
        source: "event_modal",
        eventId: createdEv.id,
        activity: createdEv.title,
        fullName: "Nguyễn Văn An",
        phone: "0911222333",
      },
    }),
    env,
  });
  await d1
    .prepare(
      "INSERT INTO registrations (id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at) VALUES (?, 'join_page', '', 'Báo lỗi', 'Lan', '0900111222', '', '', '', ?, 'new', '', 'skipped', '', 'ip', ?, ?)"
    )
    .bind("REG-BUG-1", "Lỗi hiển thị\n\n[Ảnh màn hình lỗi (Admin)]: /api/admin/bug-screenshot/bug-261126-abc12345.jpg", now, now)
    .run();

  const albumRow = await d1.prepare("SELECT id FROM media_albums LIMIT 1").first();
  if (albumRow) {
    await d1
      .prepare(
        "INSERT INTO media_photos (id, album_id, url, web_url, media_key, caption, alt, photographer, is_featured_home, sort_order, approval_status, created_at, updated_at) VALUES ('ph-pend-1', ?, '/api/media/x.jpg', '/api/media/x.jpg', 'x.jpg', '', '', 'TV', 0, 0, 'pending', ?, ?)"
      )
      .bind(albumRow.id, now, now)
      .run();
  }

  const ovRes = await overviewGet({ request: makeReq("/api/admin/overview", { cookie: soleCookie }), env });
  assert.equal(ovRes.status, 200);
  const ov = await ovRes.json();
  assert.equal(ov.registrations.new, 2);
  assert.equal(ov.media.pendingPhotoCount, albumRow ? 1 : 0);
  const evInOv = ov.events.upcoming.find((x) => x.id === createdEv.id);
  assert.ok(evInOv);
  assert.equal(evInOv.webBookedCount, 1);

  const bugRegsRes = await regsList({
    request: makeReq("/api/admin/registrations?source=feedback", { cookie: soleCookie }),
    env,
  });
  const bugRegs = await bugRegsRes.json();
  assert.equal(bugRegs.items.length, 1);
  assert.equal(bugRegs.items[0].bug_screenshot_url, "/api/admin/bug-screenshot/bug-261126-abc12345.jpg");
});
