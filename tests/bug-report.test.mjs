import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { validateEventFeedbackInput } from "../functions/_lib/validation.js";
import { onRequestPost as feedbackPost } from "../functions/api/event-feedback/index.js";
import { onRequestPost as registrationsPost } from "../functions/api/registrations.js";
import { onRequestGet as bugScreenshotGet } from "../functions/api/admin/bug-screenshot/[id].js";
import { notifyAdminNewFeedback } from "../functions/_lib/manager-notify.js";
import { randomTokenHex, SESSION_COOKIE_NAME, sha256Hex } from "../functions/_lib/security.js";

const TINY_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from(TINY_JPEG).toString("base64")}`;

function createMockKv() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts = {}) {
      store.set(key, { value, opts });
    },
    async getWithMetadata(key) {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: entry.value, metadata: entry.opts?.metadata || null };
    },
  };
}

function createMockDb(adminTokenHash = "", notifyEmail = "admin-alert@holarise.org") {
  const insertedFeedbacks = [];
  const insertedRegs = [];
  return {
    insertedFeedbacks,
    insertedRegs,
    prepare(sql) {
      const q = String(sql);
      return {
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        async first() {
          if (q.includes("FROM sessions") && adminTokenHash && this._binds[0] === adminTokenHash) {
            return {
              session_id: "sess-1",
              user_id: "u-1",
              email: "203int64@holarise.org",
              name: "Admin",
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
              username: "203int64",
              display_name: "Admin",
              role: "super_admin",
              is_active: 1,
            };
          }
          if (q.includes("FROM settings") && q.includes("notify_email")) {
            return { value: notifyEmail };
          }
          return null;
        },
        async run() {
          if (q.includes("INSERT INTO event_feedbacks")) {
            insertedFeedbacks.push(this._binds);
          } else if (q.includes("INSERT INTO registrations")) {
            insertedRegs.push(this._binds);
          }
          return { success: true };
        },
      };
    },
  };
}

test("validateEventFeedbackInput: accepts site/bug feedback with diagnostics & valid JPEG attachment", () => {
  const res = validateEventFeedbackInput({
    sourceKind: "bug",
    topicLabel: "Báo lỗi kỹ thuật",
    pageUrl: "/su-kien/demo",
    content: "Nút đăng ký bị lệch trên màn hình iPhone SE.",
    diagnostics: "Trang: /su-kien/demo\nKhung hình: 375x667",
    attachmentDataUrl: TINY_JPEG_DATA_URL,
  });

  assert.equal(res.ok, true);
  assert.equal(res.value.source_kind, "bug");
  assert.equal(res.value.attachment_data_url, TINY_JPEG_DATA_URL);
  assert.equal(res.value.page_url, "/su-kien/demo");
  assert.match(res.value.diagnostics, /\/su-kien\/demo/);
});

test("validateEventFeedbackInput: rejects invalid attachment MIME", () => {
  const bad = validateEventFeedbackInput({
    sourceKind: "bug",
    content: "Lỗi hiển thị phần tiêu đề trang chủ.",
    attachmentDataUrl: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.fields.attachmentDataUrl);
});

test("POST /api/event-feedback (site/bug) stores in event_feedbacks (never registrations), saves private image & notifies Admin by email", async () => {
  const rawToken = randomTokenHex(32);
  const tokenHash = await sha256Hex(rawToken);
  const kv = createMockKv();
  const db = createMockDb(tokenHash, "ops@holarise.org");
  const sentEmails = [];
  const fakeEmailBinding = {
    async send(msg) {
      sentEmails.push(msg);
    },
  };

  const req = new Request("https://holarise.org/api/event-feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://holarise.org",
    },
    body: JSON.stringify({
      sourceKind: "bug",
      topicLabel: "Báo lỗi kỹ thuật",
      pageUrl: "/su-kien/test",
      content: "Màn hình sự kiện bị tràn ngang khi mở trong Zalo.",
      diagnostics: "Trang: /su-kien/test\nMôi trường: Zalo WebView / iOS",
      attachmentDataUrl: TINY_JPEG_DATA_URL,
    }),
  });

  const postRes = await feedbackPost({
    request: req,
    env: { DB: db, MEDIA_KV: kv, EMAIL: fakeEmailBinding, EMAIL_CLOUDFLARE_PAID: "1" },
  });
  assert.equal(postRes.status, 201);
  const postJson = await postRes.json();
  assert.equal(postJson.ok, true);
  assert.equal(postJson.attachmentSaved, true);
  assert.equal(postJson.sourceKind, "bug");

  // Stored strictly in event_feedbacks, NOT registrations
  assert.equal(db.insertedRegs.length, 0);
  assert.equal(db.insertedFeedbacks.length, 1);

  assert.equal(kv.store.size, 1);
  const [[kvKey, kvEntry]] = Array.from(kv.store.entries());
  assert.match(kvKey, /^bugshot:bug-.*\.jpg$/);
  assert.equal(kvEntry.opts.expirationTtl, 60 * 60 * 24 * 30);

  const shotId = kvKey.replace(/^bugshot:/, "");
  assert.equal(db.insertedFeedbacks[0][7], `/api/admin/bug-screenshot/${shotId}`);

  // 1) Admin email notification triggered to notify_email with direct link to feedbacks subtab
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "ops@holarise.org");
  assert.match(sentEmails[0].subject, /HolaRise Góp ý/);
  assert.match(sentEmails[0].html, /\/admin\/\?tab=community&amp;subtab=feedbacks/);

  // 2) Unauthenticated access to attached image MUST be blocked (401)
  const unauthRes = await bugScreenshotGet({
    request: new Request(`https://holarise.org/api/admin/bug-screenshot/${shotId}`),
    env: { DB: db, MEDIA_KV: kv },
    params: { id: shotId },
  });
  assert.equal(unauthRes.status, 401);

  // 3) Authenticated admin access MUST succeed with private no-store header
  const authRes = await bugScreenshotGet({
    request: new Request(`https://holarise.org/api/admin/bug-screenshot/${shotId}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${rawToken}` },
    }),
    env: { DB: db, MEDIA_KV: kv },
    params: { id: shotId },
  });
  assert.equal(authRes.status, 200);
  assert.equal(authRes.headers.get("Content-Type"), "image/jpeg");
  assert.equal(authRes.headers.get("Cache-Control"), "private, no-store");
  const returnedBytes = new Uint8Array(await authRes.arrayBuffer());
  assert.deepEqual(returnedBytes, TINY_JPEG);
});

test("Legacy POST /api/registrations with source=feedback redirects cleanly into event_feedbacks (zero pollution of registrations)", async () => {
  const db = createMockDb();
  const req = new Request("https://holarise.org/api/registrations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://holarise.org",
    },
    body: JSON.stringify({
      source: "feedback",
      role: "Đề xuất ý tưởng / hoạt động",
      note: "Mong HolaRise tổ chức thêm buổi đọc sách sáng Chủ nhật.",
      organization: "/lich-hoat-dong/",
    }),
  });

  const res = await registrationsPost({ request: req, env: { DB: db } });
  assert.equal(res.status, 201);
  assert.equal(db.insertedRegs.length, 0);
  assert.equal(db.insertedFeedbacks.length, 1);
  assert.equal(db.insertedFeedbacks[0][4], "site");
  assert.equal(db.insertedFeedbacks[0][6], "/lich-hoat-dong/");
});

test("notifyAdminNewFeedback: respects anonymity and falls back to default notify email", async () => {
  const sent = [];
  const fakeEmail = {
    async send(msg) {
      sent.push(msg);
    },
  };
  const result = await notifyAdminNewFeedback(
    { EMAIL: fakeEmail, EMAIL_CLOUDFLARE_PAID: "1" },
    {
      feedback: {
        sourceKind: "site",
        topicLabel: "Đề xuất",
        pageUrl: "/",
        content: "Nút góp ý nhỏ gọn rất dễ bấm.",
        authorName: "Tên thật không được lộ",
        authorContact: "0999888777",
        isAnonymous: true,
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "phungsu@holarise.org");
  assert.match(sent[0].html, /Ẩn danh \(bảo mật\)/);
  assert.doesNotMatch(sent[0].html, /0999888777/);
});

test("Migration 0028 moves legacy feedback rows out of registrations into event_feedbacks cleanly", () => {
  const db = new DatabaseSync(":memory:");
  for (const mig of [
    "migrations/0001_init.sql",
    "migrations/0003_media_portal.sql",
    "migrations/0006_member_auth_and_reflections.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0019_event_memory_stage.sql",
  ]) {
    db.exec(fs.readFileSync(mig, "utf8"));
  }

  const now = "2026-11-28T14:28:00.000Z";
  // Insert 1 real event registration + 1 legacy bug feedback + 1 legacy idea feedback
  db.prepare(
    `INSERT INTO registrations (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
     VALUES (?, '', 'event_modal', 'ev-cha', 'Workshop "Cuộc Đời Của Cha"', 'Phuc Thanh', '0862899982', '203int64@gmail.com', '', '', 'Đi 1 mình', 'contacted', '', 'skipped', '', 'ip1', ?, ?)`
  ).run("REG-REAL-1", now, now);

  db.prepare(
    `INSERT INTO registrations (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
     VALUES (?, 'm-1', 'join_page', '', 'Đóng góp · Đề xuất ý tưởng / hoạt động', 'Phuc Thanh', '203int64@gmail.com', '203int64@gmail.com', 'Đề xuất ý tưởng / hoạt động', '/?source=pwa', ?, 'contacted', '', 'skipped', '', 'ip2', ?, ?)`
  ).run(
    "REG-OLD-BUG",
    "Chữ lỗi trên mobile\n\n[Ảnh màn hình lỗi (Admin)]: /api/admin/bug-screenshot/bug-261128-ff47586b.jpg\n[Ngữ cảnh kỹ thuật]: Trang: /?source=pwa",
    now,
    now
  );

  db.prepare(
    `INSERT INTO registrations (id, member_id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
     VALUES (?, '', 'join_page', '', 'Đóng góp · Đề xuất ý tưởng / hoạt động', 'Thành viên đóng góp', 'Ẩn danh', '', 'Đề xuất ý tưởng / hoạt động', '/lich-hoat-dong/', 'Thêm buổi đọc sách cuối tuần', 'new', '', 'skipped', '', 'ip3', ?, ?)`
  ).run("REG-OLD-IDEA", now, now);

  db.exec(fs.readFileSync("migrations/0028_unified_feedback_inbox.sql", "utf8"));

  const remainingRegs = db.prepare("SELECT id FROM registrations").all();
  assert.equal(remainingRegs.length, 1);
  assert.equal(remainingRegs[0].id, "REG-REAL-1");

  const migrated = db.prepare("SELECT * FROM event_feedbacks ORDER BY id ASC").all();
  assert.equal(migrated.length, 2);

  const bugRow = migrated.find((r) => r.id === "efb_mig_REG_OLD_BUG");
  assert.ok(bugRow);
  assert.equal(bugRow.source_kind, "bug");
  assert.equal(bugRow.attachment_url, "/api/admin/bug-screenshot/bug-261128-ff47586b.jpg");
  assert.equal(bugRow.page_url, "/?source=pwa");
  assert.equal(bugRow.content, "Chữ lỗi trên mobile");
  assert.equal(bugRow.status, "read");
  assert.equal(bugRow.is_anonymous, 0);

  const ideaRow = migrated.find((r) => r.id === "efb_mig_REG_OLD_IDEA");
  assert.ok(ideaRow);
  assert.equal(ideaRow.source_kind, "site");
  assert.equal(ideaRow.category, "de-xuat");
  assert.equal(ideaRow.page_url, "/lich-hoat-dong/");
  assert.equal(ideaRow.is_anonymous, 1);
  assert.equal(ideaRow.author_name, "Ẩn danh");
  assert.equal(ideaRow.status, "new");
});
