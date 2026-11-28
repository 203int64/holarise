(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ROLE_LABELS = {
    super_admin: "Quản trị chính",
    editor: "Ban Điều Phối",
    media: "Ban Hình Ảnh",
    ngv: "NGV · Cộng tác viên Media",
    media_viewer: "NGV · Cộng tác viên Media",
  };

  const UPLOAD_CONCURRENCY = 2;
  const RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB (multiple of 256 KB required by Google Drive)
  const DIRECT_RESUMABLE_IMAGE_THRESHOLD = 8 * 1024 * 1024;

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

  function isNgvRole() {
    return state.user?.role === "ngv" || state.user?.role === "media_viewer";
  }

  function canManageMedia() {
    return (
      state.user?.role === "super_admin" ||
      state.user?.role === "editor" ||
      state.user?.role === "media"
    );
  }

  function isVideoFile(file) {
    if (!file) return false;
    const t = String(file.type || "").toLowerCase();
    if (t.startsWith("video/")) return true;
    return /\.(mp4|mov|m4v|webm|3gp|mpeg|mpg)$/i.test(String(file.name || ""));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Không đọc được ảnh xem trước."));
      reader.readAsDataURL(blob);
    });
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
        resumableSupported: Boolean(info?.resumableSupported ?? info?.driveConfigured),
        storage: info?.storage || "media_kv",
      };
    } catch {
      state.mediaStorage = { driveConfigured: false, resumableSupported: false, storage: "media_kv" };
    }
    return state.mediaStorage;
  }

  /* =========================================================================
     Client-side Image Compression (Dual-Upload WebP + Fast Grid / Full Detail)
     ========================================================================= */
  function isDriveImageUrl(url) {
    const s = String(url || "").trim();
    return s.startsWith("/api/media/drive/") && !/[?&]kind=(?:video|audio)\b/i.test(s);
  }

  function formatCoverThumb(url, width = 480) {
    if (!url) return "";
    if (isDriveImageUrl(url)) {
      return `${String(url).split("?")[0]}?w=${width}`;
    }
    return url;
  }

  function getFastGridUrl(photo, width = 480) {
    if (!photo) return "";
    if (photo.webUrl) return photo.webUrl;
    if (isDriveImageUrl(photo.url)) {
      return `${String(photo.url).split("?")[0]}?w=${width}`;
    }
    return photo.displayUrl || photo.url || "";
  }

  function getFullDetailUrl(photo) {
    if (!photo) return "";
    if (String(photo.webMediaKey || "").startsWith("ai-") && photo.webUrl) {
      return photo.webUrl;
    }
    if (isDriveImageUrl(photo.url)) {
      return `${String(photo.url).split("?")[0]}?raw=1`;
    }
    return photo.displayUrl || photo.url || "";
  }

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
            (webpBlob) => {
              if (webpBlob && webpBlob.type === "image/webp" && webpBlob.size > 0) {
                resolve({ blob: webpBlob, ext: "webp" });
                return;
              }
              canvas.toBlob(
                (jpegBlob) => {
                  if (!jpegBlob) {
                    reject(new Error("Không thể nén ảnh trên trình duyệt."));
                    return;
                  }
                  resolve({ blob: jpegBlob, ext: "jpg" });
                },
                "image/jpeg",
                quality
              );
            },
            "image/webp",
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

  function isVideoPhotoItem(photo) {
    return (
      photo?.mediaType === "video" ||
      /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(photo?.url || ""))
    );
  }

  async function approveSinglePhoto(photo) {
    const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}/approve`, {
      method: "POST",
      json: { action: "approve" },
    });
    const idx = state.photos.findIndex((p) => p.id === photo.id);
    if (idx !== -1) state.photos[idx] = res.item;
    if (state.activeAlbum && !state.activeAlbum.coverUrl && !isVideoPhotoItem(res.item)) {
      state.activeAlbum.coverUrl = res.item.webUrl || res.item.url;
    }
    return { item: res.item, bytes: res.item?.sizeBytes || 0 };
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
      passkeyBtn.hidden = isNgvRole() || Boolean(user.hasPasskey) || !window.HolaPasskey?.isSupported?.();
    }
    const changePwBtn = $("#btn-open-pw");
    if (changePwBtn) changePwBtn.hidden = isNgvRole();

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
      } else if (status.mediaContributor || status.mediaViewer) {
        await enterMediaShell(status.mediaContributor || status.mediaViewer);
      } else {
        showAuthScreen();
      }
    } catch (err) {
      showAuthScreen();
      showAlert($("#pin-gate-alert"), err.message || "Không thể kết nối máy chủ.");
    }
  }

  /* =========================================================================
     VIEW 1: Albums Gallery
     ========================================================================= */
  function setTopbarMode(mode) {
    const inWorkspace = mode === "workspace";
    const canManage = canManageMedia();
    $("#brand-home-link").hidden = inWorkspace;
    $("#ws-nav-head").hidden = !inWorkspace;
    $("#btn-new-album").hidden = !canManage || inWorkspace;
    $("#btn-upload-trigger").hidden = !inWorkspace;
    $("#ws-more-menu").hidden = !inWorkspace;
    if ($("#btn-edit-album")) $("#btn-edit-album").hidden = !canManage;
    if ($("#btn-delete-album")) $("#btn-delete-album").hidden = !canManage;
    if ($("#ws-menu-danger-sep")) $("#ws-menu-danger-sep").hidden = !canManage;
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
        <p>${state.albums.length === 0 ? (canManageMedia() ? "Tạo Album sự kiện đầu tiên để tải ảnh & video gốc lên kho HolaRise." : "Hiện chưa có thư mục sự kiện nào được tạo bởi Quản trị.") : "Thử xóa bộ lọc hoặc từ khóa tìm kiếm."}</p>
        ${state.albums.length === 0 && canManageMedia() ? '<button class="btn btn--primary btn--sm" type="button" data-trigger-new-album>+ Tạo Album đầu tiên</button>' : ""}
      </div>`;
      return;
    }

    grid.innerHTML = list
      .map((a) => {
        const cornerPill =
          Number(a.approvedCount || 0) > 0
            ? `<span class="album-corner-pill album-corner-pill--public">${a.approvedCount} công khai</span>`
            : Number(a.pendingCount || 0) > 0
              ? `<span class="album-corner-pill album-corner-pill--pending">${a.pendingCount} nội bộ</span>`
              : a.status === "draft"
                ? '<span class="album-corner-pill album-corner-pill--draft">Nháp</span>'
                : "";
        const coverHtml = a.coverUrl
          ? `<img src="${esc(formatCoverThumb(a.coverUrl, 480))}" alt="${esc(a.title)}" loading="lazy" decoding="async">`
          : `<div class="album-card-cover--empty">Chưa có ảnh</div>`;
        const dateLabel = a.dateDisplay || a.eventDate || "Chưa ghi ngày";
        return `<article class="album-card" data-open-album="${esc(a.id)}" tabindex="0" role="button" aria-label="Mở album ${esc(a.title)}">
          <div class="album-card-cover">
            ${coverHtml}
            ${cornerPill}
            ${!canManageMedia() ? "" : `<button class="album-edit-btn" type="button" data-edit-album="${esc(a.id)}" aria-label="Sửa album ${esc(a.title)}" title="Sửa thông tin Album">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>`}
          </div>
          <div class="album-card-body">
            <h3 class="album-card-title">${esc(a.title)}</h3>
            <div class="album-card-meta">${esc(dateLabel)} · ${a.photoCount} tư liệu</div>
          </div>
        </article>`;
      })
      .join("");
  }

  /* =========================================================================
     VIEW 2: Photo-First Album Workspace
     ========================================================================= */
  function isContributionPhoto(p) {
    return (
      p?.sourceKind === "member_contribution" ||
      (Boolean(p?.contributorMemberId) && p?.sourceKind !== "ngv_upload")
    );
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
      state.photoFilter = "all";
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
    $("#ws-meta").textContent = `${a.dateDisplay || a.eventDate || "Hòa Lạc"} · ${total} tư liệu · ${approved} công khai · ${pending} nội bộ`;

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

    const selectBtn = $("#btn-toggle-select");
    if (selectBtn) {
      selectBtn.hidden = !canManageMedia() || total === 0;
      selectBtn.textContent = state.selectMode ? "Xong" : "Chọn nhiều";
      selectBtn.classList.toggle("btn--primary", state.selectMode);
      selectBtn.classList.toggle("btn--outline", !state.selectMode);
    }

    const modCopy = $("#ws-moderation-copy");
    if (modCopy) {
      modCopy.innerHTML = isNgvRole()
        ? "<strong>Kho tư liệu nội bộ · NGV</strong> · Tải ảnh &amp; video gốc không giới hạn để phục vụ dựng video, viết bài, phóng sự. Quản trị sẽ chủ động chọn những khung hình phù hợp để hiển thị công khai."
        : "<strong>Kho tư liệu nội bộ</strong> · Tệp tải lên được giữ an toàn trong kho cho đội làm video, bài viết, phóng sự. Chọn ảnh hoặc clip phù hợp rồi bấm <em>Hiển thị công khai</em> để đưa lên web.";
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
        <h3>Album chưa có ảnh hoặc video</h3>
        <p>Chạm vào đây hoặc kéo thả ảnh &amp; video gốc trực tiếp để tải lên (không giới hạn số lượng).</p>
        <span class="btn btn--primary btn--sm">+ Chọn ảnh &amp; video từ máy</span>
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
        if (status === "approved") {
          markers.push('<span class="tile-pill tile-pill--public">Công khai</span>');
        } else if (status === "pending") {
          markers.push('<span class="tile-pill tile-pill--pending">Nội bộ</span>');
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
        const mediaSrc = isVideo ? p.displayUrl || p.url : getFastGridUrl(p, 480);
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
      approveBtn.textContent = `Hiển thị công khai (${pendingInSelection.length})`;
    }
    if (unapproveBtn) {
      unapproveBtn.hidden = !isApproverRole() || pendingInSelection.length > 0 || approvedInSelection.length === 0;
      unapproveBtn.disabled = state.batchBusy;
      unapproveBtn.textContent = `Chỉ giữ trong kho (${approvedInSelection.length})`;
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
        summary.textContent = `Đang bật công khai: ${done}/${total}${failed ? ` · ${failed} lỗi` : ""}`;
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
      toast(`Đã bật hiển thị công khai ${done} tư liệu lên web.`, "success");
    } else {
      toast(`Đã bật công khai ${done}/${total} tư liệu (${failed} gặp lỗi).`, "error");
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
    toast(failed ? `Đã chuyển ${done} tư liệu về kho (${failed} lỗi).` : `Đã chuyển ${done} tư liệu về kho nội bộ.`, failed ? "error" : "info");
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

  let lightboxLoadSeq = 0;

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
    pill.textContent = isApproved ? "Công khai" : status === "rejected" ? "Đã ẩn" : "Nội bộ";
    pill.className = `lb-status-pill ${isApproved ? "lb-status-pill--approved" : "lb-status-pill--pending"}`;

    const dlBtn = $("#lb-btn-download");
    if (dlBtn) {
      const rawUrl = String(photo.url || photo.displayUrl || "").trim();
      const basePath = rawUrl.split("?")[0];
      dlBtn.href = basePath.startsWith("/api/media/drive/") ? `${basePath}?download=1` : rawUrl || "#";
      dlBtn.hidden = !rawUrl;
    }

    const isVideo =
      String(photo.mediaType || "image").toLowerCase() === "video" ||
      /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(photo.displayUrl || photo.url || ""));
    const imgEl = $("#lb-img");
    const vidEl = $("#lb-video");
    const loadSeq = ++lightboxLoadSeq;
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
      const previewSrc = getFastGridUrl(photo, 480);
      const fullSrc = getFullDetailUrl(photo);
      imgEl.src = previewSrc || fullSrc;
      imgEl.alt = photo.caption || photo.alt || state.activeAlbum?.title || "Ảnh sự kiện";
      if (fullSrc && fullSrc !== previewSrc) {
        const hi = new Image();
        hi.onload = () => {
          if (loadSeq === lightboxLoadSeq && !imgEl.hidden) {
            imgEl.src = fullSrc;
          }
        };
        hi.src = fullSrc;
      }
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
    $("#lb-btn-approve").textContent = "Hiển thị công khai";

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
    coverBtn.hidden = !canManageMedia() || !isApproved || Boolean(isCover);
    coverBtn.disabled = false;

    const editBtn = $("#lb-btn-edit");
    if (editBtn) editBtn.hidden = !canManageMedia();
    const delBtn = $("#lb-btn-delete");
    if (delBtn) delBtn.hidden = !canManageMedia();

    const aiBtn = $("#lb-btn-ai-retouch");
    if (aiBtn) {
      const isVideo = String(photo.mediaType || "image").toLowerCase() === "video";
      aiBtn.hidden = isVideo || !canManageMedia();
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
    imageSize: "2K",
    aspectRatio: "auto",
  };
  let cachedBrandLogoPromise = null;

  function loadBrandLogoImage() {
    if (!cachedBrandLogoPromise) {
      cachedBrandLogoPromise = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = "/assets/images/logo-holarise.png";
      });
    }
    return cachedBrandLogoPromise;
  }

  function getAiBrandOptions() {
    return {
      providerSlot: $("#ai-opt-key")?.value || "auto",
      imageSize: $("#ai-opt-size")?.value || "2K",
      aspectRatio: $("#ai-opt-ratio")?.value || "auto",
      showLogo: Boolean($("#ai-opt-logo")?.checked),
      slogan: String($("#ai-opt-slogan")?.value || "").trim(),
    };
  }

  function populateAiKeySlots(slots) {
    const sel = $("#ai-opt-key");
    if (!sel || !Array.isArray(slots)) return;
    const prev = sel.value || "auto";
    const countLabel = slots.length > 1 ? `Tự động xoay vòng (${slots.length} key)` : `Tự động (${slots.length} key)`;
    sel.innerHTML = [
      `<option value="auto">${esc(countLabel)}</option>`,
      ...slots.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`),
    ].join("");
    if ([...sel.options].some((o) => o.value === prev)) {
      sel.value = prev;
    }
  }

  async function composeBrandedImage(sourceUrl, { showLogo = false, slogan = "", maxDim = 0, quality = 0.9 } = {}) {
    const res = await fetch(sourceUrl, { credentials: "same-origin" });
    if (!res.ok) throw new Error("Không tải được dữ liệu ảnh.");
    const blob = await res.blob();
    const bitmapUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Không thể đọc định dạng ảnh này."));
        el.src = bitmapUrl;
      });
      const natW = img.naturalWidth || 1;
      const natH = img.naturalHeight || 1;
      const scale = maxDim > 0 ? Math.min(1, maxDim / Math.max(natW, natH)) : 1;
      const w = Math.max(1, Math.round(natW * scale));
      const h = Math.max(1, Math.round(natH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      const cleanSlogan = String(slogan || "").trim();
      if (showLogo || cleanSlogan) {
        const shortEdge = Math.min(w, h);
        const padX = Math.round(w * 0.032);
        const padY = Math.round(h * 0.03);
        const scrimH = Math.round(Math.max(h * 0.14, shortEdge * 0.13));
        const grad = ctx.createLinearGradient(0, h - scrimH, 0, h);
        grad.addColorStop(0, "rgba(11, 17, 15, 0)");
        grad.addColorStop(1, "rgba(11, 17, 15, 0.62)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, h - scrimH, w, scrimH);

        let logoDrawnWidth = 0;
        if (showLogo) {
          const logoImg = await loadBrandLogoImage();
          if (logoImg && logoImg.naturalWidth > 0 && logoImg.naturalHeight > 0) {
            const targetH = Math.max(20, Math.round(shortEdge * 0.048));
            const targetW = Math.round((logoImg.naturalWidth / logoImg.naturalHeight) * targetH);
            ctx.save();
            ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
            ctx.shadowBlur = Math.max(4, Math.round(targetH * 0.2));
            ctx.drawImage(logoImg, padX, h - padY - targetH, targetW, targetH);
            ctx.restore();
            logoDrawnWidth = targetW;
          }
        }

        if (cleanSlogan) {
          const fontSize = Math.max(13, Math.round(shortEdge * 0.025));
          ctx.save();
          ctx.font = `600 ${fontSize}px "Be Vietnam Pro", system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
          ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
          ctx.shadowBlur = Math.max(4, Math.round(fontSize * 0.35));
          ctx.textBaseline = "bottom";
          const maxTextW = Math.max(120, w - padX * 2 - (logoDrawnWidth ? logoDrawnWidth + Math.round(w * 0.03) : 0));
          ctx.textAlign = showLogo ? "right" : "left";
          const textX = showLogo ? w - padX : padX;
          ctx.fillText(cleanSlogan, textX, h - padY - Math.round(fontSize * 0.12), maxTextW);
          ctx.restore();
        }
      }

      return { dataUrl: canvas.toDataURL("image/jpeg", quality), width: w, height: h };
    } finally {
      URL.revokeObjectURL(bitmapUrl);
    }
  }

  async function compressImageUrlToDataUrl(url, maxDim = 1280, quality = 0.88) {
    const out = await composeBrandedImage(url, { showLogo: false, slogan: "", maxDim, quality });
    return out.dataUrl;
  }

  async function refreshAiBrandedPreviews() {
    if (!aiRetouchState.variants.length) return;
    const { showLogo, slogan } = getAiBrandOptions();
    await Promise.all(
      aiRetouchState.variants.map(async (v, idx) => {
        const img = document.querySelector(`[data-ai-preview-img="${idx}"]`);
        const cmpBtn = document.querySelector(`[data-ai-compare="${idx}"]`);
        if (!img || cmpBtn?.getAttribute("data-showing-orig") === "1") return;
        if (!showLogo && !slogan) {
          v.previewUrl = v.dataUrl;
          img.src = v.dataUrl;
          return;
        }
        try {
          const out = await composeBrandedImage(v.dataUrl, { showLogo, slogan, maxDim: 960, quality: 0.88 });
          v.previewUrl = out.dataUrl;
          img.src = out.dataUrl;
        } catch {
          v.previewUrl = v.dataUrl;
          img.src = v.dataUrl;
        }
      })
    );
  }

  function renderAiRetouchSkeleton(count = 3) {
    const grid = $("#ai-retouch-grid");
    if (!grid) return;
    const labels = [
      ["Mẫu 1 · Phim ấm Hòa Lạc", "Kodak Portra 400 · Đang chỉnh ánh sáng & màu gỗ ấm..."],
      ["Mẫu 2 · Sáng trong tự nhiên", "Leica Natural · Đang cân bằng trắng & khử chói..."],
      ["Mẫu 3 · Điện ảnh trầm sâu", "Classic Chrome · Đang tạo chiều sâu vùng tối..."],
    ].slice(0, count);
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
        (v, idx) => {
          const is4k = String(v.imageSize || aiRetouchState.imageSize).toUpperCase() === "4K";
          const sizeTag = v.imageSize || aiRetouchState.imageSize || "2K";
          const ratioTag = v.aspectRatio && v.aspectRatio !== "auto" ? ` · ${v.aspectRatio}` : "";
          return `
        <article class="ai-variant-card" data-ai-variant-idx="${idx}">
          <div class="ai-variant-frame">
            <img src="${esc(v.previewUrl || v.dataUrl)}" alt="${esc(v.label)}" data-ai-preview-img="${idx}">
            <span class="ai-variant-badge" data-ai-badge="${idx}">Mẫu ${idx + 1} · ${esc(sizeTag)}${esc(ratioTag)}</span>
          </div>
          <div class="ai-variant-info">
            <strong>${esc(v.label)}</strong>
            <span>${esc(v.subtitle || "")}</span>
          </div>
          <div class="ai-variant-actions">
            <button class="btn btn--outline btn--sm" type="button" data-ai-compare="${idx}">So ảnh gốc</button>
            <button class="btn btn--outline btn--sm" type="button" data-ai-download="${idx}">Tải ${esc(sizeTag)}</button>
            ${!is4k ? `<button class="btn btn--outline btn--sm" type="button" data-ai-upscale4k="${idx}">✦ Xuất 4K</button>` : ""}
            <button class="btn btn--primary btn--sm" type="button" data-ai-apply="${idx}">Chọn thay thế</button>
          </div>
        </article>`;
        }
      )
      .join("");
    refreshAiBrandedPreviews();
  }

  let aiDefaultsSynced = false;

  async function syncAiDefaultsFromServer(photoId) {
    if (aiDefaultsSynced || !photoId) return;
    try {
      const cfg = await apiFetch(`/api/admin/photos/${encodeURIComponent(photoId)}/ai-retouch`);
      if (Array.isArray(cfg.slots)) populateAiKeySlots(cfg.slots);
      if (cfg.defaultImageSize && $("#ai-opt-size")) $("#ai-opt-size").value = cfg.defaultImageSize;
      if (cfg.defaultAspectRatio && $("#ai-opt-ratio")) $("#ai-opt-ratio").value = cfg.defaultAspectRatio;
      if (typeof cfg.defaultSlogan === "string" && $("#ai-opt-slogan")) $("#ai-opt-slogan").value = cfg.defaultSlogan;
      aiDefaultsSynced = true;
    } catch {
      // Non-fatal: keep local defaults
    }
  }

  async function runAiRetouchGenerate(photo, { presetId = "", forceSize = "" } = {}) {
    if (!photo || aiRetouchState.busy) return;
    await syncAiDefaultsFromServer(photo.id);
    const dlg = $("#ai-retouch-dialog");
    const alertEl = $("#ai-retouch-alert");
    const statusEl = $("#ai-retouch-status");
    const regenBtn = $("#ai-retouch-regen");
    const origImg = $("#ai-retouch-orig-img");
    const opts = getAiBrandOptions();
    const imageSize = forceSize || opts.imageSize || "2K";
    const aspectRatio = opts.aspectRatio || "auto";
    const isSingle4k = imageSize === "4K" || Boolean(presetId);

    aiRetouchState = {
      photoId: photo.id,
      originalUrl: photo.displayUrl || photo.url,
      busy: true,
      variants: [],
      imageSize,
      aspectRatio,
    };
    if (origImg) origImg.src = aiRetouchState.originalUrl;
    if (alertEl) showAlert(alertEl, "");
    if (statusEl) {
      statusEl.textContent =
        imageSize === "4K"
          ? `Đang xuất bản sắc nét 4K (${aspectRatio === "auto" ? "giữ tỉ lệ gốc" : aspectRatio}) — mất khoảng 15–35 giây...`
          : `Đang tạo 3 mẫu màu phim ${imageSize} (${aspectRatio === "auto" ? "giữ tỉ lệ gốc" : aspectRatio})...`;
    }
    if (regenBtn) regenBtn.disabled = true;
    renderAiRetouchSkeleton(isSingle4k ? 1 : 3);
    if (dlg && !dlg.open) dlg.showModal();

    try {
      const sourceDataUrl = await compressImageUrlToDataUrl(aiRetouchState.originalUrl, 1280, 0.88);
      const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photo.id)}/ai-retouch`, {
        method: "POST",
        json: {
          action: "generate",
          imageDataUrl: sourceDataUrl,
          imageSize,
          aspectRatio,
          presetId,
          providerSlot: opts.providerSlot || "auto",
        },
      });
      if (Array.isArray(res.slots)) populateAiKeySlots(res.slots);
      aiRetouchState.variants = Array.isArray(res.variants) ? res.variants : [];
      aiRetouchState.imageSize = res.imageSize || imageSize;
      aiRetouchState.aspectRatio = res.aspectRatio || aspectRatio;
      if (statusEl) {
        const keyNote = res.keyCount > 1 ? ` · Pool ${res.keyCount} key` : "";
        statusEl.textContent = `Đã tạo xong ${aiRetouchState.variants.length} mẫu (${aiRetouchState.imageSize}${keyNote}). Bật/tắt Logo & Slogan bên dưới để xem trực tiếp không tốn API.`;
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

  async function downloadAiRetouchVariant(idx) {
    const variant = aiRetouchState.variants[idx];
    if (!variant) return;
    const { showLogo, slogan } = getAiBrandOptions();
    const out = await composeBrandedImage(variant.dataUrl, { showLogo, slogan, maxDim: 0, quality: 0.94 });
    const a = document.createElement("a");
    a.href = out.dataUrl;
    const sizeTag = String(variant.imageSize || aiRetouchState.imageSize || "2K").toLowerCase();
    a.download = `holarise_${variant.id}_${sizeTag}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function applyAiRetouchVariant(idx) {
    const variant = aiRetouchState.variants[idx];
    if (!variant || aiRetouchState.busy) return;
    const photoId = aiRetouchState.photoId;
    const btn = document.querySelector(`[data-ai-apply="${idx}"]`);
    const statusEl = $("#ai-retouch-status");
    const alertEl = $("#ai-retouch-alert");
    const { showLogo, slogan } = getAiBrandOptions();
    const is4k = String(variant.imageSize || aiRetouchState.imageSize).toUpperCase() === "4K";

    aiRetouchState.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = is4k ? "Đang lưu Web & 4K Drive..." : "Đang lưu thay thế...";
    }
    if (alertEl) showAlert(alertEl, "");

    try {
      // Web display copy <= 1280px with Logo/Slogan composited cleanly
      const webOut = await composeBrandedImage(variant.dataUrl, { showLogo, slogan, maxDim: 1280, quality: 0.88 });
      const payload = {
        action: "apply",
        presetId: variant.id,
        imageDataUrl: webOut.dataUrl,
      };
      if (is4k) {
        const hiOut = await composeBrandedImage(variant.dataUrl, { showLogo, slogan, maxDim: 0, quality: 0.92 });
        payload.highResDataUrl = hiOut.dataUrl;
      }
      const res = await apiFetch(`/api/admin/photos/${encodeURIComponent(photoId)}/ai-retouch`, {
        method: "POST",
        json: payload,
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
        res.driveExportUrl
          ? `Đã thay ảnh "${variant.label}" & lưu bản 4K lên Google Drive.`
          : res.preservedDriveOriginal
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
     Unlimited Multi-Image & Large Video Upload Queue (Concurrency = 2 + Drive Resumable)
     ========================================================================= */
  function enqueueFiles(fileList) {
    if (!state.activeAlbum) return;
    const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
    if (files.length === 0) return;

    const items = files.map((file, idx) => ({
      uid: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      name: file.name || (isVideoFile(file) ? `video-${idx + 1}.mp4` : `anh-${idx + 1}.jpg`),
      status: "pending",
      progress: 0,
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
    const activePartial = state.uploadQueue
      .filter((i) => i.status === "uploading")
      .reduce((sum, i) => sum + Math.max(0, Math.min(99, Number(i.progress || 0))) / 100, 0);
    const pct = Math.min(100, Math.round(((done + failed + activePartial) / Math.max(1, total)) * 100));
    if (fill) fill.style.width = `${pct}%`;

    $("#upload-queue-summary").textContent = state.uploading
      ? `Đang tải lên: ${done}/${total} tệp (${pct}%)${failed ? ` · ${failed} lỗi` : ""}`
      : `Hoàn tất: ${done}/${total} tệp${failed ? ` · ${failed} lỗi` : ""}`;

    $("#btn-retry-failed").hidden = state.uploading || failed === 0;
    $("#btn-clear-queue").hidden = state.uploading;

    const statusText = {
      pending: "Chờ...",
      compressing: "Đang xử lý...",
      uploading: "Đang tải...",
      done: "Xong ✓",
      error: "Lỗi",
    };

    list.innerHTML = state.uploadQueue
      .map((item) => {
        const label =
          item.status === "error"
            ? item.error || "Lỗi"
            : item.status === "uploading" && item.progress > 0
              ? `Đang tải ${item.progress}%`
              : statusText[item.status];
        return `<div class="queue-item queue-item--${esc(item.status)}">
          <span class="queue-item-name" title="${esc(item.name)}">${esc(item.name)}</span>
          <span class="queue-item-status">${esc(label)}</span>
        </div>`;
      })
      .join("");
  }

  async function uploadFileDirectResumable(item, { folderName, isVid, webPreview }) {
    const file = item.file;
    const mimeType =
      String(file.type || "").toLowerCase() || (isVid ? "video/mp4" : "image/jpeg");
    const init = await apiFetch("/api/admin/media", {
      method: "POST",
      json: {
        action: "init-resumable",
        filename: item.name || (isVid ? "video.mp4" : "photo.jpg"),
        mimeType,
        fileSize: file.size,
        category: "album",
        subfolder: folderName,
      },
    });
    const uploadUrl = init?.uploadUrl;
    if (!uploadUrl) {
      throw new Error("Không lấy được phiên tải Google Drive.");
    }

    const total = file.size;
    let offset = 0;
    let driveData = null;

    while (offset < total) {
      const end = Math.min(offset + RESUMABLE_CHUNK_BYTES, total);
      const chunk = file.slice(offset, end);
      let attempt = 0;
      let res = null;
      while (attempt < 3) {
        try {
          res = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": mimeType,
              "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
            },
            body: chunk,
          });
          if (res.status === 308 || res.ok) break;
          if (res.status >= 500 && attempt < 2) {
            attempt += 1;
            await new Promise((r) => setTimeout(r, 600 * attempt));
            continue;
          }
          break;
        } catch (netErr) {
          if (attempt < 2) {
            attempt += 1;
            await new Promise((r) => setTimeout(r, 700 * attempt));
            continue;
          }
          throw netErr;
        }
      }

      if (!res) {
        throw new Error("Mất kết nối khi đang tải lên Google Drive.");
      }

      if (res.status === 308) {
        const rangeHeader = res.headers.get("Range") || "";
        const m = rangeHeader.match(/bytes=0-(\d+)/i);
        offset = m ? Number(m[1]) + 1 : end;
        item.progress = Math.min(99, Math.round((offset / total) * 100));
        renderUploadQueue();
        continue;
      }

      if (res.ok) {
        driveData = await res.json().catch(() => null);
        item.progress = 99;
        renderUploadQueue();
        break;
      }

      const errText = await res.text().catch(() => "");
      throw new Error(`Google Drive từ chối tệp (HTTP ${res.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`);
    }

    const driveId = driveData?.id;
    if (!driveId) {
      throw new Error("Google Drive không trả mã tệp sau khi tải xong.");
    }

    let webThumbDataUrl = "";
    if (!isVid && webPreview?.blob) {
      try {
        webThumbDataUrl = await blobToDataUrl(webPreview.blob);
      } catch {
        webThumbDataUrl = "";
      }
    }

    return apiFetch("/api/admin/media", {
      method: "POST",
      json: {
        action: "finalize-resumable",
        driveId,
        filename: item.name,
        mimeType,
        webThumbDataUrl,
      },
    });
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
      let webPreview = null;

      if (!isVid) {
        item.status = "compressing";
        item.error = "";
        renderUploadQueue();
        if (!storageInfo.driveConfigured) {
          const compressed = await compressImageFile(item.file, 1280, 0.82);
          uploadPayload = compressed.blob;
          uploadFilename = item.name.replace(/\.[^.]+$/, "") + `.${compressed.ext}`;
        } else {
          try {
            const compressed = await compressImageFile(item.file, 1280, 0.82);
            if (compressed?.blob && compressed.blob.size > 0 && compressed.blob.size <= 1.45 * 1024 * 1024) {
              webPreview = compressed;
            }
          } catch {
            // Best-effort: Drive thumbnail proxy handles display resizing
          }
        }
      }

      item.status = "uploading";
      item.progress = 0;
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

      let uploaded = null;
      const shouldUseDirectResumable =
        storageInfo.driveConfigured &&
        storageInfo.resumableSupported &&
        (isVid || item.file.size > DIRECT_RESUMABLE_IMAGE_THRESHOLD);

      if (shouldUseDirectResumable) {
        try {
          uploaded = await uploadFileDirectResumable(item, { folderName, isVid, webPreview });
        } catch (directErr) {
          const proxyCap = isVid ? 48 * 1024 * 1024 : 24 * 1024 * 1024;
          if (item.file.size > proxyCap) {
            throw directErr;
          }
          // Fallback to Worker proxy for moderate files if browser/WebView blocked direct Drive CORS
          item.progress = 0;
          renderUploadQueue();
        }
      }

      if (!uploaded) {
        const fd = new FormData();
        fd.append("file", uploadPayload, uploadFilename);
        if (webPreview) {
          fd.append("webFile", webPreview.blob, `web.${webPreview.ext}`);
        }
        fd.append("category", "album");
        fd.append("subfolder", folderName);
        uploaded = await apiFetch("/api/admin/media", { method: "POST", body: fd });
      }

      const attached = await apiFetch(`/api/admin/albums/${encodeURIComponent(albumId)}/photos`, {
        method: "POST",
        json: {
          url: uploaded.url,
          mediaKey: uploaded.id,
          webUrl: uploaded.webUrl || "",
          webMediaKey: uploaded.webMediaKey || "",
          mediaType: uploaded.mediaType || (isVid ? "video" : "image"),
          caption: "",
          alt: state.activeAlbum.title,
          photographer,
          isFeaturedHome: false,
          approvalStatus: "pending",
        },
      });

      item.status = "done";
      item.progress = 100;
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
    $("#pf-preview").src = getFastGridUrl(photo, 480);
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
      const gateToken = window.HolaVault?.getGateToken?.() || "";
      if (!gateToken) {
        showAlert(alertEl, "Phiên mã cổng đã hết hạn. Vui lòng nhập lại mã cổng.");
        window.HolaVault?.reset?.();
        return;
      }
      btn.disabled = true;
      btn.textContent = "Đang đăng nhập...";
      try {
        const res = await apiFetch("/api/auth/media-login", {
          method: "POST",
          json: {
            gateToken,
            identifier: $("#login-email").value.trim(),
            password: $("#login-password").value,
          },
        });
        $("#login-password").value = "";
        toast(`Chào mừng ${res.user.name}.`, "success");
        await enterMediaShell(res.user);
      } catch (err) {
        if (err?.data?.error?.code === "GATE_EXPIRED") {
          window.HolaVault?.reset?.();
          showAlert($("#pin-gate-alert"), err.message);
        } else {
          showAlert(alertEl, err.message);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "Đăng nhập vào kho Media";
      }
    });

    // Logout (clears both Admin and NGV Member sessions)
    $("#btn-logout")?.addEventListener("click", async () => {
      closeAllMenus();
      try {
        await apiFetch("/api/auth/logout?scope=media", { method: "POST" });
      } catch {
        // ignore
      }
      state.user = null;
      state.mediaStorage = null;
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
      btn.textContent = "Đang bật công khai...";
      try {
        const listBefore = getFilteredPhotos();
        const curIdx = listBefore.findIndex((p) => p.id === photo.id);
        await approveSinglePhoto(photo);
        toast("Đã bật hiển thị công khai trên web!", "success");
        renderWorkspaceHeader();
        renderPhotosGrid();
        loadAlbums(true).catch(() => {});

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
        btn.textContent = "Hiển thị công khai";
        toast(err.message || "Không thể bật hiển thị công khai lúc này.", "error");
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
        toast("Đã chuyển về kho tư liệu nội bộ.", "info");
      } catch (err) {
        btn.disabled = false;
        toast(err.message || "Không thể chuyển về kho nội bộ.", "error");
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

    let aiSloganTimer = null;
    $("#ai-opt-logo")?.addEventListener("change", () => {
      refreshAiBrandedPreviews();
    });
    $("#ai-opt-slogan")?.addEventListener("input", () => {
      clearTimeout(aiSloganTimer);
      aiSloganTimer = setTimeout(() => refreshAiBrandedPreviews(), 180);
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
          img.src = variant.previewUrl || variant.dataUrl;
          compareBtn.setAttribute("data-showing-orig", "0");
          compareBtn.textContent = "So ảnh gốc";
          if (badge) badge.textContent = `Mẫu ${idx + 1} · ${variant.imageSize || aiRetouchState.imageSize}`;
        } else {
          img.src = aiRetouchState.originalUrl;
          compareBtn.setAttribute("data-showing-orig", "1");
          compareBtn.textContent = "Xem lại AI";
          if (badge) badge.textContent = "Ảnh gốc";
        }
        return;
      }
      const dlBtn = e.target.closest("[data-ai-download]");
      if (dlBtn) {
        const idx = Number(dlBtn.getAttribute("data-ai-download"));
        downloadAiRetouchVariant(idx);
        return;
      }
      const upBtn = e.target.closest("[data-ai-upscale4k]");
      if (upBtn) {
        const idx = Number(upBtn.getAttribute("data-ai-upscale4k"));
        const variant = aiRetouchState.variants[idx];
        const photo = state.photos.find((p) => p.id === aiRetouchState.photoId);
        if (variant && photo) {
          const sizeSel = $("#ai-opt-size");
          if (sizeSel) sizeSel.value = "4K";
          runAiRetouchGenerate(photo, { presetId: variant.id, forceSize: "4K" });
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
