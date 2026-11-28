import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { onRequest as edgeMiddleware } from "../functions/_middleware.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as authLogin } from "../functions/api/auth/login.js";
import { onRequestGet as authStatus } from "../functions/api/auth/status.js";
import { onRequestGet as usersGet, onRequestPost as usersPost } from "../functions/api/admin/users/index.js";
import { onRequestPatch as userPatch } from "../functions/api/admin/users/[id].js";
import { onRequestGet as overviewGet } from "../functions/api/admin/overview.js";
import { onRequestGet as timelineGet } from "../functions/api/admin/timeline.js";
import { onRequestGet as tasksGet, onRequestPost as tasksPost } from "../functions/api/admin/tasks/index.js";
import { onRequestPatch as taskPatch, onRequestDelete as taskDelete } from "../functions/api/admin/tasks/[id].js";
import { onRequestPost as playbookPost } from "../functions/api/admin/tasks/playbook.js";
import { onRequestGet as auditGet } from "../functions/api/admin/audit.js";
import { onRequestPost as eventsPost } from "../functions/api/admin/events/index.js";
import { onRequestDelete as eventDelete } from "../functions/api/admin/events/[id].js";
import { onRequestGet as postsGet, onRequestPost as postsPost } from "../functions/api/admin/posts/index.js";
import { onRequestPut as postPut, onRequestDelete as postDelete } from "../functions/api/admin/posts/[id].js";
import { onRequestGet as regsGet } from "../functions/api/admin/registrations/index.js";
import { onRequestGet as regsExport } from "../functions/api/admin/registrations/export.js";
import { onRequestPost as photoApprove } from "../functions/api/admin/photos/[id]/approve.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import { onRequestGet as memberTasksGet, onRequestPatch as memberTasksPatch } from "../functions/api/member/tasks.js";

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
    "migrations/0010_admin_passkeys_and_profile.sql",
    "migrations/0011_event_seats_and_slugs.sql",
    "migrations/0012_fix_media_role_and_tables.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0017_member_photo_contributions.sql",
    "migrations/0018_event_zalo_url.sql",
    "migrations/0019_event_memory_stage.sql",
    "migrations/0020_deep_member_media_event_control.sql",
    "migrations/0021_video_media_support.sql",
    "migrations/0025_companion_chat_and_capabilities.sql",
    "migrations/0026_holarise_manager_rbac_tasks_audit.sql",
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

function makeReq(urlPath, { method = "GET", body, cookie = "", ip = "10.0.0.1" } = {}) {
  const headers = new Headers({
    Origin: "https://holarise.org",
    "CF-Connecting-IP": ip,
  });
  if (cookie) headers.set("Cookie", cookie);
  let payload;
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  return new Request(`https://holarise.org${urlPath}`, { method, headers, body: payload });
}

function extractCookie(res, name) {
  const raw = res.headers.get("Set-Cookie") || "";
  const m = raw.match(new RegExp(`${name}=([^;]+)`));
  return m ? `${name}=${m[1]}` : "";
}

test("Edge middleware redirects /manager and /manager/ to /admin/ (301)", async () => {
  const res = await edgeMiddleware({
    request: new Request("https://holarise.org/manager/?tab=timeline"),
    next: async () => new Response("ok"),
  });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://holarise.org/admin/?tab=timeline");
});

test("HolaRise Manager: 6-Role RBAC matrix, Maker-Checker posts & media, Tasks/Playbook, Timeline, CTV bridge & Audit Log", async () => {
  const d1 = createMockD1();
  const env = { DB: d1 };

  // 1. Bootstrap Sole Super Admin (203int64)
  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "203int64@holarise.org", name: "Chủ nhiệm Hola", password: "SuperPassword123!" },
    }),
    env,
  });
  assert.equal(boot.status, 201);
  const superCookie = extractCookie(boot, "holarise_session");

  // 2. Super Admin cannot create a second super_admin (403 ADMIN_LOCKED)
  const blockedSuper = await usersPost({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: superCookie,
      body: { email: "fake@holarise.org", name: "Fake", role: "super_admin", password: "Password123!" },
    }),
    env,
  });
  assert.equal(blockedSuper.status, 403);

  // 3. Super Admin creates all 5 delegated staff roles across 4 departments
  const staffSpecs = [
    { key: "ops", email: "ops@holarise.org", name: "Minh Ops", role: "event_ops", department: "Ban Sự Kiện" },
    { key: "editor", email: "editor@holarise.org", name: "Lan Editor", role: "content_editor", department: "Ban Nội Dung" },
    { key: "cctv", email: "cctv@holarise.org", name: "Huy Content CTV", role: "content_ctv", department: "Ban Nội Dung" },
    { key: "mman", email: "mman@holarise.org", name: "Tú Media Lead", role: "media_manager", department: "Ban Hình Ảnh" },
    { key: "mctv", email: "mctv@holarise.org", name: "An Media CTV", role: "media_ctv", department: "Ban Hình Ảnh" },
  ];

  const staff = {};
  let ipIdx = 10;
  for (const spec of staffSpecs) {
    const cr = await usersPost({
      request: makeReq("/api/admin/users", {
        method: "POST",
        cookie: superCookie,
        body: { ...spec, password: "StaffPassword123!" },
      }),
      env,
    });
    assert.equal(cr.status, 201, `creating ${spec.role} failed`);
    const created = (await cr.json()).item;
    assert.equal(created.department, spec.department);

    const lg = await authLogin({
      request: makeReq("/api/auth/login", {
        method: "POST",
        ip: `10.0.0.${ipIdx++}`,
        body: { email: spec.email, password: "StaffPassword123!" },
      }),
      env,
    });
    assert.equal(lg.status, 200);
    const lgData = await lg.json();
    staff[spec.key] = {
      id: created.id,
      cookie: extractCookie(lg, "holarise_session"),
      loginData: lgData,
    };
  }

  // Verify auth/status capability flags
  assert.equal(staff.ops.loginData.canAccessManager, true);
  assert.equal(staff.cctv.loginData.canAccessManager, true);
  assert.equal(staff.mman.loginData.canAccessManager, true);
  assert.equal(staff.mctv.loginData.canAccessManager, false);
  assert.equal(staff.mctv.loginData.canAccessMedia, true);

  const stOps = await (await authStatus({ request: makeReq("/api/auth/status", { cookie: staff.ops.cookie }), env })).json();
  assert.equal(stOps.canAccessManager, true);
  assert.equal(stOps.user.canonicalRole, "event_ops");
  assert.equal(stOps.user.department, "Ban Sự Kiện");

  // 4. Event Ops: creates event + runs 1-Click Playbook (idempotent!) + blocked from PII CSV export & users/audit/delete
  const evRes = await eventsPost({
    request: makeReq("/api/admin/events", {
      method: "POST",
      cookie: staff.ops.cookie,
      body: {
        kind: "upcoming",
        type: "HolaGreen · Sinh thái",
        title: "HolaGreen · Dọn Rác Tuyến Đường Bộ Tân Xã",
        date: "2027-05-15",
        time: "07:00 – 09:30",
        location: "Tuyến đường bộ quanh đồi Tân Xã, Hòa Lạc",
        fee: "Miễn phí",
        zaloGroupUrl: "https://zalo.me/g/holagreen-2027",
        summary: "Buổi sáng cuối tuần cùng sinh viên Hòa Lạc dọn sạch tuyến đường bộ và phân loại rác tái chế.",
        filters: ["sach"],
      },
    }),
    env,
  });
  assert.equal(evRes.status, 201);
  const ev = (await evRes.json()).item;

  // Ops cannot delete event, export PII CSV, manage users, or read audit log
  assert.equal((await eventDelete({ request: makeReq(`/api/admin/events/${ev.id}`, { method: "DELETE", cookie: staff.ops.cookie }), params: { id: ev.id }, env })).status, 403);
  assert.equal((await regsExport({ request: makeReq("/api/admin/registrations/export", { cookie: staff.ops.cookie }), env })).status, 403);
  assert.equal((await usersGet({ request: makeReq("/api/admin/users", { cookie: staff.ops.cookie }), env })).status, 403);
  assert.equal((await auditGet({ request: makeReq("/api/admin/audit", { cookie: staff.ops.cookie }), env })).status, 403);
  assert.equal((await regsGet({ request: makeReq("/api/admin/registrations", { cookie: staff.ops.cookie }), env })).status, 200);

  // 1-Click Playbook generates 6 tasks; 2nd run is idempotent (0 new, 6 skipped)
  const pb1 = await playbookPost({
    request: makeReq("/api/admin/tasks/playbook", { method: "POST", cookie: staff.ops.cookie, body: { eventId: ev.id } }),
    env,
  });
  assert.equal(pb1.status, 201);
  const pb1Data = await pb1.json();
  assert.equal(pb1Data.createdCount, 6);
  assert.equal(pb1Data.skippedCount, 0);
  assert.equal(pb1Data.items[0].zaloUrl, "https://zalo.me/g/holagreen-2027");

  const pb2 = await playbookPost({
    request: makeReq("/api/admin/tasks/playbook", { method: "POST", cookie: staff.ops.cookie, body: { eventId: ev.id } }),
    env,
  });
  assert.equal(pb2.status, 200);
  const pb2Data = await pb2.json();
  assert.equal(pb2Data.createdCount, 0);
  assert.equal(pb2Data.skippedCount, 6);

  // 5. Editorial Maker-Checker: Content CTV cannot publish, can submit pending_review; Content Editor approves & publishes
  // Privacy check: Content CTV cannot read registrations & gets empty recentRegistrations in overview
  assert.equal((await regsGet({ request: makeReq("/api/admin/registrations", { cookie: staff.cctv.cookie }), env })).status, 403);
  const cctvOverview = await (await overviewGet({ request: makeReq("/api/admin/overview", { cookie: staff.cctv.cookie }), env })).json();
  assert.deepEqual(cctvOverview.recentRegistrations, []);

  const blockedPub = await postsPost({
    request: makeReq("/api/admin/posts", {
      method: "POST",
      cookie: staff.cctv.cookie,
      body: {
        title: "Nhật ký buổi sáng xanh trên đường mòn Tân Xã",
        category: "HolaGreen · Sạch",
        date: "2027-05-16",
        excerpt: "Ghi chép ngắn từ buổi sáng thu gom rác tái chế cùng 25 bạn trẻ Hòa Lạc.",
        content: ["Buổi sớm nắng nhẹ dọc con đường đất đỏ Tân Xã."],
        status: "published",
      },
    }),
    env,
  });
  assert.equal(blockedPub.status, 403);

  const pendingPostRes = await postsPost({
    request: makeReq("/api/admin/posts", {
      method: "POST",
      cookie: staff.cctv.cookie,
      body: {
        title: "Nhật ký buổi sáng xanh trên đường mòn Tân Xã",
        category: "HolaGreen · Sạch",
        date: "2027-05-16",
        excerpt: "Ghi chép ngắn từ buổi sáng thu gom rác tái chế cùng 25 bạn trẻ Hòa Lạc.",
        content: ["Buổi sớm nắng nhẹ dọc con đường đất đỏ Tân Xã."],
        status: "pending_review",
      },
    }),
    env,
  });
  assert.equal(pendingPostRes.status, 201);
  const pendingPost = (await pendingPostRes.json()).item;
  assert.equal(pendingPost.status, "pending_review");
  assert.equal(pendingPost.submittedBy, "Huy Content CTV");

  // Unified Timeline surfaces pending_review post and event task summary
  const tlRes = await timelineGet({ request: makeReq("/api/admin/timeline", { cookie: staff.editor.cookie }), env });
  assert.equal(tlRes.status, 200);
  const tlData = await tlRes.json();
  assert.ok(tlData.queues.pendingPosts.some((p) => p.id === pendingPost.id));
  const evTimeline = tlData.eventTimelines.find((e) => e.id === ev.id);
  assert.equal(evTimeline.taskSummary.total, 6);

  // Content Editor publishes the submitted post; cannot delete post (super_admin only)
  const pubRes = await postPut({
    request: makeReq(`/api/admin/posts/${pendingPost.id}`, {
      method: "PUT",
      cookie: staff.editor.cookie,
      body: {
        title: pendingPost.title,
        slug: pendingPost.slug,
        category: pendingPost.category,
        date: pendingPost.date,
        excerpt: pendingPost.excerpt,
        content: pendingPost.content,
        status: "published",
      },
    }),
    params: { id: pendingPost.id },
    env,
  });
  assert.equal(pubRes.status, 200);
  const pubPost = (await pubRes.json()).item;
  assert.equal(pubPost.status, "published");
  assert.equal(pubPost.reviewedBy, "Lan Editor");
  assert.ok(pubPost.reviewedAt);

  assert.equal((await postDelete({ request: makeReq(`/api/admin/posts/${pendingPost.id}`, { method: "DELETE", cookie: staff.editor.cookie }), params: { id: pendingPost.id }, env })).status, 403);
  assert.equal((await postsGet({ request: makeReq("/api/admin/posts?status=published", { cookie: staff.editor.cookie }), env })).status, 200);

  // 6. Media Maker-Checker: Media CTV cannot approve pending photo; Media Manager approves with Safeguarding flag
  const now = new Date().toISOString();
  await d1.prepare("INSERT INTO media_albums (id, slug, title, status, created_at, updated_at) VALUES ('alb-m1', 'holagreen-test', 'HolaGreen Test', 'published', ?, ?)").bind(now, now).run();
  await d1.prepare("INSERT INTO media_photos (id, album_id, url, approval_status, created_at, updated_at) VALUES ('pho-m1', 'alb-m1', '/assets/images/logo-mark.png', 'pending', ?, ?)").bind(now, now).run();

  const ctvApprove = await photoApprove({
    request: makeReq("/api/admin/photos/pho-m1/approve", {
      method: "POST",
      cookie: staff.mctv.cookie,
      body: { action: "approve" },
    }),
    params: { id: "pho-m1" },
    env,
  });
  assert.equal(ctvApprove.status, 403);

  const mgrApprove = await photoApprove({
    request: makeReq("/api/admin/photos/pho-m1/approve", {
      method: "POST",
      cookie: staff.mman.cookie,
      body: { action: "approve", safeguardingChecked: true },
    }),
    params: { id: "pho-m1" },
    env,
  });
  assert.equal(mgrApprove.status, 200);
  assert.equal((await mgrApprove.json()).item.approvalStatus, "approved");

  // 7. Staff Task Ownership & Member CTV Task Bridge (/api/member/tasks)
  const cctvTaskRes = await tasksPost({
    request: makeReq("/api/admin/tasks", {
      method: "POST",
      cookie: staff.editor.cookie,
      body: {
        title: "Soạn tiêu đề song ngữ VN/EN",
        eventId: ev.id,
        phase: "before",
        department: "Ban Nội Dung",
        assigneeType: "staff",
        assigneeId: staff.cctv.id,
        dueAt: "2027-05-12",
      },
    }),
    env,
  });
  assert.equal(cctvTaskRes.status, 201);
  const cctvTask = (await cctvTaskRes.json()).item;

  // Content CTV updates own assigned task -> 200; cannot update someone else's task -> 403; cannot delete -> 403
  const ownUpdate = await taskPatch({
    request: makeReq(`/api/admin/tasks/${cctvTask.id}`, {
      method: "PATCH",
      cookie: staff.cctv.cookie,
      body: { status: "review" },
    }),
    params: { id: cctvTask.id },
    env,
  });
  assert.equal(ownUpdate.status, 200);
  assert.equal((await ownUpdate.json()).item.status, "review");

  const otherTaskId = pb1Data.items[0].id;
  assert.equal(
    (await taskPatch({
      request: makeReq(`/api/admin/tasks/${otherTaskId}`, { method: "PATCH", cookie: staff.cctv.cookie, body: { status: "done" } }),
      params: { id: otherTaskId },
      env,
    })).status,
    403
  );
  assert.equal(
    (await taskDelete({ request: makeReq(`/api/admin/tasks/${cctvTask.id}`, { method: "DELETE", cookie: staff.cctv.cookie }), params: { id: cctvTask.id }, env })).status,
    403
  );

  // Register a Member CTV, assign an ops_task to them, verify /api/member/tasks GET & PATCH
  const memReg = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      ip: "10.0.0.88",
      body: { name: "Nam CTV", email: "nam.ctv@holarise.org", phone: "0912345678", password: "MemberPassword123!" },
    }),
    env,
  });
  assert.equal(memReg.status, 201);
  const memData = await memReg.json();
  const memCookie = extractCookie(memReg, "holarise_member_session");

  const ctvTaskCreate = await tasksPost({
    request: makeReq("/api/admin/tasks", {
      method: "POST",
      cookie: staff.ops.cookie,
      body: {
        title: "Đón người đi một mình tại cổng chính",
        eventId: ev.id,
        phase: "during",
        department: "Ban Sự Kiện",
        assigneeType: "member",
        assigneeId: memData.member.id,
        dueAt: "2027-05-15",
      },
    }),
    env,
  });
  assert.equal(ctvTaskCreate.status, 201);
  const memberTask = (await ctvTaskCreate.json()).item;
  assert.equal(memberTask.assigneeName, "Nam CTV");

  const memTasksList = await (await memberTasksGet({ request: makeReq("/api/member/tasks", { cookie: memCookie }), env })).json();
  assert.equal(memTasksList.items.length, 1);
  assert.equal(memTasksList.items[0].id, memberTask.id);

  const memTaskDone = await memberTasksPatch({
    request: makeReq("/api/member/tasks", {
      method: "PATCH",
      cookie: memCookie,
      body: { taskId: memberTask.id, status: "done" },
    }),
    env,
  });
  assert.equal(memTaskDone.status, 200);
  assert.equal((await memTaskDone.json()).item.status, "done");

  // 8. Super Admin updates staff department/role, exports PII CSV, and inspects full Audit Trail
  const patchStaff = await userPatch({
    request: makeReq(`/api/admin/users/${staff.mctv.id}`, {
      method: "PATCH",
      cookie: superCookie,
      body: { role: "media_manager", department: "Ban Hình Ảnh" },
    }),
    params: { id: staff.mctv.id },
    env,
  });
  assert.equal(patchStaff.status, 200);
  assert.equal((await patchStaff.json()).item.canonicalRole, "media_manager");

  const csvRes = await regsExport({ request: makeReq("/api/admin/registrations/export", { cookie: superCookie }), env });
  assert.equal(csvRes.status, 200);

  const auditRes = await auditGet({ request: makeReq("/api/admin/audit?limit=100", { cookie: superCookie }), env });
  assert.equal(auditRes.status, 200);
  const auditItems = (await auditRes.json()).items;
  const actions = new Set(auditItems.map((a) => a.action));
  assert.ok(actions.has("user.create"));
  assert.ok(actions.has("user.update"));
  assert.ok(actions.has("task.playbook_generated"));
  assert.ok(actions.has("post.publish"));
  assert.ok(actions.has("media.approved"));
  assert.ok(actions.has("registrations.export_pii"));
  assert.ok(actions.has("member.task_update"));

  // Check tasks filter list works cleanly
  const filteredTasks = await (await tasksGet({ request: makeReq(`/api/admin/tasks?eventId=${ev.id}&department=Ban+N%E1%BB%99i+Dung`, { cookie: staff.editor.cookie }), env })).json();
  assert.ok(filteredTasks.items.length >= 3);
});
