import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestGet as invitePreviewGet, onRequestPost as inviteAcceptPost } from "../functions/api/auth/invite.js";
import { onRequestGet as invitesListGet, onRequestPost as invitesCreatePost } from "../functions/api/admin/invites/index.js";
import { onRequestDelete as inviteRevokeDel } from "../functions/api/admin/invites/[id].js";
import { onRequestPost as eventsPost } from "../functions/api/admin/events/index.js";
import {
  onRequestGet as resourcesGet,
  onRequestPost as resourcesPost,
  onRequestPatch as resourcesPatch,
  onRequestDelete as resourcesDelete,
} from "../functions/api/admin/events/[id]/resources.js";
import { onRequestPost as postsPost } from "../functions/api/admin/posts/index.js";
import { onRequestPut as postPut } from "../functions/api/admin/posts/[id].js";
import { onRequestPost as tasksPost } from "../functions/api/admin/tasks/index.js";
import { onRequestGet as auditGet } from "../functions/api/admin/audit.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import { onRequestPost as memberCheckinPost } from "../functions/api/member/checkin.js";
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
    "migrations/0027_manager_pro_invites_review_resources.sql",
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

function makeReq(urlPath, { method = "GET", body, cookie = "", ip = "10.0.1.1" } = {}) {
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

test("HolaRise Manager Pro: 1-Click Invites, Editorial Review Notes, QR Door Check-in, In-Kind Resource Ledger & CTV Service Record", async () => {
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

  // 2. 1-Click Invite Flow: Create -> Preview -> Consent Guard -> Activate -> Single-Use Replay Guard -> Revoke
  const invOpsRes = await invitesCreatePost({
    request: makeReq("/api/admin/invites", {
      method: "POST",
      cookie: superCookie,
      body: {
        name: "Hải Ops",
        email: "hai.ops@holarise.org",
        role: "event_ops",
        department: "Ban Sự Kiện",
        pillarScope: "holagreen",
        note: "Chào mừng Hải đồng hành Ban Sự Kiện!",
      },
    }),
    env,
  });
  assert.equal(invOpsRes.status, 201);
  const invOpsData = await invOpsRes.json();
  assert.ok(invOpsData.inviteUrl.includes("/admin/?invite="));
  const rawOpsToken = new URL(invOpsData.inviteUrl).searchParams.get("invite");

  // Public preview returns safe metadata
  const prevRes = await invitePreviewGet({
    request: makeReq(`/api/auth/invite?token=${encodeURIComponent(rawOpsToken)}`),
    env,
  });
  assert.equal(prevRes.status, 200);
  const prevData = await prevRes.json();
  assert.equal(prevData.invite.department, "Ban Sự Kiện");
  assert.equal(prevData.invite.pillarScope, "holagreen");

  // Must accept safeguarding consent before activating
  const noConsent = await inviteAcceptPost({
    request: makeReq("/api/auth/invite", {
      method: "POST",
      ip: "10.0.1.2",
      body: { token: rawOpsToken, password: "MyNewPassword123!", consentAccepted: false },
    }),
    env,
  });
  assert.equal(noConsent.status, 400);

  // Valid acceptance creates account + returns live session cookie immediately
  const accOps = await inviteAcceptPost({
    request: makeReq("/api/auth/invite", {
      method: "POST",
      ip: "10.0.1.3",
      body: { token: rawOpsToken, password: "MyNewPassword123!", consentAccepted: true },
    }),
    env,
  });
  assert.equal(accOps.status, 201);
  const opsCookie = extractCookie(accOps, "holarise_session");
  assert.ok(opsCookie.startsWith("holarise_session="));

  // Replay of used invite token is rejected (410)
  const replay = await invitePreviewGet({
    request: makeReq(`/api/auth/invite?token=${encodeURIComponent(rawOpsToken)}`),
    env,
  });
  assert.equal(replay.status, 410);

  // Create & immediately revoke a second invite
  const invRevokeCreate = await invitesCreatePost({
    request: makeReq("/api/admin/invites", {
      method: "POST",
      cookie: superCookie,
      body: { name: "Temp", email: "temp@holarise.org", role: "content_ctv", department: "Ban Nội Dung" },
    }),
    env,
  });
  const revData = await invRevokeCreate.json();
  const revToken = new URL(revData.inviteUrl).searchParams.get("invite");
  const delRes = await inviteRevokeDel({
    request: makeReq(`/api/admin/invites/${revData.item.id}`, { method: "DELETE", cookie: superCookie }),
    params: { id: revData.item.id },
    env,
  });
  assert.equal(delRes.status, 200);
  const revokedCheck = await invitePreviewGet({
    request: makeReq(`/api/auth/invite?token=${encodeURIComponent(revToken)}`),
    env,
  });
  assert.equal(revokedCheck.status, 410);

  // List invites works for super_admin
  const invList = await (await invitesListGet({ request: makeReq("/api/admin/invites", { cookie: superCookie }), env })).json();
  assert.ok(invList.items.length >= 2);

  // 3. Editorial Review Feedback Loop (content_ctv -> pending_review -> content_editor -> changes_requested + note -> published)
  const invCtv = await (
    await invitesCreatePost({
      request: makeReq("/api/admin/invites", {
        method: "POST",
        cookie: superCookie,
        body: { name: "My CTV", email: "my.ctv@holarise.org", role: "content_ctv", department: "Ban Nội Dung" },
      }),
      env,
    })
  ).json();
  const accCtv = await inviteAcceptPost({
    request: makeReq("/api/auth/invite", {
      method: "POST",
      ip: "10.0.1.4",
      body: { token: new URL(invCtv.inviteUrl).searchParams.get("invite"), password: "CtvPassword123!", consentAccepted: true },
    }),
    env,
  });
  const ctvCookie = extractCookie(accCtv, "holarise_session");

  const invEd = await (
    await invitesCreatePost({
      request: makeReq("/api/admin/invites", {
        method: "POST",
        cookie: superCookie,
        body: { name: "Trang Editor", email: "trang.ed@holarise.org", role: "content_editor", department: "Ban Nội Dung" },
      }),
      env,
    })
  ).json();
  const accEd = await inviteAcceptPost({
    request: makeReq("/api/auth/invite", {
      method: "POST",
      ip: "10.0.1.5",
      body: { token: new URL(invEd.inviteUrl).searchParams.get("invite"), password: "EdPassword123!", consentAccepted: true },
    }),
    env,
  });
  const edCookie = extractCookie(accEd, "holarise_session");

  // CTV submits pending_review post
  const pCreate = await postsPost({
    request: makeReq("/api/admin/posts", {
      method: "POST",
      cookie: ctvCookie,
      body: {
        title: "Chiều thứ Bảy trồng cây cùng HolaGreen",
        category: "HolaGreen · Sạch",
        date: "2027-06-01",
        excerpt: "Ghi chép ngắn về 30 bạn trẻ cùng nhau trồng 40 cây bản địa tại Hòa Lạc.",
        content: ["Chiều nắng nhẹ trên sườn đồi Hòa Lạc."],
        status: "pending_review",
      },
    }),
    env,
  });
  assert.equal(pCreate.status, 201);
  const postItem = (await pCreate.json()).item;
  assert.equal(postItem.status, "pending_review");

  // Content Editor returns post with reviewNote ('changes_requested')
  const returned = await postPut({
    request: makeReq(`/api/admin/posts/${postItem.id}`, {
      method: "PUT",
      cookie: edCookie,
      body: {
        title: postItem.title,
        slug: postItem.slug,
        category: postItem.category,
        date: postItem.date,
        excerpt: postItem.excerpt,
        content: postItem.content,
        status: "changes_requested",
        reviewNote: "Bổ sung số lượng cây giống thực tế và đơn vị bàn giao.",
      },
    }),
    params: { id: postItem.id },
    env,
  });
  assert.equal(returned.status, 200);
  const retPost = (await returned.json()).item;
  assert.equal(retPost.status, "changes_requested");
  assert.equal(retPost.reviewNote, "Bổ sung số lượng cây giống thực tế và đơn vị bàn giao.");

  // Content Editor then publishes -> reviewNote clears cleanly
  const published = await postPut({
    request: makeReq(`/api/admin/posts/${postItem.id}`, {
      method: "PUT",
      cookie: edCookie,
      body: {
        title: postItem.title,
        slug: postItem.slug,
        category: postItem.category,
        date: postItem.date,
        excerpt: postItem.excerpt,
        content: [...postItem.content, "Tổng 40 cây giống đã bàn giao trọn vẹn."],
        status: "published",
      },
    }),
    params: { id: postItem.id },
    env,
  });
  assert.equal(published.status, 200);
  assert.equal((await published.json()).item.reviewNote, "");

  // 4. Event In-Kind Resource Ledger + Ready-to-Paste Transparency Markdown
  const evCreate = await eventsPost({
    request: makeReq("/api/admin/events", {
      method: "POST",
      cookie: opsCookie,
      body: {
        kind: "upcoming",
        type: "HolaConnect · Tri thức",
        title: "HolaConnect · Tủ Sách Thiếu Nhi Hòa Lạc",
        date: "2027-06-15",
        time: "14:00 – 17:00",
        location: "Nhà văn hóa Tân Xã, Hòa Lạc",
        fee: "Miễn phí",
        summary: "Phân loại sách thiếu nhi và trao tận tay các bạn nhỏ vùng bán trú Hòa Lạc.",
        filters: ["se-chia"],
      },
    }),
    env,
  });
  assert.equal(evCreate.status, 201);
  const ev = (await evCreate.json()).item;

  const r1 = await resourcesPost({
    request: makeReq(`/api/admin/events/${ev.id}/resources`, {
      method: "POST",
      cookie: opsCookie,
      body: { kind: "books", title: "Sách thiếu nhi chọn lọc", quantity: "65 cuốn", donorName: "CLB Sách ĐH FPT", status: "received" },
    }),
    params: { id: ev.id },
    env,
  });
  assert.equal(r1.status, 201);
  const resItem = (await r1.json()).item;

  const rPatch = await resourcesPatch({
    request: makeReq(`/api/admin/events/${ev.id}/resources`, {
      method: "PATCH",
      cookie: opsCookie,
      body: { resourceId: resItem.id, status: "delivered" },
    }),
    params: { id: ev.id },
    env,
  });
  assert.equal(rPatch.status, 200);
  assert.equal((await rPatch.json()).item.status, "delivered");

  const rList = await (
    await resourcesGet({ request: makeReq(`/api/admin/events/${ev.id}/resources`, { cookie: opsCookie }), params: { id: ev.id }, env })
  ).json();
  assert.equal(rList.items.length, 1);
  assert.ok(rList.transparencySummary.includes("65 cuốn"));
  assert.ok(rList.transparencySummary.includes("Đã bàn giao"));

  const rDel = await resourcesDelete({
    request: makeReq(`/api/admin/events/${ev.id}/resources?resourceId=${resItem.id}`, { method: "DELETE", cookie: opsCookie }),
    params: { id: ev.id },
    env,
  });
  assert.equal(rDel.status, 200);

  // 5. QR Door Check-in (/api/member/checkin with qrCode URL) + CTV Service Record (/api/member/tasks)
  const memReg = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      ip: "10.0.1.99",
      body: { name: "Đức Thành", email: "ducthanh@holarise.org", phone: "0988777666", password: "MemberPassword123!" },
    }),
    env,
  });
  assert.equal(memReg.status, 201);
  const memData = await memReg.json();
  const memCookie = extractCookie(memReg, "holarise_member_session");
  const memberCode = memData.member.memberCode;
  assert.ok(memberCode.startsWith("HR-"));

  // Ops scans Member QR URL at the door -> auto walk-in check-in + flags isFirstTime=true!
  const qrCheckin = await memberCheckinPost({
    request: makeReq("/api/member/checkin", {
      method: "POST",
      cookie: opsCookie,
      body: { eventId: ev.id, qrCode: `https://holarise.org/tv/${memberCode}/`, allowWalkIn: true },
    }),
    env,
  });
  assert.equal(qrCheckin.status, 200);
  const qrData = await qrCheckin.json();
  assert.equal(qrData.checkedIn, true);
  assert.equal(qrData.walkInCreated, true);
  assert.equal(qrData.isFirstTime, true);
  assert.equal(qrData.memberCode, memberCode);

  // Assign a CTV task to Member, mark done, verify serviceRecord counts accurately
  const tRes = await tasksPost({
    request: makeReq("/api/admin/tasks", {
      method: "POST",
      cookie: opsCookie,
      body: {
        title: "Phân loại kệ sách theo độ tuổi",
        eventId: ev.id,
        phase: "during",
        department: "Ban Sự Kiện",
        assigneeType: "member",
        assigneeId: memData.member.id,
      },
    }),
    env,
  });
  assert.equal(tRes.status, 201);
  const ctvTask = (await tRes.json()).item;

  await memberTasksPatch({
    request: makeReq("/api/member/tasks", {
      method: "PATCH",
      cookie: memCookie,
      body: { taskId: ctvTask.id, status: "done" },
    }),
    env,
  });

  const memDesk = await (await memberTasksGet({ request: makeReq("/api/member/tasks", { cookie: memCookie }), env })).json();
  assert.equal(memDesk.serviceRecord.completedTasks, 1);
  assert.equal(memDesk.serviceRecord.eventsServed, 1);

  // 6. Verify Audit Trail captured Pro events
  const auditItems = (await (await auditGet({ request: makeReq("/api/admin/audit?limit=100", { cookie: superCookie }), env })).json()).items;
  const actions = new Set(auditItems.map((a) => a.action));
  assert.ok(actions.has("invite.create"));
  assert.ok(actions.has("invite.accepted"));
  assert.ok(actions.has("invite.revoke"));
  assert.ok(actions.has("post.changes_requested"));
  assert.ok(actions.has("resource.create"));
  assert.ok(actions.has("resource.update"));
});
