(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const FILTER_LABELS = {
    sach: "Sạch",
    "biet-on": "Biết ơn",
    "tu-te": "Tử tế",
    "se-chia": "Sẻ chia",
  };

  const ROLE_LABELS = {
    super_admin: "Quản trị chính",
    editor: "Ban Điều Phối",
    media: "Ban Hình Ảnh",
  };

  const MAX_BATCH_FILES = 30;
  const UPLOAD_CONCURRENCY = 2;

  const state = {
    user: null,
    albums: [],
    statusFilter: "",
    searchQuery: "",
    activeAlbum: null,
    photos: [],
    uploadQueue: [],
    uploading: false,
    mediaStorage: null,
  };

  async function resolveMediaStorage() {
    if (state.mediaStorage) return state.mediaStorage;
    try {
      const info = await apiFetch("/api/admin/media", { method: "GET" });
      state.mediaStorage = {
        driveConfigured: Boolean(info?.driveConfigured),
        storage: info?.storage || "media_kv",
      };
    } catch {
      state.mediaStorage = { driveConfigured: false, storage: "media_kv" };
    }
    return state.mediaStorage;
  }

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  function toast(message, type = "info") {
    const stack = $("#toast-stack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.textContent = message;
    stack.appendChild(el);
    window.setTimeout(() => {
      el.classList.add("is-leaving");
      window.setTimeout(() => el.remove(), 220);
    }, 3400);
  }

  function showAlert(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && state.user) {
        state.user = null;
        showAuthScreen();
        toast("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", "error");
      }
      const msg = data?.error?.message || `Lỗi máy chủ (HTTP ${res.status}).`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* =========================================================================
     Client-side Image Compression (<= 1280px JPEG, ~120-200 KB)
     ========================================================================= */
  function compressImageFile(file, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          URL.revokeObjectURL(objectUrl);
          let { width, height } = img;
          if (!width || !height) {
            reject(new Error("Ảnh không hợp lệ."));
            return;
          }
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Không thể nén ảnh trên trình duyệt."));
                return;
              }
              resolve(blob);
            },
            "image/jpeg",
            quality
          );
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Không đọc được tệp ảnh (hãy dùng JPEG, PNG hoặc WebP)."));
      };
      img.src = objectUrl;
    });
  }

  /* =========================================================================
     Auth & Shell Boot
     ========================================================================= */
  function showAuthScreen() {
    $("#boot-loader").hidden = true;
    $("#media-shell").hidden = true;
    $("#auth-screen").hidden = false;
  }

  async function enterMediaShell(user) {
    state.user = user;
    $("#boot-loader").hidden = true;
    $("#auth-screen").hidden = true;
    $("#media-shell").hidden = false;

    const roleLabel = ROLE_LABELS[user.role] || user.role;
    $("#topbar-user-chip").textContent = `${user.name} · ${roleLabel}`;
    $("#link-admin-cms").hidden = !(user.role === "super_admin" || user.role === "editor");

    const savedPhotographer = localStorage.getItem("holarise_media_photographer") || "Ban Hình Ảnh HolaRise";
    if ($("#default-photographer")) $("#default-photographer").value = savedPhotographer;

    await loadAlbums();
    const params = new URLSearchParams(window.location.search);
    const albumId = params.get("album");
    if (albumId) {
      await openAlbumWorkspace(albumId, false);
    } else {
      showAlbumsListView(false);
    }
  }

  async function boot() {
    try {
      const status = await apiFetch("/api/auth/status");
      if (status.authenticated && status.user) {
        await enterMediaShell(status.user);
      } else {
        showAuthScreen();
      }
    } catch (err) {
      showAuthScreen();
      showAlert($("#login-alert"), err.message || "Không thể kết nối máy chủ.");
    }
  }

  /* =========================================================================
     Albums List View
     ========================================================================= */
  function showAlbumsListView(updateUrl = true) {
    state.activeAlbum = null;
    state.photos = [];
    $("#view-workspace").hidden = true;
    $("#view-albums").hidden = false;
    if (updateUrl) {
      history.replaceState(null, "", window.location.pathname);
    }
    renderAlbumsGrid();
  }

  async function loadAlbums() {
    showAlert($("#albums-error"), "");
    $("#albums-grid").innerHTML = `
      <div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>
      <div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>
      <div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>
    `;
    try {
      const res = await apiFetch("/api/admin/albums");
      state.albums = res.items || [];
      updateStats();
      renderAlbumsGrid();
    } catch (err) {
      showAlert($("#albums-error"), err.message);
      $("#albums-grid").innerHTML = "";
    }
  }

  function updateStats() {
    const totalAlbums = state.albums.length;
    const totalPhotos = state.albums.reduce((s, a) => s + Number(a.photoCount || 0), 0);
    const totalFeatured = state.albums.reduce((s, a) => s + Number(a.featuredCount || 0), 0);
    $("#stat-albums").textContent = String(totalAlbums);
    $("#stat-photos").textContent = String(totalPhotos);
    $("#stat-featured").textContent = String(totalFeatured);
  }

  function renderAlbumsGrid() {
    const grid = $("#albums-grid");
    if (!grid) return;

    const q = state.searchQuery.trim().toLowerCase();
    const list = state.albums.filter((a) => {
      if (state.statusFilter && a.status !== state.statusFilter) return false;
      if (q) {
        const hay = `${a.title} ${a.location} ${a.dateDisplay}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (list.length === 0) {
      grid.innerHTML = `<div class="media-empty-box">
        <h3>Chưa có Album nào phù hợp</h3>
        <p>${state.albums.length === 0 ? "Tạo Album sự kiện đầu tiên để bắt đầu tải ảnh lên website HolaRise." : "Thử xóa bộ lọc hoặc từ khóa tìm kiếm."}</p>
        ${state.albums.length === 0 ? '<button class="btn btn--primary" type="button" data-trigger-new-album>+ Tạo Album đầu tiên</button>' : ""}
      </div>`;
      return;
    }

    grid.innerHTML = list
      .map((a) => {
        const statusBadge =
          a.status === "published"
            ? '<span class="badge badge--published">Công khai</span>'
            : '<span class="badge badge--draft">Bản nháp</span>';
        const driveBadge = a.driveUrl
          ? '<span class="badge badge--info">Có link Drive</span>'
          : "";
        const filterBadges = (a.filters || [])
          .map((f) => `<span class="badge">${esc(FILTER_LABELS[f] || f)}</span>`)
          .join("");
        const coverHtml = a.coverUrl
          ? `<img src="${esc(a.coverUrl)}" alt="${esc(a.title)}" loading="lazy">`
          : `<div class="album-card-cover--empty">Chưa có ảnh bìa</div>`;
        return `<article class="album-card">
          <div class="album-card-cover" data-open-album="${esc(a.id)}">
            ${coverHtml}
            <span class="album-cover-count">${a.photoCount} ảnh</span>
          </div>
          <div class="album-card-body">
            <div class="album-card-badges">${statusBadge}${driveBadge}${filterBadges}</div>
            <h3 class="album-card-title">${esc(a.title)}</h3>
            <div class="album-card-meta">${esc(a.dateDisplay || a.eventDate || "Chưa ghi ngày")} · ${esc(a.location || "Hòa Lạc")}</div>
            <div class="album-card-actions">
              <button class="btn btn--primary btn--sm" type="button" data-open-album="${esc(a.id)}">Quản lý ảnh (${a.photoCount})</button>
              <button class="btn btn--ghost btn--sm" type="button" data-edit-album="${esc(a.id)}">Sửa</button>
            </div>
          </div>
        </article>`;
      })
      .join("");
  }

  /* =========================================================================
     Album Workspace View
     ========================================================================= */
  async function openAlbumWorkspace(albumId, updateUrl = true) {
    $("#view-albums").hidden = true;
    $("#view-workspace").hidden = false;
    $("#ws-photos-grid").innerHTML = `<div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>`;
    if (updateUrl) {
      history.replaceState(null, "", `${window.location.pathname}?album=${encodeURIComponent(albumId)}`);
    }

    try {
      const res = await apiFetch(`/api/admin/albums/${encodeURIComponent(albumId)}`);
      state.activeAlbum = res.album;
      state.photos = res.photos || [];
      renderWorkspaceHeader();
      renderPhotosGrid();
    } catch (err) {
      toast(err.message, "error");
      showAlbumsListView(true);
    }
  }

  function renderWorkspaceHeader() {
    const a = state.activeAlbum;
    if (!a) return;
    $("#ws-title").textContent = a.title;
    $("#ws-meta").textContent = `${a.dateDisplay || a.eventDate || "—"} · ${a.location || "Hòa Lạc"} · ${state.photos.length} ảnh`;

    const badges = [
      a.status === "published"
        ? '<span class="badge badge--published">Công khai</span>'
        : '<span class="badge badge--draft">Bản nháp</span>',
      ...(a.filters || []).map((f) => `<span class="badge">${esc(FILTER_LABELS[f] || f)}</span>`),
    ];
    $("#ws-badges").innerHTML = badges.join("");

    const descEl = $("#ws-desc");
    if (a.description) {
      descEl.textContent = a.description;
      descEl.hidden = false;
    } else {
      descEl.hidden = true;
    }

    const driveRow = $("#ws-drive-row");
    if (a.driveUrl) {
      $("#ws-drive-link").href = a.driveUrl;
      driveRow.hidden = false;
    } else {
      driveRow.hidden = true;
    }

    $("#ws-photos-heading").textContent = `Danh sách ảnh trong Album (${state.photos.length})`;
  }

  function renderPhotosGrid() {
    const grid = $("#ws-photos-grid");
    const a = state.activeAlbum;
    if (!grid || !a) return;

    if (state.photos.length === 0) {
      grid.innerHTML = `<div class="media-empty-box">
        <h3>Album này chưa có ảnh nào</h3>
        <p>Kéo thả ảnh vào khung phía trên hoặc bấm để chọn nhiều ảnh từ máy tính / điện thoại.</p>
      </div>`;
      return;
    }

    grid.innerHTML = state.photos
      .map((p) => {
        const isCover = a.coverUrl === p.url;
        return `<article class="photo-card" data-photo-id="${esc(p.id)}">
          <div class="photo-card-thumb">
            <img src="${esc(p.url)}" alt="${esc(p.alt || p.caption || a.title)}" loading="lazy">
            <div class="photo-badges">
              ${isCover ? '<span class="photo-badge-cover">Ảnh bìa</span>' : ""}
              ${p.isFeaturedHome ? '<span class="photo-badge-home">★ Trang chủ</span>' : ""}
            </div>
          </div>
          <div class="photo-card-body">
            <p class="photo-caption ${p.caption ? "" : "photo-caption--empty"}">${esc(p.caption || "Chưa có chú thích")}</p>
            ${p.photographer ? `<div class="photo-photographer">Ảnh: ${esc(p.photographer)}</div>` : ""}
            <div class="photo-card-actions">
              <button class="btn btn--outline btn--sm" type="button" data-edit-photo="${esc(p.id)}">Sửa</button>
              <button class="btn btn--sm ${p.isFeaturedHome ? "btn--primary" : "btn--ghost"}" type="button" data-toggle-featured="${esc(p.id)}" data-featured="${p.isFeaturedHome ? "1" : "0"}">${p.isFeaturedHome ? "★ Đã ghim" : "☆ Ghim Trang chủ"}</button>
              ${!isCover ? `<button class="btn btn--ghost btn--sm" type="button" data-set-cover="${esc(p.id)}">Làm bìa</button>` : ""}
              <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-photo="${esc(p.id)}">Xóa</button>
            </div>
          </div>
        </article>`;
      })
      .join("");
  }

  /* =========================================================================
     Multi-Image Drag-and-Drop Upload Queue (Concurrency = 2 + Retry)
     ========================================================================= */
  function enqueueFiles(fileList) {
    if (!state.activeAlbum) return;
    const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
    if (files.length === 0) return;

    if (files.length > MAX_BATCH_FILES) {
      toast(`Chỉ chọn tối đa ${MAX_BATCH_FILES} ảnh mỗi lượt (đã lấy ${MAX_BATCH_FILES} ảnh đầu).`, "info");
    }
    const batch = files.slice(0, MAX_BATCH_FILES);
    const items = batch.map((file, idx) => ({
      uid: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      name: file.name || `anh-${idx + 1}.jpg`,
      status: "pending", // pending | compressing | uploading | done | error
      error: "",
    }));

    state.uploadQueue = [...state.uploadQueue.filter((i) => i.status !== "done"), ...items];
    renderUploadQueue();
    runUploadQueue();
  }

  function renderUploadQueue() {
    const box = $("#upload-queue");
    const list = $("#upload-queue-list");
    if (!box || !list) return;
    if (state.uploadQueue.length === 0) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    const total = state.uploadQueue.length;
    const done = state.uploadQueue.filter((i) => i.status === "done").length;
    const failed = state.uploadQueue.filter((i) => i.status === "error").length;

    $("#upload-queue-summary").textContent = state.uploading
      ? `Đang tải lên: ${done}/${total} hoàn tất${failed ? ` · ${failed} lỗi` : ""}`
      : `Kết quả tải lên: ${done}/${total} thành công${failed ? ` · ${failed} lỗi` : ""}`;

    $("#btn-retry-failed").hidden = state.uploading || failed === 0;
    $("#btn-clear-queue").hidden = state.uploading;

    const statusText = {
      pending: "Chờ xử lý...",
      compressing: "Đang nén ảnh...",
      uploading: "Đang tải lên...",
      done: "Hoàn tất ✓",
      error: "Lỗi",
    };

    list.innerHTML = state.uploadQueue
      .map(
        (item) => `<div class="queue-item queue-item--${esc(item.status)}">
          <span class="queue-item-name" title="${esc(item.name)}">${esc(item.name)}</span>
          <span class="queue-item-status">${esc(item.status === "error" ? item.error || "Lỗi tải lên" : statusText[item.status])}</span>
        </div>`
      )
      .join("");
  }

  async function processSingleQueueItem(item) {
    if (!state.activeAlbum) return;
    const albumId = state.activeAlbum.id;
    const photographer = ($("#default-photographer")?.value || "").trim();
    if (photographer) {
      localStorage.setItem("holarise_media_photographer", photographer);
    }

    try {
      const storageInfo = await resolveMediaStorage();
      let uploadPayload = item.file;
      let uploadFilename = item.name || "photo.jpg";

      if (!storageInfo.driveConfigured) {
        item.status = "compressing";
        item.error = "";
        renderUploadQueue();
        uploadPayload = await compressImageFile(item.file, 1280, 0.82);
        uploadFilename = item.name.replace(/\.[^.]+$/, "") + ".jpg";
      }

      item.status = "uploading";
      item.error = "";
      renderUploadQueue();

      const fd = new FormData();
      fd.append("file", uploadPayload, uploadFilename);
      fd.append("category", "album");
      fd.append("subfolder", state.activeAlbum.slug || state.activeAlbum.title || "");
      const uploaded = await apiFetch("/api/admin/media", { method: "POST", body: fd });

      const attached = await apiFetch(`/api/admin/albums/${encodeURIComponent(albumId)}/photos`, {
        method: "POST",
        json: {
          url: uploaded.url,
          mediaKey: uploaded.id,
          caption: "",
          alt: state.activeAlbum.title,
          photographer,
          isFeaturedHome: false,
        },
      });

      item.status = "done";
      if (Array.isArray(attached.items) && attached.items.length > 0) {
        state.photos = [...attached.items, ...state.photos];
        if (!state.activeAlbum.coverUrl && attached.coverUrl) {
          state.activeAlbum.coverUrl = attached.coverUrl;
        }
        renderWorkspaceHeader();
        renderPhotosGrid();
      }
      renderUploadQueue();
    } catch (err) {
      item.status = "error";
      item.error = err.message || "Tải lên thất bại";
      renderUploadQueue();
    }
  }

  async function runUploadQueue() {
    if (state.uploading) return;
    state.uploading = true;
    renderUploadQueue();

    const worker = async () => {
      while (true) {
        const next = state.uploadQueue.find((i) => i.status === "pending");
        if (!next) break;
        await processSingleQueueItem(next);
      }
    };

    const workers = Array.from({ length: UPLOAD_CONCURRENCY }, () => worker());
    await Promise.all(workers);

    state.uploading = false;
    renderUploadQueue();
    await loadAlbums();
    const failed = state.uploadQueue.filter((i) => i.status === "error").length;
    if (failed === 0) {
      toast("Đã tải ảnh lên Album thành công!", "success");
    } else {
      toast(`Có ${failed} ảnh bị lỗi. Bạn có thể bấm "Thử lại ảnh lỗi".`, "error");
    }
  }

  /* =========================================================================
     Dialogs: Create/Edit Album, Edit Photo, Change Password
     ========================================================================= */
  function openAlbumDialog(album = null) {
    const dlg = $("#album-dialog");
    const form = $("#album-form");
    form.reset();
    showAlert($("#album-form-alert"), "");

    $("#album-dialog-title").textContent = album ? "Cập nhật thông tin Album" : "Tạo Album sự kiện mới";
    $("#af-id").value = album?.id || "";
    $("#af-title").value = album?.title || "";
    $("#af-date").value = album?.eventDate || new Date().toISOString().slice(0, 10);
    $("#af-status").value = album?.status || "published";
    $("#af-location").value = album?.location || "Hòa Lạc, Hà Nội";
    $("#af-drive").value = album?.driveUrl || "";
    $("#af-desc").value = album?.description || "";

    const activeFilters = new Set(album?.filters || []);
    $$('input[name="filters"]', form).forEach((cb) => {
      cb.checked = activeFilters.has(cb.value);
    });

    dlg.showModal();
    $("#af-title").focus();
  }

  function openPhotoDialog(photo) {
    const dlg = $("#photo-dialog");
    showAlert($("#photo-form-alert"), "");
    $("#pf-id").value = photo.id;
    $("#pf-preview").src = photo.url;
    $("#pf-caption").value = photo.caption || "";
    $("#pf-photographer").value = photo.photographer || "";
    $("#pf-featured").checked = Boolean(photo.isFeaturedHome);
    dlg.showModal();
    $("#pf-caption").focus();
  }

  /* =========================================================================
     Event Binding
     ========================================================================= */
  function bindEvents() {
    // Login
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const alertEl = $("#login-alert");
      const btn = $("#login-submit");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang đăng nhập...";
      try {
        const res = await apiFetch("/api/auth/login", {
          method: "POST",
          json: {
            email: $("#login-email").value.trim(),
            password: $("#login-password").value,
          },
        });
        $("#login-password").value = "";
        toast(`Chào mừng ${res.user.name}!`, "success");
        await enterMediaShell(res.user);
      } catch (err) {
        showAlert(alertEl, err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Đăng nhập vào kho ảnh";
      }
    });

    // Logout
    $("#btn-logout").addEventListener("click", async () => {
      try {
        await apiFetch("/api/auth/logout", { method: "POST" });
      } catch {
        // ignore
      }
      state.user = null;
      showAuthScreen();
      toast("Đã đăng xuất.", "info");
    });

    // Brand link -> back to list
    $("#brand-home-link").addEventListener("click", (e) => {
      e.preventDefault();
      showAlbumsListView(true);
    });

    // Status filter & search
    $$("[data-album-status]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.statusFilter = chip.getAttribute("data-album-status") || "";
        $$("[data-album-status]").forEach((c) => c.classList.toggle("is-active", c === chip));
        renderAlbumsGrid();
      });
    });

    $("#album-search").addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderAlbumsGrid();
    });

    // New album & Back button
    $("#btn-new-album").addEventListener("click", () => openAlbumDialog(null));
    $("#btn-back-albums").addEventListener("click", () => {
      state.uploadQueue = [];
      renderUploadQueue();
      showAlbumsListView(true);
    });

    // Delegated clicks on Albums grid
    $("#albums-grid").addEventListener("click", (e) => {
      if (e.target.closest("[data-trigger-new-album]")) {
        openAlbumDialog(null);
        return;
      }
      const editBtn = e.target.closest("[data-edit-album]");
      if (editBtn) {
        const album = state.albums.find((a) => a.id === editBtn.getAttribute("data-edit-album"));
        if (album) openAlbumDialog(album);
        return;
      }
      const openBtn = e.target.closest("[data-open-album]");
      if (openBtn) {
        openAlbumWorkspace(openBtn.getAttribute("data-open-album"), true);
      }
    });

    // Workspace album edit / delete
    $("#btn-edit-album").addEventListener("click", () => {
      if (state.activeAlbum) openAlbumDialog(state.activeAlbum);
    });

    $("#btn-delete-album").addEventListener("click", async () => {
      if (!state.activeAlbum) return;
      const ok = window.confirm(
        `Xóa Album "${state.activeAlbum.title}" và toàn bộ ${state.photos.length} ảnh bên trong? Hành động này không thể hoàn tác.`
      );
      if (!ok) return;
      try {
        await apiFetch(`/api/admin/albums/${encodeURIComponent(state.activeAlbum.id)}`, {
          method: "DELETE",
        });
        toast("Đã xóa Album và dọn sạch ảnh trên kho lưu trữ.", "success");
        await loadAlbums();
        showAlbumsListView(true);
      } catch (err) {
        toast(err.message, "error");
      }
    });

    // Save Album form
    $("#album-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const alertEl = $("#album-form-alert");
      const btn = $("#album-form-submit");
      showAlert(alertEl, "");
      btn.disabled = true;

      const id = $("#af-id").value;
      const payload = {
        title: $("#af-title").value.trim(),
        eventDate: $("#af-date").value,
        status: $("#af-status").value,
        location: $("#af-location").value.trim(),
        filters: $$('input[name="filters"]:checked', form).map((cb) => cb.value),
        driveUrl: $("#af-drive").value.trim(),
        description: $("#af-desc").value.trim(),
      };

      try {
        if (id) {
          const res = await apiFetch(`/api/admin/albums/${encodeURIComponent(id)}`, {
            method: "PATCH",
            json: payload,
          });
          if (state.activeAlbum && state.activeAlbum.id === id) {
            state.activeAlbum = res.item;
            renderWorkspaceHeader();
          }
          toast("Đã cập nhật Album.", "success");
          $("#album-dialog").close();
          await loadAlbums();
        } else {
          const res = await apiFetch("/api/admin/albums", {
            method: "POST",
            json: payload,
          });
          toast("Đã tạo Album mới! Hãy kéo thả ảnh vào.", "success");
          $("#album-dialog").close();
          await loadAlbums();
          await openAlbumWorkspace(res.item.id, true);
        }
      } catch (err) {
        showAlert(alertEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });

    // Dropzone & multi-file picker
    const dropzone = $("#dropzone");
    const fileInput = $("#multi-file-input");

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        enqueueFiles(fileInput.files);
        fileInput.value = "";
      }
    });

    ["dragenter", "dragover"].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
      });
    });
    dropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer?.files?.length) {
        enqueueFiles(e.dataTransfer.files);
      }
    });

    $("#btn-retry-failed").addEventListener("click", () => {
      state.uploadQueue.forEach((item) => {
        if (item.status === "error") {
          item.status = "pending";
          item.error = "";
        }
      });
      renderUploadQueue();
      runUploadQueue();
    });

    $("#btn-clear-queue").addEventListener("click", () => {
      state.uploadQueue = [];
      renderUploadQueue();
    });

    // Delegated clicks on Photos Grid
    $("#ws-photos-grid").addEventListener("click", async (e) => {
      const editBtn = e.target.closest("[data-edit-photo]");
      if (editBtn) {
        const photo = state.photos.find((p) => p.id === editBtn.getAttribute("data-edit-photo"));
        if (photo) openPhotoDialog(photo);
        return;
      }

      const featBtn = e.target.closest("[data-toggle-featured]");
      if (featBtn) {
        const id = featBtn.getAttribute("data-toggle-featured");
        const nextVal = featBtn.getAttribute("data-featured") !== "1";
        featBtn.disabled = true;
        try {
          const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(id)}`, {
            method: "PATCH",
            json: { isFeaturedHome: nextVal },
          });
          const idx = state.photos.findIndex((p) => p.id === id);
          if (idx !== -1) state.photos[idx] = res.item;
          renderPhotosGrid();
          await loadAlbums();
          toast(nextVal ? "Đã ghim ảnh lên Trang chủ." : "Đã bỏ ghim khỏi Trang chủ.", "success");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      const coverBtn = e.target.closest("[data-set-cover]");
      if (coverBtn) {
        const id = coverBtn.getAttribute("data-set-cover");
        coverBtn.disabled = true;
        try {
          const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(id)}`, {
            method: "PATCH",
            json: { setAsCover: true },
          });
          if (state.activeAlbum) {
            state.activeAlbum.coverUrl = res.item.url;
          }
          renderPhotosGrid();
          await loadAlbums();
          toast("Đã đặt làm ảnh bìa Album.", "success");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      const delBtn = e.target.closest("[data-delete-photo]");
      if (delBtn) {
        const id = delBtn.getAttribute("data-delete-photo");
        if (!window.confirm("Xóa ảnh này khỏi Album và kho lưu trữ?")) return;
        delBtn.disabled = true;
        try {
          await apiFetch(`/api/admin/photos/${encodeURIComponent(id)}`, { method: "DELETE" });
          const removed = state.photos.find((p) => p.id === id);
          state.photos = state.photos.filter((p) => p.id !== id);
          if (state.activeAlbum && removed && state.activeAlbum.coverUrl === removed.url) {
            state.activeAlbum.coverUrl = state.photos[0]?.url || "";
          }
          renderWorkspaceHeader();
          renderPhotosGrid();
          await loadAlbums();
          toast("Đã xóa ảnh.", "success");
        } catch (err) {
          toast(err.message, "error");
          delBtn.disabled = false;
        }
      }
    });

    // Save Photo Metadata form
    $("#photo-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const alertEl = $("#photo-form-alert");
      const btn = $("#photo-form-submit");
      showAlert(alertEl, "");
      btn.disabled = true;
      const id = $("#pf-id").value;
      try {
        const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(id)}`, {
          method: "PATCH",
          json: {
            caption: $("#pf-caption").value.trim(),
            photographer: $("#pf-photographer").value.trim(),
            isFeaturedHome: $("#pf-featured").checked,
          },
        });
        const idx = state.photos.findIndex((p) => p.id === id);
        if (idx !== -1) state.photos[idx] = res.item;
        renderPhotosGrid();
        await loadAlbums();
        $("#photo-dialog").close();
        toast("Đã lưu thông tin ảnh.", "success");
      } catch (err) {
        showAlert(alertEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });

    // Change Password
    $("#btn-open-pw").addEventListener("click", () => {
      $("#pw-form").reset();
      showAlert($("#pw-form-alert"), "");
      $("#pw-dialog").showModal();
      $("#pw-current").focus();
    });

    $("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const alertEl = $("#pw-form-alert");
      showAlert(alertEl, "");
      try {
        await apiFetch("/api/auth/change-password", {
          method: "POST",
          json: {
            currentPassword: $("#pw-current").value,
            newPassword: $("#pw-new").value,
          },
        });
        $("#pw-dialog").close();
        toast("Đổi mật khẩu thành công!", "success");
      } catch (err) {
        showAlert(alertEl, err.message);
      }
    });

    // Close dialog buttons
    $$("[data-close-dialog]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dlg = btn.closest("dialog");
        if (dlg) dlg.close();
      });
    });
  }

  bindEvents();
  boot();
})();
