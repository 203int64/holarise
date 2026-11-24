/**
 * HolaRise CMS Admin Application
 * Vanilla ES6+, zero dependencies, mobile-first.
 * Follows modern-web-guidance for <dialog closedby="any"> Safari fallback,
 * :user-invalid + aria-invalid/aria-describedby sync, and accessible forms.
 */
(function () {
  "use strict";

  const state = {
    user: null,
    activeTab: "registrations",
    regFilter: { status: "", activity: "", q: "" },
    registrations: [],
    regCounts: { all: 0, new: 0, contacted: 0, attended: 0, cancelled: 0 },
    events: [],
    posts: [],
    partners: [],
    users: [],
    reflections: [],
    refStatus: "pending",
    members: [],
    memberSearch: "",
    visuals: {},
    slugTouched: false,
  };

  const TAB_TITLES = {
    registrations: "Đơn đăng ký",
    events: "Lịch hoạt động",
    posts: "Hành trình & Bài viết",
    community: "Lưu bút & Thành viên",
    settings: "Đối tác & Cài đặt",
  };

  const VISUAL_SLOTS = [
    { key: "hero", label: "Ảnh Hero Trang chủ", fallback: "/assets/images/hero-holarise-binh-minh.webp" },
    { key: "about", label: "Ảnh Trang Về HolaRise", fallback: "/assets/images/musicspace-archive/07-656713008_1333975742086926_7656936221069546148_n.jpg" },
    { key: "holaheart", label: "Ảnh Đại diện HolaHeart", fallback: "/assets/images/events/holaheart-2026-11-15/06-group-dialogue.jpg" },
    { key: "holagreen", label: "Ảnh Đại diện HolaGreen", fallback: "/assets/images/illustrations/G03.jpg" },
    { key: "holaconnect", label: "Ảnh Đại diện HolaConnect", fallback: "/assets/images/illustrations/C04.jpg" },
  ];

  const REG_STATUS_LABEL = {
    new: "Mới nhận",
    contacted: "Đã liên hệ",
    attended: "Đã tham gia",
    cancelled: "Đã hủy",
  };

  const SYNC_STATUS_LABEL = {
    synced: "Đã đồng bộ Sheet",
    pending: "Đang đồng bộ",
    failed: "Lỗi đồng bộ",
    skipped: "Chưa nối Sheet",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  function slugifyVi(input) {
    return String(input || "")
      .trim()
      .replace(/[đĐ]/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
  }

  function formatVnDateTime(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(d);
    } catch {
      return iso;
    }
  }

  function toast(message, kind = "default") {
    const stack = $("#toast-stack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = "toast" + (kind === "error" ? " toast--error" : kind === "success" ? " toast--success" : "");
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 4200);
  }

  function showAlert(el, msg, isSuccess = false) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.className = "form-alert " + (isSuccess ? "is-success" : "is-error");
    el.textContent = msg;
  }

  function formatApiError(err) {
    const base = (err && err.message) || "Đã xảy ra lỗi không xác định.";
    if (err && err.fields && typeof err.fields === "object") {
      const details = Object.values(err.fields).filter(Boolean);
      if (details.length) return `${base} ${details.join(" ")}`;
    }
    return base;
  }

  async function api(url, opts = {}) {
    const headers = { Accept: "application/json", ...(opts.headers || {}) };
    let body = opts.body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith("/api/auth/")) {
      state.user = null;
      showAuthScreen(true);
      throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    }
    if (!res.ok || data.ok === false) {
      const msg = (data && data.error && data.error.message) || `Lỗi máy chủ (HTTP ${res.status})`;
      const err = new Error(msg);
      err.fields = data?.error?.fields || null;
      throw err;
    }
    return data;
  }

  /* =========================================================================
     Modern Web Guidance: Consistent ARIA & :user-invalid Sync + Safari Dialog
     ========================================================================= */
  function initFormValidationSync() {
    const announcer = $("#aria-announcer");
    const flagged = new WeakSet();
    const supportsUserInvalid = window.CSS && CSS.supports && CSS.supports("selector(:user-invalid)");

    const linkError = (el, shown) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
      else el.removeAttribute("aria-describedby");
    };

    const syncAria = (el, announce = false) => {
      if (!el || !el.matches || !el.matches("input, select, textarea")) return;
      const isInvalid = supportsUserInvalid
        ? el.matches(":user-invalid")
        : el.classList.contains("user-invalid-fallback");
      if (isInvalid) {
        el.setAttribute("aria-invalid", "true");
        linkError(el, true);
        flagged.add(el);
        if (announce && announcer && el.dataset.error) {
          const errEl = document.getElementById(el.dataset.error);
          if (errEl) {
            announcer.textContent = "";
            setTimeout(() => {
              announcer.textContent = errEl.textContent.trim();
            }, 250);
          }
        }
      } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
        el.setAttribute("aria-invalid", "false");
        linkError(el, false);
        flagged.delete(el);
      }
    };

    $$("input, select, textarea").forEach((el) => {
      if (!el.hasAttribute("aria-invalid")) el.setAttribute("aria-invalid", "false");
    });

    document.addEventListener(
      "blur",
      (e) => {
        const el = e.target;
        if (!supportsUserInvalid && el.matches?.("input, select, textarea") && el.value) {
          el.classList.toggle("user-invalid-fallback", !el.validity.valid);
        }
        syncAria(el, true);
      },
      true
    );

    document.addEventListener("input", (e) => {
      const el = e.target;
      if (!supportsUserInvalid && el.classList?.contains("user-invalid-fallback")) {
        el.classList.toggle("user-invalid-fallback", !el.validity.valid);
      }
      if (el.hasAttribute?.("aria-invalid")) syncAria(el, false);
    });

    document.addEventListener(
      "invalid",
      (e) => {
        if (!supportsUserInvalid) e.target.classList.add("user-invalid-fallback");
        syncAria(e.target, false);
      },
      true
    );
  }

  function initDialogs() {
    $$("dialog.cms-dialog").forEach((dialog) => {
      if (!("closedBy" in HTMLDialogElement.prototype)) {
        dialog.addEventListener("click", (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const inside =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (!inside) dialog.close();
        });
      }
      $$("[data-close-dialog]", dialog).forEach((btn) => {
        btn.addEventListener("click", () => dialog.close());
      });
    });
  }

  function initPasswordToggles() {
    $$("[data-pw-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-pw-toggle");
        const input = document.getElementById(targetId);
        if (!input) return;
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        btn.setAttribute("aria-pressed", String(!showing));
        btn.setAttribute("aria-label", showing ? "Hiện mật khẩu" : "Ẩn mật khẩu");
        btn.textContent = showing ? "Hiện" : "Ẩn";
      });
    });
  }

  /* =========================================================================
     Client-Side JPEG Image Compressor (<canvas>, max 1280px, ~150KB)
     ========================================================================= */
  async function compressImageToJpeg(file, maxWidth = 1280, quality = 0.82) {
    const bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error("Không thể đọc ảnh này. Vui lòng chọn ảnh JPG/PNG/WebP."));
      };
      img.src = objUrl;
    });

    let width = bitmap.naturalWidth || bitmap.width;
    let height = bitmap.naturalHeight || bitmap.height;
    if (width > maxWidth) {
      height = Math.round((height * maxWidth) / width);
      width = maxWidth;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Không thể nén ảnh trên trình duyệt."))),
        "image/jpeg",
        quality
      );
    });
    return { blob, width, height };
  }

  function formatKb(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function initImageUploaders() {
    $$("[data-upload-target]").forEach((fileInput) => {
      const urlInput = document.getElementById(fileInput.getAttribute("data-upload-target"));
      const previewImg = document.getElementById(fileInput.getAttribute("data-preview-target"));
      const metaEl = document.getElementById(fileInput.getAttribute("data-meta-target"));

      if (urlInput && previewImg) {
        urlInput.addEventListener("input", () => {
          const v = urlInput.value.trim();
          if (v.startsWith("/") || v.startsWith("https://")) previewImg.src = v;
        });
      }

      fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (metaEl) metaEl.textContent = "Đang nén & tải ảnh lên...";
        fileInput.disabled = true;

        try {
          const { blob, width, height } = await compressImageToJpeg(file);
          const form = new FormData();
          form.append("file", blob, "upload.jpg");
          const data = await api("/api/admin/media", { method: "POST", body: form });
          if (urlInput) urlInput.value = data.url;
          if (previewImg) previewImg.src = data.url;
          if (metaEl) {
            metaEl.textContent = `Đã tải lên: ${formatKb(file.size)} → ${formatKb(data.size)} (${width}×${height} JPEG)`;
          }
          toast("Đã tải ảnh lên thành công.", "success");
        } catch (err) {
          if (metaEl) metaEl.textContent = `Lỗi tải ảnh: ${err.message}`;
          toast(err.message, "error");
        } finally {
          fileInput.disabled = false;
          fileInput.value = "";
        }
      });
    });
  }

  /* =========================================================================
     Skeleton / Empty / Error Renderers
     ========================================================================= */
  function renderSkeleton(container, count = 3) {
    container.innerHTML = `<div class="skeleton-list">${Array.from({ length: count })
      .map(
        () =>
          `<div class="sk-row"><div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-line sk-short"></div></div>`
      )
      .join("")}</div>`;
  }

  function renderErrorState(container, msg, retryAction) {
    container.innerHTML = `<div class="state-box">
      <h3>Không tải được dữ liệu</h3>
      <p>${esc(msg)}</p>
      <button class="btn btn--outline" type="button" data-retry="${esc(retryAction)}">Thử lại</button>
    </div>`;
  }

  function renderEmptyState(container, title, desc, ctaLabel = "", ctaAction = "") {
    container.innerHTML = `<div class="state-box">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--ink-muted);" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="13" y2="13"/></svg>
      <h3>${esc(title)}</h3>
      <p>${esc(desc)}</p>
      ${ctaLabel ? `<button class="btn btn--primary" type="button" data-empty-cta="${esc(ctaAction)}">${esc(ctaLabel)}</button>` : ""}
    </div>`;
  }

  /* =========================================================================
     Auth Flow & Navigation (URL Search Params synced)
     ========================================================================= */
  function showAuthScreen(initialized) {
    $$("dialog[open]").forEach((d) => d.close());
    $("#boot-loader").hidden = true;
    $("#admin-shell").hidden = true;
    $("#auth-screen").hidden = false;
    $("#login-form").hidden = !initialized;
    $("#bootstrap-form").hidden = initialized;
    $("#auth-heading").textContent = initialized
      ? "Đăng nhập Quản trị CMS"
      : "Khởi tạo Tài khoản Quản trị Đầu tiên";
    $("#auth-lead").textContent = initialized
      ? "Dành riêng cho Ban Điều Phối quản lý bài viết, lịch sự kiện và danh sách đăng ký."
      : "Thiết lập tài khoản Quản trị viên chính (Super Admin) duy nhất để bắt đầu vận hành HolaRise CMS.";
  }

  function enterAdminShell(user) {
    if (user.role === "media") {
      window.location.replace("/media/");
      return;
    }
    state.user = user;
    $("#boot-loader").hidden = true;
    $("#auth-screen").hidden = true;
    $("#admin-shell").hidden = false;

    $("#sidebar-user-name").textContent = user.name;
    $("#sidebar-user-meta").textContent =
      (user.role === "super_admin" ? "Quản trị chính · " : "Ban Điều Phối · ") + user.email;

    const isSuper = user.role === "super_admin";
    $("#box-integrations").hidden = !isSuper;
    $("#box-users").hidden = !isSuper;

    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab");
    state.regFilter.status = params.get("status") || "";
    state.regFilter.q = params.get("q") || "";
    if ($("#reg-search")) $("#reg-search").value = state.regFilter.q;
    $$("[data-reg-status]").forEach((chip) => {
      chip.classList.toggle("is-active", (chip.getAttribute("data-reg-status") || "") === state.regFilter.status);
    });

    switchTab(TAB_TITLES[initialTab] ? initialTab : "registrations", false);
  }

  function syncUrlParams() {
    const params = new URLSearchParams();
    params.set("tab", state.activeTab);
    if (state.activeTab === "registrations") {
      if (state.regFilter.status) params.set("status", state.regFilter.status);
      if (state.regFilter.q) params.set("q", state.regFilter.q);
    }
    history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function switchTab(tab, updateUrl = true) {
    state.activeTab = tab;
    $$("[data-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === tab);
    });
    $$("[data-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== tab;
    });
    $("#mobile-page-title").textContent = TAB_TITLES[tab] || "HolaRise CMS";
    if (updateUrl) syncUrlParams();

    if (tab === "registrations") loadRegistrations();
    else if (tab === "events") loadEvents();
    else if (tab === "posts") loadPosts();
    else if (tab === "community") loadCommunity();
    else if (tab === "settings") loadSettings();
  }

  /* =========================================================================
     TAB 1: REGISTRATIONS
     ========================================================================= */
  function updateRegBadges(counts) {
    state.regCounts = counts;
    $("#stat-all").textContent = String(counts.all || 0);
    $("#stat-new").textContent = String(counts.new || 0);
    $("#stat-contacted").textContent = String(counts.contacted || 0);
    $("#stat-attended").textContent = String(counts.attended || 0);
    if ($("#stat-cancelled")) $("#stat-cancelled").textContent = String(counts.cancelled || 0);

    const newCount = Number(counts.new || 0);
    [$("#badge-new-regs"), $("#badge-new-regs-mobile")].forEach((b) => {
      if (!b) return;
      b.hidden = newCount <= 0;
      b.textContent = String(newCount);
    });
  }

  async function loadRegistrations() {
    const box = $("#regs-container");
    renderSkeleton(box, 3);
    try {
      const qs = new URLSearchParams();
      if (state.regFilter.status) qs.set("status", state.regFilter.status);
      if (state.regFilter.activity) qs.set("activity", state.regFilter.activity);
      if (state.regFilter.q) qs.set("q", state.regFilter.q);
      qs.set("limit", "100");

      const data = await api(`/api/admin/registrations?${qs.toString()}`);
      state.registrations = data.items || [];
      updateRegBadges(data.counts || {});

      // Populate activity dropdown cleanly preserving current choice
      const sel = $("#reg-activity-filter");
      if (sel) {
        const cur = state.regFilter.activity;
        sel.innerHTML =
          `<option value="">Tất cả sự kiện &amp; hoạt động</option>` +
          (data.activities || [])
            .map(
              (a) =>
                `<option value="${esc(a.title)}"${a.title === cur ? " selected" : ""}>${esc(a.title)} (${a.count})</option>`
            )
            .join("");
      }

      if (state.registrations.length === 0) {
        renderEmptyState(
          box,
          "Chưa có đơn đăng ký phù hợp",
          "Khi có bạn trẻ gửi biểu mẫu tại trang Tham gia hoặc bấm Giữ chỗ sự kiện, đơn sẽ xuất hiện tại đây ngay lập tức."
        );
        return;
      }

      box.innerHTML = `<div tabindex="0" role="region" aria-labelledby="reg-table-caption" class="table-wrapper">
        <table class="cms-table">
          <caption id="reg-table-caption">Hiển thị ${state.registrations.length} / ${data.total} đơn đăng ký (mới nhất trước)</caption>
          <thead>
            <tr>
              <th>Người đăng ký</th>
              <th>Liên hệ nhanh</th>
              <th>Sự kiện / Hoạt động</th>
              <th>Trạng thái</th>
              <th>Sheet / Email</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${state.registrations
              .map((r) => {
                const digits = String(r.phone || "").replace(/\D/g, "");
                return `<tr>
                  <th>
                    ${esc(r.full_name)}
                    <span class="cell-sub">${esc(r.id)} · ${esc(formatVnDateTime(r.created_at))}</span>
                    ${r.organization ? `<span class="cell-sub">${esc(r.organization)}</span>` : ""}
                  </th>
                  <td>
                    <div>${esc(r.phone)}</div>
                    ${r.email ? `<span class="cell-sub">${esc(r.email)}</span>` : ""}
                    <div class="quick-links">
                      ${digits ? `<a class="quick-link" href="tel:${esc(digits)}">Gọi</a>` : ""}
                      ${digits ? `<a class="quick-link" href="https://zalo.me/${esc(digits)}" target="_blank" rel="noopener">Zalo ↗</a>` : ""}
                    </div>
                  </td>
                  <td>
                    <div>${esc(r.activity_title)}</div>
                    ${r.note ? `<span class="cell-sub">“${esc(r.note)}”</span>` : ""}
                  </td>
                  <td>
                    <span class="badge badge--${esc(r.status)}">${esc(REG_STATUS_LABEL[r.status] || r.status)}</span>
                    ${r.admin_note ? `<span class="cell-sub">${esc(r.admin_note)}</span>` : ""}
                  </td>
                  <td>
                    <span class="badge badge--${esc(r.sync_status)}">${esc(SYNC_STATUS_LABEL[r.sync_status] || r.sync_status)}</span>
                    ${r.sync_error ? `<span class="cell-sub">${esc(r.sync_error)}</span>` : ""}
                  </td>
                  <td>
                    <button class="btn btn--outline btn--sm" type="button" data-open-reg="${esc(r.id)}">Chi tiết</button>
                  </td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
    } catch (err) {
      renderErrorState(box, err.message, "registrations");
    }
  }

  function openRegDialog(id) {
    const reg = state.registrations.find((r) => r.id === id);
    if (!reg) return;
    $("#reg-detail-id").value = reg.id;
    $("#reg-detail-status").value = reg.status;
    $("#reg-detail-note").value = reg.admin_note || "";
    showAlert($("#reg-detail-alert"), "");

    const digits = String(reg.phone || "").replace(/\D/g, "");
    $("#reg-detail-meta").innerHTML = `
      <dt>Mã đơn</dt><dd><code>${esc(reg.id)}</code></dd>
      <dt>Thời gian gửi</dt><dd>${esc(formatVnDateTime(reg.created_at))}</dd>
      <dt>Họ và tên</dt><dd><strong>${esc(reg.full_name)}</strong></dd>
      <dt>SĐT / Zalo</dt><dd>${esc(reg.phone)} ${digits ? `· <a class="quick-link" href="https://zalo.me/${esc(digits)}" target="_blank" rel="noopener">Mở Zalo ↗</a>` : ""}</dd>
      <dt>Email</dt><dd>${reg.email ? esc(reg.email) : "—"}</dd>
      <dt>Sự kiện / Vai trò</dt><dd>${esc(reg.activity_title)}${reg.role && reg.role !== reg.activity_title ? ` (${esc(reg.role)})` : ""}</dd>
      <dt>Đơn vị / Trường</dt><dd>${reg.organization ? esc(reg.organization) : "—"}</dd>
      <dt>Lời nhắn</dt><dd>${reg.note ? esc(reg.note) : "—"}</dd>
      <dt>Đồng bộ Sheet</dt><dd><span class="badge badge--${esc(reg.sync_status)}">${esc(SYNC_STATUS_LABEL[reg.sync_status] || reg.sync_status)}</span>${reg.sync_error ? ` — ${esc(reg.sync_error)}` : ""}</dd>
    `;
    $("#reg-dialog").showModal();
  }

  /* =========================================================================
     TAB 2: EVENTS
     ========================================================================= */
  async function loadEvents() {
    const box = $("#events-container");
    renderSkeleton(box, 3);
    try {
      const data = await api("/api/admin/events?limit=100");
      state.events = data.items || [];
      if (state.events.length === 0) {
        renderEmptyState(
          box,
          "Chưa có sự kiện nào",
          "Tạo buổi Workshop hoặc Chiến dịch cuối tuần đầu tiên để mở đăng ký trên website.",
          "+ Đăng sự kiện mới",
          "new-event"
        );
        return;
      }

      box.innerHTML = `<div class="item-list">${state.events
        .map(
          (ev) => `<article class="item-row">
            <img class="item-thumb" src="${esc(ev.image)}" alt="${esc(ev.imageAlt || ev.title)}" loading="lazy">
            <div class="item-body">
              <div class="item-meta">
                <span class="badge badge--${ev.kind === "upcoming" ? "new" : "past"}">${ev.kind === "upcoming" ? "Sắp diễn ra" : "Đã tổ chức"}</span>
                <span class="badge badge--${esc(ev.status)}">${ev.status === "published" ? "Đang hiển thị" : "Nháp"}</span>
                <span>${esc(ev.dateDisplay || ev.date)}</span>
                ${ev.time ? `<span>· ${esc(ev.time)}</span>` : ""}
                ${ev.seats ? `<span>· ${esc(ev.seats)}</span>` : ""}
              </div>
              <h3>${esc(ev.title)}</h3>
              <p class="item-excerpt">${esc(ev.summary || ev.participants || ev.location)}</p>
            </div>
            <div class="item-actions">
              <button class="btn btn--outline btn--sm" type="button" data-edit-event="${esc(ev.id)}">Sửa</button>
              <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-event="${esc(ev.id)}">Xóa</button>
            </div>
          </article>`
        )
        .join("")}</div>`;
    } catch (err) {
      renderErrorState(box, err.message, "events");
    }
  }

  function openEventDialog(ev = null) {
    const form = $("#event-form");
    form.reset();
    showAlert($("#ev-alert"), "");
    $("#event-dialog-title").textContent = ev ? "Chỉnh sửa sự kiện" : "Đăng sự kiện mới";

    $("#ev-id").value = ev ? ev.id : "";
    $("#ev-kind").value = ev ? ev.kind : "upcoming";
    $("#ev-status").value = ev ? ev.status : "published";
    $("#ev-title").value = ev ? ev.title : "";
    if ($("#ev-title-en")) $("#ev-title-en").value = ev ? ev.titleEn || ev.title_en || "" : "";
    $("#ev-type").value = ev ? ev.type : "HolaHeart · Giá trị sống";
    $("#ev-date").value = ev && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? ev.date : new Date().toISOString().slice(0, 10);
    $("#ev-date-display").value = ev ? ev.dateDisplay || "" : "";
    $("#ev-time").value = ev ? ev.time || "" : "07:30 – 10:30";
    $("#ev-location").value = ev ? ev.location || "" : "Hòa Lạc, Hà Nội";
    $("#ev-fee").value = ev ? ev.fee || "" : "Miễn phí";
    $("#ev-seats").value = ev ? ev.seats || "" : "Mở đăng ký";
    $("#ev-summary").value = ev ? ev.summary || "" : "";
    if ($("#ev-summary-en")) $("#ev-summary-en").value = ev ? ev.summaryEn || ev.summary_en || "" : "";
    $("#ev-participants").value = ev ? ev.participants || "" : "";
    const imgUrl = ev ? ev.image : "/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg";
    $("#ev-image").value = imgUrl;
    $("#ev-image-preview").src = imgUrl;
    $("#ev-image-meta").textContent = "Chọn ảnh từ thư viện hoặc chụp trực tiếp.";

    const filters = new Set(ev?.filters || []);
    $$('input[name="filters"]', form).forEach((cb) => {
      cb.checked = filters.has(cb.value);
    });

    $("#event-dialog").showModal();
  }

  /* =========================================================================
     TAB 3: POSTS
     ========================================================================= */
  async function loadPosts() {
    const box = $("#posts-container");
    renderSkeleton(box, 3);
    try {
      const data = await api("/api/admin/posts?limit=100");
      state.posts = data.items || [];
      if (state.posts.length === 0) {
        renderEmptyState(
          box,
          "Chưa có bài viết nào",
          "Viết bài tường thuật đầu tiên — trang SEO /hanh-trinh/<slug>/ sẽ xuất hiện ngay lập tức.",
          "+ Viết bài mới",
          "new-post"
        );
        return;
      }

      box.innerHTML = `<div class="item-list">${state.posts
        .map(
          (p) => `<article class="item-row">
            <img class="item-thumb" src="${esc(p.image)}" alt="${esc(p.imageAlt || p.title)}" loading="lazy">
            <div class="item-body">
              <div class="item-meta">
                <span class="badge badge--${esc(p.status)}">${p.status === "published" ? "Công khai" : "Nháp"}</span>
                <span>${esc(p.category)}</span>
                <span>· ${esc(p.dateDisplay)}</span>
                <span>· ${esc(p.author)}</span>
              </div>
              <h3>${esc(p.title)}</h3>
              <p class="item-excerpt">${esc(p.excerpt)}</p>
            </div>
            <div class="item-actions">
              ${p.status === "published" ? `<a class="btn btn--ghost btn--sm" href="/hanh-trinh/${esc(p.slug)}/" target="_blank" rel="noopener">Xem ↗</a>` : ""}
              <button class="btn btn--outline btn--sm" type="button" data-edit-post="${esc(p.id)}">Sửa</button>
              <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-post="${esc(p.id)}">Xóa</button>
            </div>
          </article>`
        )
        .join("")}</div>`;
    } catch (err) {
      renderErrorState(box, err.message, "posts");
    }
  }

  function openPostDialog(post = null) {
    const form = $("#post-form");
    form.reset();
    showAlert($("#post-alert"), "");
    state.slugTouched = Boolean(post);
    $("#post-dialog-title").textContent = post ? "Chỉnh sửa bài viết" : "Viết bài mới";

    $("#post-id").value = post ? post.id : "";
    $("#post-title").value = post ? post.title : "";
    $("#post-slug").value = post ? post.slug : "";
    $("#post-status").value = post ? post.status : "published";
    $("#post-category").value = post ? post.category : "HolaGreen · Sạch";
    $("#post-date").value = post ? post.date : new Date().toISOString().slice(0, 10);
    $("#post-author").value = post ? post.author : "Ban Điều Phối HolaRise";
    $("#post-excerpt").value = post ? post.excerpt : "";
    $("#post-content").value = post && Array.isArray(post.content) ? post.content.join("\n\n") : "";
    const imgUrl = post ? post.image : "/assets/images/activity-environment.jpg";
    $("#post-image").value = imgUrl;
    $("#post-image-preview").src = imgUrl;
    $("#post-image-meta").textContent = "Khuyến nghị ảnh ngang 16:9 hoặc 3:2. Ảnh tự nén gọn trước khi tải lên.";

    const filters = new Set(post?.filters || []);
    $$('input[name="filters"]', form).forEach((cb) => {
      cb.checked = filters.has(cb.value);
    });

    $("#post-dialog").showModal();
  }

  /* =========================================================================
     TAB 3B: COMMUNITY (REFLECTIONS MODERATION & MEMBERS)
     ========================================================================= */
  function updatePendingRefsBadge(count) {
    const n = Number(count || 0);
    [$("#badge-pending-refs"), $("#badge-pending-refs-mobile")].forEach((b) => {
      if (!b) return;
      b.hidden = n <= 0;
      b.textContent = String(n);
    });
  }

  async function loadCommunity() {
    await Promise.all([loadAdminReflections(), loadAdminMembers()]);
  }

  async function loadAdminReflections() {
    const box = $("#reflections-admin-container");
    if (!box) return;
    renderSkeleton(box, 2);
    try {
      const qs = new URLSearchParams();
      if (state.refStatus) qs.set("status", state.refStatus);
      const data = await api(`/api/admin/reflections?${qs.toString()}`);
      state.reflections = data.items || [];
      if (data.counts && typeof data.counts.pending !== "undefined") {
        updatePendingRefsBadge(data.counts.pending);
      }

      if (!state.reflections.length) {
        renderEmptyState(
          box,
          "Chưa có lưu bút nào trong mục này",
          "Khi thành viên gửi cảm nhận dưới các bài Hành trình, bài sẽ xuất hiện ở đây để Ban Điều Phối duyệt."
        );
        return;
      }

      box.innerHTML = `<div class="item-list">${state.reflections
        .map(
          (rf) => `<article class="item-row">
            ${rf.photoUrl ? `<img class="item-thumb" src="${esc(rf.photoUrl)}" alt="Ảnh lưu bút của ${esc(rf.authorName)}" loading="lazy">` : ""}
            <div class="item-body">
              <div class="item-meta">
                <span class="badge badge--${rf.status === "approved" ? "published" : rf.status === "rejected" ? "cancelled" : "pending"}">${
                  rf.status === "approved" ? "Đã duyệt" : rf.status === "rejected" ? "Đã ẩn" : "Chờ duyệt"
                }</span>
                <span>${esc(rf.authorName)} (${esc(rf.authorCode)})</span>
                <span>· ${esc(rf.participantRole)}</span>
                <span>· Bài: <code>${esc(rf.activitySlug)}</code></span>
              </div>
              ${rf.pullQuote ? `<h3>“${esc(rf.pullQuote)}”</h3>` : ""}
              <p class="item-excerpt">${esc(rf.content)}</p>
            </div>
            <div class="item-actions">
              ${rf.status !== "approved" ? `<button class="btn btn--primary btn--sm" type="button" data-mod-ref="${esc(rf.id)}" data-mod-status="approved">Duyệt</button>` : ""}
              ${rf.status !== "rejected" ? `<button class="btn btn--outline btn--sm" type="button" data-mod-ref="${esc(rf.id)}" data-mod-status="rejected">Ẩn</button>` : ""}
              <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-ref="${esc(rf.id)}">Xóa</button>
            </div>
          </article>`
        )
        .join("")}</div>`;
    } catch (err) {
      renderErrorState(box, err.message, "community");
    }
  }

  async function loadAdminMembers() {
    const box = $("#members-admin-container");
    if (!box) return;
    renderSkeleton(box, 2);
    try {
      const qs = new URLSearchParams();
      if (state.memberSearch) qs.set("q", state.memberSearch);
      const data = await api(`/api/admin/members?${qs.toString()}`);
      state.members = data.items || [];

      if (!state.members.length) {
        renderEmptyState(
          box,
          "Chưa có thành viên phù hợp",
          "Thành viên đăng ký Thẻ Thành Viên Hola tại /tham-gia/ sẽ hiển thị tại đây."
        );
        return;
      }

      box.innerHTML = `<div class="item-list">${state.members
        .map(
          (m) => `<div class="user-row">
            <div>
              <strong>${esc(m.name)}</strong>
              <span class="badge badge--${m.isActive ? "published" : "cancelled"}">${m.isActive ? "Đang hoạt động" : "Đã khóa"}</span>
              <span class="cell-sub"><code>${esc(m.memberCode)}</code> · ${esc(m.phone || m.email || "—")} · ${esc(m.organization || "Hòa Lạc")} · ${esc(m.primaryPillar)}</span>
            </div>
            <div class="item-actions">
              <button class="btn btn--outline btn--sm" type="button" data-toggle-member="${esc(m.id)}" data-active="${m.isActive ? "1" : "0"}">${m.isActive ? "Khóa" : "Mở khóa"}</button>
              <button class="btn btn--outline btn--sm" type="button" data-reset-member-pw="${esc(m.id)}">Đổi MK tạm</button>
              <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-member="${esc(m.id)}">Xóa</button>
            </div>
          </div>`
        )
        .join("")}</div>`;
    } catch (err) {
      renderErrorState(box, err.message, "community");
    }
  }

  /* =========================================================================
     TAB 4: VISUALS, PARTNERS, SETTINGS & TEAM USERS
     ========================================================================= */
  function renderVisualsEditor() {
    const grid = $("#visuals-editor-grid");
    if (!grid) return;
    grid.innerHTML = VISUAL_SLOTS.map((slot) => {
      const cur = state.visuals[slot.key] || {};
      const src = cur.url || slot.fallback;
      const alt = cur.alt || "";
      const isIllust = cur.isIllustration === true;
      return `<div class="visual-slot-card" data-visual-slot="${esc(slot.key)}">
        <div class="visual-slot-head">
          <strong>${esc(slot.label)}</strong>
          <span class="cell-sub">${cur.url ? "Đang dùng ảnh CMS" : "Đang dùng ảnh mặc định"}</span>
        </div>
        <div class="uploader-box">
          <img id="vis-prev-${esc(slot.key)}" class="uploader-preview" src="${esc(src)}" alt="Xem trước ${esc(slot.label)}">
          <div class="uploader-controls">
            <input type="file" accept="image/*" class="file-input" data-visual-upload="${esc(slot.key)}">
            <div class="upload-meta" id="vis-meta-${esc(slot.key)}">Chọn ảnh chụp thật (tự động nén JPEG).</div>
            <input type="text" id="vis-url-${esc(slot.key)}" value="${esc(cur.url || "")}" placeholder="${esc(slot.fallback)}" autocorrect="off" autocapitalize="none" spellcheck="false">
            <input type="text" id="vis-alt-${esc(slot.key)}" value="${esc(alt)}" placeholder="Mô tả ảnh (Alt text ngắn gọn)">
            <label class="check-chip" style="margin-top:4px;">
              <input type="checkbox" id="vis-real-${esc(slot.key)}" ${isIllust ? "" : "checked"}>
              <span>Ảnh chụp thật (tắt nhãn Ảnh định hướng)</span>
            </label>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  async function loadVisuals() {
    try {
      const res = await api("/api/admin/visuals");
      state.visuals = res.visuals || {};
      renderVisualsEditor();
    } catch (err) {
      toast(err.message, "error");
    }
  }
  function renderPartnersList() {
    const box = $("#partners-container");
    if (!box) return;
    if (!state.partners.length) {
      renderEmptyState(
        box,
        "Chưa công bố đối tác nào",
        "Trang web sẽ tự động ẩn dải đối tác cho tới khi bạn thêm và bật hiển thị một đơn vị đồng hành.",
        "+ Thêm đối tác đầu tiên",
        "new-partner"
      );
      return;
    }

    box.innerHTML = `<div class="item-list">${state.partners
      .map(
        (p) => `<article class="item-row">
          ${p.logoUrl ? `<img class="item-thumb" src="${esc(p.logoUrl)}" alt="${esc(p.name)}" loading="lazy">` : ""}
          <div class="item-body">
            <div class="item-meta">
              <span class="badge badge--${p.isActive ? "published" : "draft"}">${p.isActive ? "Đang hiển thị" : "Đang ẩn"}</span>
              <span>${esc(p.role || "Đơn vị Đồng hành")}</span>
            </div>
            <h3>${esc(p.name)}</h3>
            ${p.websiteUrl ? `<p class="item-excerpt">${esc(p.websiteUrl)}</p>` : ""}
          </div>
          <div class="item-actions">
            <button class="btn btn--outline btn--sm" type="button" data-toggle-partner="${esc(p.id)}">${p.isActive ? "Ẩn" : "Hiện"}</button>
            <button class="btn btn--outline btn--sm" type="button" data-edit-partner="${esc(p.id)}">Sửa</button>
            <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-partner="${esc(p.id)}">Xóa</button>
          </div>
        </article>`
      )
      .join("")}</div>`;
  }

  function openPartnerDialog(partner = null) {
    const form = $("#partner-form");
    if (!form) return;
    form.reset();
    showAlert($("#partner-alert"), "");
    $("#partner-dialog-title").textContent = partner ? "Chỉnh sửa đối tác đồng hành" : "Thêm đối tác đồng hành";
    $("#pn-id").value = partner ? partner.id : "";
    $("#pn-name").value = partner ? partner.name : "";
    $("#pn-role").value = partner ? partner.role || "Không gian Đồng hành" : "Không gian Đồng hành";
    $("#pn-website").value = partner ? partner.websiteUrl || "" : "";
    $("#pn-logo").value = partner ? partner.logoUrl || "" : "";
    $("#pn-logo-preview").src = partner && partner.logoUrl ? partner.logoUrl : "/assets/images/logo-mark.png";
    $("#pn-logo-meta").textContent = "Chọn ảnh logo PNG/JPG gọn nhẹ (tùy chọn).";
    $("#pn-active").checked = partner ? Boolean(partner.isActive) : true;
    $("#partner-dialog").showModal();
  }

  async function savePartnersList(nextList, successMsg) {
    const res = await api("/api/admin/partners", {
      method: "PUT",
      body: { items: nextList },
    });
    state.partners = res.items || [];
    renderPartnersList();
    if (successMsg) toast(successMsg, "success");
  }

  async function loadSettings() {
    loadVisuals();
    try {
      const pRes = await api("/api/admin/partners");
      state.partners = pRes.items || [];
      renderPartnersList();
    } catch (err) {
      renderErrorState($("#partners-container"), err.message, "settings");
    }

    if (state.user?.role !== "super_admin") return;
    try {
      const [sRes, uRes] = await Promise.all([api("/api/admin/settings"), api("/api/admin/users")]);
      const s = sRes.settings || {};
      $("#set-notify-email").value = s.notify_email || "";
      $("#set-webhook-url").value = s.gas_webhook_url || "";
      $("#set-webhook-secret").value = "";
      $("#set-secret-hint").textContent = s.has_webhook_secret
        ? "Đã lưu mã bí mật. Để trống nếu giữ nguyên, hoặc nhập mã mới để thay thế."
        : "Nhập mã trùng với WEBHOOK_SECRET bạn đặt trong Google Apps Script.";

      state.users = uRes.items || [];
      renderUsersList();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderUsersList() {
    const box = $("#users-container");
    if (!box) return;
    box.innerHTML = state.users
      .map(
        (u) => `<div class="user-row">
          <div>
            <strong>${esc(u.name)}</strong> ${u.id === state.user?.id ? '<span class="badge badge--new">Bạn</span>' : ""}
            <span class="cell-sub">${esc(u.email)} · ${u.role === "super_admin" ? "Quản trị chính" : u.role === "media" ? "Ban Hình Ảnh (/media)" : "Điều phối / Biên tập"} · ${u.is_active ? "Đang hoạt động" : "Đã khóa"}</span>
          </div>
          ${
            u.id !== state.user?.id
              ? `<div class="item-actions">
                  <button class="btn btn--outline btn--sm" type="button" data-toggle-user="${esc(u.id)}" data-active="${u.is_active ? "1" : "0"}">${u.is_active ? "Khóa" : "Mở khóa"}</button>
                  <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-user="${esc(u.id)}">Xóa</button>
                </div>`
              : ""
          }
        </div>`
      )
      .join("");
  }

  /* =========================================================================
     Event Binding & Submissions
     ========================================================================= */
  function bindEvents() {
    // Tab navigation (desktop + mobile)
    $$("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });

    // Logout buttons
    const handleLogout = async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } finally {
        state.user = null;
        showAuthScreen(true);
        toast("Đã đăng xuất an toàn.");
      }
    };
    $("#btn-logout")?.addEventListener("click", handleLogout);
    $("#btn-logout-mobile")?.addEventListener("click", handleLogout);

    // Bootstrap Super Admin form
    $("#bootstrap-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#boot-alert");
      showAlert(alertEl, "");

      if (!form.checkValidity()) {
        form.querySelector(":invalid")?.focus();
        showAlert(alertEl, "Vui lòng điền đầy đủ họ tên, email hợp lệ và mật khẩu tối thiểu 8 ký tự.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Đang khởi tạo...";
      try {
        const res = await api("/api/auth/bootstrap", {
          method: "POST",
          body: {
            name: $("#boot-name").value.trim(),
            email: $("#boot-email").value.trim(),
            password: $("#boot-password").value,
          },
        });
        toast("Khởi tạo tài khoản Quản trị chính thành công!", "success");
        enterAdminShell(res.user);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Tạo tài khoản Quản trị chính";
      }
    });

    // Login form
    $("#login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#login-alert");
      showAlert(alertEl, "");

      if (!form.checkValidity()) {
        form.querySelector(":invalid")?.focus();
        showAlert(alertEl, "Vui lòng nhập email và mật khẩu.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Đang đăng nhập...";
      try {
        const res = await api("/api/auth/login", {
          method: "POST",
          body: {
            email: $("#login-email").value.trim(),
            password: $("#login-password").value,
          },
        });
        form.reset();
        toast(`Chào mừng ${res.user.name}!`, "success");
        enterAdminShell(res.user);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Đăng nhập vào CMS";
      }
    });

    // Registration filters & export
    $$("[data-reg-status]").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$("[data-reg-status]").forEach((c) => c.classList.toggle("is-active", c === chip));
        state.regFilter.status = chip.getAttribute("data-reg-status") || "";
        syncUrlParams();
        loadRegistrations();
      });
    });

    $("#reg-filter-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      state.regFilter.q = $("#reg-search").value.trim();
      state.regFilter.activity = $("#reg-activity-filter").value;
      syncUrlParams();
      loadRegistrations();
    });

    $("#btn-refresh-regs")?.addEventListener("click", () => loadRegistrations());

    $("#btn-export-csv")?.addEventListener("click", () => {
      const qs = new URLSearchParams();
      if (state.regFilter.status) qs.set("status", state.regFilter.status);
      if (state.regFilter.activity) qs.set("activity", state.regFilter.activity);
      window.location.href = `/api/admin/registrations/export?${qs.toString()}`;
    });

    // Registration detail update / resync / delete
    $("#reg-detail-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#reg-detail-id").value;
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#reg-detail-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        await api(`/api/admin/registrations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: {
            status: $("#reg-detail-status").value,
            admin_note: $("#reg-detail-note").value.trim(),
          },
        });
        $("#reg-dialog").close();
        toast("Đã cập nhật trạng thái đơn đăng ký.", "success");
        loadRegistrations();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu cập nhật";
      }
    });

    $("#btn-resync-reg")?.addEventListener("click", async () => {
      const id = $("#reg-detail-id").value;
      const btn = $("#btn-resync-reg");
      btn.disabled = true;
      btn.textContent = "Đang đồng bộ...";
      try {
        const res = await api(`/api/admin/registrations/${encodeURIComponent(id)}/resync`, { method: "POST" });
        if (res.sync_status === "synced") {
          toast("Đã đồng bộ sang Google Sheets & Email thành công!", "success");
        } else if (res.sync_status === "skipped") {
          toast("Chưa cấu hình URL Google Apps Script trong tab Đội ngũ & Cài đặt.", "error");
        } else {
          toast(res.sync_error || "Đồng bộ thất bại. Kiểm tra lại cấu hình Apps Script.", "error");
        }
        $("#reg-dialog").close();
        loadRegistrations();
      } catch (err) {
        toast(formatApiError(err), "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Đồng bộ lại Sheet";
      }
    });

    $("#btn-delete-reg")?.addEventListener("click", async () => {
      const id = $("#reg-detail-id").value;
      if (!window.confirm(`Xóa vĩnh viễn đơn đăng ký ${id}?`)) return;
      try {
        await api(`/api/admin/registrations/${encodeURIComponent(id)}`, { method: "DELETE" });
        $("#reg-dialog").close();
        toast("Đã xóa đơn đăng ký.");
        loadRegistrations();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    // Event creation & update
    $("#btn-new-event")?.addEventListener("click", () => openEventDialog(null));
    $("#event-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#ev-alert");
      showAlert(alertEl, "");

      const id = $("#ev-id").value.trim();
      const filters = $$('input[name="filters"]:checked', form).map((cb) => cb.value);
      const body = {
        kind: $("#ev-kind").value,
        status: $("#ev-status").value,
        title: $("#ev-title").value.trim(),
        titleEn: $("#ev-title-en") ? $("#ev-title-en").value.trim() : "",
        type: $("#ev-type").value,
        date: $("#ev-date").value.trim(),
        dateDisplay: $("#ev-date-display").value.trim(),
        time: $("#ev-time").value.trim(),
        location: $("#ev-location").value.trim(),
        fee: $("#ev-fee").value.trim(),
        seats: $("#ev-seats").value.trim(),
        summary: $("#ev-summary").value.trim(),
        summaryEn: $("#ev-summary-en") ? $("#ev-summary-en").value.trim() : "",
        participants: $("#ev-participants").value.trim(),
        image: $("#ev-image").value.trim(),
        filters,
      };

      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        if (id) {
          await api(`/api/admin/events/${encodeURIComponent(id)}`, { method: "PUT", body });
          toast("Đã cập nhật sự kiện lên website!", "success");
        } else {
          await api("/api/admin/events", { method: "POST", body });
          toast("Đã đăng sự kiện mới — hiển thị ngay trên web!", "success");
        }
        $("#event-dialog").close();
        loadEvents();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu & Cập nhật ngay";
      }
    });

    // Post auto-slug + creation & update
    $("#post-title")?.addEventListener("input", () => {
      if (!state.slugTouched) {
        $("#post-slug").value = slugifyVi($("#post-title").value);
      }
    });
    $("#post-slug")?.addEventListener("input", () => {
      state.slugTouched = true;
    });

    $("#btn-new-post")?.addEventListener("click", () => openPostDialog(null));
    $("#post-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#post-alert");
      showAlert(alertEl, "");

      const id = $("#post-id").value.trim();
      const filters = $$('input[name="filters"]:checked', form).map((cb) => cb.value);
      const body = {
        title: $("#post-title").value.trim(),
        slug: $("#post-slug").value.trim(),
        status: $("#post-status").value,
        category: $("#post-category").value,
        date: $("#post-date").value.trim(),
        author: $("#post-author").value.trim(),
        image: $("#post-image").value.trim(),
        excerpt: $("#post-excerpt").value.trim(),
        content: $("#post-content").value,
        filters,
      };

      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        if (id) {
          await api(`/api/admin/posts/${encodeURIComponent(id)}`, { method: "PUT", body });
          toast("Đã cập nhật bài viết!", "success");
        } else {
          await api("/api/admin/posts", { method: "POST", body });
          toast("Đã xuất bản bài viết mới!", "success");
        }
        $("#post-dialog").close();
        loadPosts();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu bài viết";
      }
    });

    // Settings form & webhook test
    $("#settings-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#settings-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        await api("/api/admin/settings", {
          method: "PUT",
          body: {
            notify_email: $("#set-notify-email").value.trim(),
            gas_webhook_url: $("#set-webhook-url").value.trim(),
            gas_webhook_secret: $("#set-webhook-secret").value.trim(),
          },
        });
        $("#set-webhook-secret").value = "";
        showAlert(alertEl, "Đã lưu cài đặt tích hợp Google Sheets & Email.", true);
        loadSettings();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu cài đặt";
      }
    });

    $("#btn-test-webhook")?.addEventListener("click", async () => {
      const btn = $("#btn-test-webhook");
      const alertEl = $("#settings-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang kiểm tra...";
      try {
        const res = await api("/api/admin/settings/test-webhook", { method: "POST" });
        showAlert(alertEl, res.message, true);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Gửi thử kiểm tra kết nối";
      }
    });

    // Partner modal & submit
    $("#btn-new-partner")?.addEventListener("click", () => openPartnerDialog(null));
    $("#partner-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#partner-alert");
      showAlert(alertEl, "");

      const id = $("#pn-id").value.trim();
      const item = {
        id: id || undefined,
        name: $("#pn-name").value.trim(),
        role: $("#pn-role").value,
        websiteUrl: $("#pn-website").value.trim(),
        logoUrl: $("#pn-logo").value.trim(),
        isActive: $("#pn-active").checked,
      };
      const next = id
        ? state.partners.map((p) => (p.id === id ? { ...p, ...item } : p))
        : [...state.partners, item];

      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        await savePartnersList(next, id ? "Đã cập nhật đối tác!" : "Đã thêm đối tác đồng hành!");
        $("#partner-dialog").close();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu đối tác";
      }
    });

    // Team user modal
    $("#btn-new-user")?.addEventListener("click", () => {
      $("#user-form").reset();
      showAlert($("#user-alert"), "");
      $("#user-dialog").showModal();
    });
    $("#user-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#user-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang tạo...";
      try {
        await api("/api/admin/users", {
          method: "POST",
          body: {
            name: $("#u-name").value.trim(),
            email: $("#u-email").value.trim(),
            role: $("#u-role").value,
            password: $("#u-password").value,
          },
        });
        $("#user-dialog").close();
        toast("Đã thêm tài khoản Ban Điều Phối mới.", "success");
        loadSettings();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Tạo tài khoản";
      }
    });

    // Change own password
    $("#change-pw-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#cp-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang cập nhật...";
      try {
        const res = await api("/api/auth/change-password", {
          method: "POST",
          body: {
            currentPassword: $("#cp-current").value,
            newPassword: $("#cp-new").value,
          },
        });
        form.reset();
        showAlert(alertEl, res.message, true);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Cập nhật mật khẩu";
      }
    });

    // Community tab filters & refresh
    $("#btn-refresh-community")?.addEventListener("click", () => loadCommunity());
    $$("[data-ref-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.refStatus = btn.getAttribute("data-ref-status") || "";
        $$("[data-ref-status]").forEach((b) => {
          const active = b === btn;
          b.classList.toggle("btn--primary", active);
          b.classList.toggle("btn--outline", !active);
        });
        loadAdminReflections();
      });
    });
    $("#member-search-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      state.memberSearch = ($("#member-search-input")?.value || "").trim();
      loadAdminMembers();
    });

    // Site Visuals upload & save
    document.addEventListener("change", async (e) => {
      const input = e.target.closest("input[data-visual-upload]");
      if (!input) return;
      const slot = input.getAttribute("data-visual-upload");
      const file = input.files && input.files[0];
      if (!file) return;
      const metaEl = document.getElementById(`vis-meta-${slot}`);
      const urlEl = document.getElementById(`vis-url-${slot}`);
      const prevEl = document.getElementById(`vis-prev-${slot}`);
      if (metaEl) metaEl.textContent = "Đang nén & tải ảnh lên...";
      input.disabled = true;
      try {
        const { blob, width, height } = await compressImageToJpeg(file, 1600, 0.84);
        const fd = new FormData();
        fd.append("file", blob, `visual-${slot}.jpg`);
        const up = await api("/api/admin/media", { method: "POST", body: fd });
        if (urlEl) urlEl.value = up.url;
        if (prevEl) prevEl.src = up.url;
        if (metaEl) metaEl.textContent = `Đã tải lên (${width}×${height}). Bấm “Lưu hình ảnh giao diện” để áp dụng.`;
        toast("Đã tải ảnh lên — nhớ bấm Lưu để xuất bản!", "success");
      } catch (err) {
        if (metaEl) metaEl.textContent = `Lỗi: ${err.message}`;
        toast(err.message, "error");
      } finally {
        input.disabled = false;
        input.value = "";
      }
    });

    $("#visuals-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#btn-save-visuals");
      const alertEl = $("#visuals-alert");
      showAlert(alertEl, "");
      const payload = {};
      VISUAL_SLOTS.forEach((slot) => {
        const url = (document.getElementById(`vis-url-${slot.key}`)?.value || "").trim();
        const alt = (document.getElementById(`vis-alt-${slot.key}`)?.value || "").trim();
        const isReal = Boolean(document.getElementById(`vis-real-${slot.key}`)?.checked);
        if (url) {
          payload[slot.key] = { url, alt, isIllustration: !isReal };
        }
      });
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        const res = await api("/api/admin/visuals", { method: "PUT", body: payload });
        state.visuals = res.visuals || {};
        renderVisualsEditor();
        showAlert(alertEl, "Đã cập nhật hình ảnh giao diện trực tiếp lên website!", true);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu hình ảnh giao diện";
      }
    });

    // Delegated click handler for dynamic rows & retry/empty buttons
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-open-reg], button[data-edit-event], button[data-delete-event], button[data-edit-post], button[data-delete-post], button[data-toggle-partner], button[data-edit-partner], button[data-delete-partner], button[data-toggle-user], button[data-delete-user], button[data-mod-ref], button[data-delete-ref], button[data-toggle-member], button[data-reset-member-pw], button[data-delete-member], button[data-retry], button[data-empty-cta]");
      if (!btn) return;

      if (btn.dataset.modRef) {
        const id = btn.dataset.modRef;
        const status = btn.dataset.modStatus;
        try {
          await api(`/api/admin/reflections/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { status },
          });
          toast(status === "approved" ? "Đã duyệt và xuất bản lưu bút!" : "Đã ẩn lưu bút.", "success");
          loadAdminReflections();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.deleteRef) {
        if (window.confirm("Xóa vĩnh viễn lưu bút này?")) {
          try {
            await api(`/api/admin/reflections/${encodeURIComponent(btn.dataset.deleteRef)}`, { method: "DELETE" });
            toast("Đã xóa lưu bút.");
            loadAdminReflections();
          } catch (err) {
            toast(err.message, "error");
          }
        }
        return;
      }
      if (btn.dataset.toggleMember) {
        const nextActive = btn.dataset.active !== "1";
        try {
          await api(`/api/admin/members/${encodeURIComponent(btn.dataset.toggleMember)}`, {
            method: "PATCH",
            body: { isActive: nextActive },
          });
          toast(nextActive ? "Đã mở khóa Thẻ Thành Viên." : "Đã khóa Thẻ Thành Viên.");
          loadAdminMembers();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.resetMemberPw) {
        const newPw = window.prompt("Nhập mật khẩu tạm mới cho thành viên (tối thiểu 6 ký tự):");
        if (!newPw || newPw.trim().length < 6) return;
        try {
          await api(`/api/admin/members/${encodeURIComponent(btn.dataset.resetMemberPw)}`, {
            method: "PATCH",
            body: { resetPassword: newPw.trim() },
          });
          toast("Đã cấp lại mật khẩu tạm cho thành viên.", "success");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.deleteMember) {
        if (window.confirm("Xóa vĩnh viễn tài khoản thành viên này và các lưu bút liên quan?")) {
          try {
            await api(`/api/admin/members/${encodeURIComponent(btn.dataset.deleteMember)}`, { method: "DELETE" });
            toast("Đã xóa tài khoản thành viên.");
            loadAdminMembers();
          } catch (err) {
            toast(err.message, "error");
          }
        }
        return;
      }

      if (btn.dataset.openReg) {
        openRegDialog(btn.dataset.openReg);
      } else if (btn.dataset.editPartner) {
        const pn = state.partners.find((x) => x.id === btn.dataset.editPartner);
        if (pn) openPartnerDialog(pn);
      } else if (btn.dataset.togglePartner) {
        const next = state.partners.map((x) =>
          x.id === btn.dataset.togglePartner ? { ...x, isActive: !x.isActive } : x
        );
        try {
          await savePartnersList(next, "Đã cập nhật trạng thái hiển thị đối tác.");
        } catch (err) {
          toast(err.message, "error");
        }
      } else if (btn.dataset.deletePartner) {
        const pn = state.partners.find((x) => x.id === btn.dataset.deletePartner);
        if (pn && window.confirm(`Xóa đối tác "${pn.name}"?`)) {
          const next = state.partners.filter((x) => x.id !== pn.id);
          try {
            await savePartnersList(next, "Đã xóa đối tác.");
          } catch (err) {
            toast(err.message, "error");
          }
        }
      } else if (btn.dataset.editEvent) {
        const ev = state.events.find((x) => x.id === btn.dataset.editEvent);
        if (ev) openEventDialog(ev);
      } else if (btn.dataset.deleteEvent) {
        const ev = state.events.find((x) => x.id === btn.dataset.deleteEvent);
        if (ev && window.confirm(`Xóa sự kiện "${ev.title}"?`)) {
          try {
            await api(`/api/admin/events/${encodeURIComponent(ev.id)}`, { method: "DELETE" });
            toast("Đã xóa sự kiện.");
            loadEvents();
          } catch (err) {
            toast(err.message, "error");
          }
        }
      } else if (btn.dataset.editPost) {
        const p = state.posts.find((x) => x.id === btn.dataset.editPost);
        if (p) openPostDialog(p);
      } else if (btn.dataset.deletePost) {
        const p = state.posts.find((x) => x.id === btn.dataset.deletePost);
        if (p && window.confirm(`Xóa bài viết "${p.title}"?`)) {
          try {
            await api(`/api/admin/posts/${encodeURIComponent(p.id)}`, { method: "DELETE" });
            toast("Đã xóa bài viết.");
            loadPosts();
          } catch (err) {
            toast(err.message, "error");
          }
        }
      } else if (btn.dataset.toggleUser) {
        const nextActive = btn.dataset.active !== "1";
        try {
          await api(`/api/admin/users/${encodeURIComponent(btn.dataset.toggleUser)}`, {
            method: "PATCH",
            body: { is_active: nextActive },
          });
          toast(nextActive ? "Đã mở khóa tài khoản." : "Đã khóa tài khoản.");
          loadSettings();
        } catch (err) {
          toast(err.message, "error");
        }
      } else if (btn.dataset.deleteUser) {
        if (window.confirm("Xóa vĩnh viễn tài khoản thành viên này?")) {
          try {
            await api(`/api/admin/users/${encodeURIComponent(btn.dataset.deleteUser)}`, { method: "DELETE" });
            toast("Đã xóa tài khoản.");
            loadSettings();
          } catch (err) {
            toast(err.message, "error");
          }
        }
      } else if (btn.dataset.retry) {
        switchTab(btn.dataset.retry, false);
      } else if (btn.dataset.emptyCta === "new-event") {
        openEventDialog(null);
      } else if (btn.dataset.emptyCta === "new-post") {
        openPostDialog(null);
      } else if (btn.dataset.emptyCta === "new-partner") {
        openPartnerDialog(null);
      }
    });
  }

  async function boot() {
    initFormValidationSync();
    initDialogs();
    initPasswordToggles();
    initImageUploaders();
    bindEvents();

    try {
      const status = await api("/api/auth/status");
      if (status.authenticated && status.user) {
        enterAdminShell(status.user);
      } else {
        showAuthScreen(Boolean(status.initialized));
      }
    } catch (err) {
      $("#boot-loader").innerHTML = `<div class="auth-card">
        <h2 style="margin:0 0 8px;">Chưa kết nối được API CMS</h2>
        <p style="margin:0 0 16px;color:var(--ink-secondary);">${esc(err.message)}. Trang /admin cần chạy trên Cloudflare Pages có gắn D1.</p>
        <a class="btn btn--outline" href="/">← Về trang chủ</a>
      </div>`;
    }
  }

  boot();
})();
