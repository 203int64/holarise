/**
 * HolaRise Manager Module — Role-Scoped Shell, Unified Timeline,
 * Ops Tasks + 1-Click Event Playbook, Team & Roles Matrix, and Audit Trail.
 * Vanilla ES6+, zero external dependencies.
 */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const TAB_PERMISSIONS = {
    overview: "overview.read",
    timeline: "timeline.read",
    tasks: "tasks.read",
    team: "team.read",
    registrations: "registrations.read",
    events: "events.read",
    posts: "posts.read",
    inbox: "inbox.read",
    community: "reflections.read",
    settings: "settings.manage",
  };

  const PHASE_LABEL = {
    before: "Trước buổi gặp",
    during: "Trong buổi gặp",
    after: "Sau buổi gặp",
    general: "Việc chung",
  };

  const STATUS_LABEL = {
    todo: "Cần làm",
    in_progress: "Đang làm",
    review: "Chờ duyệt",
    done: "Hoàn thành",
  };

  const NEXT_STATUS = {
    todo: "in_progress",
    in_progress: "review",
    review: "done",
    done: "todo",
  };

  const PRIORITY_LABEL = {
    low: "Thấp",
    normal: "Bình thường",
    high: "Quan trọng",
    urgent: "Gấp",
  };

  const state = {
    user: null,
    isSoleAdmin: false,
    permissions: [],
    rolesCatalog: [],
    departments: ["Ban Điều Hành", "Ban Sự Kiện", "Ban Nội Dung", "Ban Hình Ảnh", "Ban Đối Ngoại"],
    timeline: null,
    tasks: [],
    taskCounts: { all: 0, todo: 0, in_progress: 0, review: 0, done: 0, overdue: 0, mine: 0 },
    taskFilter: { department: "", eventId: "", status: "", mine: false },
    assignees: { staff: [], members: [] },
    events: [],
    users: [],
    auditLogs: [],
    auditFilter: "",
    bound: false,
  };

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  function hasPerm(perm) {
    if (state.isSoleAdmin || state.permissions.includes("*")) return true;
    if (!perm) return false;
    if (Array.isArray(perm)) return perm.some((p) => state.permissions.includes(p));
    return state.permissions.includes(perm);
  }

  function formatDate(iso) {
    if (!iso) return "Chưa đặt hạn";
    const s = String(iso).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split("-");
      return `${d}/${m}/${y}`;
    }
    return s;
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return String(iso);
    return dt.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function api(url, { method = "GET", body } = {}) {
    const opts = { method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({ ok: false, error: { message: "Phản hồi không hợp lệ." } }));
    if (!res.ok || data.ok === false) {
      const err = new Error(data?.error?.message || `Lỗi máy chủ (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(msg, type = "info") {
    const stack = $("#toast-stack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 260);
    }, 3400);
  }

  function canAccessTab(tab) {
    const req = TAB_PERMISSIONS[tab];
    if (!req) return state.isSoleAdmin;
    return hasPerm(req);
  }

  function getFirstAllowedTab(requestedTab) {
    if (requestedTab && canAccessTab(requestedTab)) return requestedTab;
    const order = ["overview", "timeline", "tasks", "events", "posts", "registrations", "inbox", "community", "team", "settings"];
    for (const t of order) {
      if (canAccessTab(t)) return t;
    }
    return "overview";
  }

  function applyRoleShell(user, permissions, isSoleAdmin, statusPayload = {}) {
    state.user = user || null;
    state.isSoleAdmin = Boolean(isSoleAdmin);
    state.permissions = Array.isArray(permissions) ? permissions : [];
    if (Array.isArray(statusPayload.rolesCatalog)) state.rolesCatalog = statusPayload.rolesCatalog;
    if (Array.isArray(statusPayload.departments)) state.departments = statusPayload.departments;

    // 1. Hide unauthorized nav items (sidebar + mobile bottom nav + quick topbar icons)
    $$("[data-tab]").forEach((btn) => {
      const tab = btn.getAttribute("data-tab");
      btn.hidden = !canAccessTab(tab);
    });

    // 2. Role-scoped action buttons inside shared panels
    const setHidden = (sel, shouldHide) => {
      const el = $(sel);
      if (el) el.hidden = Boolean(shouldHide);
    };
    setHidden("#btn-export-csv", !state.isSoleAdmin);
    setHidden("#btn-new-event", !hasPerm("events.write"));
    setHidden("#btn-new-post", !hasPerm("posts.draft"));
    setHidden("#btn-new-task", !hasPerm("tasks.write"));
    setHidden("#btn-new-staff-team", !state.isSoleAdmin);
    setHidden("#btn-new-media-user", !state.isSoleAdmin);
    setHidden("#box-audit-log", !state.isSoleAdmin);
    setHidden("#box-team-accounts", !state.isSoleAdmin);

    // 3. Maker-Checker on Post Status select: CTV Content cannot choose 'published'
    const postStatusSel = $("#post-status");
    if (postStatusSel) {
      const pubOpt = postStatusSel.querySelector('option[value="published"]');
      const canPublish = hasPerm("posts.publish");
      if (pubOpt) {
        pubOpt.disabled = !canPublish;
        pubOpt.hidden = !canPublish;
      }
      if (!canPublish && postStatusSel.value === "published") {
        postStatusSel.value = "pending_review";
      }
    }

    // 4. Update sidebar role pill cleanly
    const nameEl = $("#sidebar-user-name");
    const metaEl = $("#sidebar-user-meta");
    if (nameEl && user) nameEl.textContent = user.name || "Thành viên Ban";
    if (metaEl && user) {
      const roleLabel = user.roleShortLabel || user.roleLabel || user.role || "";
      const dept = user.department || "";
      metaEl.textContent = [roleLabel, dept].filter(Boolean).join(" · ") || user.email || "";
    }

    bindOnce();
  }

  /* =========================================================================
     PANEL: UNIFIED TIMELINE
     ========================================================================= */
  async function loadTimeline() {
    const box = $("#timeline-container");
    if (!box) return;
    box.innerHTML = '<div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>';
    try {
      const data = await api("/api/admin/timeline");
      state.timeline = data;
      renderTimeline(data);
    } catch (err) {
      box.innerHTML = `<div class="form-alert">${esc(err.message)}</div>`;
    }
  }

  function renderTimeline(data) {
    const box = $("#timeline-container");
    if (!box) return;
    const q = data.queues || {};
    const pendingPosts = q.pendingPosts || [];
    const events = data.eventTimelines || [];
    const milestones = data.milestones || [];
    const canPlaybook = hasPerm("tasks.write");

    const queuesHtml = `
      <div class="mgr-queue-strip">
        ${
          hasPerm("posts.read")
            ? `<button type="button" class="mgr-queue-card ${pendingPosts.length ? "is-alert" : ""}" data-go-tab="posts">
                <span>Bài chờ duyệt</span>
                <strong>${pendingPosts.length}</strong>
              </button>`
            : ""
        }
        ${
          hasPerm("media.read")
            ? `<a class="mgr-queue-card ${q.pendingPhotosCount ? "is-alert" : ""}" href="/media/">
                <span>Ảnh chờ duyệt Safeguarding</span>
                <strong>${Number(q.pendingPhotosCount || 0)}</strong>
              </a>`
            : ""
        }
        ${
          hasPerm("reflections.read")
            ? `<button type="button" class="mgr-queue-card ${q.pendingReflectionsCount ? "is-alert" : ""}" data-go-tab="community">
                <span>Cảm nhận chờ duyệt</span>
                <strong>${Number(q.pendingReflectionsCount || 0)}</strong>
              </button>`
            : ""
        }
        ${
          hasPerm("inbox.read")
            ? `<button type="button" class="mgr-queue-card ${q.unreadChatThreadsCount ? "is-alert" : ""}" data-go-tab="inbox">
                <span>Hộp thoại chưa đọc</span>
                <strong>${Number(q.unreadChatThreadsCount || 0)}</strong>
              </button>`
            : ""
        }
      </div>
    `;

    const pendingPostsHtml = pendingPosts.length
      ? `<section class="panel-box" style="margin-bottom:16px;">
          <div class="panel-box-head panel-box-head--row">
            <div>
              <h2>Hàng chờ duyệt bài Hành trình (${pendingPosts.length})</h2>
              <p>Bài do CTV Nội dung gửi lên — Trưởng ban Nội dung hoặc Chủ nhiệm kiểm tra bút pháp rồi duyệt xuất bản.</p>
            </div>
            <button type="button" class="btn btn--outline btn--sm" data-go-tab="posts">Mở tab Bài viết →</button>
          </div>
          <div class="mgr-pending-list">
            ${pendingPosts
              .map(
                (p) => `<div class="mgr-pending-row">
                  <div>
                    <strong>${esc(p.title)}</strong>
                    <span class="cell-sub">${esc(p.category)} · Gửi bởi ${esc(p.submittedBy || p.author || "Ban Nội Dung")} · ${esc(formatDateTime(p.updatedAt))}</span>
                  </div>
                  <button type="button" class="btn btn--primary btn--sm" data-edit-post="${esc(p.id)}">Xem &amp; Duyệt</button>
                </div>`
              )
              .join("")}
          </div>
        </section>`
      : "";

    const eventsHtml = events.length
      ? events
          .map((ev) => {
            const ts = ev.taskSummary || { total: 0, done: 0, overdue: 0, percent: 0, phases: {} };
            const p = ts.phases || {};
            return `<article class="mgr-event-card">
              <div class="mgr-event-head">
                <div>
                  <span class="badge badge--${ev.isUpcoming ? "new" : "published"}">${ev.isUpcoming ? "Sắp diễn ra" : "Đã diễn ra"}</span>
                  <span class="cell-sub" style="display:inline;margin-left:6px;">${esc(ev.dateDisplay || formatDate(ev.date))}${ev.time ? ` · ${esc(ev.time)}` : ""}</span>
                  <h3>${esc(ev.title)}</h3>
                  <p class="cell-sub">${esc(ev.location || "Hòa Lạc")}</p>
                </div>
                <div class="mgr-event-actions">
                  ${
                    ev.zaloGroupUrl
                      ? `<a class="btn btn--ghost btn--sm" href="${esc(ev.zaloGroupUrl)}" target="_blank" rel="noopener">Nhóm Zalo ↗</a>`
                      : ""
                  }
                  <button type="button" class="btn btn--outline btn--sm" data-mgr-filter-event="${esc(ev.id)}">Xem việc (${ts.total})</button>
                  ${
                    canPlaybook
                      ? `<button type="button" class="btn btn--primary btn--sm" data-mgr-playbook="${esc(ev.id)}">⚡ Tạo 6 việc mẫu</button>`
                      : ""
                  }
                </div>
              </div>
              <div class="mgr-progress-wrap">
                <div class="mgr-progress-bar"><span style="width:${ts.percent}%"></span></div>
                <span class="mgr-progress-label">${ts.done}/${ts.total} việc xong (${ts.percent}%)${ts.overdue ? ` · <strong style="color:#b42318;">${ts.overdue} quá hạn</strong>` : ""}</span>
              </div>
              <div class="mgr-phase-pills">
                <span>Trước buổi: <strong>${p.before?.done || 0}/${p.before?.total || 0}</strong></span>
                <span>Trong buổi: <strong>${p.during?.done || 0}/${p.during?.total || 0}</strong></span>
                <span>Sau buổi: <strong>${p.after?.done || 0}/${p.after?.total || 0}</strong></span>
              </div>
            </article>`;
          })
          .join("")
      : '<p class="field-hint">Chưa có sự kiện nào trong lịch.</p>';

    const milestonesHtml = milestones.length
      ? `<div class="mgr-milestone-list">
          ${milestones
            .map(
              (m) => `<div class="mgr-milestone-item ${m.overdue ? "is-overdue" : ""} ${m.kind === "event" ? "is-event" : ""}">
                <div class="mgr-milestone-date">${esc(formatDate(m.date))}</div>
                <div class="mgr-milestone-body">
                  <div class="mgr-milestone-top">
                    <span class="badge badge--${m.kind === "event" ? "new" : m.overdue ? "cancelled" : "contacted"}">${m.kind === "event" ? "Sự kiện" : m.overdue ? "Quá hạn" : esc(STATUS_LABEL[m.status] || "Nhiệm vụ")}</span>
                    <span class="cell-sub" style="display:inline;">${esc(m.department || "")}</span>
                  </div>
                  <strong>${esc(m.title)}</strong>
                  <span class="cell-sub">${esc(m.subtitle || "")}</span>
                </div>
              </div>`
            )
            .join("")}
        </div>`
      : '<p class="field-hint">Không có mốc thời gian hay hạn chót nào đang mở.</p>';

    box.innerHTML = `
      ${queuesHtml}
      ${pendingPostsHtml}
      <div class="mgr-timeline-grid">
        <section class="panel-box">
          <div class="panel-box-head">
            <div>
              <h2>Tiến độ Chuẩn bị theo Sự kiện</h2>
              <p>Bấm "Tạo 6 việc mẫu" trên sự kiện mới để sinh tự động checklist 3 chặng cho đủ 3 Ban.</p>
            </div>
          </div>
          <div class="mgr-event-list">${eventsHtml}</div>
        </section>

        <section class="panel-box">
          <div class="panel-box-head">
            <div>
              <h2>Dòng thời gian Mốc sắp tới</h2>
              <p>Tự động gom lịch sự kiện &amp; hạn chót nhiệm vụ theo thứ tự thời gian.</p>
            </div>
          </div>
          ${milestonesHtml}
        </section>
      </div>
    `;
  }

  /* =========================================================================
     PANEL: TASKS & ASSIGNMENTS
     ========================================================================= */
  async function loadTasks() {
    const box = $("#tasks-container");
    if (!box) return;
    box.innerHTML = '<div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>';
    try {
      const qs = new URLSearchParams();
      if (state.taskFilter.department) qs.set("department", state.taskFilter.department);
      if (state.taskFilter.eventId) qs.set("eventId", state.taskFilter.eventId);
      if (state.taskFilter.status) qs.set("status", state.taskFilter.status);
      if (state.taskFilter.mine) qs.set("mine", "1");

      const data = await api(`/api/admin/tasks?${qs.toString()}`);
      state.tasks = data.items || [];
      state.taskCounts = data.counts || state.taskCounts;
      state.assignees = data.assignees || state.assignees;
      state.events = data.events || state.events;
      if (Array.isArray(data.departments)) state.departments = data.departments;

      const openCount = Number(state.taskCounts.todo || 0) + Number(state.taskCounts.in_progress || 0) + Number(state.taskCounts.review || 0);
      const badge = $("#badge-open-tasks");
      if (badge) {
        badge.hidden = openCount <= 0;
        badge.textContent = String(openCount);
      }

      populateTaskFilters();
      renderTasks();
    } catch (err) {
      box.innerHTML = `<div class="form-alert">${esc(err.message)}</div>`;
    }
  }

  function populateTaskFilters() {
    const evSel = $("#task-filter-event");
    if (evSel) {
      const cur = state.taskFilter.eventId;
      evSel.innerHTML =
        '<option value="">Tất cả sự kiện</option>' +
        state.events.map((e) => `<option value="${esc(e.id)}">${esc(e.title)} (${esc(formatDate(e.date))})</option>`).join("");
      evSel.value = cur;
    }
    const deptSel = $("#task-filter-dept");
    if (deptSel) {
      const cur = state.taskFilter.department;
      deptSel.innerHTML =
        '<option value="">Tất cả các Ban</option>' +
        state.departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
      deptSel.value = cur;
    }
  }

  function renderTasks() {
    const box = $("#tasks-container");
    const statsEl = $("#tasks-stats-strip");
    if (!box) return;
    const c = state.taskCounts;
    if (statsEl) {
      statsEl.innerHTML = `
        <button type="button" class="mgr-stat-pill ${state.taskFilter.mine ? "is-active" : ""}" data-mgr-mine-toggle>Việc của tôi: <strong>${c.mine || 0}</strong></button>
        <span class="mgr-stat-pill ${c.overdue ? "is-danger" : ""}">Quá hạn: <strong>${c.overdue || 0}</strong></span>
        <span class="mgr-stat-pill">Cần làm: <strong>${c.todo || 0}</strong></span>
        <span class="mgr-stat-pill">Đang làm: <strong>${c.in_progress || 0}</strong></span>
        <span class="mgr-stat-pill">Chờ duyệt: <strong>${c.review || 0}</strong></span>
        <span class="mgr-stat-pill is-ok">Xong: <strong>${c.done || 0}</strong></span>
      `;
    }

    if (!state.tasks.length) {
      box.innerHTML = `<div class="panel-box"><p class="field-hint" style="margin:0;">Chưa có nhiệm vụ nào khớp bộ lọc. Bạn có thể bấm <strong>+ Giao nhiệm vụ</strong> hoặc sang <strong>Timeline</strong> bấm <strong>Tạo 6 việc mẫu</strong> cho sự kiện.</p></div>`;
      return;
    }

    const todayIso = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const canWrite = hasPerm("tasks.write");

    box.innerHTML = `<div class="mgr-task-list">${state.tasks
      .map((t) => {
        const overdue = t.dueAt && t.status !== "done" && t.dueAt.slice(0, 10) < todayIso;
        const isMine = t.assigneeType === "staff" && t.assigneeId === state.user?.id;
        const canCycle = canWrite || isMine;
        const nextStatus = NEXT_STATUS[t.status] || "done";
        return `<article class="mgr-task-card is-${esc(t.status)} ${overdue ? "is-overdue" : ""}">
          <div class="mgr-task-main">
            <div class="mgr-task-badges">
              <span class="badge badge--${t.status === "done" ? "published" : overdue ? "cancelled" : t.status === "review" ? "new" : "contacted"}">${esc(STATUS_LABEL[t.status] || t.status)}</span>
              <span class="mgr-chip">${esc(t.department)}</span>
              <span class="mgr-chip">${esc(PHASE_LABEL[t.phase] || t.phase)}</span>
              ${t.priority === "urgent" || t.priority === "high" ? `<span class="mgr-chip mgr-chip--${esc(t.priority)}">${esc(PRIORITY_LABEL[t.priority])}</span>` : ""}
            </div>
            <h3>${esc(t.title)}</h3>
            ${t.description ? `<p class="mgr-task-desc">${esc(t.description)}</p>` : ""}
            <div class="mgr-task-meta">
              <span>Phụ trách: <strong>${esc(t.assigneeName || "Chưa gán")}</strong>${t.assigneeType === "member" ? " (CTV)" : ""}</span>
              <span>Hạn: <strong ${overdue ? 'style="color:#b42318;"' : ""}>${esc(formatDate(t.dueAt))}</strong></span>
              ${t.eventTitle ? `<span>Sự kiện: <strong>${esc(t.eventTitle)}</strong></span>` : ""}
              ${t.zaloUrl ? `<a href="${esc(t.zaloUrl)}" target="_blank" rel="noopener">Nhóm Zalo ↗</a>` : ""}
            </div>
          </div>
          <div class="mgr-task-actions">
            ${
              canCycle
                ? `<button type="button" class="btn btn--primary btn--sm" data-mgr-task-status="${esc(t.id)}" data-next-status="${esc(nextStatus)}">→ ${esc(STATUS_LABEL[nextStatus])}</button>`
                : ""
            }
            ${
              canWrite
                ? `<button type="button" class="btn btn--outline btn--sm" data-mgr-task-edit="${esc(t.id)}">Sửa</button>
                   <button type="button" class="btn btn--danger-ghost btn--sm" data-mgr-task-delete="${esc(t.id)}">Xóa</button>`
                : ""
            }
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }

  function openTaskDialog(task = null) {
    const dlg = $("#task-dialog");
    const form = $("#task-form");
    if (!dlg || !form) return;
    form.reset();
    $("#task-alert").hidden = true;
    $("#task-dialog-title").textContent = task ? "Cập nhật nhiệm vụ" : "Giao nhiệm vụ mới";
    $("#task-id").value = task ? task.id : "";

    const evSel = $("#task-event-id");
    evSel.innerHTML =
      '<option value="">— Việc chung theo Ban —</option>' +
      state.events.map((e) => `<option value="${esc(e.id)}">${esc(e.title)} (${esc(formatDate(e.date))})</option>`).join("");

    const deptSel = $("#task-department");
    deptSel.innerHTML = state.departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");

    const assigneeSel = $("#task-assignee");
    const staffOpts = state.assignees.staff
      .map((s) => `<option value="staff:${esc(s.id)}">[Ban] ${esc(s.name)} (${esc(s.department || s.role)})</option>`)
      .join("");
    const memberOpts = state.assignees.members
      .map((m) => `<option value="member:${esc(m.id)}">[CTV] ${esc(m.name)}${m.memberCode ? ` · ${esc(m.memberCode)}` : ""}</option>`)
      .join("");
    assigneeSel.innerHTML =
      `<option value="unassigned:">— Chưa giao người cụ thể —</option>` +
      (staffOpts ? `<optgroup label="Ban chuyên môn (HolaRise Manager)">${staffOpts}</optgroup>` : "") +
      (memberOpts ? `<optgroup label="CTV / Thành viên (/tham-gia/)">${memberOpts}</optgroup>` : "");

    if (task) {
      $("#task-title").value = task.title || "";
      $("#task-description").value = task.description || "";
      evSel.value = task.eventId || "";
      $("#task-phase").value = task.phase || "before";
      deptSel.value = task.department || "Ban Sự Kiện";
      $("#task-priority").value = task.priority || "normal";
      $("#task-status").value = task.status || "todo";
      $("#task-due-at").value = task.dueAt ? task.dueAt.slice(0, 10) : "";
      $("#task-zalo-url").value = task.zaloUrl || "";
      assigneeSel.value =
        task.assigneeType && task.assigneeId ? `${task.assigneeType}:${task.assigneeId}` : "unassigned:";
    } else {
      deptSel.value = state.user?.department || "Ban Sự Kiện";
    }

    dlg.showModal();
  }

  /* =========================================================================
     PANEL: TEAM, ROLES MATRIX & AUDIT LOG
     ========================================================================= */
  async function loadTeamAndAudit() {
    renderRolesMatrix();
    if (!state.isSoleAdmin) return;

    const usersBox = $("#team-users-container");
    const auditBox = $("#audit-logs-container");
    if (usersBox) usersBox.innerHTML = '<div class="skeleton-card"><div class="sk sk-line"></div></div>';
    if (auditBox) auditBox.innerHTML = '<div class="skeleton-card"><div class="sk sk-line"></div></div>';

    const [uRes, aRes] = await Promise.allSettled([
      api("/api/admin/users"),
      api(`/api/admin/audit?limit=80${state.auditFilter ? `&action=${encodeURIComponent(state.auditFilter)}` : ""}`),
    ]);

    if (uRes.status === "fulfilled") {
      state.users = uRes.value.items || [];
      if (Array.isArray(uRes.value.rolesCatalog)) {
        state.rolesCatalog = uRes.value.rolesCatalog;
        renderRolesMatrix();
      }
      renderTeamUsers();
    }
    if (aRes.status === "fulfilled") {
      state.auditLogs = aRes.value.items || [];
      renderAuditLogs();
    }
  }

  function renderRolesMatrix() {
    const box = $("#roles-matrix-container");
    if (!box) return;
    const catalog = state.rolesCatalog.length
      ? state.rolesCatalog
      : [
          { code: "super_admin", label: "Chủ nhiệm · Quản trị chính", department: "Ban Điều Hành", summary: "Toàn quyền hệ thống, phân quyền, cài đặt, xuất CSV gốc và Audit Log." },
          { code: "event_ops", label: "Điều phối Sự kiện", department: "Ban Sự Kiện", summary: "Quản lý sự kiện, đăng ký, hộp thoại, phân công CTV & nhiệm vụ." },
          { code: "content_editor", label: "Trưởng ban Nội dung", department: "Ban Nội Dung", summary: "Biên tập, duyệt xuất bản bài Hành trình, kiểm duyệt cảm nhận." },
          { code: "content_ctv", label: "CTV Nội dung", department: "Ban Nội Dung", summary: "Soạn bản nháp bài Hành trình, gửi duyệt và cập nhật nhiệm vụ." },
          { code: "media_manager", label: "Trưởng ban Hình ảnh", department: "Ban Hình Ảnh", summary: "Quản lý album, duyệt ảnh Safeguarding, AI retouch & giao việc Ban Ảnh." },
          { code: "media_ctv", label: "CTV Hình ảnh", department: "Ban Hình Ảnh", summary: "Tải ảnh/video vào hàng chờ duyệt tại Cổng Media (/media/)." },
        ];

    box.innerHTML = `<div class="mgr-roles-grid">${catalog
      .map((r) => {
        const isCurrent = state.user?.canonicalRole === r.code;
        return `<article class="mgr-role-card ${isCurrent ? "is-current" : ""}">
          <div class="mgr-role-head">
            <span class="mgr-chip">${esc(r.department)}</span>
            ${isCurrent ? '<span class="badge badge--new">Vai của bạn</span>' : ""}
          </div>
          <h3>${esc(r.label)}</h3>
          <p>${esc(r.summary)}</p>
        </article>`;
      })
      .join("")}</div>`;
  }

  function renderTeamUsers() {
    const box = $("#team-users-container");
    if (!box) return;
    if (!state.users.length) {
      box.innerHTML = '<p class="field-hint">Chưa có tài khoản nhân sự nào.</p>';
      return;
    }
    box.innerHTML = state.users
      .map((u) => {
        const isSelf = u.id === state.user?.id;
        return `<div class="user-row">
          <div>
            <strong>${esc(u.name)}</strong>
            ${isSelf ? '<span class="badge badge--new">Bạn</span>' : ""}
            <span class="mgr-chip">${esc(u.department || "Ban Điều Hành")}</span>
            <span class="badge badge--${u.is_active ? "published" : "cancelled"}">${u.is_active ? "Hoạt động" : "Đã khóa"}</span>
            <span class="cell-sub">${esc(u.email)} · ${esc(u.roleLabel || u.role)}${u.last_login_at ? ` · Đăng nhập gần nhất: ${esc(formatDateTime(u.last_login_at))}` : ""}</span>
          </div>
          ${
            !isSelf
              ? `<div class="item-actions">
                  <button class="btn btn--outline btn--sm" type="button" data-mgr-edit-staff="${esc(u.id)}">Đổi Ban/Vai</button>
                  <button class="btn btn--outline btn--sm" type="button" data-toggle-user="${esc(u.id)}" data-active="${u.is_active ? "1" : "0"}">${u.is_active ? "Khóa" : "Mở khóa"}</button>
                  <button class="btn btn--outline btn--sm" type="button" data-reset-user-pw="${esc(u.id)}">Đổi MK</button>
                  <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-user="${esc(u.id)}">Xóa</button>
                </div>`
              : ""
          }
        </div>`;
      })
      .join("");
  }

  function renderAuditLogs() {
    const box = $("#audit-logs-container");
    if (!box) return;
    if (!state.auditLogs.length) {
      box.innerHTML = '<p class="field-hint">Chưa ghi nhận thao tác nào trong bộ lọc này.</p>';
      return;
    }
    box.innerHTML = `<div class="mgr-audit-list">${state.auditLogs
      .map(
        (a) => `<div class="mgr-audit-row">
          <div class="mgr-audit-time">${esc(formatDateTime(a.createdAt))}</div>
          <div class="mgr-audit-body">
            <strong>${esc(a.summary || a.action)}</strong>
            <span class="cell-sub">${esc(a.actorName || a.actorEmail || "Hệ thống")} (${esc(a.actorRole || "—")}) · <code>${esc(a.action)}</code></span>
          </div>
        </div>`
      )
      .join("")}</div>`;
  }

  /* =========================================================================
     EVENT BINDINGS
     ========================================================================= */
  function bindOnce() {
    if (state.bound) return;
    state.bound = true;

    $("#btn-refresh-timeline")?.addEventListener("click", () => loadTimeline());
    $("#btn-new-task")?.addEventListener("click", () => openTaskDialog(null));
    $("#btn-new-staff-team")?.addEventListener("click", () => {
      $("#btn-new-media-user")?.click();
    });

    $("#task-filter-dept")?.addEventListener("change", (e) => {
      state.taskFilter.department = e.target.value;
      loadTasks();
    });
    $("#task-filter-event")?.addEventListener("change", (e) => {
      state.taskFilter.eventId = e.target.value;
      loadTasks();
    });
    $("#task-filter-status")?.addEventListener("change", (e) => {
      state.taskFilter.status = e.target.value;
      loadTasks();
    });
    $("#audit-filter-action")?.addEventListener("change", (e) => {
      state.auditFilter = e.target.value;
      loadTeamAndAudit();
    });

    $("#task-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const alertEl = $("#task-alert");
      alertEl.hidden = true;
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      btn.disabled = true;
      const rawAssignee = $("#task-assignee").value || "unassigned:";
      const [assigneeType, assigneeId] = rawAssignee.split(":");
      const id = $("#task-id").value.trim();
      const payload = {
        title: $("#task-title").value.trim(),
        description: $("#task-description").value.trim(),
        eventId: $("#task-event-id").value,
        phase: $("#task-phase").value,
        department: $("#task-department").value,
        priority: $("#task-priority").value,
        status: $("#task-status").value,
        dueAt: $("#task-due-at").value,
        zaloUrl: $("#task-zalo-url").value.trim(),
        assigneeType: assigneeType || "unassigned",
        assigneeId: assigneeId || "",
      };
      try {
        if (id) {
          await api(`/api/admin/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
          toast("Đã cập nhật nhiệm vụ.", "success");
        } else {
          await api("/api/admin/tasks", { method: "POST", body: payload });
          toast("Đã giao nhiệm vụ mới.", "success");
        }
        $("#task-dialog").close();
        loadTasks();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });

    document.addEventListener("click", async (e) => {
      const pb = e.target.closest("[data-mgr-playbook]");
      if (pb) {
        const eventId = pb.getAttribute("data-mgr-playbook");
        pb.disabled = true;
        pb.textContent = "Đang tạo...";
        try {
          const res = await api("/api/admin/tasks/playbook", { method: "POST", body: { eventId } });
          toast(`Đã tạo ${res.createdCount} nhiệm vụ mẫu (bỏ qua ${res.skippedCount} việc đã có).`, "success");
          loadTimeline();
        } catch (err) {
          toast(err.message, "error");
        } finally {
          pb.disabled = false;
          pb.textContent = "⚡ Tạo 6 việc mẫu";
        }
        return;
      }

      const fev = e.target.closest("[data-mgr-filter-event]");
      if (fev) {
        state.taskFilter.eventId = fev.getAttribute("data-mgr-filter-event") || "";
        state.taskFilter.mine = false;
        document.querySelector('[data-tab="tasks"]')?.click();
        return;
      }

      const mineBtn = e.target.closest("[data-mgr-mine-toggle]");
      if (mineBtn) {
        state.taskFilter.mine = !state.taskFilter.mine;
        loadTasks();
        return;
      }

      const stBtn = e.target.closest("[data-mgr-task-status]");
      if (stBtn) {
        const id = stBtn.getAttribute("data-mgr-task-status");
        const status = stBtn.getAttribute("data-next-status");
        stBtn.disabled = true;
        try {
          await api(`/api/admin/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
          toast(`Đã chuyển sang "${STATUS_LABEL[status] || status}".`, "success");
          loadTasks();
        } catch (err) {
          toast(err.message, "error");
          stBtn.disabled = false;
        }
        return;
      }

      const editBtn = e.target.closest("[data-mgr-task-edit]");
      if (editBtn) {
        const id = editBtn.getAttribute("data-mgr-task-edit");
        const task = state.tasks.find((t) => t.id === id);
        if (task) openTaskDialog(task);
        return;
      }

      const delBtn = e.target.closest("[data-mgr-task-delete]");
      if (delBtn) {
        const id = delBtn.getAttribute("data-mgr-task-delete");
        if (!window.confirm("Xóa nhiệm vụ này?")) return;
        try {
          await api(`/api/admin/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
          toast("Đã xóa nhiệm vụ.", "success");
          loadTasks();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      const editStaffBtn = e.target.closest("[data-mgr-edit-staff]");
      if (editStaffBtn) {
        const id = editStaffBtn.getAttribute("data-mgr-edit-staff");
        const u = state.users.find((x) => x.id === id);
        if (!u) return;
        const nextRole = window.prompt(
          `Chọn vai mới cho ${u.name} (event_ops / content_editor / content_ctv / media_manager / media_ctv):`,
          u.canonicalRole || u.role
        );
        if (!nextRole) return;
        const nextDept = window.prompt(
          `Ban công tác (${state.departments.join(" / ")}):`,
          u.department || ""
        );
        try {
          await api(`/api/admin/users/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { role: nextRole.trim(), department: (nextDept || "").trim() },
          });
          toast("Đã cập nhật Ban & Vai trò.", "success");
          loadTeamAndAudit();
        } catch (err) {
          toast(err.message, "error");
        }
      }
    });
  }

  window.__holariseManager = {
    applyRoleShell,
    canAccessTab,
    getFirstAllowedTab,
    hasPerm,
    loadTimeline,
    loadTasks,
    loadTeamAndAudit,
  };
})();
