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
import { onRequestGet as ssrWorkshop } from "../functions/workshop/index.js";
import { onRequestGet as ssrJoin } from "../functions/tham-gia/index.js";
import { onRequestGet as ssrNewsList } from "../functions/tin-tuc/index.js";
import { onRequestGet as ssrPostDetail, onRequestHead as ssrPostHead } from "../functions/tin-tuc/[slug].js";
import { onRequestHead as mediaHead } from "../functions/api/media/[id].js";
import { onRequestGet as ssrSitemap } from "../functions/sitemap.xml.js";
import { callGasWebhook } from "../functions/_lib/gas.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

/** Minimal Cloudflare D1 adapter backed by real in-memory SQLite */
function createMockD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0001_init.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0002_seed.sql"), "utf8"));

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

  // 2. Bootstrap super admin
  const bootRes = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "admin@holarise.org", name: "Nguyễn Lan", password: "StrongPassword123" },
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

  // 8. Role isolation: create editor -> editor blocked from /users & /settings
  const uCreate = await usersCreate({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: adminCookie,
      body: { email: "editor@holarise.org", name: "Minh Anh", role: "editor", password: "EditorPass123" },
    }),
    env,
  });
  assert.equal(uCreate.status, 201);
  const editorId = (await uCreate.json()).item.id;

  const editorLogin = await authLogin({
    request: makeReq("/api/auth/login", {
      method: "POST",
      body: { email: "editor@holarise.org", password: "EditorPass123" },
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
    request: makeReq("/tin-tuc/bai-viet-moi-tuc-thi/"),
    env,
    params: { slug: "bai-viet-moi-tuc-thi" },
  });
  assert.equal(postRes.status, 200);
  const postHtml = await postRes.text();
  assert.ok(!postHtml.includes("__SSR_"), "All __SSR_ placeholders must be replaced");
  assert.ok(postHtml.includes('<meta property="og:image" content="https://holarise.org/api/media/img-cover.jpg">'));
  assert.ok(postHtml.includes("https://holarise.org/tin-tuc/bai-viet-moi-tuc-thi/"));
  assert.ok(postHtml.includes("<strong>chữ đậm</strong>"));
  assert.ok(postHtml.includes("<h2>Điểm nhấn</h2>"));
  assert.ok(postHtml.includes('"@type": "Article"'));

  // Non-existent slug returns 404
  const notFound = await ssrPostDetail({
    request: makeReq("/tin-tuc/khong-ton-tai/"),
    env,
    params: { slug: "khong-ton-tai" },
  });
  assert.equal(notFound.status, 404);

  // Dynamic sitemap includes newly published post URL
  const smRes = await ssrSitemap({ request: makeReq("/sitemap.xml"), env });
  assert.equal(smRes.status, 200);
  const smXml = await smRes.text();
  assert.ok(smXml.includes("https://holarise.org/tin-tuc/bai-viet-moi-tuc-thi/"));

  // HEAD request on article & SSR on /workshop/ and /tin-tuc/ + bare /_templates block
  const headPost = await ssrPostHead({
    request: makeReq("/tin-tuc/bai-viet-moi-tuc-thi/", { method: "HEAD" }),
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

  const wsRes = await ssrWorkshop({ request: makeReq("/workshop/"), env });
  assert.equal(wsRes.status, 200);
  const wsHtml = await wsRes.text();
  assert.ok(wsHtml.includes("Chiến dịch SSR Live Test"));
  assert.ok(wsHtml.includes('"@type": "Event"'));

  const joinRes = await ssrJoin({ request: makeReq("/tham-gia/"), env });
  assert.equal(joinRes.status, 200);
  const joinHtml = await joinRes.text();
  assert.ok(joinHtml.includes("Chiến dịch SSR Live Test"));
  assert.ok(joinHtml.includes('id="join-ev-ev-live-ssr"'));
  assert.ok(joinHtml.includes("Ngày đầu của tuần - Chủ nhật"));
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
        note: "[Phong cách: Đi một mình (ghép nhóm) | Hứng thú: Trồng cây xanh | Rủ bởi: Minh Anh] Hẹn gặp Chủ nhật!",
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

  const nlRes = await ssrNewsList({ request: makeReq("/tin-tuc/"), env });
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
    request: makeReq("/tin-tuc/token-test/"),
    env,
    params: { slug: "token-test" },
  });
  const tokHtml = await tokRes.text();
  assert.ok(tokHtml.includes("<title>Tiêu đề chứa __SSR_EXTRA_JSON_LD__ an toàn"));
  assert.ok(!tokHtml.includes("<title>Tiêu đề chứa <script"));
});

test("Security & reliability regressions: rate limits (429), resync, event edit preservation, session revoke on pw reset, GAS bridge, Vietnamese search & HEAD media", async () => {
  const env = { DB: createMockD1(), MEDIA_KV: createMockKV() };

  // Bootstrap admin
  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "super@holarise.org", name: "Super", password: "SuperPassword123" },
    }),
    env,
  });
  const superCookie = extractSessionCookie(boot);

  // Create editor & log them in
  const edRes = await usersCreate({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: superCookie,
      body: { email: "ed2@holarise.org", name: "Ed2", role: "editor", password: "EditorPass123" },
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
