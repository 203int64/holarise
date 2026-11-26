(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ROLE_LABELS = {
    super_admin: "Quản trị chính",
    editor: "Ban Điều Phối",
    media: "Ban Hình Ảnh",
    media_viewer: "Thành viên xem Media",
  };

  const MAX_BATCH_FILES = 30;
  const UPLOAD_CONCURRENCY = 2;

  const state = {
    user: null,
    albums: [],
    albumFilter: "all", // all | pending | published | draft
    searchQuery: "",
    activeAlbum: null,
    photos: [],
    photoFilter: "all", // pending | approved | featured | all
    selectMode: false,
    selectedIds: new Set(),
    lightboxPhotoId: null,
    uploadQueue: [],
    uploading: false,
    batchBusy: false,
    mediaStorage: null,
  };

  /* =========================================================================
     Modern Top-Layer Exit Fallback (animate-to-from-top-layer)
     ========================================================================= */
  let supportsDisplayTransition;
  function canTransitionDisplay() {
    if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
    if (!window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
      return false;
    }
    const probe = document.createElement("div");
    probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
    document.body.appendChild(probe);
    getComputedStyle(probe).display;
    probe.style.display = "none";
    supportsDisplayTransition = getComputedStyle(probe).display === "block";
    probe.remove();
    return supportsDisplayTransition;
  }

  function supportsTopLayerExit() {
    return window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay();
  }

  async function closeDialogSmooth(dlg) {
    if (!dlg || !dlg.open) return;
    if (!supportsTopLayerExit()) {
      dlg.setAttribute("data-closing", "");
      const animations = dlg.getAnimations ? dlg.getAnimations({ subtree: true }) : [];
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((a) => a.finished)),
          new Promise((r) => setTimeout(r, 400)),
        ]);
      }
      if (!dlg.hasAttribute("data-closing")) return;
      dlg.removeAttribute("data-closing");
    }
    dlg.close();
  }

  /* =========================================================================
     Helpers
     ========================================================================= */
  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  function getInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "HR";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function isApproverRole() {
    return state.user?.role === "super_admin" || state.user?.role === "editor";
  }

  function isViewerOnly() {
    return state.user?.role === "media_viewer";
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
    }, 3200);
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

  function closeAllMenus() {
    $$("details.mp-menu[open]").forEach((d) => d.removeAttribute("open"));
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

  /* =========================================================================
     Client-side Image Compression (Fallback KV upload & Admin WebP approval)
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

  async function compressRemoteImageToWebBlob(url, maxDim = 1280, quality = 0.82) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      throw new Error(`Không thể tải ảnh gốc để nén (HTTP ${res.status}).`);
    }
    const origBlob = await res.blob();
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      const objUrl = URL.createObjectURL(origBlob);
      el.onload = () => {
        URL.revokeObjectURL(objUrl);
        resolve(el);
      };
      el.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error("Không thể giải mã ảnh gốc để nén."));
      };
      el.src = objUrl;
    });

    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const webpBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (webpBlob && webpBlob.type === "image/webp" && webpBlob.size > 0) {
      return { blob: webpBlob, ext: "webp" };
    }
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (jpegBlob && jpegBlob.size > 0) {
      return { blob: jpegBlob, ext: "jpg" };
    }
    throw new Error("Trình duyệt không nén được ảnh web.");
  }

  async function approveSinglePhoto(photo) {
    const { blob, ext } = await compressRemoteImageToWebBlob(photo.url, 1280, 0.82);
    const fd = new FormData();
    fd.append("action", "approve");
    fd.append("file", blob, `${photo.id}.${ext}`);
    const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}/approve`, {
      method: "POST",
      body: fd,
    });
    const idx = state.photos.findIndex((p) => p.id === photo.id);
    if (idx !== -1) state.photos[idx] = res.item;
    if (state.activeAlbum && !state.activeAlbum.coverUrl) {
      state.activeAlbum.coverUrl = res.item.webUrl || res.item.url;
    }
    return { item: res.item, bytes: res.compressedBytes || blob.size };
  }

  /* =========================================================================
     Auth & Shell Boot
     ========================================================================= */
  function showAuthScreen() {
    $("#boot-loader").hidden = true;
    $("#media-shell").hidden = true;
    $("#auth-screen").hidden = false;
    window.HolaVault?.reset?.();
  }

  async function enterMediaShell(user) {
    state.user = user;
    $("#boot-loader").hidden = true;
    $("#auth-screen").hidden = true;
    $("#media-shell").hidden = false;

    const roleLabel = user.department || ROLE_LABELS[user.role] || user.role;
    $("#topbar-user-initials").textContent = getInitials(user.name);
    $("#topbar-user-name").textContent = user.name || "Thành viên";
    $("#menu-user-name").textContent = user.name || "Thành viên";
    $("#menu-user-role").textContent = `${roleLabel}${user.phone ? ` · ${user.phone}` : ""}`;
    $("#link-admin-cms").hidden = !isApproverRole();

    const passkeyBtn = $("#btn-setup-passkey");
    if (passkeyBtn) {
      passkeyBtn.hidden = isViewerOnly() || Boolean(user.hasPasskey) || !window.HolaPasskey?.isSupported?.();
    }
    const changePwBtn = $("#btn-change-pw");
    if (changePwBtn) changePwBtn.hidden = isViewerOnly();

    const savedPhotographer =
      localStorage.getItem("holarise_media_photographer") || user.name || "Ban Hình Ảnh HolaRise";
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
      } else if (status.mediaViewer) {
        await enterMediaShell(status.mediaViewer);
      } else {
        showAuthScreen();
      }
    } catch (err) {
      showAuthScreen();
      showAlert($("#login-alert"), err.message || "Không thể kết nối máy chủ.");
    }
  }

  /* =========================================================================
     VIEW 1: Albums Gallery
     ========================================================================= */
  function setTopbarMode(mode) {
    const inWorkspace = mode === "workspace";
    const viewer = isViewerOnly();
    $("#brand-home-link").hidden = inWorkspace;
    $("#ws-nav-head").hidden = !inWorkspace;
    $("#btn-new-album").hidden = viewer || inWorkspace;
    $("#btn-upload-trigger").hidden = viewer || !inWorkspace;
    $("#ws-more-menu").hidden = viewer || !inWorkspace;
  }

  function showAlbumsListView(updateUrl = true) {
    state.activeAlbum = null;
    state.photos = [];
    state.selectMode = false;
    state.selectedIds.clear();
    updateBatchBar();
    setTopbarMode("albums");
    $("#view-workspace").hidden = true;
    $("#view-albums").hidden = false;
    if (updateUrl) {
      history.replaceState(null, "", window.location.pathname);
    }
    renderAlbumsGrid();
  }

  async function loadAlbums(silent = false) {
    showAlert($("#albums-error"), "");
    if (!silent) {
      $("#albums-grid").innerHTML = `
        <div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>
        <div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>
        <div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>
        <div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>
      `;
    }
    try {
      const res = await apiFetch("/api/admin/albums");
      state.albums = res.items || [];
      syncAlbumFilterCounts();
      renderAlbumsGrid();
    } catch (err) {
      showAlert($("#albums-error"), err.message);
      if (!silent) $("#albums-grid").innerHTML = "";
    }
  }

  function syncAlbumFilterCounts() {
    const totalPendingPhotos = state.albums.reduce((s, a) => s + Number(a.pendingCount || 0), 0);
    $("#cnt-alb-all").textContent = String(state.albums.length);
    const pendingChip = $("#chip-alb-pending");
    if (pendingChip) {
      pendingChip.hidden = totalPendingPhotos === 0;
      $("#cnt-alb-pending").textContent = String(totalPendingPhotos);
      if (totalPendingPhotos === 0 && state.albumFilter === "pending") {
        state.albumFilter = "all";
        $$("[data-album-filter]").forEach((c) =>
          c.classList.toggle("is-active", c.getAttribute("data-album-filter") === "all")
        );
      }
    }
  }

  function renderAlbumsGrid() {
    const grid = $("#albums-grid");
    if (!grid) return;

    const q = state.searchQuery.trim().toLowerCase();
    const list = state.albums.filter((a) => {
      if (state.albumFilter === "pending" && Number(a.pendingCount || 0) <= 0) return false;
      if (state.albumFilter === "published" && a.status !== "published") return false;
      if (state.albumFilter === "draft" && a.status !== "draft") return false;
      if (q) {
        const hay = `${a.title} ${a.location} ${a.dateDisplay}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (list.length === 0) {
      grid.innerHTML = `<div class="media-empty-box">
        <h3>Chưa có Album phù hợp</h3>
        <p>${state.albums.length === 0 ? "Tạo Album sự kiện đầu tiên để tải ảnh gốc lên kho HolaRise." : "Thử xóa bộ lọc hoặc từ khóa tìm kiếm."}</p>
        ${state.albums.length === 0 ? '<button class="btn btn--primary btn--sm" type="button" data-trigger-new-album>+ Tạo Album đầu tiên</button>' : ""}
      </div>`;
      return;
    }

    grid.innerHTML = list
      .map((a) => {
        const cornerPill =
          Number(a.pendingCount || 0) > 0
            ? `<span class="album-corner-pill album-corner-pill--pending">${a.pendingCount} chờ duyệt</span>`
            : a.status === "draft"
              ? '<span class="album-corner-pill album-corner-pill--draft">Nháp</span>'
              : "";
        const coverHtml = a.coverUrl
          ? `<img src="${esc(a.coverUrl)}" alt="${esc(a.title)}" loading="lazy">`
          : `<div class="album-card-cover--empty">Chưa có ảnh</div>`;
        const dateLabel = a.dateDisplay || a.eventDate || "Chưa ghi ngày";
        return `<article class="album-card" data-open-album="${esc(a.id)}" tabindex="0" role="button" aria-label="Mở album ${esc(a.title)}">
          <div class="album-card-cover">
            ${coverHtml}
            ${cornerPill}
            ${isViewerOnly() ? "" : `<button class="album-edit-btn" type="button" data-edit-album="${esc(a.id)}" aria-label="Sửa album ${esc(a.title)}" title="Sửa thông tin Album">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>`}
          </div>
          <div class="album-card-body">
            <h3 class="album-card-title">${esc(a.title)}</h3>
            <div class="album-card-meta">${esc(dateLabel)} · ${a.photoCount} ảnh</div>
          </div>
        </article>`;
      })
      .join("");
  }

  /* =========================================================================
     VIEW 2: Photo-First Album Workspace
     ========================================================================= */
  function isContributionPhoto(p) {
    return p?.sourceKind === "member_contribution" || Boolean(p?.contributorMemberId);
  }

  function getFilteredPhotos() {
    return state.photos.filter((p) => {
      const status = p.approvalStatus || "approved";
      if (state.photoFilter === "pending") return status === "pending";
      if (state.photoFilter === "contributions") return isContributionPhoto(p);
      if (state.photoFilter === "approved") return status === "approved";
      if (state.photoFilter === "featured") return status === "approved" && Boolean(p.isFeaturedHome);
      return true;
    });
  }

  async function openAlbumWorkspace(albumId, updateUrl = true) {
    state.selectMode = false;
    state.selectedIds.clear();
    updateBatchBar();
    setTopbarMode("workspace");
    $("#view-albums").hidden = true;
    $("#view-workspace").hidden = false;
    $("#ws-title").textContent = "Đang tải...";
    $("#ws-meta").textContent = "";
    $("#ws-photos-grid").innerHTML = `<div class="skeleton-card"><div class="sk sk-title"></div><div class="sk sk-line"></div></div>`;
    if (updateUrl) {
      history.replaceState(null, "", `${window.location.pathname}?album=${encodeURIComponent(albumId)}`);
    }

    try {
      const res = await apiFetch(`/api/admin/albums/${encodeURIComponent(albumId)}`);
      state.activeAlbum = res.album;
      state.photos = res.photos || [];
      const pendingCount = state.photos.filter((p) => p.approvalStatus === "pending").length;
      state.photoFilter = pendingCount > 0 && isApproverRole() ? "pending" : "all";
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
    const total = state.photos.length;
    const pending = state.photos.filter((p) => p.approvalStatus === "pending").length;
    const contributions = state.photos.filter(isContributionPhoto).length;
    const approved = state.photos.filter((p) => (p.approvalStatus || "approved") === "approved").length;
    const featured = state.photos.filter(
      (p) => (p.approvalStatus || "approved") === "approved" && p.isFeaturedHome
    ).length;

    $("#ws-title").textContent = a.title;
    $("#ws-meta").textContent = `${a.dateDisplay || a.eventDate || "Hòa Lạc"} · ${total} ảnh${contributions > 0 ? ` · ${contributions} ảnh đóng góp` : ""}${pending > 0 ? ` · ${pending} chờ duyệt` : ""}`;

    const driveLink = $("#ws-drive-link");
    if (driveLink) {
      if (a.driveUrl) {
        driveLink.href = a.driveUrl;
        driveLink.hidden = false;
      } else {
        driveLink.hidden = true;
      }
    }

    $("#cnt-photo-pending").textContent = String(pending);
    if ($("#cnt-photo-contrib")) $("#cnt-photo-contrib").textContent = String(contributions);
    $("#cnt-photo-approved").textContent = String(approved);
    $("#cnt-photo-featured").textContent = String(featured);
    $("#cnt-photo-all").textContent = String(total);

    const pendingTab = $("#tab-photo-pending");
    if (pendingTab) {
      pendingTab.hidden = pending === 0;
      if (pending === 0 && state.photoFilter === "pending") {
        state.photoFilter = "all";
      }
    }
    const contribTab = $("#tab-photo-contrib");
    if (contribTab) {
      contribTab.hidden = contributions === 0;
      if (contributions === 0 && state.photoFilter === "contributions") {
        state.photoFilter = "all";
      }
    }

    $$("[data-photo-filter]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-photo-filter") === state.photoFilter);
    });

    const approveAllBtn = $("#btn-approve-all");
    if (approveAllBtn) {
      approveAllBtn.hidden = !isApproverRole() || pending === 0 || state.selectMode || state.batchBusy;
      approveAllBtn.textContent = `✓ Duyệt hết (${pending})`;
    }

    const selectBtn = $("#btn-toggle-select");
    if (selectBtn) {
      selectBtn.hidden = total === 0;
      selectBtn.textContent = state.selectMode ? "Xong" : "Chọn nhiều";
      selectBtn.classList.toggle("btn--primary", state.selectMode);
      selectBtn.classList.toggle("btn--outline", !state.selectMode);
    }
  }

  function renderPhotosGrid() {
    const grid = $("#ws-photos-grid");
    const a = state.activeAlbum;
    if (!grid || !a) return;

    grid.classList.toggle("is-select-mode", state.selectMode);

    if (state.photos.length === 0) {
      grid.innerHTML = `<div class="media-empty-box media-empty-box--clickable" data-trigger-upload tabindex="0" role="button">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <h3>Album chưa có ảnh</h3>
        <p>Chạm vào đây hoặc kéo thả ảnh trực tiếp để tải lên (tối đa 30 ảnh/lượt).</p>
        <span class="btn btn--primary btn--sm">+ Chọn ảnh từ máy</span>
      </div>`;
      return;
    }

    const visible = getFilteredPhotos();
    if (visible.length === 0) {
      grid.innerHTML = `<div class="media-empty-box">
        <h3>Không có ảnh trong mục này</h3>
        <p>Chọn bộ lọc khác hoặc bấm <strong>Tất cả</strong> để xem toàn bộ ảnh trong album.</p>
      </div>`;
      return;
    }

    grid.innerHTML = visible
      .map((p) => {
        const status = p.approvalStatus || "approved";
        const isCover = a.coverUrl === p.url || (p.webUrl && a.coverUrl === p.webUrl);
        const isSelected = state.selectedIds.has(p.id);
        const markers = [];
        if (status === "pending") {
          markers.push('<span class="tile-pill tile-pill--pending">Chờ duyệt</span>');
        } else if (status === "rejected") {
          markers.push('<span class="tile-pill tile-pill--rejected">Đã ẩn</span>');
        }
        if (isContributionPhoto(p)) {
          markers.push('<span class="tile-pill tile-pill--contrib" title="Ảnh thành viên đóng góp">Đóng góp</span>');
        }
        if (p.isFeaturedHome && status === "approved") {
          markers.push('<span class="tile-pill tile-pill--home" title="Ghim Trang chủ"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>');
        }
        if (isCover) {
          markers.push('<span class="tile-pill tile-pill--cover">Bìa</span>');
        }

        const isVideo =
          String(p.mediaType || "image").toLowerCase() === "video" ||
          /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(p.displayUrl || p.url || ""));
        const mediaSrc = p.displayUrl || p.url;
        if (isVideo) {
          markers.push('<span class="tile-pill tile-pill--video">Video</span>');
        }
        const mediaMarkup = isVideo
          ? `<video src="${esc(mediaSrc)}#t=0.1" muted playsinline preload="metadata"></video>`
          : `<img src="${esc(mediaSrc)}" alt="${esc(p.alt || p.caption || a.title)}" loading="lazy" decoding="async" onerror="this.parentElement&&this.parentElement.classList.add('is-broken')">`;

        return `<article class="photo-tile ${isSelected ? "is-selected" : ""}" data-photo-id="${esc(p.id)}">
          ${mediaMarkup}
          ${markers.length ? `<div class="photo-tile-markers">${markers.join("")}</div>` : ""}
          <button class="photo-tile-check" type="button" data-check-photo="${esc(p.id)}" aria-label="${isSelected ? "Bỏ chọn ảnh" : "Chọn ảnh"}" aria-pressed="${isSelected ? "true" : "false"}">
            ${isSelected ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ""}
          </button>
        </article>`;
      })
      .join("");
  }

  function updateBatchBar() {
    const bar = $("#batch-bar");
    if (!bar) return;
    const count = state.selectedIds.size;
    bar.hidden = count === 0;
    if (count === 0) return;

    $("#batch-count").textContent = `Đã chọn ${count} ảnh`;
    const selectedPhotos = state.photos.filter((p) => state.selectedIds.has(p.id));
    const pendingInSelection = selectedPhotos.filter((p) => (p.approvalStatus || "approved") !== "approved");
    const approvedInSelection = selectedPhotos.filter((p) => (p.approvalStatus || "approved") === "approved");

    const approveBtn = $("#btn-batch-approve");
    const unapproveBtn = $("#btn-batch-unapprove");
    const deleteBtn = $("#btn-batch-delete");

    if (approveBtn) {
      approveBtn.hidden = !isApproverRole() || pendingInSelection.length === 0;
      approveBtn.disabled = state.batchBusy;
      approveBtn.textContent = `✓ Duyệt & nén (${pendingInSelection.length})`;
    }
    if (unapproveBtn) {
      unapproveBtn.hidden = !isApproverRole() || pendingInSelection.length > 0 || approvedInSelection.length === 0;
      unapproveBtn.disabled = state.batchBusy;
      unapproveBtn.textContent = `Ẩn khỏi web (${approvedInSelection.length})`;
    }
    if (deleteBtn) {
      deleteBtn.disabled = state.batchBusy;
      deleteBtn.textContent = `Xóa (${count})`;
    }
  }

  function togglePhotoSelection(photoId) {
    if (!state.selectMode) state.selectMode = true;
    if (state.selectedIds.has(photoId)) {
      state.selectedIds.delete(photoId);
    } else {
      state.selectedIds.add(photoId);
    }
    renderWorkspaceHeader();
    renderPhotosGrid();
    updateBatchBar();
  }

  async function runBatchApprove(photosToApprove) {
    if (!isApproverRole() || photosToApprove.length === 0 || state.batchBusy) return;
    state.batchBusy = true;
    renderWorkspaceHeader();
    updateBatchBar();

    const strip = $("#upload-queue");
    const fill = $("#upload-progress-fill");
    const summary = $("#upload-queue-summary");
    const details = $("#upload-queue-details");
    const total = photosToApprove.length;
    let done = 0;
    let failed = 0;

    if (strip) strip.hidden = false;
    if (details) details.hidden = true;
    $("#btn-retry-failed").hidden = true;
    $("#btn-clear-queue").hidden = true;

    const updateProgress = () => {
      const pct = Math.round(((done + failed) / Math.max(1, total)) * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (summary) {
        summary.textContent = `Đang duyệt & nén WebP: ${done}/${total}${failed ? ` · ${failed} lỗi` : ""}`;
      }
    };
    updateProgress();

    let cursor = 0;
    const worker = async () => {
      while (cursor < photosToApprove.length) {
        const current = photosToApprove[cursor++];
        try {
          await approveSinglePhoto(current);
          done += 1;
          state.selectedIds.delete(current.id);
        } catch {
          failed += 1;
        }
        updateProgress();
      }
    };

    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, () => worker()));

    state.batchBusy = false;
    if (state.selectedIds.size === 0) state.selectMode = false;
    if (strip) strip.hidden = true;
    if (details) details.hidden = false;

    renderWorkspaceHeader();
    renderPhotosGrid();
    updateBatchBar();
    await loadAlbums(true);

    if (failed === 0) {
      toast(`Đã duyệt & nén ${done} ảnh lên web thành công.`, "success");
    } else {
      toast(`Đã duyệt ${done}/${total} ảnh (${failed} ảnh gặp lỗi).`, "error");
    }
  }

  async function runBatchUnapprove(photosToHide) {
    if (!isApproverRole() || photosToHide.length === 0 || state.batchBusy) return;
    state.batchBusy = true;
    updateBatchBar();
    let done = 0;
    let failed = 0;

    for (const p of photosToHide) {
      try {
        const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(p.id)}/approve`, {
          method: "POST",
          json: { action: "pending" },
        });
        const idx = state.photos.findIndex((item) => item.id === p.id);
        if (idx !== -1) state.photos[idx] = res.item;
        state.selectedIds.delete(p.id);
        done += 1;
      } catch {
        failed += 1;
      }
    }

    state.batchBusy = false;
    if (state.selectedIds.size === 0) state.selectMode = false;
    renderWorkspaceHeader();
    renderPhotosGrid();
    updateBatchBar();
    await loadAlbums(true);
    toast(failed ? `Đã ẩn ${done} ảnh (${failed} lỗi).` : `Đã ẩn ${done} ảnh khỏi web công khai.`, failed ? "error" : "info");
  }

  async function runBatchDelete(photosToDelete) {
    if (photosToDelete.length === 0 || state.batchBusy) return;
    const ok = window.confirm(`Xóa vĩnh viễn ${photosToDelete.length} ảnh đã chọn khỏi Album và kho lưu trữ?`);
    if (!ok) return;

    state.batchBusy = true;
    updateBatchBar();
    let done = 0;
    let failed = 0;

    for (const p of photosToDelete) {
      try {
        await apiFetch(`/api/admin/photos/${encodeURIComponent(p.id)}`, { method: "DELETE" });
        state.photos = state.photos.filter((item) => item.id !== p.id);
        state.selectedIds.delete(p.id);
        if (state.activeAlbum && (state.activeAlbum.coverUrl === p.url || state.activeAlbum.coverUrl === p.webUrl)) {
          state.activeAlbum.coverUrl = state.photos[0]?.displayUrl || state.photos[0]?.url || "";
        }
        done += 1;
      } catch {
        failed += 1;
      }
    }

    state.batchBusy = false;
    if (state.selectedIds.size === 0) state.selectMode = false;
    renderWorkspaceHeader();
    renderPhotosGrid();
    updateBatchBar();
    await loadAlbums(true);
    toast(failed ? `Đã xóa ${done} ảnh (${failed} lỗi).` : `Đã xóa ${done} ảnh.`, failed ? "error" : "success");
  }

  /* =========================================================================
     Quick-Review Lightbox (<dialog>)
     ========================================================================= */
  function openLightbox(photoId) {
    const visible = getFilteredPhotos();
    const photo = visible.find((p) => p.id === photoId) || state.photos.find((p) => p.id === photoId);
    if (!photo) return;
    state.lightboxPhotoId = photo.id;
    renderLightbox();
    const dlg = $("#lightbox-dialog");
    if (dlg && !dlg.open) {
      dlg.removeAttribute("data-closing");
      dlg.showModal();
    }
  }

  function renderLightbox() {
    const list = getFilteredPhotos();
    const idx = list.findIndex((p) => p.id === state.lightboxPhotoId);
    const photo = idx !== -1 ? list[idx] : state.photos.find((p) => p.id === state.lightboxPhotoId);
    if (!photo) {
      closeDialogSmooth($("#lightbox-dialog"));
      return;
    }

    const activeList = idx !== -1 ? list : state.photos;
    const activeIdx = activeList.findIndex((p) => p.id === photo.id);
    const status = photo.approvalStatus || "approved";
    const isApproved = status === "approved";
    const canApprove = isApproverRole();
    const isCover =
      state.activeAlbum &&
      (state.activeAlbum.coverUrl === photo.url || (photo.webUrl && state.activeAlbum.coverUrl === photo.webUrl));

    $("#lb-counter").textContent = `${activeIdx + 1} / ${activeList.length}`;
    const pill = $("#lb-status-pill");
    pill.textContent = isApproved ? (photo.webUrl ? "Đã duyệt · WebP" : "Đã lên web") : status === "rejected" ? "Đã ẩn" : "Chờ duyệt";
    pill.className = `lb-status-pill ${isApproved ? "lb-status-pill--approved" : "lb-status-pill--pending"}`;

    const isVideo =
      String(photo.mediaType || "image").toLowerCase() === "video" ||
      /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(photo.displayUrl || photo.url || ""));
    const imgEl = $("#lb-img");
    const vidEl = $("#lb-video");
    if (isVideo && vidEl) {
      imgEl.hidden = true;
      imgEl.removeAttribute("src");
      vidEl.hidden = false;
      vidEl.src = photo.displayUrl || photo.url;
    } else {
      if (vidEl) {
        try { vidEl.pause(); } catch {}
        vidEl.removeAttribute("src");
        vidEl.hidden = true;
      }
      imgEl.hidden = false;
      imgEl.src = photo.displayUrl || photo.url;
      imgEl.alt = photo.caption || photo.alt || state.activeAlbum?.title || "Ảnh sự kiện";
    }

    $("#lb-prev").hidden = activeList.length <= 1;
    $("#lb-next").hidden = activeList.length <= 1;

    const metaEl = $("#lb-meta");
    const sourceLabel = isContributionPhoto(photo)
      ? `Đóng góp: ${photo.uploadedBy || photo.photographer || "Thành viên"}`
      : photo.photographer
        ? `Ảnh: ${photo.photographer}`
        : "";
    const metaBits = [
      photo.caption,
      sourceLabel,
      photo.drivePath ? `Thư mục: ${photo.drivePath}` : "",
    ].filter(Boolean);
    metaEl.textContent = metaBits.join(" · ");
    metaEl.hidden = metaBits.length === 0;

    $("#lb-btn-approve").hidden = !canApprove || isApproved;
    $("#lb-btn-approve").disabled = false;
    $("#lb-btn-approve").textContent = "✓ Duyệt & nén lên web";

    $("#lb-btn-unapprove").hidden = !canApprove || !isApproved;
    $("#lb-btn-unapprove").disabled = false;

    const featBtn = $("#lb-btn-featured");
    featBtn.hidden = !canApprove || !isApproved;
    featBtn.disabled = false;
    featBtn.classList.toggle("is-active", Boolean(photo.isFeaturedHome));
    featBtn.innerHTML = photo.isFeaturedHome
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Đang ghim Trang chủ'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Ghim Trang chủ';

    const coverBtn = $("#lb-btn-cover");
    coverBtn.hidden = !isApproved || Boolean(isCover);
    coverBtn.disabled = false;

    const aiBtn = $("#lb-btn-ai-retouch");
    if (aiBtn) {
      const isVideo = String(photo.mediaType || "image").toLowerCase() === "video";
      const isViewerOnly = state.user?.role === "media_viewer";
      aiBtn.hidden = isVideo || isViewerOnly;
      aiBtn.disabled = false;
    }
  }

  /* =========================================================================
     1-Click AI Photo Retouch Studio (3 Authentic Film Variants -> 1-Click Replace)
     ========================================================================= */
  let aiRetouchState = {
    photoId: "",
    originalUrl: "",
    busy: false,
    variants: [],
  };

  async function compressImageUrlToDataUrl(url, maxDim = 1280, quality = 0.88) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error("Không tải được ảnh gốc từ máy chủ.");
    const blob = await res.blob();
    const bitmapUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Không thể đọc định dạng ảnh này."));
        el.src = bitmapUrl;
      });
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", quality);
    } finally {
      URL.revokeObjectURL(bitmapUrl);
    }
  }

  function renderAiRetouchSkeleton() {
    const grid = $("#ai-retouch-grid");
    if (!grid) return;
    const labels = [
      ["Mẫu 1 · Phim ấm Hòa Lạc", "Kodak Portra 400 · Đang chỉnh ánh sáng & màu gỗ ấm..."],
      ["Mẫu 2 · Sáng trong tự nhiên", "Leica Natural · Đang cân bằng trắng & khử chói..."],
      ["Mẫu 3 · Điện ảnh trầm sâu", "Classic Chrome · Đang tạo chiều sâu vùng tối..."],
    ];
    grid.innerHTML = labels
      .map(
        ([title, sub]) => `
        <article class="ai-variant-card ai-variant-card--loading">
          <div class="ai-variant-frame"><div class="ai-variant-shimmer"></div></div>
          <div class="ai-variant-info">
            <strong>${esc(title)}</strong>
            <span>${esc(sub)}</span>
          </div>
        </article>`
      )
      .join("");
  }

  function renderAiRetouchVariants() {
    const grid = $("#ai-retouch-grid");
    if (!grid) return;
    grid.innerHTML = aiRetouchState.variants
      .map(
        (v, idx) => `
        <article class="ai-variant-card" data-ai-variant-idx="${idx}">
          <div class="ai-variant-frame">
            <img src="${esc(v.dataUrl)}" alt="${esc(v.label)}" data-ai-preview-img="${idx}">
            <span class="ai-variant-badge" data-ai-badge="${idx}">Mẫu ${idx + 1}</span>
          </div>
          <div class="ai-variant-info">
            <strong>${esc(v.label)}</strong>
            <span>${esc(v.subtitle || "")}</span>
          </div>
          <div class="ai-variant-actions">
            <button class="btn btn--outline btn--sm" type="button" data-ai-compare="${idx}">So ảnh gốc</button>
            <button class="btn btn--primary btn--sm" type="button" data-ai-apply="${idx}">Chọn thay thế</button>
          </div>
        </article>`
      )
      .join("");
  }

  async function runAiRetouchGenerate(photo) {
    if (!photo || aiRetouchState.busy) return;
    const dlg = $("#ai-retouch-dialog");
    const alertEl = $("#ai-retouch-alert");
    const statusEl = $("#ai-retouch-status");
    const regenBtn = $("#ai-retouch-regen");
    const origImg = $("#ai-retouch-orig-img");

    aiRetouchState = {
      photoId: photo.id,
      originalUrl: photo.displayUrl || photo.url,
      busy: true,
      variants: [],
    };
    if (origImg) origImg.src = aiRetouchState.originalUrl;
    if (alertEl) showAlert(alertEl, "");
    if (statusEl) statusEl.textContent = "Đang tạo song song 3 bản chỉnh màu phim thật (khoảng 6–12 giây)...";
    if (regenBtn) regenBtn.disabled = true;
    renderAiRetouchSkeleton();
    if (dlg && !dlg.open) dlg.showModal();

    try {
      const sourceDataUrl = await compressImageUrlToDataUrl(aiRetouchState.originalUrl, 1280, 0.88);
      const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}/ai-retouch`, {
        method: "POST",
        json: {
          action: "generate",
          imageDataUrl: sourceDataUrl,
        },
      });
      aiRetouchState.variants = Array.isArray(res.variants) ? res.variants : [];
      if (statusEl) {
        statusEl.textContent = `Đã tạo xong ${aiRetouchState.variants.length} mẫu chỉnh màu thật. Bấm "So ảnh gốc" để đối chiếu hoặc "Chọn thay thế".`;
      }
      renderAiRetouchVariants();
    } catch (err) {
      if (statusEl) statusEl.textContent = "Chưa tạo được mẫu AI.";
      if (alertEl) showAlert(alertEl, err.message || "Không thể kết nối Gemini AI Retouch.");
      const grid = $("#ai-retouch-grid");
      if (grid) grid.innerHTML = "";
    } finally {
      aiRetouchState.busy = false;
      if (regenBtn) regenBtn.disabled = false;
    }
  }

  async function applyAiRetouchVariant(idx) {
    const variant = aiRetouchState.variants[idx];
    if (!variant || aiRetouchState.busy) return;
    const photoId = aiRetouchState.photoId;
    const btn = document.querySelector(`[data-ai-apply="${idx}"]`);
    const statusEl = $("#ai-retouch-status");
    const alertEl = $("#ai-retouch-alert");

    aiRetouchState.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Đang lưu thay thế...";
    }
    if (alertEl) showAlert(alertEl, "");

    try {
      // Re-compress chosen variant cleanly to <= 1280px JPEG so web display stays ultra-fast
      const optimizedDataUrl = await compressImageUrlToDataUrl(variant.dataUrl, 1280, 0.88);
      const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photoId)}/ai-retouch`, {
        method: "POST",
        json: {
          action: "apply",
          presetId: variant.id,
          imageDataUrl: optimizedDataUrl,
        },
      });
      const pIdx = state.photos.findIndex((p) => p.id === photoId);
      if (pIdx !== -1 && res.item) state.photos[pIdx] = res.item;
      if (
        state.activeAlbum &&
        res.item?.webUrl &&
        (state.activeAlbum.coverUrl === aiRetouchState.originalUrl)
      ) {
        state.activeAlbum.coverUrl = res.item.webUrl;
      }
      renderPhotosGrid();
      if ($("#lightbox-dialog")?.open) renderLightbox();
      await loadAlbums(true);
      await closeDialogSmooth($("#ai-retouch-dialog"));
      toast(
        res.preservedDriveOriginal
          ? `Đã thay ảnh bằng "${variant.label}" (bản gốc Google Drive vẫn giữ nguyên).`
          : `Đã thay ảnh bằng "${variant.label}".`,
        "success"
      );
    } catch (err) {
      if (alertEl) showAlert(alertEl, err.message || "Không thể lưu ảnh thay thế.");
      if (statusEl) statusEl.textContent = "Lưu ảnh thất bại, vui lòng thử lại.";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Chọn thay thế";
      }
    } finally {
      aiRetouchState.busy = false;
    }
  }

  function stepLightbox(delta) {
    const list = getFilteredPhotos();
    const pool = list.length > 0 ? list : state.photos;
    if (pool.length <= 1) return;
    const idx = pool.findIndex((p) => p.id === state.lightboxPhotoId);
    const nextIdx = (idx + delta + pool.length) % pool.length;
    state.lightboxPhotoId = pool[nextIdx].id;
    renderLightbox();
  }

  /* =========================================================================
     Multi-Image Upload Queue (Concurrency = 2 + Retry)
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
      status: "pending",
      error: "",
    }));

    state.uploadQueue = [...state.uploadQueue.filter((i) => i.status !== "done"), ...items];
    renderUploadQueue();
    runUploadQueue();
  }

  function renderUploadQueue() {
    const box = $("#upload-queue");
    const list = $("#upload-queue-list");
    const fill = $("#upload-progress-fill");
    const details = $("#upload-queue-details");
    if (!box || !list) return;
    if (state.uploadQueue.length === 0) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (details) details.hidden = false;

    const total = state.uploadQueue.length;
    const done = state.uploadQueue.filter((i) => i.status === "done").length;
    const failed = state.uploadQueue.filter((i) => i.status === "error").length;
    const pct = Math.round(((done + failed) / Math.max(1, total)) * 100);
    if (fill) fill.style.width = `${pct}%`;

    $("#upload-queue-summary").textContent = state.uploading
      ? `Đang tải lên: ${done}/${total}${failed ? ` · ${failed} lỗi` : ""}`
      : `Hoàn tất: ${done}/${total} ảnh${failed ? ` · ${failed} lỗi` : ""}`;

    $("#btn-retry-failed").hidden = state.uploading || failed === 0;
    $("#btn-clear-queue").hidden = state.uploading;

    const statusText = {
      pending: "Chờ...",
      compressing: "Đang nén...",
      uploading: "Đang tải...",
      done: "Xong ✓",
      error: "Lỗi",
    };

    list.innerHTML = state.uploadQueue
      .map(
        (item) => `<div class="queue-item queue-item--${esc(item.status)}">
          <span class="queue-item-name" title="${esc(item.name)}">${esc(item.name)}</span>
          <span class="queue-item-status">${esc(item.status === "error" ? item.error || "Lỗi" : statusText[item.status])}</span>
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
      const isVid = isVideoFile(item.file);
      let uploadPayload = item.file;
      let uploadFilename = item.name || (isVid ? "video.mp4" : "photo.jpg");

      if (!isVid && !storageInfo.driveConfigured) {
        item.status = "compressing";
        item.error = "";
        renderUploadQueue();
        uploadPayload = await compressImageFile(item.file, 1280, 0.82);
        uploadFilename = item.name.replace(/\.[^.]+$/, "") + ".jpg";
      }

      item.status = "uploading";
      item.error = "";
      renderUploadQueue();

      const dateMatch = String(state.activeAlbum.eventDate || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
      const cleanTitle = String(state.activeAlbum.title || "")
        .replace(/[\\/:*?"<>|\r\n]+/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      const folderName =
        dateMatch && cleanTitle
          ? `${dateMatch[1]} - ${cleanTitle}`.slice(0, 120)
          : (cleanTitle || state.activeAlbum.slug || "").slice(0, 120);

      const fd = new FormData();
      fd.append("file", uploadPayload, uploadFilename);
      fd.append("category", "album");
      fd.append("subfolder", folderName);
      const uploaded = await apiFetch("/api/admin/media", { method: "POST", body: fd });

      const attached = await apiFetch(`/api/admin/albums/${encodeURIComponent(albumId)}/photos`, {
        method: "POST",
        json: {
          url: uploaded.url,
          mediaKey: uploaded.id,
          mediaType: uploaded.mediaType || (isVid ? "video" : "image"),
          caption: "",
          alt: state.activeAlbum.title,
          photographer,
          isFeaturedHome: false,
          approvalStatus: storageInfo.driveConfigured ? "pending" : undefined,
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

    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, () => worker()));

    state.uploading = false;
    renderUploadQueue();
    await loadAlbums(true);
    const failed = state.uploadQueue.filter((i) => i.status === "error").length;
    if (failed === 0) {
      toast("Đã tải ảnh lên Album thành công.", "success");
      window.setTimeout(() => {
        if (!state.uploading && state.uploadQueue.every((i) => i.status === "done")) {
          state.uploadQueue = [];
          renderUploadQueue();
        }
      }, 2400);
    } else {
      toast(`Có ${failed} ảnh bị lỗi. Bạn có thể bấm "Thử lại ảnh lỗi".`, "error");
    }
  }

  /* =========================================================================
     Dialogs: Create/Edit Album, Edit Photo, Change Password
     ========================================================================= */
  function openAlbumDialog(album = null) {
    closeAllMenus();
    const dlg = $("#album-dialog");
    const form = $("#album-form");
    form.reset();
    showAlert($("#album-form-alert"), "");

    $("#album-dialog-title").textContent = album ? "Cập nhật Album" : "Tạo Album mới";
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

    const extras = $("#af-extras");
    if (extras) extras.open = Boolean(album);

    dlg.showModal();
    $("#af-title").focus();
  }

  function openPhotoDialog(photo) {
    const dlg = $("#photo-dialog");
    showAlert($("#photo-form-alert"), "");
    $("#pf-id").value = photo.id;
    $("#pf-preview").src = photo.displayUrl || photo.url;
    $("#pf-caption").value = photo.caption || "";
    $("#pf-photographer").value = photo.photographer || "";
    $("#pf-featured").checked = Boolean(photo.isFeaturedHome);
    const featWrap = $("#pf-featured-wrap");
    if (featWrap) {
      featWrap.hidden = !isApproverRole() || (photo.approvalStatus || "approved") !== "approved";
    }
    dlg.showModal();
    $("#pf-caption").focus();
  }

  /* =========================================================================
     Event Binding
     ========================================================================= */
  function bindEvents() {
    // Close <details> menus when clicking outside or pressing Escape
    document.addEventListener("click", (e) => {
      $$("details.mp-menu[open]").forEach((menu) => {
        if (!menu.contains(e.target)) {
          menu.removeAttribute("open");
        }
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAllMenus();
      }
      const lb = $("#lightbox-dialog");
      if (lb && lb.open && !$("#photo-dialog")?.open && !$("#ai-retouch-dialog")?.open) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        const isTyping = tag === "input" || tag === "textarea" || tag === "select";
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          stepLightbox(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          stepLightbox(1);
        } else if (!isTyping && (e.key === "a" || e.key === "A") && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const approveBtn = $("#lb-btn-approve");
          if (approveBtn && !approveBtn.hidden && !approveBtn.disabled) {
            e.preventDefault();
            approveBtn.click();
          }
        }
      }
    });

    // Smooth top-layer close on native cancel (Esc / closedby light dismiss)
    const lbDlg = $("#lightbox-dialog");
    if (lbDlg) {
      lbDlg.addEventListener("cancel", (e) => {
        e.preventDefault();
        closeDialogSmooth(lbDlg);
      });
      lbDlg.addEventListener("close", () => {
        const vidEl = $("#lb-video");
        if (vidEl) {
          try { vidEl.pause(); } catch {}
          vidEl.removeAttribute("src");
          try { vidEl.load(); } catch {}
          vidEl.hidden = true;
        }
      });
    }

    // Touch swipe inside Lightbox stage
    const lbStage = $("#lb-stage");
    if (lbStage) {
      let touchStartX = 0;
      lbStage.addEventListener(
        "touchstart",
        (e) => {
          touchStartX = e.touches?.[0]?.clientX || 0;
        },
        { passive: true }
      );
      lbStage.addEventListener(
        "touchend",
        (e) => {
          const endX = e.changedTouches?.[0]?.clientX || 0;
          const dx = endX - touchStartX;
          if (Math.abs(dx) > 48) {
            stepLightbox(dx > 0 ? -1 : 1);
          }
        },
        { passive: true }
      );
    }

    // Progressive Passkey Login
    async function handleBiometricLogin(btnEl) {
      const alertEl = $("#vault-login-alert");
      showAlert(alertEl, "");
      if (!window.HolaPasskey?.isSupported?.()) {
        showAlert(alertEl, "Thiết bị hoặc trình duyệt này chưa hỗ trợ đăng nhập nhanh. Bạn có thể đăng ký mới hoặc dùng Email bên dưới.");
        window.HolaVault?.revealFallback?.();
        return;
      }
      const labelEl = btnEl.querySelector("span") || btnEl;
      const prevText = labelEl.textContent;
      btnEl.disabled = true;
      labelEl.textContent = "Đang xác thực...";
      try {
        const res = await window.HolaPasskey.loginWithPasskey("");
        toast(`Chào mừng ${res.user.name}.`, "success");
        await enterMediaShell(res.user);
      } catch (err) {
        showAlert(
          alertEl,
          err?.message || "Đăng nhập không thành công. Nếu bạn là thành viên mới, hãy chọn Đăng ký bên dưới."
        );
        window.HolaVault?.revealFallback?.();
      } finally {
        btnEl.disabled = false;
        labelEl.textContent = prevText;
      }
    }

    $("#btn-vault-login")?.addEventListener("click", (e) => handleBiometricLogin(e.currentTarget));

    $("#media-gate-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const alertEl = $("#mg-alert");
      const btn = $("#mg-submit");
      showAlert(alertEl, "");
      const gateToken = window.HolaVault?.getGateToken?.() || "";
      if (!gateToken) {
        showAlert(alertEl, "Phiên mã cổng đã hết hạn. Vui lòng nhập lại mã cổng.");
        window.HolaVault?.reset?.();
        return;
      }
      btn.disabled = true;
      btn.textContent = "Đang tạo hồ sơ...";
      try {
        const res = await apiFetch("/api/auth/media-gate", {
          method: "POST",
          json: {
            gateToken,
            fullName: $("#mg-name").value.trim(),
            phone: $("#mg-phone").value.trim(),
            department: $("#mg-dept").value.trim(),
            email: $("#mg-email").value.trim(),
            password: $("#mg-password")?.value || "",
          },
        });
        if ($("#mg-password")) $("#mg-password").value = "";
        toast(`Chào mừng ${res.user.name}.`, "success");
        if (res.requiresPasskeySetup && window.HolaPasskey?.isSupported?.()) {
          try {
            await window.HolaPasskey.registerPasskey();
            res.user.hasPasskey = true;
            toast("Đã kích hoạt Face ID / Touch ID thành công.", "success");
          } catch {
            toast("Bạn có thể gắn Face ID / Vân tay trong menu tài khoản bất cứ lúc nào.", "info");
          }
        }
        await enterMediaShell(res.user);
      } catch (err) {
        const detail = err?.data?.error?.fields ? Object.values(err.data.error.fields).join(" ") : err.message;
        showAlert(alertEl, detail || "Đăng ký thất bại.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Hoàn tất đăng ký & Bật Face ID";
      }
    });

    $("#btn-setup-passkey")?.addEventListener("click", async () => {
      closeAllMenus();
      const btn = $("#btn-setup-passkey");
      btn.disabled = true;
      try {
        await window.HolaPasskey.registerPasskey();
        if (state.user) state.user.hasPasskey = true;
        btn.hidden = true;
        toast("Đã gắn Face ID / Touch ID cho thiết bị này.", "success");
      } catch (err) {
        toast(err.message || "Chưa thể gắn sinh trắc học.", "error");
      } finally {
        btn.disabled = false;
      }
    });

    $("#login-form")?.addEventListener("submit", async (e) => {
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
        toast(`Chào mừng ${res.user.name}.`, "success");
        await enterMediaShell(res.user);
      } catch (err) {
        showAlert(alertEl, err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Đăng nhập vào kho ảnh";
      }
    });

    // Logout
    $("#btn-logout")?.addEventListener("click", async () => {
      closeAllMenus();
      try {
        await apiFetch("/api/auth/logout", { method: "POST" });
      } catch {
        // ignore
      }
      state.user = null;
      showAuthScreen();
      toast("Đã đăng xuất.", "info");
    });

    // Topbar Navigation
    $("#brand-home-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      showAlbumsListView(true);
    });

    $("#btn-back-albums")?.addEventListener("click", () => {
      state.uploadQueue = [];
      renderUploadQueue();
      showAlbumsListView(true);
    });

    $("#btn-new-album")?.addEventListener("click", () => openAlbumDialog(null));

    // Album Filters & Search
    $$("[data-album-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.albumFilter = chip.getAttribute("data-album-filter") || "all";
        $$("[data-album-filter]").forEach((c) => c.classList.toggle("is-active", c === chip));
        renderAlbumsGrid();
      });
    });

    $("#album-search")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderAlbumsGrid();
    });

    // Delegated clicks on Albums Grid
    $("#albums-grid")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-trigger-new-album]")) {
        openAlbumDialog(null);
        return;
      }
      const editBtn = e.target.closest("[data-edit-album]");
      if (editBtn) {
        e.stopPropagation();
        const album = state.albums.find((a) => a.id === editBtn.getAttribute("data-edit-album"));
        if (album) openAlbumDialog(album);
        return;
      }
      const openCard = e.target.closest("[data-open-album]");
      if (openCard) {
        openAlbumWorkspace(openCard.getAttribute("data-open-album"), true);
      }
    });

    $("#albums-grid")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const openCard = e.target.closest("[data-open-album]");
      if (openCard && !e.target.closest("button")) {
        e.preventDefault();
        openAlbumWorkspace(openCard.getAttribute("data-open-album"), true);
      }
    });

    // Workspace Album Edit / Delete
    $("#btn-edit-album")?.addEventListener("click", () => {
      if (state.activeAlbum) openAlbumDialog(state.activeAlbum);
    });

    $("#btn-delete-album")?.addEventListener("click", async () => {
      closeAllMenus();
      if (!state.activeAlbum) return;
      const ok = window.confirm(
        `Xóa Album "${state.activeAlbum.title}" và toàn bộ ${state.photos.length} ảnh bên trong? Hành động này không thể hoàn tác.`
      );
      if (!ok) return;
      try {
        await apiFetch(`/api/admin/albums/${encodeURIComponent(state.activeAlbum.id)}`, { method: "DELETE" });
        toast("Đã xóa Album và dọn sạch ảnh trên kho lưu trữ.", "success");
        await loadAlbums();
        showAlbumsListView(true);
      } catch (err) {
        toast(err.message, "error");
      }
    });

    // Save Album form
    $("#album-form")?.addEventListener("submit", async (e) => {
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
          await loadAlbums(true);
        } else {
          const res = await apiFetch("/api/admin/albums", {
            method: "POST",
            json: payload,
          });
          toast("Đã tạo Album mới. Bấm Tải ảnh để thêm hình.", "success");
          $("#album-dialog").close();
          await loadAlbums(true);
          await openAlbumWorkspace(res.item.id, true);
        }
      } catch (err) {
        showAlert(alertEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });

    // Upload Trigger + Full-Window Drag-and-Drop in Workspace
    const fileInput = $("#multi-file-input");
    const dropOverlay = $("#drop-overlay");
    let dragDepth = 0;

    $("#btn-upload-trigger")?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        enqueueFiles(fileInput.files);
        fileInput.value = "";
      }
    });

    window.addEventListener("dragenter", (e) => {
      if (!state.activeAlbum || !e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepth += 1;
      if (dropOverlay) dropOverlay.hidden = false;
    });
    window.addEventListener("dragover", (e) => {
      if (!state.activeAlbum || !e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
    });
    window.addEventListener("dragleave", (e) => {
      if (!state.activeAlbum) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 && dropOverlay) dropOverlay.hidden = true;
    });
    window.addEventListener("drop", (e) => {
      if (!state.activeAlbum) return;
      e.preventDefault();
      dragDepth = 0;
      if (dropOverlay) dropOverlay.hidden = true;
      if (e.dataTransfer?.files?.length) {
        enqueueFiles(e.dataTransfer.files);
      }
    });

    // Clipboard Image Paste (Ctrl+V / Cmd+V) directly into open Album Workspace
    window.addEventListener("paste", (e) => {
      if (!state.activeAlbum) return;
      const openDialog = document.querySelector("dialog[open]");
      if (openDialog) return;
      const cb = e.clipboardData;
      if (!cb) return;
      const pasted = [];
      for (const item of Array.from(cb.items || [])) {
        if (item.kind === "file" && /^image\//i.test(item.type || "")) {
          const f = item.getAsFile();
          if (f) pasted.push(f);
        }
      }
      if (!pasted.length) {
        for (const f of Array.from(cb.files || [])) {
          if (/^image\//i.test(f.type || "")) pasted.push(f);
        }
      }
      if (!pasted.length) return;
      e.preventDefault();
      enqueueFiles(pasted);
      toast(`Đã dán ${pasted.length} ảnh vào hàng đợi tải lên.`, "info");
    });

    $("#btn-retry-failed")?.addEventListener("click", () => {
      state.uploadQueue.forEach((item) => {
        if (item.status === "error") {
          item.status = "pending";
          item.error = "";
        }
      });
      renderUploadQueue();
      runUploadQueue();
    });

    $("#btn-clear-queue")?.addEventListener("click", () => {
      state.uploadQueue = [];
      renderUploadQueue();
    });

    // Photo Status Filter Tabs & Select Mode
    $$("[data-photo-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.photoFilter = btn.getAttribute("data-photo-filter") || "all";
        renderWorkspaceHeader();
        renderPhotosGrid();
      });
    });

    $("#btn-toggle-select")?.addEventListener("click", () => {
      state.selectMode = !state.selectMode;
      if (!state.selectMode) state.selectedIds.clear();
      renderWorkspaceHeader();
      renderPhotosGrid();
      updateBatchBar();
    });

    $("#btn-approve-all")?.addEventListener("click", () => {
      const pending = state.photos.filter((p) => p.approvalStatus === "pending");
      if (pending.length === 0) return;
      if (!window.confirm(`Duyệt và nén WebP toàn bộ ${pending.length} ảnh đang chờ duyệt lên web?`)) return;
      runBatchApprove(pending);
    });

    // Batch Bar Actions
    $("#btn-select-visible")?.addEventListener("click", () => {
      getFilteredPhotos().forEach((p) => state.selectedIds.add(p.id));
      renderPhotosGrid();
      updateBatchBar();
    });

    $("#btn-clear-select")?.addEventListener("click", () => {
      state.selectedIds.clear();
      state.selectMode = false;
      renderWorkspaceHeader();
      renderPhotosGrid();
      updateBatchBar();
    });

    $("#btn-batch-approve")?.addEventListener("click", () => {
      const targets = state.photos.filter(
        (p) => state.selectedIds.has(p.id) && (p.approvalStatus || "approved") !== "approved"
      );
      runBatchApprove(targets);
    });

    $("#btn-batch-unapprove")?.addEventListener("click", () => {
      const targets = state.photos.filter(
        (p) => state.selectedIds.has(p.id) && (p.approvalStatus || "approved") === "approved"
      );
      runBatchUnapprove(targets);
    });

    $("#btn-batch-delete")?.addEventListener("click", () => {
      const targets = state.photos.filter((p) => state.selectedIds.has(p.id));
      runBatchDelete(targets);
    });

    // Photos Grid Clicks (Check circle -> toggle select; Tile -> Lightbox or select)
    $("#ws-photos-grid")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-trigger-upload]")) {
        fileInput?.click();
        return;
      }
      const checkBtn = e.target.closest("[data-check-photo]");
      if (checkBtn) {
        e.stopPropagation();
        togglePhotoSelection(checkBtn.getAttribute("data-check-photo"));
        return;
      }
      const tile = e.target.closest("[data-photo-id]");
      if (!tile) return;
      const id = tile.getAttribute("data-photo-id");
      if (state.selectMode) {
        togglePhotoSelection(id);
      } else {
        openLightbox(id);
      }
    });

    // Lightbox Controls
    $("#lb-prev")?.addEventListener("click", () => stepLightbox(-1));
    $("#lb-next")?.addEventListener("click", () => stepLightbox(1));

    $("#lb-btn-approve")?.addEventListener("click", async () => {
      const photo = state.photos.find((p) => p.id === state.lightboxPhotoId);
      if (!photo) return;
      const btn = $("#lb-btn-approve");
      btn.disabled = true;
      btn.textContent = "Đang nén WebP...";
      try {
        const listBefore = getFilteredPhotos();
        const curIdx = listBefore.findIndex((p) => p.id === photo.id);
        const { bytes } = await approveSinglePhoto(photo);
        const kb = Math.max(1, Math.round(bytes / 1024));
        toast(`Đã duyệt & nén lên web (${kb} KB).`, "success");
        renderWorkspaceHeader();
        renderPhotosGrid();
        await loadAlbums(true);

        // If viewing 'pending' tab, smoothly advance to next pending photo
        if (state.photoFilter === "pending") {
          const remaining = getFilteredPhotos();
          if (remaining.length > 0) {
            state.lightboxPhotoId = remaining[Math.min(curIdx, remaining.length - 1)].id;
            renderLightbox();
          } else {
            await closeDialogSmooth($("#lightbox-dialog"));
          }
        } else {
          renderLightbox();
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "✓ Duyệt & nén lên web";
        toast(err.message || "Không thể duyệt ảnh lúc này.", "error");
      }
    });

    $("#lb-btn-unapprove")?.addEventListener("click", async () => {
      const photo = state.photos.find((p) => p.id === state.lightboxPhotoId);
      if (!photo) return;
      const btn = $("#lb-btn-unapprove");
      btn.disabled = true;
      try {
        const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}/approve`, {
          method: "POST",
          json: { action: "pending" },
        });
        const idx = state.photos.findIndex((p) => p.id === photo.id);
        if (idx !== -1) state.photos[idx] = res.item;
        renderWorkspaceHeader();
        renderPhotosGrid();
        renderLightbox();
        await loadAlbums(true);
        toast("Đã ẩn ảnh khỏi web công khai.", "info");
      } catch (err) {
        btn.disabled = false;
        toast(err.message || "Không thể ẩn ảnh.", "error");
      }
    });

    $("#lb-btn-featured")?.addEventListener("click", async () => {
      const photo = state.photos.find((p) => p.id === state.lightboxPhotoId);
      if (!photo) return;
      const btn = $("#lb-btn-featured");
      const nextVal = !photo.isFeaturedHome;
      btn.disabled = true;
      try {
        const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}`, {
          method: "PATCH",
          json: { isFeaturedHome: nextVal },
        });
        const idx = state.photos.findIndex((p) => p.id === photo.id);
        if (idx !== -1) state.photos[idx] = res.item;
        renderWorkspaceHeader();
        renderPhotosGrid();
        renderLightbox();
        await loadAlbums(true);
        toast(nextVal ? "Đã ghim ảnh lên Trang chủ." : "Đã bỏ ghim khỏi Trang chủ.", "success");
      } catch (err) {
        btn.disabled = false;
        toast(err.message, "error");
      }
    });

    $("#lb-btn-cover")?.addEventListener("click", async () => {
      const photo = state.photos.find((p) => p.id === state.lightboxPhotoId);
      if (!photo) return;
      const btn = $("#lb-btn-cover");
      btn.disabled = true;
      try {
        const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}`, {
          method: "PATCH",
          json: { setAsCover: true },
        });
        if (state.activeAlbum) {
          state.activeAlbum.coverUrl = res.item.webUrl || res.item.url;
        }
        renderPhotosGrid();
        renderLightbox();
        await loadAlbums(true);
        toast("Đã đặt làm ảnh bìa Album.", "success");
      } catch (err) {
        btn.disabled = false;
        toast(err.message, "error");
      }
    });

    $("#lb-btn-edit")?.addEventListener("click", () => {
      const photo = state.photos.find((p) => p.id === state.lightboxPhotoId);
      if (photo) openPhotoDialog(photo);
    });

    $("#lb-btn-ai-retouch")?.addEventListener("click", () => {
      const photo = state.photos.find((p) => p.id === state.lightboxPhotoId);
      if (photo) runAiRetouchGenerate(photo);
    });

    $("#ai-retouch-regen")?.addEventListener("click", () => {
      const photo = state.photos.find((p) => p.id === aiRetouchState.photoId);
      if (photo) runAiRetouchGenerate(photo);
    });

    $("#ai-retouch-grid")?.addEventListener("click", (e) => {
      const compareBtn = e.target.closest("[data-ai-compare]");
      if (compareBtn) {
        const idx = Number(compareBtn.getAttribute("data-ai-compare"));
        const variant = aiRetouchState.variants[idx];
        const img = document.querySelector(`[data-ai-preview-img="${idx}"]`);
        const badge = document.querySelector(`[data-ai-badge="${idx}"]`);
        if (!variant || !img) return;
        const showingOrig = compareBtn.getAttribute("data-showing-orig") === "1";
        if (showingOrig) {
          img.src = variant.dataUrl;
          compareBtn.setAttribute("data-showing-orig", "0");
          compareBtn.textContent = "So ảnh gốc";
          if (badge) badge.textContent = `Mẫu ${idx + 1}`;
        } else {
          img.src = aiRetouchState.originalUrl;
          compareBtn.setAttribute("data-showing-orig", "1");
          compareBtn.textContent = "Xem lại AI";
          if (badge) badge.textContent = "Ảnh gốc";
        }
        return;
      }
      const applyBtn = e.target.closest("[data-ai-apply]");
      if (applyBtn) {
        const idx = Number(applyBtn.getAttribute("data-ai-apply"));
        applyAiRetouchVariant(idx);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (
        $("#lightbox-dialog")?.open &&
        !$("#ai-retouch-dialog")?.open &&
        !$("#photo-dialog")?.open &&
        (e.key === "r" || e.key === "R") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        const btn = $("#lb-btn-ai-retouch");
        if (btn && !btn.hidden && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
      }
    });

    $("#lb-btn-delete")?.addEventListener("click", async () => {
      const photo = state.photos.find((p) => p.id === state.lightboxPhotoId);
      if (!photo) return;
      if (!window.confirm("Xóa ảnh này khỏi Album và kho lưu trữ?")) return;
      try {
        const listBefore = getFilteredPhotos();
        const curIdx = listBefore.findIndex((p) => p.id === photo.id);
        await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}`, { method: "DELETE" });
        state.photos = state.photos.filter((p) => p.id !== photo.id);
        state.selectedIds.delete(photo.id);
        if (state.activeAlbum && (state.activeAlbum.coverUrl === photo.url || state.activeAlbum.coverUrl === photo.webUrl)) {
          state.activeAlbum.coverUrl = state.photos[0]?.displayUrl || state.photos[0]?.url || "";
        }
        renderWorkspaceHeader();
        renderPhotosGrid();
        updateBatchBar();
        await loadAlbums(true);
        toast("Đã xóa ảnh.", "success");

        const remaining = getFilteredPhotos();
        if (remaining.length > 0) {
          state.lightboxPhotoId = remaining[Math.min(curIdx, remaining.length - 1)].id;
          renderLightbox();
        } else {
          await closeDialogSmooth($("#lightbox-dialog"));
        }
      } catch (err) {
        toast(err.message, "error");
      }
    });

    // Save Photo Metadata
    $("#photo-form")?.addEventListener("submit", async (e) => {
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
        renderWorkspaceHeader();
        renderPhotosGrid();
        if ($("#lightbox-dialog")?.open) renderLightbox();
        await loadAlbums(true);
        $("#photo-dialog").close();
        toast("Đã lưu chi tiết ảnh.", "success");
      } catch (err) {
        showAlert(alertEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });

    // Change Password
    $("#btn-open-pw")?.addEventListener("click", () => {
      closeAllMenus();
      $("#pw-form").reset();
      showAlert($("#pw-form-alert"), "");
      $("#pw-dialog").showModal();
      $("#pw-current").focus();
    });

    $("#pw-form")?.addEventListener("submit", async (e) => {
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
        toast("Đổi mật khẩu thành công.", "success");
      } catch (err) {
        showAlert(alertEl, err.message);
      }
    });

    // Close dialog buttons
    $$("[data-close-dialog]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dlg = btn.closest("dialog");
        if (dlg) closeDialogSmooth(dlg);
      });
    });
  }

  bindEvents();
  boot();
})();
