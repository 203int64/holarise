/**
 * HolaRise CMS Admin Application (v2 — Unified Sole-Admin Console)
 * Vanilla ES6+, zero external dependencies, mobile-first.
 * Consolidates all CRUD, overview dashboard, 1-tap check-in, markdown live preview,
 * optional canvas cropper, Passkey setup, and accessible native <dialog> workflows.
 */
(function () {
  "use strict";

  const SITE_ORIGIN = "https://holarise.org";

  const state = {
    user: null,
    activeTab: "overview",
    commSubtab: "reflections",
    setSubtab: "visuals",
    overview: null,
    regFilter: { status: "", activity: "", source: "", q: "" },
    regOffset: 0,
    regTotal: 0,
    registrations: [],
    regCounts: { all: 0, new: 0, contacted: 0, attended: 0, cancelled: 0 },
    events: [],
    eventFilter: "all",
    eventSearch: "",
    posts: [],
    postFilter: "all",
    postSearch: "",
    reflections: [],
    refStatus: "pending",
    feedbacks: [],
    fbFilter: { status: "new", eventId: "", category: "" },
    members: [],
    memberSearch: "",
    partners: [],
    users: [],
    visuals: {},
    slugTouched: false,
    m360: { memberId: "", tab: "journey", data: null },
    evCmd: { eventId: "", tab: "attendees", search: "", data: null },
  };

  const TAB_TITLES = {
    overview: "Tổng quan",
    timeline: "Timeline & Tiến độ",
    tasks: "Nhiệm vụ & Phân công",
    team: "Đội ngũ, Quyền & Nhật ký",
    registrations: "Đơn đăng ký",
    events: "Lịch sự kiện",
    posts: "Bài viết",
    inbox: "Hộp thoại & Trao quyền",
    community: "Cộng đồng",
    settings: "Giao diện & Cài đặt",
  };

  const VISUAL_SLOTS = [
    { key: "hero", label: "Ảnh Hero Trang chủ", fallback: "/assets/images/hero-holarise-binh-minh.webp" },
    { key: "about", label: "Ảnh Trang Về HolaRise", fallback: "/assets/images/hero-holarise-binh-minh.webp" },
    { key: "holaheart", label: "Ảnh Đại diện HolaHeart", fallback: "/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg" },
    { key: "holagreen", label: "Ảnh Đại diện HolaGreen", fallback: "/assets/images/illustrations/holagreen/G03.jpg" },
    { key: "holaconnect", label: "Ảnh Đại diện HolaConnect", fallback: "/assets/images/illustrations/holaconnect/C04.jpg" },
  ];

  const PILLAR_LABEL = {
    holaheart: "HolaHeart",
    holagreen: "HolaGreen",
    holaconnect: "HolaConnect",
  };

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

  const VISIBILITY_LABEL = {
    public: "Công khai",
    members_only: "Chỉ Thành viên",
    attendees_only: "Người đã dự & được cấp",
    private: "Riêng tư (chỉ người được cấp)",
  };

  const STAGE_LABEL = {
    auto: "Tự động theo ngày",
    invite: "Ép giữ Thư mời",
    memory: "Ép Sân khấu Kỷ niệm",
  };

  const FB_CAT_LABEL = {
    "cai-thien": "Cần cải thiện",
    "dong-vien": "Lời động viên",
    "de-xuat": "Đề xuất chặng tới",
    khac: "Khác",
  };

  const FB_STATUS_LABEL = {
    new: "Mới",
    read: "Đã đọc",
    resolved: "Đã xử lý",
  };

  const EVENT_PRESETS = {
    holaheart: {
      type: "HolaHeart · Giá trị sống",
      time: "19:15 – 21:15",
      location: "Quán Cafe Mây Lang Thang, Hòa Lạc",
      fee: "Miễn phí tham dự · Tự túc đồ uống",
      seats: "Mở đăng ký · 30 chỗ",
      seatCapacity: 30,
      image: "/assets/images/events/holaheart-2026-11-15/06-group-dialogue.jpg",
      filters: ["biet-on", "tu-te"],
    },
    holagreen: {
      type: "HolaGreen · Sinh thái",
      time: "07:00 – 09:30",
      location: "Hồ Tân Xã, Hòa Lạc",
      fee: "Miễn phí",
      seats: "Mở đăng ký · 25 chỗ",
      seatCapacity: 25,
      image: "/assets/images/illustrations/holagreen/G03.jpg",
      filters: ["sach"],
    },
    holaconnect: {
      type: "HolaConnect · Phụng sự",
      time: "14:30 – 17:30",
      location: "Hòa Lạc – Xuân Mai",
      fee: "Miễn phí",
      seats: "Mở đăng ký · 25 chỗ",
      seatCapacity: 25,
      image: "/assets/images/illustrations/holaconnect/C04.jpg",
      filters: ["se-chia", "tu-te"],
    },
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
      return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  function formatKb(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function toast(message, kind = "default") {
    const stack = $("#toast-stack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = "toast" + (kind === "error" ? " toast--error" : kind === "success" ? " toast--success" : "");
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
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

  async function copyText(text, successMsg = "Đã sao chép vào bộ nhớ tạm.") {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMsg, "success");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(successMsg, "success");
    }
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
      showAuthScreen({ initialized: true });
      throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    }
    if (!res.ok || data.ok === false) {
      const msg = (data && data.error && data.error.message) || data?.message || `Lỗi máy chủ (HTTP ${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.code = data?.error?.code || "";
      err.fields = data?.error?.fields || null;
      throw err;
    }
    return data;
  }

  /* =========================================================================
     Native <dialog> Confirm / Prompt Helper (modern-web-guidance)
     ========================================================================= */
  function openConfirmDialog({
    title = "Xác nhận thao tác",
    message = "",
    confirmLabel = "Xác nhận",
    danger = false,
    inputLabel = "",
    inputType = "text",
    inputPlaceholder = "",
    inputValue = "",
    inputMinLength = 0,
  }) {
    const dialog = $("#confirm-dialog");
    if (!dialog) return Promise.resolve(inputLabel ? null : false);

    $("#confirm-dialog-title").textContent = title;
    $("#confirm-dialog-msg").textContent = message;
    const okBtn = $("#confirm-ok-btn");
    okBtn.textContent = confirmLabel;
    okBtn.className = `btn ${danger ? "btn--danger" : "btn--primary"}`;

    const inputWrap = $("#confirm-input-wrap");
    const inputEl = $("#confirm-input");
    const labelEl = $("#confirm-input-label");
    if (inputLabel) {
      inputWrap.hidden = false;
      labelEl.textContent = inputLabel;
      inputEl.type = inputType;
      inputEl.placeholder = inputPlaceholder;
      inputEl.value = inputValue;
      inputEl.required = true;
      inputEl.minLength = inputMinLength;
    } else {
      inputWrap.hidden = true;
      inputEl.required = false;
      inputEl.value = "";
    }

    return new Promise((resolve) => {
      const onClose = () => {
        const result = dialog.returnValue;
        dialog.returnValue = "";
        dialog.removeEventListener("close", onClose);
        if (result !== "confirm") {
          resolve(inputLabel ? null : false);
          return;
        }
        resolve(inputLabel ? inputEl.value.trim() : true);
      };
      dialog.addEventListener("close", onClose);
      dialog.showModal();
      if (inputLabel) {
        inputEl.focus();
      } else {
        $("#confirm-cancel-btn")?.focus();
      }
    });
  }

  /* =========================================================================
     Modern Web Guidance: ARIA Sync, Safari Light-Dismiss & Sub-tabs
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
    const isOutside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    $$("dialog.cms-dialog").forEach((dialog) => {
      if (!("closedBy" in HTMLDialogElement.prototype) && dialog.getAttribute("closedby") === "any") {
        let pressedOutside = false;
        dialog.addEventListener("pointerdown", (e) => {
          pressedOutside = isOutside(e, dialog);
        });
        dialog.addEventListener("pointerup", (e) => {
          if (pressedOutside && isOutside(e, dialog)) dialog.close();
          pressedOutside = false;
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
        const input = document.getElementById(btn.getAttribute("data-pw-toggle"));
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
     Unified Image Upload Pipeline & Optional <canvas> Cropper
     (Preserves Google Drive uncompressed originals & event subfolders!)
     ========================================================================= */
  let cachedMediaStorage = null;
  async function getMediaStorageInfo() {
    if (cachedMediaStorage) return cachedMediaStorage;
    try {
      const info = await api("/api/admin/media", { method: "GET" });
      cachedMediaStorage = {
        driveConfigured: Boolean(info?.driveConfigured),
        storage: info?.storage || "media_kv",
      };
    } catch {
      cachedMediaStorage = { driveConfigured: false, storage: "media_kv" };
    }
    return cachedMediaStorage;
  }

  async function compressImageToJpeg(file, maxWidth = 1280, quality = 0.84) {
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

    const webpBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (webpBlob && webpBlob.type === "image/webp" && webpBlob.size > 0) {
      return { blob: webpBlob, width, height, ext: "webp" };
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Không thể nén ảnh trên trình duyệt."))),
        "image/jpeg",
        quality
      );
    });
    return { blob, width, height, ext: "jpg" };
  }

  function detectUploadSubfolder(category) {
    if (category === "su-kien") {
      const title = ($("#ev-title")?.value || "")
        .replace(/[\\/:*?"<>|\r\n]+/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      const dateMatch = ($("#ev-date")?.value || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch && title) return `${dateMatch[1]} - ${title}`.slice(0, 120);
      if (title) return title.slice(0, 120);
    }
    return "";
  }

  async function uploadImageAsset({ file, category = "khac", forceBlob = false, maxWidth = 1280 }) {
    const storageInfo = await getMediaStorageInfo();
    const form = new FormData();
    form.append("category", category);
    const subfolder = detectUploadSubfolder(category);
    if (subfolder) form.append("subfolder", subfolder);

    if (storageInfo.driveConfigured) {
      form.append("file", file, file.name || (forceBlob ? "cropped.jpg" : "upload.jpg"));
      try {
        const { blob: webBlob, ext } = await compressImageToJpeg(file, maxWidth, 0.84);
        if (webBlob && webBlob.size > 0 && webBlob.size <= 1.45 * 1024 * 1024) {
          form.append("webFile", webBlob, `web.${ext || "webp"}`);
          form.append("preferWebUrl", "1");
        }
      } catch {
        // Best-effort: Drive thumbnail proxy will still resize on the fly
      }
    } else if (forceBlob) {
      form.append("file", file, file.name || "cropped.jpg");
    } else {
      const { blob, ext } = await compressImageToJpeg(file, maxWidth, 0.84);
      form.append("file", blob, `upload.${ext || "jpg"}`);
    }
    return api("/api/admin/media", { method: "POST", body: form });
  }

  function initImageUploaders() {
    $$("input[type='file'][data-upload-target]").forEach((fileInput) => {
      const targetId = fileInput.getAttribute("data-upload-target");
      const urlInput = document.getElementById(targetId);
      const previewImg = document.getElementById(fileInput.getAttribute("data-preview-target"));
      const metaEl = document.getElementById(fileInput.getAttribute("data-meta-target"));
      const category = fileInput.getAttribute("data-upload-category") || "khac";

      if (urlInput && previewImg) {
        urlInput.addEventListener("input", () => {
          const v = urlInput.value.trim();
          if (v.startsWith("/") || v.startsWith("https://")) previewImg.src = v;
        });
      }

      async function handleUploadFile(file) {
        if (!file) return;
        fileInput.disabled = true;
        if (metaEl) metaEl.textContent = "Đang tải ảnh lên...";
        try {
          const data = await uploadImageAsset({ file, category });
          if (urlInput) urlInput.value = data.url;
          if (previewImg) previewImg.src = data.url;
          if (metaEl) {
            metaEl.textContent =
              data.storage === "google_drive"
                ? `Đã lưu ảnh gốc lên Google Drive (${formatKb(data.size)} · không nén)`
                : `Đã tải lên: ${formatKb(file.size)} → ${formatKb(data.size)}`;
          }
          toast("Đã tải ảnh lên thành công.", "success");
        } catch (err) {
          if (metaEl) metaEl.textContent = `Lỗi tải ảnh: ${err.message}`;
          toast(err.message, "error");
        } finally {
          fileInput.disabled = false;
          fileInput.value = "";
        }
      }

      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        handleUploadFile(file);
      });

      const hostDialog = fileInput.closest("dialog");
      if (hostDialog && !hostDialog.dataset.pasteBound) {
        hostDialog.dataset.pasteBound = "1";
        hostDialog.addEventListener("paste", (e) => {
          const cb = e.clipboardData;
          if (!cb) return;
          let imgFile = null;
          for (const item of Array.from(cb.items || [])) {
            if (item.kind === "file" && /^image\//i.test(item.type || "")) {
              imgFile = item.getAsFile();
              break;
            }
          }
          if (!imgFile) {
            for (const f of Array.from(cb.files || [])) {
              if (/^image\//i.test(f.type || "")) {
                imgFile = f;
                break;
              }
            }
          }
          if (!imgFile) return;
          e.preventDefault();
          handleUploadFile(imgFile);
        });
      }
    });
  }

  /* Optional Native <canvas> Cropper */
  const cropState = {
    img: null,
    ratio: 16 / 9,
    rotation: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    targetInput: null,
    previewImg: null,
    metaEl: null,
    category: "giao-dien",
  };

  function drawCropCanvas() {
    const canvas = $("#crop-canvas");
    if (!canvas || !cropState.img) return;
    const img = cropState.img;
    const rotRad = (cropState.rotation * Math.PI) / 180;
    const swapped = cropState.rotation % 180 !== 0;
    const natW = swapped ? img.naturalHeight : img.naturalWidth;
    const natH = swapped ? img.naturalWidth : img.naturalHeight;
    const ratio = cropState.ratio > 0 ? cropState.ratio : natW / Math.max(1, natH);
    const outW = 960;
    const outH = Math.round(outW / ratio);
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, outW, outH);

    const coverScale = Math.max(outW / natW, outH / natH) * cropState.zoom;
    const drawW = img.naturalWidth * coverScale;
    const drawH = img.naturalHeight * coverScale;

    ctx.save();
    ctx.translate(outW / 2 + cropState.offsetX, outH / 2 + cropState.offsetY);
    ctx.rotate(rotRad);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo((outW / 3) * i, 0);
      ctx.lineTo((outW / 3) * i, outH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (outH / 3) * i);
      ctx.lineTo(outW, (outH / 3) * i);
      ctx.stroke();
    }
    ctx.restore();
  }

  function openCropper({ src, targetInput, previewImg, metaEl, category = "giao-dien", defaultRatio = 16 / 9 }) {
    const dialog = $("#image-crop-dialog");
    if (!dialog || !src) return;
    showAlert($("#crop-alert"), "");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      cropState.img = img;
      cropState.rotation = 0;
      cropState.zoom = 1;
      cropState.offsetX = 0;
      cropState.offsetY = 0;
      cropState.ratio = Number(defaultRatio) >= 0 ? Number(defaultRatio) : 16 / 9;
      cropState.targetInput = targetInput;
      cropState.previewImg = previewImg;
      cropState.metaEl = metaEl;
      cropState.category = category;
      if ($("#crop-zoom")) $("#crop-zoom").value = "1";
      $$("[data-crop-ratio]").forEach((b) => {
        const match = Math.abs(Number(b.dataset.cropRatio) - cropState.ratio) < 0.05;
        b.classList.toggle("btn--primary", match);
        b.classList.toggle("btn--outline", !match);
      });
      drawCropCanvas();
      dialog.showModal();
    };
    img.onerror = () => toast("Không thể mở ảnh này để căn khung (ảnh ngoài chưa bật CORS).", "error");
    img.src = src;
  }

  function initCropperControls() {
    const canvas = $("#crop-canvas");
    $$("[data-crop-ratio]").forEach((btn) => {
      btn.addEventListener("click", () => {
        cropState.ratio = Number(btn.dataset.cropRatio) || 0;
        cropState.offsetX = 0;
        cropState.offsetY = 0;
        $$("[data-crop-ratio]").forEach((b) => {
          b.classList.toggle("btn--primary", b === btn);
          b.classList.toggle("btn--outline", b !== btn);
        });
        drawCropCanvas();
      });
    });

    $("#crop-rotate-btn")?.addEventListener("click", () => {
      cropState.rotation = (cropState.rotation + 90) % 360;
      cropState.offsetX = 0;
      cropState.offsetY = 0;
      drawCropCanvas();
    });

    $("#crop-zoom")?.addEventListener("input", (e) => {
      cropState.zoom = Number(e.target.value) || 1;
      drawCropCanvas();
    });

    if (canvas) {
      canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        cropState.dragging = true;
        cropState.startX = e.clientX - cropState.offsetX;
        cropState.startY = e.clientY - cropState.offsetY;
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!cropState.dragging) return;
        cropState.offsetX = e.clientX - cropState.startX;
        cropState.offsetY = e.clientY - cropState.startY;
        drawCropCanvas();
      });
      const endDrag = () => {
        cropState.dragging = false;
      };
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
    }

    $("#crop-confirm-btn")?.addEventListener("click", async () => {
      const btn = $("#crop-confirm-btn");
      const alertEl = $("#crop-alert");
      if (!canvas || !cropState.img) return;
      btn.disabled = true;
      btn.textContent = "Đang cắt & tải lên...";
      showAlert(alertEl, "");
      try {
        const img = cropState.img;
        const swapped = cropState.rotation % 180 !== 0;
        const natW = swapped ? img.naturalHeight : img.naturalWidth;
        const natH = swapped ? img.naturalWidth : img.naturalHeight;
        const ratio = cropState.ratio > 0 ? cropState.ratio : natW / Math.max(1, natH);
        const exportW = Math.min(1280, Math.max(canvas.width, 1080));
        const exportH = Math.round(exportW / ratio);
        const scaleFactor = exportW / canvas.width;

        const outCanvas = document.createElement("canvas");
        outCanvas.width = exportW;
        outCanvas.height = exportH;
        const ctx = outCanvas.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, exportW, exportH);
        const coverScale = Math.max(exportW / natW, exportH / natH) * cropState.zoom;
        const drawW = img.naturalWidth * coverScale;
        const drawH = img.naturalHeight * coverScale;
        ctx.save();
        ctx.translate(exportW / 2 + cropState.offsetX * scaleFactor, exportH / 2 + cropState.offsetY * scaleFactor);
        ctx.rotate((cropState.rotation * Math.PI) / 180);
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();

        const blob = await new Promise((resolve) => outCanvas.toBlob(resolve, "image/jpeg", 0.92));
        if (!blob) throw new Error("Không thể xuất ảnh đã cắt.");

        const file = new File([blob], "cropped.jpg", { type: "image/jpeg" });
        const data = await uploadImageAsset({ file, category: cropState.category, forceBlob: true });
        if (cropState.targetInput) cropState.targetInput.value = data.url;
        if (cropState.previewImg) cropState.previewImg.src = data.url;
        if (cropState.metaEl) {
          cropState.metaEl.textContent = `Đã cắt khung (${exportW}×${exportH}px · ${formatKb(blob.size)}) và tải lên thành công.`;
        }
        toast("Đã cắt khung & tải ảnh lên!", "success");
        $("#image-crop-dialog")?.close();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Cắt & Tải ảnh lên";
      }
    });
  }

  /* =========================================================================
     State Renderers (Skeleton / Empty / Error)
     ========================================================================= */
  function renderSkeleton(container, count = 3) {
    if (!container) return;
    container.innerHTML = `<div class="skeleton-list">${Array.from({ length: count })
      .map(
        () =>
          `<div class="sk-row"><div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-line sk-short"></div></div>`
      )
      .join("")}</div>`;
  }

  function renderErrorState(container, msg, retryAction) {
    if (!container) return;
    container.innerHTML = `<div class="state-box">
      <h3>Không tải được dữ liệu</h3>
      <p>${esc(msg)}</p>
      <button class="btn btn--outline" type="button" data-retry="${esc(retryAction)}">Thử lại</button>
    </div>`;
  }

  function renderEmptyState(container, title, desc, ctaLabel = "", ctaAction = "") {
    if (!container) return;
    container.innerHTML = `<div class="state-box">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--ink-muted);" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="13" y2="13"/></svg>
      <h3>${esc(title)}</h3>
      <p>${esc(desc)}</p>
      ${ctaLabel ? `<button class="btn btn--primary" type="button" data-empty-cta="${esc(ctaAction)}">${esc(ctaLabel)}</button>` : ""}
    </div>`;
  }

  /* =========================================================================
     Auth Flow & Sole-Admin Shell Entry
     ========================================================================= */
  function showAuthScreen({ initialized = true, forbiddenMsg = "" } = {}) {
    $$("dialog[open]").forEach((d) => d.close());
    $("#boot-loader").hidden = true;
    $("#admin-shell").hidden = true;
    $("#auth-screen").hidden = false;

    const signinBox = $("#auth-signin-box");
    const forbiddenBox = $("#auth-forbidden-box");
    const bootForm = $("#bootstrap-form");

    signinBox.hidden = true;
    forbiddenBox.hidden = true;
    bootForm.hidden = true;

    if (forbiddenMsg) {
      forbiddenBox.hidden = false;
      $("#auth-forbidden-msg").textContent = forbiddenMsg;
    } else if (initialized) {
      signinBox.hidden = false;
      if (!window.HolaPasskey?.isSupported?.() && $("#btn-passkey-login")) {
        $("#btn-passkey-login").hidden = true;
      }
    } else {
      bootForm.hidden = false;
    }
  }

  function handleAuthenticatedUser(user, isSoleAdmin, statusPayload = {}) {
    if (!user) {
      showAuthScreen({ initialized: true });
      return;
    }
    const canonicalRole = user.canonicalRole || user.role;
    const canAccessManager =
      Boolean(isSoleAdmin) ||
      Boolean(statusPayload.canAccessManager) ||
      Boolean(user.canAccessManager) ||
      ["event_ops", "content_editor", "content_ctv", "media_manager", "editor"].includes(canonicalRole);

    if (!canAccessManager && (canonicalRole === "media" || canonicalRole === "media_ctv")) {
      window.location.replace("/media/");
      return;
    }
    if (!canAccessManager) {
      showAuthScreen({
        initialized: true,
        forbiddenMsg: `Tài khoản ${user.email} chưa được cấp quyền truy cập HolaRise Manager. Liên hệ Chủ nhiệm để kiểm tra vai trò.`,
      });
      return;
    }
    const perms = Array.isArray(statusPayload.permissions)
      ? statusPayload.permissions
      : Array.isArray(user.permissions)
        ? user.permissions
        : isSoleAdmin
          ? ["*"]
          : [];
    enterAdminShell(user, Boolean(isSoleAdmin), perms, statusPayload);
  }

  function enterAdminShell(user, isSoleAdmin = false, permissions = [], statusPayload = {}) {
    state.user = user;
    state.isSoleAdmin = Boolean(isSoleAdmin);
    state.permissions = permissions;
    $("#boot-loader").hidden = true;
    $("#auth-screen").hidden = true;
    $("#admin-shell").hidden = false;

    const roleDisplay = user.roleShortLabel || user.roleLabel || (isSoleAdmin ? "Chủ nhiệm" : user.role || "Thành viên Ban");
    $("#sidebar-user-name").textContent = user.name || "Thành viên Ban";
    $("#sidebar-user-meta").textContent = `${roleDisplay}${user.department ? ` · ${user.department}` : ""} · ${user.email}`;

    window.__holariseManager?.applyRoleShell(user, permissions, isSoleAdmin, statusPayload);

    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab");
    state.regFilter.status = params.get("status") || "";
    state.regFilter.activity = params.get("activity") || "";
    state.regFilter.source = params.get("source") || "";
    state.regFilter.q = params.get("q") || "";
    if ($("#reg-search")) $("#reg-search").value = state.regFilter.q;
    if ($("#reg-source-filter")) $("#reg-source-filter").value = state.regFilter.source;
    $$("[data-reg-status]").forEach((chip) => {
      chip.classList.toggle("is-active", (chip.getAttribute("data-reg-status") || "") === state.regFilter.status);
    });

    const safeInitialTab = window.__holariseManager
      ? window.__holariseManager.getFirstAllowedTab(TAB_TITLES[initialTab] ? initialTab : "overview")
      : TAB_TITLES[initialTab]
        ? initialTab
        : "overview";
    switchTab(safeInitialTab, false);
  }

  function syncUrlParams() {
    const params = new URLSearchParams();
    params.set("tab", state.activeTab);
    if (state.activeTab === "registrations") {
      if (state.regFilter.status) params.set("status", state.regFilter.status);
      if (state.regFilter.activity) params.set("activity", state.regFilter.activity);
      if (state.regFilter.source) params.set("source", state.regFilter.source);
      if (state.regFilter.q) params.set("q", state.regFilter.q);
    }
    history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function setBadgeCount(ids, count) {
    const n = Number(count || 0);
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = n <= 0;
      el.textContent = String(n);
    });
  }

  function switchTab(tab, updateUrl = true) {
    if (window.__holariseManager && !window.__holariseManager.canAccessTab(tab)) {
      tab = window.__holariseManager.getFirstAllowedTab("overview");
    }
    state.activeTab = tab;
    $$("[data-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === tab);
    });
    $$("[data-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== tab;
    });
    if ($("#mobile-page-title")) {
      $("#mobile-page-title").textContent = TAB_TITLES[tab] || "HolaRise Manager";
    }
    if (updateUrl) syncUrlParams();

    if (tab === "overview") loadOverview();
    else if (tab === "timeline") window.__holariseManager?.loadTimeline();
    else if (tab === "tasks") window.__holariseManager?.loadTasks();
    else if (tab === "team") window.__holariseManager?.loadTeamAndAudit();
    else if (tab === "registrations") loadRegistrations(false);
    else if (tab === "events") loadEvents();
    else if (tab === "posts") loadPosts();
    else if (tab === "inbox") window.__holariseAdminDesk?.open();
    else if (tab === "community") loadCommunity();
    else if (tab === "settings") loadSettings();
    if (tab !== "inbox") window.__holariseAdminDesk?.pause();
  }
  window.__holariseSwitchTab = switchTab;

  function switchSubtab(attr, panelAttr, value) {
    $$(`[${attr}]`).forEach((tabBtn) => {
      const active = tabBtn.getAttribute(attr) === value;
      tabBtn.setAttribute("aria-selected", String(active));
      if (active) {
        tabBtn.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    });
    $$(`[${panelAttr}]`).forEach((panel) => {
      panel.hidden = panel.getAttribute(panelAttr) !== value;
    });
  }

  /* =========================================================================
     TAB 0: OVERVIEW DASHBOARD
     ========================================================================= */
  async function loadOverview() {
    const box = $("#overview-container");
    renderSkeleton(box, 3);
    try {
      const data = await api("/api/admin/overview");
      state.overview = data;

      setBadgeCount(["badge-new-regs", "badge-new-regs-mobile"], data.registrations?.new || 0);
      setBadgeCount(["badge-pending-refs", "badge-pending-refs-mobile"], data.reflections?.pending || 0);
      setBadgeCount(["badge-pending-photos"], data.media?.pendingPhotoCount || 0);
      setBadgeCount(["badge-unread-chat"], data.chat?.unreadThreads || 0);
      setBadgeCount(["badge-open-tasks", "badge-open-tasks-mobile"], data.tasks?.open || 0);

      const mgr = window.__holariseManager;
      const can = (p) => (!mgr ? true : mgr.hasPerm(p));
      const isSuper = !mgr ? true : mgr.isEffectiveSuperAdmin();

      const newRegs = Number(data.registrations?.new || 0);
      const pendingRefs = Number(data.reflections?.pending || 0);
      const pendingPhotos = Number(data.media?.pendingPhotoCount || 0);
      const pendingPosts = Number(data.posts?.pending_review || 0);
      const openTasks = Number(data.tasks?.open || 0);
      const overdueTasks = Number(data.tasks?.overdue || 0);
      const upcomingEvents = data.events?.upcoming || [];
      const recentRegs = data.recentRegistrations || [];
      const integ = data.integrations || {};

      const upcomingHtml = upcomingEvents.length
        ? `<div class="overview-list">${upcomingEvents
            .map((ev) => {
              const booked = Number(ev.webBookedCount || 0) + Number(ev.externalBooked || 0);
              const seatText = ev.seatCapacity > 0 ? `${booked} / ${ev.seatCapacity} chỗ` : `${ev.webBookedCount || 0} đơn web`;
              const url = `${SITE_ORIGIN}/su-kien/${ev.slug || ev.id}/`;
              return `<div class="overview-row">
                <div class="overview-row-main">
                  <strong>${esc(ev.title)}</strong>
                  <span class="overview-row-sub">${esc(ev.dateDisplay || ev.date)} · ${esc(ev.time || "")} · ${esc(seatText)}</span>
                </div>
                <div class="btn-row">
                  ${can("events.write") ? `<button class="btn btn--primary btn--sm" type="button" data-event-command="${esc(ev.id)}">Điều hành</button>` : ""}
                  <button class="btn btn--outline btn--sm" type="button" data-copy-url="${esc(url)}">Copy link</button>
                </div>
              </div>`;
            })
            .join("")}</div>`
        : `<p class="page-sub">Chưa có sự kiện sắp diễn ra nào đang công khai.</p>`;

      const recentRegsHtml = recentRegs.length
        ? `<div class="overview-list">${recentRegs
            .map((r) => {
              const digits = String(r.phone || "").replace(/\D/g, "");
              return `<div class="overview-row">
                <div class="overview-row-main">
                  <strong>${esc(r.full_name)} <span class="badge badge--${esc(r.status)}">${esc(REG_STATUS_LABEL[r.status] || r.status)}</span></strong>
                  <span class="overview-row-sub">${esc(r.activity_title)} · ${esc(formatVnDateTime(r.created_at))}</span>
                </div>
                <div class="btn-row">
                  ${digits ? `<a class="btn btn--ghost btn--sm" href="https://zalo.me/${esc(digits)}" target="_blank" rel="noopener">Zalo ↗</a>` : ""}
                  <button class="btn btn--outline btn--sm" type="button" data-go-tab="registrations">Mở đơn</button>
                </div>
              </div>`;
            })
            .join("")}</div>`
        : `<p class="page-sub">Chưa có đơn đăng ký nào.</p>`;

      const kpiCards = [];
      if (can("tasks.read")) {
        kpiCards.push(`<button class="kpi-card ${overdueTasks > 0 ? "kpi-card--warn" : openTasks > 0 ? "kpi-card--accent" : ""}" type="button" data-go-tab="tasks">
          <span class="kpi-label">Nhiệm vụ đang mở</span>
          <strong class="kpi-value">${openTasks}</strong>
          <span class="kpi-foot">${overdueTasks} quá hạn · ${Number(data.tasks?.mine || 0)} giao cho bạn · ${Number(data.tasks?.done || 0)} đã xong</span>
        </button>`);
      }
      if (can("registrations.read")) {
        kpiCards.push(`<button class="kpi-card ${newRegs > 0 ? "kpi-card--accent" : ""}" type="button" data-go-tab="registrations" data-go-status="new">
          <span class="kpi-label">Đơn mới cần liên hệ</span>
          <strong class="kpi-value">${newRegs}</strong>
          <span class="kpi-foot">Tổng ${data.registrations?.all || 0} đơn · ${data.registrations?.attended || 0} đã tham gia</span>
        </button>`);
      }
      if (can("posts.read")) {
        kpiCards.push(`<button class="kpi-card ${pendingPosts > 0 ? "kpi-card--warn" : ""}" type="button" data-go-tab="posts">
          <span class="kpi-label">Bài Hành trình chờ duyệt</span>
          <strong class="kpi-value">${pendingPosts}</strong>
          <span class="kpi-foot">${Number(data.posts?.published || 0)} đã đăng · ${Number(data.posts?.draft || 0)} nháp</span>
        </button>`);
      }
      if (can("events.read")) {
        kpiCards.push(`<button class="kpi-card" type="button" data-go-tab="events">
          <span class="kpi-label">Sự kiện sắp diễn ra</span>
          <strong class="kpi-value">${data.events?.upcomingCount || 0}</strong>
          <span class="kpi-foot">${data.events?.pastCount || 0} đã tổ chức · ${data.events?.draftCount || 0} nháp</span>
        </button>`);
      }
      if (can("reflections.read")) {
        kpiCards.push(`<button class="kpi-card ${pendingRefs > 0 || Number(data.feedbacks?.new || 0) > 0 ? "kpi-card--warn" : ""}" type="button" data-go-tab="community">
          <span class="kpi-label">Lưu bút &amp; Góp ý mới</span>
          <strong class="kpi-value">${pendingRefs + Number(data.feedbacks?.new || 0)}</strong>
          <span class="kpi-foot">${pendingRefs} lưu bút · ${Number(data.feedbacks?.new || 0)} góp ý</span>
        </button>`);
      }
      if (can("media.read")) {
        kpiCards.push(`<a class="kpi-card ${pendingPhotos > 0 ? "kpi-card--warn" : ""}" href="/media/">
          <span class="kpi-label">Ảnh chờ duyệt Safeguarding</span>
          <strong class="kpi-value">${pendingPhotos}</strong>
          <span class="kpi-foot">${data.media?.albumCount || 0} album · ${data.media?.photoCount || 0} ảnh · Mở /media/ ↗</span>
        </a>`);
      }

      const healthStripHtml = isSuper
        ? `<div class="health-strip" aria-label="Trạng thái kết nối hệ thống">
            <span class="health-pill ${integ.driveConfigured ? "is-ok" : "is-warn"}"><span class="health-dot"></span>Google Drive: ${integ.driveConfigured ? "Đã nối ảnh gốc" : "Đang dùng MEDIA_KV"}</span>
            <span class="health-pill ${integ.gasConfigured ? "is-ok" : "is-warn"}"><span class="health-dot"></span>Google Sheets: ${integ.gasConfigured ? "Đang đồng bộ" : "Chưa cấu hình"}</span>
            <span class="health-pill ${integ.mediaGateEnabled ? "is-ok" : "is-warn"}"><span class="health-dot"></span>PIN Ban Hình Ảnh: ${integ.mediaGateEnabled ? "Đang bật" : "Chưa đặt"}</span>
          </div>`
        : "";

      const rightPanelHtml = can("registrations.read")
        ? `<section class="panel-box">
            <div class="panel-box-head panel-box-head--row">
              <div>
                <h2>Đơn đăng ký mới nhất</h2>
                <p>Chạm Zalo để nhắn trực tiếp hoặc mở danh sách check-in.</p>
              </div>
              <button class="btn btn--ghost btn--sm" type="button" data-go-tab="registrations">Tất cả →</button>
            </div>
            ${recentRegsHtml}
          </section>`
        : `<section class="panel-box">
            <div class="panel-box-head panel-box-head--row">
              <div>
                <h2>Lối tắt nhanh của Ban bạn</h2>
                <p>Chỉ hiển thị các đầu mục thuộc phạm vi vai trò hiện tại (che danh sách SĐT người tham dự).</p>
              </div>
            </div>
            <div class="btn-row" style="flex-wrap:wrap;">
              ${can("timeline.read") ? '<button class="btn btn--primary btn--sm" type="button" data-go-tab="timeline">Mở Timeline Sự kiện</button>' : ""}
              ${can("tasks.read") ? '<button class="btn btn--outline btn--sm" type="button" data-go-tab="tasks">Xem Nhiệm vụ của tôi</button>' : ""}
              ${can("posts.draft") ? '<button class="btn btn--outline btn--sm" type="button" data-go-tab="posts">Soạn / Duyệt Bài viết</button>' : ""}
              ${can("media.read") ? '<a class="btn btn--outline btn--sm" href="/media/">Mở Kho Ban Hình Ảnh ↗</a>' : ""}
              ${can("team.read") ? '<button class="btn btn--ghost btn--sm" type="button" data-go-tab="team">Xem Ma trận Quyền</button>' : ""}
            </div>
          </section>`;

      box.innerHTML = `
        <div class="overview-kpis">${kpiCards.join("")}</div>
        ${healthStripHtml}
        <div class="overview-grid">
          <section class="panel-box">
            <div class="panel-box-head panel-box-head--row">
              <div>
                <h2>Sự kiện sắp diễn ra</h2>
                <p>Lấy số giữ chỗ trực tiếp từ bảng đơn đăng ký D1.</p>
              </div>
              ${can("events.read") ? '<button class="btn btn--ghost btn--sm" type="button" data-go-tab="events">Tất cả →</button>' : ""}
            </div>
            ${upcomingHtml}
          </section>
          ${rightPanelHtml}
        </div>
      `;
    } catch (err) {
      renderErrorState(box, err.message, "overview");
    }
  }

  /* =========================================================================
     TAB 1: REGISTRATIONS & 1-TAP CHECK-IN
     ========================================================================= */
  function updateRegBadges(counts) {
    state.regCounts = counts;
    $("#stat-all").textContent = String(counts.all || 0);
    $("#stat-new").textContent = String(counts.new || 0);
    $("#stat-contacted").textContent = String(counts.contacted || 0);
    $("#stat-attended").textContent = String(counts.attended || 0);
    if ($("#stat-cancelled")) $("#stat-cancelled").textContent = String(counts.cancelled || 0);
    setBadgeCount(["badge-new-regs", "badge-new-regs-mobile"], counts.new || 0);
  }

  function renderRegistrationsTable() {
    const box = $("#regs-container");
    const pagBar = $("#regs-pagination");
    if (state.registrations.length === 0) {
      pagBar.hidden = true;
      renderEmptyState(
        box,
        "Chưa có đơn đăng ký phù hợp",
        "Khi có bạn trẻ gửi biểu mẫu tại trang Tham gia hoặc bấm Giữ chỗ sự kiện, đơn sẽ xuất hiện tại đây ngay lập tức."
      );
      return;
    }

    box.innerHTML = `<div tabindex="0" role="region" aria-labelledby="reg-table-caption" class="table-wrapper">
      <table class="cms-table">
        <caption id="reg-table-caption">Hiển thị ${state.registrations.length} / ${state.regTotal} đơn đăng ký (mới nhất trước)</caption>
        <thead>
          <tr>
            <th>Người đăng ký</th>
            <th>Liên hệ nhanh</th>
            <th>Sự kiện / Hoạt động</th>
            <th>Trạng thái</th>
            <th>Sheet / Email</th>
            <th>Thao tác nhanh</th>
          </tr>
        </thead>
        <tbody>
          ${state.registrations
            .map((r) => {
              const digits = String(r.phone || "").replace(/\D/g, "");
              return `<tr>
                <th>
                  ${esc(r.full_name)}
                  ${r.bug_screenshot_url ? `<span class="badge badge--pending">Có ảnh lỗi</span>` : ""}
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
                  ${r.note ? `<span class="cell-sub">“${esc(r.note.slice(0, 140))}${r.note.length > 140 ? "…" : ""}”</span>` : ""}
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
                  <div class="reg-quick-actions">
                    ${r.status === "new" ? `<button class="btn btn--outline btn--sm" type="button" data-quick-reg-status="${esc(r.id)}" data-next-status="contacted">Đã liên hệ</button>` : ""}
                    ${r.status !== "attended" && r.status !== "cancelled" ? `<button class="btn btn--primary btn--sm" type="button" data-quick-reg-status="${esc(r.id)}" data-next-status="attended">Check-in</button>` : ""}
                    <button class="btn btn--outline btn--sm" type="button" data-open-reg="${esc(r.id)}">Chi tiết</button>
                  </div>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

    if (state.registrations.length < state.regTotal) {
      pagBar.hidden = false;
      $("#regs-pagination-meta").textContent = `Đã tải ${state.registrations.length} / ${state.regTotal} đơn`;
    } else {
      pagBar.hidden = true;
    }
  }

  async function loadRegistrations(append = false) {
    const box = $("#regs-container");
    if (!append) {
      state.regOffset = 0;
      renderSkeleton(box, 3);
    }
    try {
      const qs = new URLSearchParams();
      if (state.regFilter.status) qs.set("status", state.regFilter.status);
      if (state.regFilter.activity) qs.set("activity", state.regFilter.activity);
      if (state.regFilter.source) qs.set("source", state.regFilter.source);
      if (state.regFilter.q) qs.set("q", state.regFilter.q);
      qs.set("limit", "50");
      qs.set("offset", String(state.regOffset));

      const data = await api(`/api/admin/registrations?${qs.toString()}`);
      const incoming = data.items || [];
      state.registrations = append ? [...state.registrations, ...incoming] : incoming;
      state.regTotal = Number(data.total || state.registrations.length);
      state.regOffset = state.registrations.length;
      updateRegBadges(data.counts || {});

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

      renderRegistrationsTable();
    } catch (err) {
      if (!append) renderErrorState(box, err.message, "registrations");
      else toast(err.message, "error");
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
      <dt>Lời nhắn</dt><dd style="white-space:pre-wrap;">${reg.note ? esc(reg.note) : "—"}</dd>
      <dt>Đồng bộ Sheet</dt><dd><span class="badge badge--${esc(reg.sync_status)}">${esc(SYNC_STATUS_LABEL[reg.sync_status] || reg.sync_status)}</span>${reg.sync_error ? ` — ${esc(reg.sync_error)}` : ""}</dd>
    `;

    const shotWrap = $("#reg-bug-shot-wrap");
    if (reg.bug_screenshot_url) {
      shotWrap.hidden = false;
      $("#reg-bug-shot-link").href = reg.bug_screenshot_url;
      $("#reg-bug-shot-img").src = reg.bug_screenshot_url;
    } else {
      shotWrap.hidden = true;
    }

    $("#reg-dialog").showModal();
  }

  /* =========================================================================
     TAB 2: EVENTS
     ========================================================================= */
  function renderEventsList() {
    const box = $("#events-container");
    const q = state.eventSearch.trim().toLowerCase();
    const filtered = state.events.filter((ev) => {
      if (state.eventFilter === "upcoming" && (ev.kind !== "upcoming" || ev.status !== "published")) return false;
      if (state.eventFilter === "past" && ev.kind !== "past") return false;
      if (state.eventFilter === "draft" && ev.status !== "draft") return false;
      if (q) {
        const hay = `${ev.title} ${ev.location} ${ev.type} ${ev.dateDisplay}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      renderEmptyState(
        box,
        state.events.length ? "Không tìm thấy sự kiện phù hợp" : "Chưa có sự kiện nào",
        state.events.length
          ? "Thử đổi bộ lọc hoặc từ khóa tìm kiếm."
          : "Tạo buổi Workshop hoặc Chiến dịch đầu tiên để mở giữ chỗ trên website.",
        state.events.length ? "" : "+ Đăng sự kiện mới",
        "new-event"
      );
      return;
    }

    box.innerHTML = `<div class="item-list">${filtered
      .map((ev) => {
        const slug = ev.slug || ev.id;
        const invitePath = `/su-kien/${slug}/`;
        const inviteFullUrl = `${SITE_ORIGIN}${invitePath}`;
        const webBooked = Number(ev.webBookedCount || 0);
        const totalBooked = webBooked + Number(ev.externalBooked || 0);
        const isFull = ev.seatCapacity > 0 && totalBooked >= ev.seatCapacity;
        const seatLabel =
          ev.seatCapacity > 0
            ? `${totalBooked} / ${ev.seatCapacity} chỗ (${webBooked} web)`
            : `${webBooked} đơn web`;

        return `<article class="item-row">
          <img class="item-thumb" src="${esc(ev.image)}" alt="${esc(ev.imageAlt || ev.title)}" loading="lazy">
          <div class="item-body">
            <div class="item-meta">
              <span class="badge badge--${ev.kind === "upcoming" ? "new" : "past"}">${ev.kind === "upcoming" ? "Sắp diễn ra" : "Đã tổ chức"}</span>
              <span class="badge badge--${esc(ev.status)}">${ev.status === "published" ? "Công khai" : "Nháp"}</span>
              ${ev.rsvpClosed ? `<span class="badge badge--cancelled">Khóa giữ chỗ</span>` : ""}
              ${ev.stageOverride === "memory" ? `<span class="badge badge--attended">Ép Kỷ niệm</span>` : ev.stageOverride === "invite" ? `<span class="badge badge--pending">Ép Thư mời</span>` : ""}
              <span class="event-seat-pill ${isFull ? "is-full" : ""}">${esc(seatLabel)}</span>
              <span>${esc(ev.dateDisplay || ev.date)}</span>
              ${ev.time ? `<span>· ${esc(ev.time)}</span>` : ""}
              ${ev.zaloGroupUrl ? `<span>· Zalo riêng</span>` : ""}
            </div>
            <h3>${esc(ev.title)}</h3>
            <p class="item-excerpt">${esc(ev.location || "")}${ev.summary ? ` — ${esc(ev.summary)}` : ""}</p>
          </div>
          <div class="item-actions">
            <button class="btn btn--primary btn--sm" type="button" data-event-command="${esc(ev.id)}">Điều hành</button>
            ${ev.status === "published" ? `<button class="btn btn--outline btn--sm" type="button" data-copy-url="${esc(inviteFullUrl)}">Copy link</button>` : ""}
            ${ev.status === "published" ? `<button class="btn btn--ghost btn--sm" type="button" data-invite-personal="${esc(inviteFullUrl)}" data-invite-title="${esc(ev.title)}">Mời tên</button>` : ""}
            ${ev.status === "published" ? `<a class="btn btn--ghost btn--sm" href="${esc(invitePath)}" target="_blank" rel="noopener">Xem ↗</a>` : ""}
            <button class="btn btn--ghost btn--sm" type="button" data-dup-event="${esc(ev.id)}">Nhân bản</button>
            <button class="btn btn--outline btn--sm" type="button" data-edit-event="${esc(ev.id)}">Sửa</button>
            <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-event="${esc(ev.id)}">Xóa</button>
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }

  async function loadEvents() {
    const box = $("#events-container");
    renderSkeleton(box, 3);
    try {
      const data = await api("/api/admin/events?limit=150");
      state.events = data.items || [];
      renderEventsList();
    } catch (err) {
      renderErrorState(box, err.message, "events");
    }
  }

  function openEventDialog(ev = null) {
    const form = $("#event-form");
    form.reset();
    showAlert($("#ev-alert"), "");
    $("#event-dialog-title").textContent = ev && ev.id ? "Chỉnh sửa sự kiện" : "Đăng sự kiện mới";

    $("#ev-id").value = ev ? ev.id || "" : "";
    $("#ev-kind").value = ev ? ev.kind || "upcoming" : "upcoming";
    $("#ev-status").value = ev ? ev.status || "published" : "published";
    $("#ev-sort-order").value = ev ? Number(ev.sortOrder || 0) : 0;
    $("#ev-title").value = ev ? ev.title || "" : "";
    $("#ev-title-en").value = ev ? ev.titleEn || "" : "";
    $("#ev-type").value = ev ? ev.type || "HolaHeart · Giá trị sống" : "HolaHeart · Giá trị sống";
    $("#ev-date").value = ev && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? ev.date : new Date().toISOString().slice(0, 10);
    $("#ev-date-display").value = ev ? ev.dateDisplay || "" : "";
    $("#ev-time").value = ev ? ev.time || "" : "07:30 – 10:30";
    $("#ev-location").value = ev ? ev.location || "" : "Hòa Lạc, Hà Nội";
    $("#ev-fee").value = ev ? ev.fee || "" : "Miễn phí tham dự · Tự túc đồ uống";
    $("#ev-zalo-url").value = ev ? ev.zaloGroupUrl || "" : "";

    const savedAudioUrl = ev ? String(ev.reelAudioUrl || "").trim() : "";
    const savedAudioTitle = ev ? String(ev.reelAudioTitle || "").trim() : "";
    const isPresetAudio =
      savedAudioUrl === "" ||
      savedAudioUrl === "preset:holaheart" ||
      savedAudioUrl === "preset:holagreen" ||
      savedAudioUrl === "preset:holaconnect" ||
      savedAudioUrl === "preset:silent";
    if ($("#ev-reel-audio-mode")) {
      $("#ev-reel-audio-mode").value = isPresetAudio ? savedAudioUrl : "custom";
    }
    if ($("#ev-reel-audio-title")) {
      $("#ev-reel-audio-title").value = savedAudioTitle;
    }
    if ($("#ev-reel-audio-url")) {
      $("#ev-reel-audio-url").value = isPresetAudio ? "" : savedAudioUrl;
    }
    if ($("#ev-reel-custom-wrap")) {
      $("#ev-reel-custom-wrap").hidden = isPresetAudio;
    }
    const evAudioPreview = $("#ev-reel-audio-preview");
    const evAudioPlayerWrap = $("#ev-reel-audio-player-wrap");
    if (evAudioPreview) {
      evAudioPreview.pause();
      if (!isPresetAudio && savedAudioUrl) {
        evAudioPreview.src = savedAudioUrl;
        if (evAudioPlayerWrap) evAudioPlayerWrap.hidden = false;
      } else {
        evAudioPreview.removeAttribute("src");
        if (evAudioPlayerWrap) evAudioPlayerWrap.hidden = true;
      }
    }
    if ($("#ev-reel-audio-status")) {
      $("#ev-reel-audio-status").textContent = "Hỗ trợ MP3, M4A, OGG, WAV (tối đa 15 MB qua Drive hoặc 8 MB qua KV).";
    }
    $("#ev-seats").value = ev ? ev.seats || "" : "";
    $("#ev-seat-capacity").value = ev ? Number(ev.seatCapacity || 0) : 0;
    $("#ev-external-booked").value = ev ? Number(ev.externalBooked || 0) : 0;
    $("#ev-show-seat-bar").checked = ev ? Boolean(ev.showSeatBar) : false;
    $("#ev-summary").value = ev ? ev.summary || "" : "";
    $("#ev-summary-en").value = ev ? ev.summaryEn || "" : "";
    $("#ev-highlights").value = ev && Array.isArray(ev.highlights) ? ev.highlights.join("\n") : "";
    $("#ev-participants").value = ev ? ev.participants || "" : "";

    const imgUrl = ev && ev.image ? ev.image : "/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg";
    $("#ev-image").value = imgUrl;
    $("#ev-image-preview").src = imgUrl;
    $("#ev-image-alt").value = ev ? ev.imageAlt || "" : "";
    $("#ev-image-meta").textContent = "Tải ảnh trực tiếp lên Google Drive hoặc bấm Cắt khung nếu cần.";

    const filters = new Set(ev?.filters || []);
    $$('input[name="filters"]', form).forEach((cb) => {
      cb.checked = filters.has(cb.value);
    });

    $("#event-dialog").showModal();
  }

  /* =========================================================================
     TAB 3: POSTS & SAFE MARKDOWN LIVE PREVIEW
     ========================================================================= */
  function renderSafeMarkdownPreview(rawText) {
    const lines = String(rawText || "")
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) {
      return `<p style="color:var(--ink-muted);">Chưa có nội dung để xem trước.</p>`;
    }

    const formatInline = (line) =>
      esc(line)
        .replace(
          /\[([^\[\]]+)\]\((\/(?:[a-z0-9_-][a-z0-9/_-]*)?(?:#[a-z0-9_-]+)?)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>'
        )
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    const out = [];
    let inList = false;
    const closeList = () => {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
    };
    for (const line of lines) {
      if (line.startsWith("- ")) {
        if (!inList) {
          out.push("<ul>");
          inList = true;
        }
        out.push(`<li>${formatInline(line.slice(2).trim())}</li>`);
        continue;
      }
      closeList();
      if (line.startsWith("### ")) out.push(`<h3>${formatInline(line.slice(4).trim())}</h3>`);
      else if (line.startsWith("## ")) out.push(`<h2>${formatInline(line.slice(3).trim())}</h2>`);
      else if (line.startsWith("> ")) out.push(`<blockquote>${formatInline(line.slice(2).trim())}</blockquote>`);
      else out.push(`<p>${formatInline(line)}</p>`);
    }
    closeList();
    return out.join("\n");
  }

  function updatePostWordCount() {
    const text = ($("#post-content")?.value || "").trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(1, Math.round(words / 180));
    const el = $("#post-word-count");
    if (el) el.textContent = `${words} từ · ~${mins} phút đọc`;
  }

  function setPostEditorMode(mode) {
    switchSubtab("data-post-mode", "data-post-editor-pane", mode);
    if (mode === "preview") {
      $("#post-preview-pane").innerHTML = renderSafeMarkdownPreview($("#post-content").value);
    }
  }

  function renderPostsList() {
    const box = $("#posts-container");
    const q = state.postSearch.trim().toLowerCase();
    const filtered = state.posts.filter((p) => {
      if (state.postFilter !== "all" && p.status !== state.postFilter) return false;
      if (q) {
        const hay = `${p.title} ${p.slug} ${p.category} ${p.author}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      renderEmptyState(
        box,
        state.posts.length ? "Không tìm thấy bài viết phù hợp" : "Chưa có bài viết nào",
        state.posts.length
          ? "Thử đổi bộ lọc hoặc từ khóa tìm kiếm."
          : "Viết bài tường thuật đầu tiên — trang SEO /hanh-trinh/<slug>/ sẽ xuất hiện ngay lập tức.",
        state.posts.length ? "" : "+ Viết bài mới",
        "new-post"
      );
      return;
    }

    const POST_STATUS_LABEL = {
      published: "Công khai",
      pending_review: "Chờ duyệt",
      changes_requested: "Cần sửa lại",
      draft: "Nháp",
    };

    box.innerHTML = `<div class="item-list">${filtered
      .map(
        (p) => `<article class="item-row">
          <img class="item-thumb" src="${esc(p.image)}" alt="${esc(p.imageAlt || p.title)}" loading="lazy">
          <div class="item-body">
            <div class="item-meta">
              <span class="badge badge--${p.status === "published" ? "published" : p.status === "changes_requested" ? "cancelled" : p.status === "pending_review" ? "new" : "draft"}">${esc(POST_STATUS_LABEL[p.status] || p.status)}</span>
              <span>${esc(p.category)}</span>
              <span>· ${esc(p.dateDisplay)}</span>
              <span>· ${esc(p.readTime || "")}</span>
            </div>
            <h3>${esc(p.title)}</h3>
            <p class="item-excerpt">${esc(p.excerpt)}</p>
            ${p.reviewNote ? `<p class="item-excerpt" style="color:#b45309;font-weight:500;">Góp ý duyệt: ${esc(p.reviewNote)}</p>` : ""}
          </div>
          <div class="item-actions">
            ${p.status === "published" ? `<button class="btn btn--outline btn--sm" type="button" data-copy-url="${esc(`${SITE_ORIGIN}/hanh-trinh/${p.slug}/`)}">Copy link</button>` : ""}
            ${p.status === "published" ? `<a class="btn btn--ghost btn--sm" href="/hanh-trinh/${esc(p.slug)}/" target="_blank" rel="noopener">Xem ↗</a>` : ""}
            <button class="btn btn--outline btn--sm" type="button" data-edit-post="${esc(p.id)}">Sửa</button>
            <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-post="${esc(p.id)}">Xóa</button>
          </div>
        </article>`
      )
      .join("")}</div>`;
  }

  async function loadPosts() {
    const box = $("#posts-container");
    renderSkeleton(box, 3);
    try {
      const data = await api("/api/admin/posts?limit=150");
      state.posts = data.items || [];
      renderPostsList();
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
    const canPublish = !window.__holariseManager || window.__holariseManager.hasPerm("posts.publish");
    $("#post-status").value = post ? post.status : canPublish ? "published" : "pending_review";
    $("#post-category").value = post ? post.category : "HolaGreen · Sạch";
    $("#post-date").value = post ? post.date : new Date().toISOString().slice(0, 10);
    $("#post-author").value = post ? post.author : "Ban Điều Phối HolaRise";
    $("#post-excerpt").value = post ? post.excerpt : "";
    $("#post-content").value = post && Array.isArray(post.content) ? post.content.join("\n\n") : "";
    const imgUrl = post ? post.image : "/assets/images/activity-environment.jpg";
    $("#post-image").value = imgUrl;
    $("#post-image-preview").src = imgUrl;
    $("#post-image-alt").value = post ? post.imageAlt || "" : "";
    $("#post-image-meta").textContent = "Khuyến nghị ảnh ngang 16:9 hoặc 3:2.";

    const filters = new Set(post?.filters || []);
    $$('input[name="filters"]', form).forEach((cb) => {
      cb.checked = filters.has(cb.value);
    });

    const canPub = !window.__holariseManager || window.__holariseManager.hasPerm("posts.publish");
    const noteField = $("#post-review-note-field");
    const noteInput = $("#post-review-note");
    const noteBanner = $("#post-review-note-banner");
    if (noteField) noteField.hidden = !canPub;
    if (noteInput) noteInput.value = post?.reviewNote || "";
    if (noteBanner) {
      if (post?.reviewNote) {
        noteBanner.textContent = `Góp ý từ người duyệt (${post.reviewedBy || "Ban Nội Dung"}): ${post.reviewNote}`;
        noteBanner.hidden = false;
      } else {
        noteBanner.hidden = true;
      }
    }

    setPostEditorMode("write");
    updatePostWordCount();
    $("#post-dialog").showModal();
  }

  /* =========================================================================
     TAB 4: COMMUNITY (REFLECTIONS, MEMBERS & EVENT FEEDBACKS)
     ========================================================================= */
  async function loadCommunity() {
    await Promise.all([loadAdminReflections(), loadAdminMembers(), loadAdminFeedbacks()]);
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
        setBadgeCount(["badge-pending-refs", "badge-pending-refs-mobile"], data.counts.pending);
      }

      if (!state.reflections.length) {
        renderEmptyState(
          box,
          "Chưa có lưu bút nào trong mục này",
          "Khi thành viên gửi cảm nhận hoặc bạn nhập mới, nội dung sẽ hiển thị tại đây để duyệt và ghim Trang chủ.",
          "+ Nhập cảm nhận",
          "new-reflection"
        );
        return;
      }

      box.innerHTML = `<div class="item-list">${state.reflections
        .map((rf) => {
          const photos =
            Array.isArray(rf.photoUrls) && rf.photoUrls.length
              ? rf.photoUrls
              : rf.photoUrl
                ? [rf.photoUrl]
                : [];
          const thumbsHtml = photos.length
            ? `<div class="admin-ref-thumbs">${photos
                .map((u, idx) => {
                  const isVid = /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(u || ""));
                  return isVid
                    ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="Xem video ${idx + 1}"><video class="item-thumb" src="${esc(u)}" muted playsinline preload="metadata"></video></a>`
                    : `<a href="${esc(u)}" target="_blank" rel="noopener" title="Xem ảnh ${idx + 1}"><img class="item-thumb" src="${esc(u)}" alt="Ảnh ${idx + 1} lưu bút của ${esc(rf.authorName)}" loading="lazy"></a>`;
                })
                .join("")}</div>`
            : "";
          const codePart = rf.authorMemberCode ? ` (${esc(rf.authorMemberCode)})` : "";
          const isCommunity = rf.kind === "community";
          return `<article class="item-row">
            ${thumbsHtml}
            <div class="item-body">
              <div class="item-meta">
                <span class="badge badge--${rf.status === "approved" ? "published" : rf.status === "rejected" ? "cancelled" : "pending"}">${
                  rf.status === "approved" ? "Đã duyệt" : rf.status === "rejected" ? "Đã ẩn" : "Chờ duyệt"
                }</span>
                ${isCommunity && rf.isFeaturedHome ? `<span class="badge badge--attended">Ghim Trang chủ</span>` : ""}
                <span>${esc(rf.authorName)}${codePart}</span>
                <span>· ${esc(rf.participantRole)}</span>
                ${rf.authorOrg ? `<span>· ${esc(rf.authorOrg)}</span>` : ""}
                ${rf.activitySlug ? `<span>· Bài: <code>${esc(rf.activitySlug)}</code></span>` : ""}
              </div>
              ${rf.pullQuote ? `<h3>“${esc(rf.pullQuote)}”</h3>` : ""}
              <p class="item-excerpt">${esc(rf.content)}</p>
            </div>
            <div class="item-actions">
              ${rf.status !== "approved" ? `<button class="btn btn--primary btn--sm" type="button" data-mod-ref="${esc(rf.id)}" data-mod-status="approved">Duyệt</button>` : ""}
              ${rf.status !== "rejected" ? `<button class="btn btn--outline btn--sm" type="button" data-mod-ref="${esc(rf.id)}" data-mod-status="rejected">Ẩn</button>` : ""}
              ${isCommunity ? `<button class="btn btn--ghost btn--sm" type="button" data-pin-ref="${esc(rf.id)}" data-pinned="${rf.isFeaturedHome ? "1" : "0"}">${rf.isFeaturedHome ? "Bỏ ghim" : "Ghim"}</button>` : ""}
              <button class="btn btn--outline btn--sm" type="button" data-edit-ref="${esc(rf.id)}">Sửa</button>
              <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-ref="${esc(rf.id)}">Xóa</button>
            </div>
          </article>`;
        })
        .join("")}</div>`;
    } catch (err) {
      renderErrorState(box, err.message, "community");
    }
  }

  function openReflectionDialog(item = null) {
    const form = $("#reflection-editor-form");
    form.reset();
    showAlert($("#reflection-editor-alert"), "");
    const isMemberKind = Boolean(item && item.kind === "member");

    $("#reflection-dialog-title").textContent = item ? "Chỉnh sửa cảm nhận" : "Nhập cảm nhận từ người tham gia";
    $("#ref-id").value = item?.id || "";
    $("#ref-kind").value = item?.kind || "community";
    $("#ref-author").value = item?.authorName || "";
    $("#ref-role").value = item?.participantRole || "Thành viên tham dự";
    $("#ref-org").value = item?.authorOrg || "";
    $("#ref-slug").value = item?.activitySlug || "";
    $("#ref-quote").value = item?.pullQuote || "";
    $("#ref-content").value = item?.content || "";
    $("#ref-photo").value = item?.photoUrl || "";
    $("#ref-photo-preview").src = item?.photoUrl || "/assets/images/logo-mark.png";
    $("#ref-status").value = item?.status || "approved";
    $("#ref-featured").checked = item ? Boolean(item.isFeaturedHome) : true;
    $("#ref-admin-note").value = item?.adminNote || "";

    $("#ref-member-readonly-note").hidden = !isMemberKind;
    $("#ref-admin-note-field").hidden = !isMemberKind;
    $("#ref-photo-field").hidden = isMemberKind;
    $("#ref-featured-wrap").hidden = isMemberKind;
    ["ref-author", "ref-role", "ref-org", "ref-slug", "ref-quote", "ref-content"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = isMemberKind;
    });

    $("#reflection-dialog").showModal();
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
          "Thành viên đăng ký Thẻ Thành Viên Hola tại /tham-gia/ hoặc được thêm trực tiếp sẽ hiển thị tại đây.",
          "+ Thêm thành viên",
          "new-member"
        );
        return;
      }

      box.innerHTML = `<div class="item-list">${state.members
        .map((m) => {
          const contact = m.phoneDisplay || m.email || "Chưa có liên hệ";
          const pillarLabel = PILLAR_LABEL[m.pillarChoice] || m.pillarChoice || "HolaHeart";
          const countsLabel = `${m.registrationCount || 0} buổi · ${m.reflectionCount || 0} lưu bút`;
          return `<div class="user-row">
            <div>
              <strong>${esc(m.name)}</strong>
              <span class="badge badge--${m.isActive ? "published" : "cancelled"}">${m.isActive ? "Hoạt động" : "Đã khóa"}</span>
              ${m.isPublicTeam ? `<span class="badge badge--attended">Đội ngũ công khai</span>` : ""}
              ${m.roleTitle ? `<span class="badge badge--past">${esc(m.roleTitle)}</span>` : ""}
              ${m.canViewAllMedia ? `<span class="badge badge--attended">Xem mọi Media</span>` : ""}
              ${m.canAccessMediaPortal ? `<span class="badge badge--new">NGV · Media</span>` : ""}
              ${Number(m.albumGrantCount || 0) > 0 ? `<span class="badge badge--past">${Number(m.albumGrantCount)} album</span>` : ""}
              <span class="cell-sub"><code>${esc(m.memberCode)}</code> · ${esc(contact)} · ${esc(m.organization || "Hòa Lạc")} · ${esc(pillarLabel)} · ${esc(countsLabel)}</span>
            </div>
            <div class="item-actions">
              <button class="btn btn--primary btn--sm" type="button" data-member-360="${esc(m.id)}">Hồ sơ 360°</button>
              <button class="btn btn--outline btn--sm" type="button" data-edit-member="${esc(m.id)}">Sửa</button>
              <a class="btn btn--outline btn--sm" href="/tv/${encodeURIComponent(m.memberCode)}" target="_blank" rel="noopener noreferrer">Thẻ ↗</a>
              <button class="btn btn--outline btn--sm" type="button" data-toggle-member="${esc(m.id)}" data-active="${m.isActive ? "1" : "0"}">${m.isActive ? "Khóa" : "Mở khóa"}</button>
              <button class="btn btn--danger-ghost btn--sm" type="button" data-delete-member="${esc(m.id)}">Xóa</button>
            </div>
          </div>`;
        })
        .join("")}</div>`;
    } catch (err) {
      renderErrorState(box, err.message, "community");
    }
  }

  function openMemberDialog(item = null) {
    const form = $("#member-editor-form");
    form.reset();
    showAlert($("#member-editor-alert"), "");
    $("#member-dialog-title").textContent = item && item.id ? "Cập nhật thành viên / Đội ngũ" : "Thêm thành viên / Đội ngũ";
    $("#mem-id").value = item?.id || "";
    $("#mem-name").value = item?.name || "";
    $("#mem-role-title").value = item?.roleTitle || "";
    $("#mem-phone").value = item?.phoneDisplay || item?.phone || "";
    $("#mem-email").value = item?.email || "";
    $("#mem-org").value = item?.organization || "";
    $("#mem-pillar").value = item?.pillarChoice || "holaheart";
    $("#mem-bio").value = item?.bio || "";
    $("#mem-notes").value = item?.notes || "";
    $("#mem-avatar").value = item?.avatarUrl || "";
    $("#mem-avatar-preview").src = item?.avatarUrl || "/assets/images/logo-mark.png";
    $("#mem-public-team").checked = Boolean(item?.isPublicTeam);
    $("#member-dialog").showModal();
  }

  function renderFeedbackCards(items, ctx = "global") {
    return `<div class="item-list">${items
      .map((fb) => {
        const badgeCls = fb.status === "resolved" ? "published" : fb.status === "read" ? "past" : "pending";
        const authorLine = fb.isAnonymous
          ? "Ẩn danh (bảo mật)"
          : `${fb.authorName || "Thành viên"}${fb.authorContact ? ` · ${fb.authorContact}` : ""}`;
        return `<article class="item-row">
          <div class="item-body">
            <div class="item-meta">
              <span class="badge badge--${badgeCls}">${esc(FB_STATUS_LABEL[fb.status] || fb.status)}</span>
              <span class="badge badge--new">${esc(FB_CAT_LABEL[fb.category] || fb.category)}</span>
              ${ctx === "global" ? `<span>${esc(fb.eventTitle)}</span>` : ""}
              <span>· ${esc(authorLine)}</span>
              <span>· ${esc(formatVnDateTime(fb.createdAt))}</span>
            </div>
            <p class="item-excerpt" style="color:var(--ink);white-space:pre-wrap;">${esc(fb.content)}</p>
            ${fb.adminNote ? `<p class="cell-sub" style="margin-top:6px;">Ghi chú nội bộ: ${esc(fb.adminNote)}</p>` : ""}
          </div>
          <div class="item-actions">
            ${fb.status === "new" ? `<button class="btn btn--outline btn--sm" type="button" data-fb-status-set="${esc(fb.id)}" data-next-status="read" data-fb-ctx="${esc(ctx)}">Đã đọc</button>` : ""}
            ${fb.status !== "resolved" ? `<button class="btn btn--primary btn--sm" type="button" data-fb-status-set="${esc(fb.id)}" data-next-status="resolved" data-fb-ctx="${esc(ctx)}">Đã xử lý</button>` : ""}
            <button class="btn btn--ghost btn--sm" type="button" data-fb-note="${esc(fb.id)}" data-current-note="${esc(fb.adminNote || "")}" data-fb-ctx="${esc(ctx)}">Ghi chú</button>
            <button class="btn btn--danger-ghost btn--sm" type="button" data-fb-delete="${esc(fb.id)}" data-fb-ctx="${esc(ctx)}">Xóa</button>
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }

  async function loadAdminFeedbacks() {
    const box = $("#feedbacks-admin-container");
    if (!box) return;
    renderSkeleton(box, 2);
    try {
      const qs = new URLSearchParams();
      if (state.fbFilter.status) qs.set("status", state.fbFilter.status);
      if (state.fbFilter.eventId) qs.set("eventId", state.fbFilter.eventId);
      if (state.fbFilter.category) qs.set("category", state.fbFilter.category);
      const data = await api(`/api/admin/event-feedback?${qs.toString()}`);
      state.feedbacks = data.items || [];

      const evSel = $("#fb-event-filter");
      if (evSel && Array.isArray(data.events)) {
        const cur = state.fbFilter.eventId;
        evSel.innerHTML =
          `<option value="">Tất cả sự kiện</option>` +
          data.events
            .map(
              (ev) =>
                `<option value="${esc(ev.eventId)}"${ev.eventId === cur ? " selected" : ""}>${esc(ev.eventTitle)} (${ev.count})</option>`
            )
            .join("");
      }

      if (!state.feedbacks.length) {
        renderEmptyState(
          box,
          "Chưa có góp ý nào trong bộ lọc này",
          "Khi người tham dự gửi góp ý hoặc lời động viên từ Sân khấu Kỷ niệm sau sự kiện, nội dung sẽ tập trung tại đây."
        );
        return;
      }
      box.innerHTML = renderFeedbackCards(state.feedbacks, "global");
    } catch (err) {
      renderErrorState(box, err.message, "community");
    }
  }

  /* =========================================================================
     DIALOG 10: MEMBER 360 DEEP CONTROL & MEDIA ACCESS
     ========================================================================= */
  function setM360Tab(tab) {
    state.m360.tab = tab;
    $$("[data-m360-tab]").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-m360-tab") === tab));
    });
    renderMember360Content();
  }

  async function openMember360(memberId, tab = "journey") {
    const dialog = $("#member-360-dialog");
    const box = $("#m360-content");
    if (!dialog || !box) return;
    state.m360.memberId = memberId;
    state.m360.tab = tab;
    state.m360.data = null;
    $$("[data-m360-tab]").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-m360-tab") === tab));
    });
    $("#m360-title").textContent = "Đang tải hồ sơ Thành viên...";
    $("#m360-subtitle").textContent = "—";
    renderSkeleton(box, 3);
    if (!dialog.open) dialog.showModal();

    try {
      const data = await api(`/api/admin/members/${encodeURIComponent(memberId)}`);
      state.m360.data = data;
      const m = data.member;
      $("#m360-title").textContent = `${m.name} (${m.memberCode})`;
      $("#m360-subtitle").textContent = [
        m.roleTitle || "Thành viên Hola",
        m.phoneDisplay || m.email || "Chưa có liên hệ",
        m.organization || "Hòa Lạc",
      ]
        .filter(Boolean)
        .join(" · ");
      renderMember360Content();
    } catch (err) {
      box.innerHTML = `<div class="state-box"><h3>Không tải được hồ sơ</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function renderMember360Content() {
    const box = $("#m360-content");
    const data = state.m360.data;
    if (!box || !data) return;
    const m = data.member;
    const tab = state.m360.tab;

    if (tab === "journey") {
      const events = data.events || [];
      const regs = data.registrations || [];
      const refs = data.reflections || [];
      const photos = data.photos || [];

      const assignHtml = `<div class="deep-card">
        <h3>Gán sự kiện &amp; Chấm công thủ công</h3>
        <form id="m360-assign-form" class="inline-assign-bar">
          <div class="field">
            <label for="m360-assign-event">Chọn sự kiện</label>
            <select id="m360-assign-event" required>
              <option value="">— Chọn sự kiện —</option>
              ${events.map((ev) => `<option value="${esc(ev.id)}">${esc(ev.title)} (${esc(ev.dateDisplay || ev.date)})</option>`).join("")}
            </select>
          </div>
          <div class="field" style="max-width:190px;">
            <label for="m360-assign-status">Trạng thái</label>
            <select id="m360-assign-status">
              <option value="attended">Đã tham gia (Check-in)</option>
              <option value="contacted">Đã liên hệ</option>
              <option value="new">Mới nhận</option>
            </select>
          </div>
          <button class="btn btn--primary btn--sm" type="submit" style="min-height:40px;">Gán vào sự kiện</button>
        </form>
      </div>`;

      const regsHtml = regs.length
        ? `<div class="item-list">${regs
            .map(
              (r) => `<div class="user-row">
                <div>
                  <strong>${esc(r.event_title || r.activity_title)}</strong>
                  <span class="badge badge--${esc(r.status)}">${esc(REG_STATUS_LABEL[r.status] || r.status)}</span>
                  <span class="cell-sub">${esc(r.date_display || r.event_date || "")} · Mã đơn <code>${esc(r.id)}</code>${r.admin_note ? ` · ${esc(r.admin_note)}` : ""}</span>
                </div>
                <div class="item-actions">
                  ${r.status !== "attended" ? `<button class="btn btn--primary btn--sm" type="button" data-m360-checkin-reg="${esc(r.id)}">Check-in</button>` : ""}
                  <button class="btn btn--danger-ghost btn--sm" type="button" data-m360-remove-reg="${esc(r.id)}">Gỡ</button>
                </div>
              </div>`
            )
            .join("")}</div>`
        : `<p class="page-sub">Thành viên chưa có lịch sử đăng ký hoặc check-in sự kiện nào.</p>`;

      const refsHtml = refs.length
        ? `<div class="item-list">${refs
            .map(
              (rf) => `<div class="user-row">
                <div>
                  <strong>${rf.pullQuote ? `“${esc(rf.pullQuote)}”` : esc(rf.activitySlug || "Lưu bút thành viên")}</strong>
                  <span class="badge badge--${rf.status === "approved" ? "published" : rf.status === "rejected" ? "cancelled" : "pending"}">${rf.status === "approved" ? "Đã duyệt" : rf.status === "rejected" ? "Đã ẩn" : "Chờ duyệt"}</span>
                  <span class="cell-sub">${esc((rf.content || "").slice(0, 160))}${(rf.content || "").length > 160 ? "…" : ""} · ${esc(formatVnDateTime(rf.createdAt))}</span>
                </div>
              </div>`
            )
            .join("")}</div>`
        : `<p class="page-sub">Chưa gửi lưu bút cảm nhận nào.</p>`;

      const photosHtml = photos.length
        ? `<div class="photo-strip-mini">${photos
            .map(
              (p) => `<a class="photo-strip-card" href="${esc(p.url)}" target="_blank" rel="noopener">
                <img src="${esc(p.url)}" alt="${esc(p.caption || p.album_title || "Ảnh thành viên góp")}" loading="lazy">
                <span class="photo-strip-cap">${esc(p.album_title || "Album")} · ${p.approval_status === "pending" ? "Chờ duyệt" : "Đã duyệt"}</span>
              </a>`
            )
            .join("")}</div>`
        : `<p class="page-sub">Chưa đóng góp ảnh kỷ niệm nào.</p>`;

      box.innerHTML = `<div class="deep-section">
        ${assignHtml}
        <div class="deep-card">
          <h3>Lịch sử tham dự sự kiện (${regs.length})</h3>
          ${regsHtml}
        </div>
        <div class="deep-card">
          <h3>Lưu bút đã gửi (${refs.length})</h3>
          ${refsHtml}
        </div>
        <div class="deep-card">
          <h3>Ảnh đã đóng góp (${photos.length})</h3>
          ${photosHtml}
        </div>
      </div>`;
      return;
    }

    if (tab === "media") {
      const ma = data.mediaAccess || {};
      const albums = ma.albums || [];
      box.innerHTML = `<form id="m360-media-form" class="deep-section">
        <div class="deep-card">
          <h3>Quyền Media cấp tài khoản</h3>
          <div style="display:grid;gap:10px;">
            <label class="check-chip">
              <input type="checkbox" id="m360-view-all-media" ${ma.canViewAllMedia ? "checked" : ""}>
              <span><strong>Xem mọi Album &amp; Ảnh riêng tư:</strong> Thành viên mở được tất cả kho ảnh nội bộ, bao gồm album đặt <em>Riêng tư</em> hoặc <em>Người đã dự</em>.</span>
            </label>
            <label class="check-chip">
              <input type="checkbox" id="m360-media-portal" ${ma.canAccessMediaPortal ? "checked" : ""}>
              <span><strong>Nâng quyền NGV (Cổng <code>/media/</code>):</strong> Cho phép thành viên vào kho tư liệu nội bộ <code>/media/</code> (qua mã cổng) để xem, tải bản gốc và đăng ảnh, video không giới hạn (Quản trị chủ động chọn hiển thị công khai).</span>
            </label>
          </div>
        </div>
        <div class="deep-card">
          <h3>Cấp quyền theo từng Album cụ thể (${albums.filter((a) => a.granted).length} / ${albums.length})</h3>
          ${
            albums.length
              ? `<div class="grant-grid">${albums
                  .map(
                    (a) => `<label class="grant-item">
                      <input type="checkbox" name="albumIds" value="${esc(a.id)}" ${a.granted ? "checked" : ""}>
                      <span>
                        <strong>${esc(a.title)}</strong>
                        <span class="cell-sub">${esc(a.dateDisplay || a.eventDate || "")} · ${a.photoCount} ảnh · <span class="badge badge--${a.visibility === "public" ? "published" : "pending"}">${esc(VISIBILITY_LABEL[a.visibility] || a.visibility)}</span></span>
                      </span>
                    </label>`
                  )
                  .join("")}</div>`
              : `<p class="page-sub">Chưa có album ảnh nào trên hệ thống.</p>`
          }
        </div>
        <div class="dialog-foot" style="padding:0;border:0;">
          <button class="btn btn--primary" type="submit">Lưu quyền xem Media</button>
        </div>
      </form>`;
      return;
    }

    if (tab === "security") {
      const sec = data.security || {};
      box.innerHTML = `<div class="deep-section">
        <div class="mini-kpi-row">
          <div class="mini-kpi"><span>Trạng thái</span><strong>${m.isActive ? "Hoạt động" : "Đã khóa"}</strong></div>
          <div class="mini-kpi"><span>Phiên đang mở</span><strong>${Number(sec.activeSessionCount || 0)}</strong></div>
          <div class="mini-kpi"><span>Passkey (Face ID)</span><strong>${Number(sec.passkeyCount || 0)}</strong></div>
          <div class="mini-kpi"><span>Đăng nhập gần nhất</span><strong style="font-size:0.9rem;">${esc(formatVnDateTime(sec.lastLoginAt))}</strong></div>
        </div>
        <div class="deep-card">
          <h3>Can thiệp phiên &amp; tài khoản</h3>
          <p class="page-sub" style="margin-bottom:12px;">Thu hồi phiên sẽ lập tức đẩy thành viên ra khỏi mọi điện thoại/trình duyệt đang đăng nhập (bao gồm phiên <code>/media/</code> Chỉ xem).</p>
          <div class="btn-row">
            <button class="btn btn--danger btn--sm" type="button" data-m360-revoke-sessions="${esc(m.id)}">Đăng xuất toàn bộ thiết bị</button>
            <button class="btn btn--outline btn--sm" type="button" data-m360-toggle-active="${esc(m.id)}" data-active="${m.isActive ? "1" : "0"}">${m.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"}</button>
            <button class="btn btn--outline btn--sm" type="button" data-reset-member-pw="${esc(m.id)}">Cấp mật khẩu tạm</button>
            <button class="btn btn--outline btn--sm" type="button" data-m360-edit-profile="${esc(m.id)}">Sửa hồ sơ cơ bản</button>
            <a class="btn btn--ghost btn--sm" href="/tv/${encodeURIComponent(m.memberCode)}" target="_blank" rel="noopener noreferrer">Mở Thẻ &amp; QR ↗</a>
          </div>
        </div>
      </div>`;
    }
  }

  /* =========================================================================
     DIALOG 11: EVENT COMMAND CENTER (DEEP EVENT CONTROL)
     ========================================================================= */
  function setEvCmdTab(tab) {
    state.evCmd.tab = tab;
    $$("[data-evcmd-tab]").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-evcmd-tab") === tab));
    });
    renderEventCommandContent();
  }

  async function openEventCommand(eventId, tab = "attendees") {
    const dialog = $("#event-command-dialog");
    const box = $("#evcmd-content");
    if (!dialog || !box) return;
    state.evCmd.eventId = eventId;
    state.evCmd.tab = tab;
    state.evCmd.search = "";
    state.evCmd.data = null;
    $$("[data-evcmd-tab]").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-evcmd-tab") === tab));
    });
    $("#evcmd-title").textContent = "Đang tải Trung tâm điều hành...";
    $("#evcmd-subtitle").textContent = "—";
    renderSkeleton(box, 3);
    if (!dialog.open) dialog.showModal();

    try {
      const data = await api(`/api/admin/events/${encodeURIComponent(eventId)}/command`);
      state.evCmd.data = data;
      const ev = data.event;
      $("#evcmd-title").textContent = ev.title;
      $("#evcmd-subtitle").textContent = [
        ev.dateDisplay || ev.date,
        ev.time,
        ev.location,
        ev.rsvpClosed ? "Đang khóa giữ chỗ" : "Đang mở giữ chỗ",
        STAGE_LABEL[ev.stageOverride || "auto"],
      ]
        .filter(Boolean)
        .join(" · ");
      renderEventCommandContent();
    } catch (err) {
      box.innerHTML = `<div class="state-box"><h3>Không tải được dữ liệu sự kiện</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function renderEventCommandContent() {
    const box = $("#evcmd-content");
    const data = state.evCmd.data;
    if (!box || !data) return;
    const ev = data.event;
    const stats = data.stats || {};
    const tab = state.evCmd.tab;

    if (tab === "attendees") {
      const q = (state.evCmd.search || "").trim().toLowerCase();
      const regs = (data.registrations || []).filter((r) => {
        if (!q) return true;
        return `${r.full_name} ${r.phone} ${r.email} ${r.organization} ${r.id}`.toLowerCase().includes(q);
      });
      const members = data.members || [];
      const csvUrl = `/api/admin/registrations/export?activity=${encodeURIComponent(ev.title)}`;
      const invitePath = `/su-kien/${ev.slug || ev.id}/`;

      box.innerHTML = `<div class="deep-section">
        <div class="mini-kpi-row">
          <div class="mini-kpi"><span>Tổng đơn</span><strong>${Number(stats.total || 0)}</strong></div>
          <div class="mini-kpi"><span>Mới nhận</span><strong>${Number(stats.new || 0)}</strong></div>
          <div class="mini-kpi"><span>Đã liên hệ</span><strong>${Number(stats.contacted || 0)}</strong></div>
          <div class="mini-kpi"><span>Đã Check-in</span><strong>${Number(stats.attended || 0)}</strong></div>
        </div>

        <div class="btn-row" style="justify-content:space-between;">
          <input id="evcmd-attendee-search" type="search" value="${esc(state.evCmd.search)}" placeholder="Tìm nhanh tên, SĐT, trường..." style="flex:1 1 220px;min-height:38px;padding:6px 12px;border:1px solid var(--line-strong);border-radius:10px;background:#fff;">
          <div class="btn-row">
            <a class="btn btn--outline btn--sm" href="${esc(csvUrl)}">Xuất CSV buổi này</a>
            <a class="btn btn--ghost btn--sm" href="${esc(invitePath)}" target="_blank" rel="noopener">Mở trang sự kiện ↗</a>
          </div>
        </div>

        <details class="deep-card">
          <summary style="cursor:pointer;font-weight:700;font-size:0.9rem;">+ Thêm khách tại cửa / Gán thành viên vào sự kiện</summary>
          <form id="evcmd-add-attendee-form" class="admin-form" style="margin-top:12px;">
            <div class="form-row-2">
              <div class="field">
                <label for="evcmd-add-member">Chọn Thành viên sẵn có (tùy chọn)</label>
                <select id="evcmd-add-member">
                  <option value="">— Hoặc nhập khách walk-in bên dưới —</option>
                  ${members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.memberCode)} · ${esc(m.phoneDisplay || m.email || "—")})</option>`).join("")}
                </select>
              </div>
              <div class="field">
                <label for="evcmd-add-status">Trạng thái check-in</label>
                <select id="evcmd-add-status">
                  <option value="attended">Đã tham gia (Check-in)</option>
                  <option value="contacted">Đã liên hệ</option>
                  <option value="new">Mới nhận</option>
                </select>
              </div>
            </div>
            <div class="form-row-3">
              <div class="field">
                <label for="evcmd-add-name">Họ và tên (nếu khách mới)</label>
                <input id="evcmd-add-name" type="text" placeholder="Nguyễn Minh Anh">
              </div>
              <div class="field">
                <label for="evcmd-add-phone">SĐT / Zalo</label>
                <input id="evcmd-add-phone" type="tel" placeholder="09xx...">
              </div>
              <div class="field">
                <label for="evcmd-add-org">Trường / Đơn vị</label>
                <input id="evcmd-add-org" type="text" placeholder="ĐH FPT / KCNC Hòa Lạc">
              </div>
            </div>
            <button class="btn btn--primary btn--sm" type="submit">Lưu người tham dự</button>
          </form>
        </details>

        <div class="deep-card">
          <h3>Danh sách khách (${regs.length})</h3>
          ${
            regs.length
              ? `<div class="item-list">${regs
                  .map((r) => {
                    const digits = String(r.phone || "").replace(/\D/g, "");
                    return `<div class="user-row">
                      <div>
                        <strong>${esc(r.full_name)}</strong>
                        <span class="badge badge--${esc(r.status)}">${esc(REG_STATUS_LABEL[r.status] || r.status)}</span>
                        <span class="cell-sub">${esc(r.phone)}${r.organization ? ` · ${esc(r.organization)}` : ""}${r.admin_note ? ` · ${esc(r.admin_note)}` : ""}</span>
                      </div>
                      <div class="item-actions">
                        ${digits ? `<a class="btn btn--ghost btn--sm" href="https://zalo.me/${esc(digits)}" target="_blank" rel="noopener">Zalo ↗</a>` : ""}
                        ${r.status === "new" ? `<button class="btn btn--outline btn--sm" type="button" data-evcmd-reg-status="${esc(r.id)}" data-next-status="contacted">Đã liên hệ</button>` : ""}
                        ${r.status !== "attended" ? `<button class="btn btn--primary btn--sm" type="button" data-evcmd-reg-status="${esc(r.id)}" data-next-status="attended">Check-in</button>` : ""}
                        ${r.status !== "cancelled" ? `<button class="btn btn--danger-ghost btn--sm" type="button" data-evcmd-reg-status="${esc(r.id)}" data-next-status="cancelled">Hủy</button>` : ""}
                      </div>
                    </div>`;
                  })
                  .join("")}</div>`
              : `<p class="page-sub">Không có khách phù hợp với bộ lọc hiện tại.</p>`
          }
        </div>
      </div>`;
      return;
    }

    if (tab === "lifecycle") {
      const savedAudioUrl = String(ev.reelAudioUrl || "").trim();
      const savedAudioTitle = String(ev.reelAudioTitle || "").trim();
      const isPresetMode =
        savedAudioUrl === "" ||
        savedAudioUrl === "preset:holaheart" ||
        savedAudioUrl === "preset:holagreen" ||
        savedAudioUrl === "preset:holaconnect" ||
        savedAudioUrl === "preset:silent";
      const audioMode = isPresetMode ? savedAudioUrl : "custom";
      const customAudioUrl = isPresetMode ? "" : savedAudioUrl;

      box.innerHTML = `<form id="evcmd-lifecycle-form" class="deep-section">
        <div class="deep-card">
          <h3>Trạng thái Sân khấu &amp; Khóa giữ chỗ</h3>
          <div class="form-row-2">
            <div class="field">
              <label for="evcmd-stage-override">Chế độ hiển thị trang <code>/su-kien/${esc(ev.slug || ev.id)}/</code></label>
              <select id="evcmd-stage-override">
                <option value="auto" ${(ev.stageOverride || "auto") === "auto" ? "selected" : ""}>Tự động theo ngày diễn ra</option>
                <option value="invite" ${ev.stageOverride === "invite" ? "selected" : ""}>Ép giữ giao diện Thư mời &amp; Giữ chỗ</option>
                <option value="memory" ${ev.stageOverride === "memory" ? "selected" : ""}>Ép mở Sân khấu Kỷ niệm (Album &amp; Lưu bút)</option>
              </select>
            </div>
            <div class="field">
              <label for="evcmd-status">Trạng thái công khai</label>
              <select id="evcmd-status">
                <option value="published" ${ev.status === "published" ? "selected" : ""}>Công khai trên website</option>
                <option value="draft" ${ev.status === "draft" ? "selected" : ""}>Lưu nháp (ẩn)</option>
              </select>
            </div>
          </div>
          <label class="check-chip" style="margin-top:12px;">
            <input type="checkbox" id="evcmd-rsvp-closed" ${ev.rsvpClosed ? "checked" : ""}>
            <span><strong>Khóa nhận đơn giữ chỗ mới:</strong> Chặn biểu mẫu đăng ký (trả mã 409) ngay cả khi sự kiện chưa hết chỗ hoặc chưa qua ngày.</span>
          </label>
        </div>

        <div class="deep-card">
          <h3>Nhạc nền Thước phim Kỷ niệm (Apple Photos Reel)</h3>
          <p class="page-sub" style="margin:0 0 12px;">Tùy biến bản nhạc riêng cho sự kiện này khi khách bấm "Phát thước phim kỷ niệm".</p>
          <div class="form-row-2">
            <div class="field">
              <label for="evcmd-reel-audio-mode">Chế độ nhạc nền</label>
              <select id="evcmd-reel-audio-mode">
                <option value="" ${audioMode === "" ? "selected" : ""}>Tự động theo trụ cột (Piano trầm ấm)</option>
                <option value="preset:holaheart" ${audioMode === "preset:holaheart" ? "selected" : ""}>Preset · HolaHeart (Fmaj9 ấm áp)</option>
                <option value="preset:holagreen" ${audioMode === "preset:holagreen" ? "selected" : ""}>Preset · HolaGreen (Gmaj9 rừng thông)</option>
                <option value="preset:holaconnect" ${audioMode === "preset:holaconnect" ? "selected" : ""}>Preset · HolaConnect (Cmaj9 tươi sáng)</option>
                <option value="preset:silent" ${audioMode === "preset:silent" ? "selected" : ""}>Tắt nhạc mặc định (Khách tự bật nếu muốn)</option>
                <option value="custom" ${audioMode === "custom" ? "selected" : ""}>Nhạc riêng (Tải file MP3/M4A/OGG/WAV hoặc dán link)</option>
              </select>
            </div>
            <div class="field">
              <label for="evcmd-reel-audio-title">Tên bản nhạc hiển thị trên thước phim (tùy chọn)</label>
              <input id="evcmd-reel-audio-title" type="text" maxlength="120" value="${esc(savedAudioTitle)}" placeholder="VD: Chiều rừng thông · Acoustic">
            </div>
          </div>
          <div id="evcmd-reel-custom-wrap" style="margin-top:12px;${audioMode === "custom" ? "" : "display:none;"}">
            <div class="field">
              <label for="evcmd-reel-audio-url">Đường dẫn tệp nhạc (MP3, M4A, OGG, WAV)</label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <input id="evcmd-reel-audio-url" type="text" maxlength="500" value="${esc(customAudioUrl)}" placeholder="/api/media/... hoặc https://..." style="flex:1 1 240px;">
                <label class="btn btn--outline btn--sm" style="cursor:pointer;margin:0;white-space:nowrap;">
                  Tải tệp nhạc lên
                  <input id="evcmd-reel-audio-file" type="file" accept=".mp3,.m4a,.ogg,.wav,audio/mpeg,audio/mp4,audio/ogg,audio/wav" hidden>
                </label>
              </div>
              <small id="evcmd-reel-audio-status" class="cell-sub" style="display:block;margin-top:6px;">Hỗ trợ MP3, M4A, OGG, WAV (tối đa 15 MB qua Google Drive hoặc 8 MB qua KV).</small>
            </div>
            <div id="evcmd-reel-audio-player-wrap" style="margin-top:10px;${customAudioUrl ? "" : "display:none;"}">
              <audio id="evcmd-reel-audio-preview" controls preload="none" src="${esc(customAudioUrl)}" style="width:100%;height:40px;"></audio>
            </div>
          </div>
        </div>

        <div class="deep-card">
          <h3>Sức chứa &amp; Thanh hiển thị chỗ trống</h3>
          <div class="form-row-2">
            <div class="field">
              <label for="evcmd-seat-cap">Tổng sức chứa (0 = không giới hạn)</label>
              <input id="evcmd-seat-cap" type="number" min="0" max="5000" value="${Number(ev.seatCapacity || 0)}">
            </div>
            <div class="field">
              <label for="evcmd-ext-booked">Số chỗ đăng ký ngoài web</label>
              <input id="evcmd-ext-booked" type="number" min="0" max="5000" value="${Number(ev.externalBooked || 0)}">
            </div>
          </div>
          <label class="check-chip" style="margin-top:12px;">
            <input type="checkbox" id="evcmd-show-seat-bar" ${ev.showSeatBar ? "checked" : ""}>
            <span>Hiển thị thanh chỗ còn lại trên trang Thư mời</span>
          </label>
        </div>

        <div class="dialog-foot" style="padding:0;border:0;">
          <button class="btn btn--primary" type="submit">Lưu cấu hình điều hành</button>
        </div>
      </form>`;
      return;
    }

    if (tab === "media") {
      const alb = data.album;
      if (!alb) {
        box.innerHTML = `<div class="state-box">
          <h3>Sự kiện này chưa gắn Album ảnh</h3>
          <p>Bạn có thể tạo Album mới và tải ảnh gốc từ Ban Hình Ảnh tại cổng <code>/media/</code>.</p>
          <a class="btn btn--primary" href="/media/">Mở kho ảnh /media/ ↗</a>
        </div>`;
        return;
      }

      const granted = alb.grantedMembers || [];
      const grantedSet = new Set(granted.map((g) => g.memberId));
      const availableMembers = (data.members || []).filter((m) => !grantedSet.has(m.id));

      box.innerHTML = `<div class="deep-section">
        <div class="mini-kpi-row">
          <div class="mini-kpi"><span>Tổng ảnh</span><strong>${alb.photoCount}</strong></div>
          <div class="mini-kpi"><span>Đã duyệt</span><strong>${alb.approvedCount}</strong></div>
          <div class="mini-kpi"><span>Chờ duyệt</span><strong>${alb.pendingCount}</strong></div>
          <div class="mini-kpi"><span>Quyền xem</span><strong style="font-size:0.9rem;">${esc(VISIBILITY_LABEL[alb.visibility] || alb.visibility)}</strong></div>
        </div>

        <form id="evcmd-album-form" class="deep-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
            <h3 style="margin:0;">Album gắn kết: ${esc(alb.title)}</h3>
            <a class="btn btn--outline btn--sm" href="/media/?album=${encodeURIComponent(alb.id)}">Quản lý ảnh tại /media/ ↗</a>
          </div>
          <input type="hidden" id="evcmd-album-id" value="${esc(alb.id)}">
          <div class="form-row-2">
            <div class="field">
              <label for="evcmd-album-vis">Quyền xem Album &amp; Ảnh gốc (bảo vệ cả Edge Proxy)</label>
              <select id="evcmd-album-vis">
                <option value="public" ${alb.visibility === "public" ? "selected" : ""}>Công khai (ai có link cũng xem được)</option>
                <option value="members_only" ${alb.visibility === "members_only" ? "selected" : ""}>Chỉ Thành viên đăng nhập</option>
                <option value="attendees_only" ${alb.visibility === "attendees_only" ? "selected" : ""}>Người đã đăng ký / dự buổi &amp; người được cấp quyền</option>
                <option value="private" ${alb.visibility === "private" ? "selected" : ""}>Riêng tư tuyệt đối (chỉ Quản trị &amp; thành viên được cấp)</option>
              </select>
            </div>
            <div class="field">
              <label for="evcmd-album-status">Trạng thái Album</label>
              <select id="evcmd-album-status">
                <option value="published" ${alb.status === "published" ? "selected" : ""}>Xuất bản</option>
                <option value="draft" ${alb.status === "draft" ? "selected" : ""}>Ẩn (Nháp)</option>
              </select>
            </div>
          </div>
          <div style="margin-top:12px;">
            <button class="btn btn--primary btn--sm" type="submit">Lưu quyền xem Album</button>
          </div>
        </form>

        <div class="deep-card">
          <h3>Thành viên được cấp quyền xem riêng (${granted.length})</h3>
          <form id="evcmd-grant-member-form" class="inline-assign-bar" style="margin-bottom:12px;">
            <div class="field">
              <label for="evcmd-grant-member-select">Thêm thành viên được phép xem album này</label>
              <select id="evcmd-grant-member-select" required>
                <option value="">— Chọn thành viên —</option>
                ${availableMembers.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.memberCode)})</option>`).join("")}
              </select>
            </div>
            <button class="btn btn--outline btn--sm" type="submit" style="min-height:40px;">+ Cấp quyền xem</button>
          </form>
          ${
            granted.length
              ? `<div class="item-list">${granted
                  .map(
                    (g) => `<div class="user-row">
                      <div>
                        <strong>${esc(g.name)}</strong>
                        <span class="cell-sub"><code>${esc(g.memberCode)}</code>${g.phoneDisplay ? ` · ${esc(g.phoneDisplay)}` : ""} · Cấp lúc ${esc(formatVnDateTime(g.grantedAt))}</span>
                      </div>
                      <div class="item-actions">
                        <button class="btn btn--danger-ghost btn--sm" type="button" data-evcmd-revoke-member="${esc(g.memberId)}" data-album-id="${esc(alb.id)}">Thu hồi</button>
                      </div>
                    </div>`
                  )
                  .join("")}</div>`
              : `<p class="page-sub">Chưa cấp quyền riêng cho thành viên nào (chế độ quyền xem chung phía trên vẫn đang áp dụng).</p>`
          }
        </div>
      </div>`;
      return;
    }

    if (tab === "feedbacks") {
      const fbs = data.feedbacks || [];
      box.innerHTML = fbs.length
        ? renderFeedbackCards(fbs, "evcmd")
        : `<div class="state-box"><h3>Chưa có góp ý nào cho sự kiện này</h3><p>Góp ý gửi từ Sân khấu Kỷ niệm của buổi gặp sẽ xuất hiện trực tiếp tại đây.</p></div>`;
      return;
    }

    if (tab === "email") {
      const provider = data.emailProvider || {};
      const logs = data.emailLogs || [];
      const activeEmailSet = new Set();
      const attendedEmailSet = new Set();
      for (const r of data.registrations || []) {
        const em = String(r.email || "").trim().toLowerCase();
        if (!em || !em.includes("@") || r.status === "cancelled") continue;
        activeEmailSet.add(em);
        if (r.status === "attended") attendedEmailSet.add(em);
      }
      const defaultAlbumUrl =
        (data.album && data.album.driveUrl) || `${SITE_ORIGIN}/su-kien/${ev.slug || ev.id}/`;
      const defaultTestEmail = (state.user && state.user.email) || "phungsu@holarise.org";
      const tplLabels = {
        rsvp_confirm: "Xác nhận giữ chỗ",
        event_reminder: "Nhắc trước giờ G",
        event_thankyou: "Cảm ơn & Album",
        test_preview: "Bản test",
      };
      const statusBadge = (s) => {
        if (s === "sent") return `<span class="badge badge--attended">Đã gửi</span>`;
        if (s === "failed") return `<span class="badge badge--cancelled">Lỗi</span>`;
        return `<span class="badge badge--pending">Bỏ qua</span>`;
      };

      box.innerHTML = `<div class="deep-section">
        <div class="deep-card">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
            <h3 style="margin:0;">Trạng thái kênh gửi Email</h3>
            <span class="badge ${provider.canSendToGuests ? "badge--attended" : "badge--pending"}">${esc(provider.label || "Chưa cấu hình")}</span>
          </div>
          <p class="page-sub" style="margin:0;">
            Khách giữ chỗ có email: <strong>${activeEmailSet.size}</strong> · Đã check-in có email: <strong>${attendedEmailSet.size}</strong> · Thư xác nhận giữ chỗ tự động gửi ngay khi khách RSVP có điền email.
          </p>
        </div>

        <form id="evcmd-email-form" class="deep-card admin-form">
          <h3>Soạn &amp; Gửi thư cho khách sự kiện</h3>
          <div class="form-row-2">
            <div class="field">
              <label for="evcmd-email-tpl">Loại thư</label>
              <select id="evcmd-email-tpl">
                <option value="event_reminder" ${ev.kind === "upcoming" ? "selected" : ""}>Thư nhắc trước giờ G</option>
                <option value="event_thankyou" ${ev.kind === "past" ? "selected" : ""}>Thư cảm ơn &amp; mở Kho ảnh sau buổi</option>
              </select>
            </div>
            <div class="field">
              <label for="evcmd-email-audience">Đối tượng nhận</label>
              <select id="evcmd-email-audience">
                <option value="active">Tất cả khách giữ chỗ có email (${activeEmailSet.size})</option>
                <option value="attended">Chỉ khách đã check-in có email (${attendedEmailSet.size})</option>
              </select>
            </div>
          </div>
          <div class="form-row-2">
            <div class="field">
              <label for="evcmd-email-lang">Ngôn ngữ thư</label>
              <select id="evcmd-email-lang">
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </div>
            <div class="field">
              <label for="evcmd-email-test-to">Email nhận bản test</label>
              <input id="evcmd-email-test-to" type="email" value="${esc(defaultTestEmail)}" placeholder="phungsu@holarise.org">
            </div>
          </div>
          <div class="field">
            <label for="evcmd-email-album-url">Link Kho ảnh / Kỷ niệm (dùng cho Thư cảm ơn)</label>
            <input id="evcmd-email-album-url" type="url" value="${esc(defaultAlbumUrl)}" placeholder="https://holarise.org/su-kien/...">
          </div>
          <div class="field">
            <label for="evcmd-email-note">Lời nhắn thêm từ Ban Điều Phối (tùy chọn)</label>
            <textarea id="evcmd-email-note" rows="3" placeholder="Ví dụ: Gửi xe miễn phí ngay cổng quán, trời Hòa Lạc tối hơi lạnh bạn nhớ mang áo khoác mỏng."></textarea>
          </div>
          <div id="evcmd-email-alert" class="form-alert" hidden></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <button class="btn btn--outline btn--sm" type="button" data-evcmd-email-action="preview">Xem trước nội dung</button>
            <button class="btn btn--outline btn--sm" type="button" data-evcmd-email-action="test">Gửi bản test</button>
            <button class="btn btn--primary btn--sm" type="button" data-evcmd-email-action="send_all">Gửi cho khách sự kiện</button>
          </div>
          <div id="evcmd-email-preview-wrap" hidden style="margin-top:14px;border:1px solid var(--line-strong);border-radius:10px;overflow:hidden;background:#FAF8F4;">
            <div style="padding:10px 14px;background:#F5F1E8;border-bottom:1px solid var(--line-strong);font-size:13px;">
              <strong>Tiêu đề:</strong> <span id="evcmd-email-preview-subject">—</span>
              <span id="evcmd-email-preview-meta" class="cell-sub" style="margin-left:8px;"></span>
            </div>
            <iframe id="evcmd-email-preview-frame" title="Xem trước email" sandbox="" style="width:100%;height:420px;border:0;background:#FAF8F4;"></iframe>
          </div>
        </form>

        <div class="deep-card">
          <h3>Lịch sử gửi Email (${logs.length})</h3>
          ${
            logs.length
              ? `<div class="table-wrap"><table class="data-table">
                  <thead><tr><th>Thời gian</th><th>Người nhận</th><th>Loại thư</th><th>Kênh</th><th>Trạng thái</th></tr></thead>
                  <tbody>${logs
                    .map(
                      (l) => `<tr>
                        <td><span class="cell-sub">${esc(formatVnDateTime(l.createdAt))}</span></td>
                        <td><strong>${esc(l.recipientName || "—")}</strong><span class="cell-sub">${esc(l.recipientEmail)}</span></td>
                        <td>${esc(tplLabels[l.templateType] || l.templateType)}</td>
                        <td><code>${esc(l.provider || "none")}</code></td>
                        <td>${statusBadge(l.status)}${l.errorMessage ? `<span class="cell-sub" style="display:block;color:#b42318;">${esc(l.errorMessage.slice(0, 90))}</span>` : ""}</td>
                      </tr>`
                    )
                    .join("")}</tbody>
                </table></div>`
              : `<p class="page-sub" style="margin:0;">Chưa có email nào được gửi cho sự kiện này.</p>`
          }
        </div>
      </div>`;
    }
  }

  /* =========================================================================
     TAB 5: VISUALS, PARTNERS, INTEGRATIONS & SECURITY
     ========================================================================= */
  function getVisualSlotData(visuals, key) {
    const v = visuals && typeof visuals === "object" ? visuals : {};
    if (key === "hero") return { url: v.heroImage || "", alt: v.heroImageAlt || "", isIllustration: Boolean(v.heroIsIllustration) };
    if (key === "about") return { url: v.aboutImage || "", alt: v.aboutImageAlt || "", isIllustration: Boolean(v.aboutIsIllustration) };
    const p = v.pillars && v.pillars[key] ? v.pillars[key] : {};
    return { url: p.image || "", alt: p.imageAlt || "", isIllustration: Boolean(p.isIllustration) };
  }

  function renderVisualsEditor() {
    const grid = $("#visuals-editor-grid");
    if (!grid) return;
    grid.innerHTML = VISUAL_SLOTS.map((slot) => {
      const cur = getVisualSlotData(state.visuals, slot.key);
      const src = cur.url || slot.fallback;
      const isCustom = Boolean(cur.url && cur.url !== slot.fallback);
      return `<article class="visual-slot-card" data-visual-slot="${esc(slot.key)}">
        <div class="visual-slot-media">
          <img id="vis-prev-${esc(slot.key)}" src="${esc(src)}" alt="Xem trước ${esc(slot.label)}" loading="lazy">
          <span class="visual-slot-badge ${isCustom ? "is-custom" : ""}">${isCustom ? "Ảnh CMS" : "Mặc định"}</span>
        </div>
        <div class="visual-slot-body">
          <div class="visual-slot-bar">
            <strong>${esc(slot.label)}</strong>
            <div class="visual-slot-actions">
              <label class="btn btn--outline btn--sm visual-pick-btn">
                <span>Thay ảnh</span>
                <input type="file" accept="image/*" class="visually-hidden" data-visual-upload="${esc(slot.key)}">
              </label>
              <button class="btn btn--ghost btn--sm" type="button" data-open-crop="vis-url-${esc(slot.key)}" data-crop-preview="vis-prev-${esc(slot.key)}" data-crop-meta="vis-meta-${esc(slot.key)}" data-crop-category="giao-dien" data-default-ratio="1.7778">Cắt khung</button>
              <button class="btn btn--ghost btn--sm" type="button" data-visual-reset="${esc(slot.key)}" ${isCustom ? "" : "hidden"}>Mặc định</button>
            </div>
          </div>
          <div class="upload-meta visual-slot-meta" id="vis-meta-${esc(slot.key)}"></div>
          <details class="visual-slot-more">
            <summary>Mô tả ảnh &amp; tùy chọn nâng cao</summary>
            <div class="visual-slot-more-body">
              <div class="field">
                <label for="vis-alt-${esc(slot.key)}">Mô tả ảnh (Alt text)</label>
                <input type="text" id="vis-alt-${esc(slot.key)}" value="${esc(cur.alt || "")}" placeholder="Mô tả ngắn gọn nội dung ảnh">
              </div>
              <div class="field">
                <label for="vis-url-${esc(slot.key)}">Đường dẫn ảnh</label>
                <input type="text" id="vis-url-${esc(slot.key)}" value="${esc(cur.url || "")}" placeholder="${esc(slot.fallback)}" autocorrect="off" autocapitalize="none" spellcheck="false">
              </div>
              <label class="check-chip">
                <input type="checkbox" id="vis-real-${esc(slot.key)}" ${cur.isIllustration ? "" : "checked"}>
                <span>Ảnh chụp thật (ẩn nhãn Ảnh định hướng)</span>
              </label>
            </div>
          </details>
        </div>
      </article>`;
    }).join("");
  }

  function renderPartnersList() {
    const box = $("#partners-container");
    if (!box) return;
    if (!state.partners.length) {
      renderEmptyState(
        box,
        "Chưa công bố đối tác nào",
        "Trang web sẽ tự ẩn dải đối tác cho tới khi bạn thêm và bật hiển thị ít nhất một đơn vị đồng hành.",
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
    const res = await api("/api/admin/partners", { method: "PUT", body: { items: nextList } });
    state.partners = res.items || [];
    renderPartnersList();
    if (successMsg) toast(successMsg, "success");
  }

  function renderUsersList() {
    const box = $("#users-container");
    if (!box) return;
    if (!state.users.length) {
      renderEmptyState(box, "Chưa có tài khoản Ban nào", "Bấm '+ Cấp tài khoản Ban' để phân quyền cho Ban Sự Kiện, Ban Nội Dung hoặc Ban Hình Ảnh.");
      return;
    }
    box.innerHTML = state.users
      .map((u) => {
        const isSelf = u.id === state.user?.id;
        const roleLabel = u.roleLabel || u.roleShortLabel || u.role;
        const deptLabel = u.department ? ` · ${u.department}` : "";
        return `<div class="user-row">
          <div>
            <strong>${esc(u.name)}</strong>
            ${isSelf ? '<span class="badge badge--new">Bạn</span>' : ""}
            <span class="badge badge--${u.is_active ? "published" : "cancelled"}">${u.is_active ? "Hoạt động" : "Đã khóa"}</span>
            <span class="cell-sub">${esc(u.email)} · ${esc(roleLabel)}${esc(deptLabel)}${u.last_login_at ? ` · Lần cuối: ${esc(formatVnDateTime(u.last_login_at))}` : ""}</span>
          </div>
          ${
            !isSelf
              ? `<div class="item-actions">
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

  function renderAiApiConfig(cfg) {
    const healthEl = $("#ai-api-health");
    const listEl = $("#ai-api-slots-list");
    const slots = Array.isArray(cfg?.slots) ? cfg.slots : [];
    const count = Number(cfg?.keyCount || slots.length || 0);
    if (healthEl) {
      healthEl.innerHTML = `
        <span class="health-pill ${count > 0 ? "is-ok" : "is-warn"}"><span class="health-dot"></span>Gemini API Pool: ${count > 0 ? `${count} khóa đang hoạt động` : "Chưa có khóa nào"}</span>
        <span class="health-pill is-ok"><span class="health-dot"></span>Model: ${esc(cfg?.model || "gemini-nano-banana-2.1")}</span>
        <span class="health-pill is-ok"><span class="health-dot"></span>Mặc định: ${esc(cfg?.defaultImageSize || "2K")} · ${esc(cfg?.defaultAspectRatio === "auto" ? "Giữ tỉ lệ gốc" : cfg?.defaultAspectRatio || "auto")}</span>
      `;
    }
    if (listEl) {
      if (slots.length === 0) {
        listEl.innerHTML = '<p class="field-hint">Chưa có khóa Gemini nào được gắn. Dán khóa vào ô bên dưới để kích hoạt AI Studio trên <code>/media/</code>.</p>';
      } else {
        listEl.innerHTML = slots
          .map(
            (s) => `
            <div class="user-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line,rgba(11,17,15,0.1));border-radius:10px;margin-bottom:8px;background:#fff;">
              <div style="min-width:0;">
                <strong style="display:block;font-size:0.88rem;">${esc(s.label)}</strong>
                <span style="font-size:0.78rem;color:var(--muted,#5c6b64);">${esc(s.masked || "")} · ${s.source === "admin" ? "Lưu trong Admin (D1)" : `Cloudflare Env (${esc(s.source)})`}</span>
              </div>
              ${
                s.removable
                  ? `<button class="btn btn--outline btn--sm" type="button" data-remove-ai-key="${esc(s.id)}">Xóa</button>`
                  : '<span class="field-hint" style="margin:0;">Env</span>'
              }
            </div>`
          )
          .join("");
      }
    }
    if ($("#ai-def-model")) $("#ai-def-model").value = cfg?.model || "gemini-nano-banana-2.1";
    if ($("#ai-def-fallback-model")) $("#ai-def-fallback-model").value = cfg?.fallbackModel || "";
    if ($("#ai-def-size")) $("#ai-def-size").value = cfg?.defaultImageSize || "2K";
    if ($("#ai-def-ratio")) $("#ai-def-ratio").value = cfg?.defaultAspectRatio || "auto";
    if ($("#ai-def-slogan")) $("#ai-def-slogan").value = cfg?.defaultSlogan ?? "Together We Rise, Together We Serve.";
  }

  async function loadSettings() {
    const [vRes, pRes, sRes, uRes, mInfo, aiRes] = await Promise.allSettled([
      api("/api/admin/visuals"),
      api("/api/admin/partners"),
      api("/api/admin/settings"),
      api("/api/admin/users"),
      getMediaStorageInfo(),
      api("/api/admin/ai-config"),
    ]);

    if (vRes.status === "fulfilled") {
      state.visuals = vRes.value.visuals || {};
      renderVisualsEditor();
    }
    if (pRes.status === "fulfilled") {
      state.partners = pRes.value.items || [];
      renderPartnersList();
    } else {
      renderErrorState($("#partners-container"), pRes.reason?.message || "Lỗi tải đối tác", "settings");
    }
    if (sRes.status === "fulfilled") {
      const s = sRes.value.settings || {};
      $("#set-notify-email").value = s.notify_email || "";
      $("#set-webhook-url").value = s.gas_webhook_url || "";
      $("#set-webhook-secret").value = "";
      $("#set-secret-hint").textContent = s.has_webhook_secret
        ? "Đã lưu mã bí mật. Để trống nếu giữ nguyên, hoặc nhập mã mới để thay thế."
        : "Nhập mã trùng với WEBHOOK_SECRET bạn đặt trong Google Apps Script.";
      const driveOk = mInfo.status === "fulfilled" && mInfo.value?.driveConfigured;
      const healthEl = $("#integration-health");
      if (healthEl) {
        healthEl.innerHTML = `
          <span class="health-pill ${driveOk ? "is-ok" : "is-warn"}"><span class="health-dot"></span>Google Drive: ${driveOk ? "Đang hoạt động (ảnh gốc)" : "Đang dùng MEDIA_KV"}</span>
          <span class="health-pill ${s.gas_webhook_url ? "is-ok" : "is-warn"}"><span class="health-dot"></span>Apps Script: ${s.gas_webhook_url ? "Đã cấu hình URL" : "Chưa cấu hình"}</span>
          <span class="health-pill ${s.has_webhook_secret ? "is-ok" : "is-warn"}"><span class="health-dot"></span>Webhook Secret: ${s.has_webhook_secret ? "Đã bảo vệ" : "Chưa đặt"}</span>
        `;
      }
    }
    if (uRes.status === "fulfilled") {
      state.users = uRes.value.items || [];
      renderUsersList();
    }
    if (aiRes.status === "fulfilled") {
      renderAiApiConfig(aiRes.value);
    }
  }

  /* =========================================================================
     Event Binding & Submissions
     ========================================================================= */
  function bindEvents() {
    // Primary navigation
    $$("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });

    // Sub-tabs
    $$("[data-comm-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.commSubtab = btn.getAttribute("data-comm-subtab");
        switchSubtab("data-comm-subtab", "data-comm-panel", state.commSubtab);
      });
    });
    $$("[data-set-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.setSubtab = btn.getAttribute("data-set-subtab");
        switchSubtab("data-set-subtab", "data-set-panel", state.setSubtab);
      });
    });
    $$("[data-post-mode]").forEach((btn) => {
      btn.addEventListener("click", () => setPostEditorMode(btn.getAttribute("data-post-mode")));
    });

    // Logout
    const handleLogout = async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } finally {
        state.user = null;
        showAuthScreen({ initialized: true });
        toast("Đã đăng xuất an toàn.");
      }
    };
    $("#btn-logout")?.addEventListener("click", handleLogout);
    $("#btn-logout-mobile")?.addEventListener("click", handleLogout);
    $("#btn-forbidden-logout")?.addEventListener("click", handleLogout);

    // Auth: Passkey Login
    $("#btn-passkey-login")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const alertEl = $("#passkey-alert");
      showAlert(alertEl, "");
      if (!window.HolaPasskey?.isSupported?.()) {
        showAlert(alertEl, "Thiết bị này chưa hỗ trợ sinh trắc học. Vui lòng đăng nhập bằng Email & Mật khẩu bên dưới.");
        return;
      }
      const span = btn.querySelector("span") || btn;
      const prev = span.textContent;
      btn.disabled = true;
      span.textContent = "Đang xác thực...";
      try {
        const res = await window.HolaPasskey.loginWithPasskey("");
        toast(`Chào mừng trở lại, ${res.user.name}!`, "success");
        handleAuthenticatedUser(res.user, Boolean(res.isSoleAdmin), res);
      } catch (err) {
        showAlert(alertEl, err?.message || "Đăng nhập sinh trắc học không thành công.");
      } finally {
        btn.disabled = false;
        span.textContent = prev;
      }
    });

    // Auth: Email + Password Login
    $("#login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#login-alert");
      showAlert(alertEl, "");
      if (!form.checkValidity()) {
        form.querySelector(":invalid")?.focus();
        showAlert(alertEl, "Vui lòng nhập email và mật khẩu hợp lệ.");
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
        handleAuthenticatedUser(res.user, Boolean(res.isSoleAdmin), res);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Đăng nhập bằng Email";
      }
    });

    // Auth: Bootstrap (empty DB)
    $("#bootstrap-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#boot-alert");
      showAlert(alertEl, "");
      if (!form.checkValidity()) {
        form.querySelector(":invalid")?.focus();
        showAlert(alertEl, "Vui lòng điền đầy đủ họ tên, email và mật khẩu tối thiểu 8 ký tự.");
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
        toast("Khởi tạo Quản trị chính thành công!", "success");
        const st = await api("/api/auth/status");
        handleAuthenticatedUser(st.user || res.user, Boolean(st.isSoleAdmin), st);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Tạo tài khoản Quản trị chính";
      }
    });

    // Overview quick refresh & actions
    $("#btn-refresh-overview")?.addEventListener("click", () => loadOverview());
    $$("[data-quick-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-quick-action");
        if (act === "new-event") openEventDialog(null);
        else if (act === "new-post") openPostDialog(null);
      });
    });

    // Registrations filters, pagination & export
    $$("[data-reg-status]").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$("[data-reg-status]").forEach((c) => c.classList.toggle("is-active", c === chip));
        state.regFilter.status = chip.getAttribute("data-reg-status") || "";
        syncUrlParams();
        loadRegistrations(false);
      });
    });
    $("#reg-filter-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      state.regFilter.q = $("#reg-search").value.trim();
      state.regFilter.activity = $("#reg-activity-filter").value;
      state.regFilter.source = $("#reg-source-filter").value;
      syncUrlParams();
      loadRegistrations(false);
    });
    $("#btn-refresh-regs")?.addEventListener("click", () => loadRegistrations(false));
    $("#btn-load-more-regs")?.addEventListener("click", () => loadRegistrations(true));
    $("#btn-export-csv")?.addEventListener("click", () => {
      const qs = new URLSearchParams();
      if (state.regFilter.status) qs.set("status", state.regFilter.status);
      if (state.regFilter.activity) qs.set("activity", state.regFilter.activity);
      window.location.href = `/api/admin/registrations/export?${qs.toString()}`;
    });

    // Registration detail modal submit / convert to member / resync / delete
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
        loadRegistrations(false);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu cập nhật";
      }
    });

    $("#btn-reg-to-member")?.addEventListener("click", () => {
      const id = $("#reg-detail-id").value;
      const reg = state.registrations.find((r) => r.id === id);
      if (!reg) return;
      $("#reg-dialog").close();
      openMemberDialog({
        name: reg.full_name,
        phoneDisplay: reg.phone,
        email: reg.email,
        organization: reg.organization,
        notes: `Chuyển từ đơn ${reg.id} (${reg.activity_title})`,
      });
    });

    $("#btn-resync-reg")?.addEventListener("click", async () => {
      const id = $("#reg-detail-id").value;
      const btn = $("#btn-resync-reg");
      btn.disabled = true;
      btn.textContent = "Đang đồng bộ...";
      try {
        const res = await api(`/api/admin/registrations/${encodeURIComponent(id)}/resync`, { method: "POST" });
        if (res.sync_status === "synced") toast("Đã đồng bộ Google Sheets & Email thành công!", "success");
        else if (res.sync_status === "skipped") toast("Chưa cấu hình URL Google Apps Script trong mục Cài đặt.", "error");
        else toast(res.sync_error || "Đồng bộ thất bại.", "error");
        $("#reg-dialog").close();
        loadRegistrations(false);
      } catch (err) {
        toast(formatApiError(err), "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Đồng bộ lại Sheet";
      }
    });

    $("#btn-delete-reg")?.addEventListener("click", async () => {
      const id = $("#reg-detail-id").value;
      const ok = await openConfirmDialog({
        title: "Xóa đơn đăng ký",
        message: `Xóa vĩnh viễn đơn đăng ký ${id}? Thao tác này không thể hoàn tác.`,
        confirmLabel: "Xóa đơn",
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/admin/registrations/${encodeURIComponent(id)}`, { method: "DELETE" });
        $("#reg-dialog").close();
        toast("Đã xóa đơn đăng ký.");
        loadRegistrations(false);
      } catch (err) {
        toast(err.message, "error");
      }
    });

    // Events filter, search, presets & submit
    $("#btn-refresh-events")?.addEventListener("click", () => loadEvents());
    $("#btn-new-event")?.addEventListener("click", () => openEventDialog(null));
    $$("[data-ev-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.eventFilter = btn.getAttribute("data-ev-filter");
        $$("[data-ev-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderEventsList();
      });
    });
    $("#event-search")?.addEventListener("input", (e) => {
      state.eventSearch = e.target.value || "";
      renderEventsList();
    });
    $$("[data-ev-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = EVENT_PRESETS[btn.getAttribute("data-ev-preset")];
        if (!p) return;
        $("#ev-type").value = p.type;
        $("#ev-time").value = p.time;
        $("#ev-location").value = p.location;
        $("#ev-fee").value = p.fee;
        $("#ev-seats").value = p.seats;
        $("#ev-seat-capacity").value = p.seatCapacity;
        $("#ev-image").value = p.image;
        $("#ev-image-preview").src = p.image;
        const set = new Set(p.filters);
        $$('input[name="filters"]', $("#event-form")).forEach((cb) => {
          cb.checked = set.has(cb.value);
        });
        toast("Đã điền sẵn mẫu khung giờ & địa điểm.", "success");
      });
    });

    $("#event-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector('button[type="submit"]');
      const alertEl = $("#ev-alert");
      showAlert(alertEl, "");

      const id = $("#ev-id").value.trim();
      const filters = $$('input[name="filters"]:checked', form).map((cb) => cb.value);
      const highlights = $("#ev-highlights")
        .value.split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 6);

      const evAudioMode = $("#ev-reel-audio-mode")?.value || "";
      const evCustomAudioUrl = ($("#ev-reel-audio-url")?.value || "").trim();
      if (evAudioMode === "custom" && !evCustomAudioUrl) {
        showAlert(alertEl, "Vui lòng tải tệp nhạc lên hoặc dán đường dẫn nhạc hợp lệ.");
        $("#ev-reel-audio-url")?.focus();
        return;
      }
      const reelAudioUrl = evAudioMode === "custom" ? evCustomAudioUrl : evAudioMode;
      const reelAudioTitle = ($("#ev-reel-audio-title")?.value || "").trim();

      const body = {
        kind: $("#ev-kind").value,
        status: $("#ev-status").value,
        sortOrder: Number($("#ev-sort-order").value || 0),
        title: $("#ev-title").value.trim(),
        titleEn: $("#ev-title-en").value.trim(),
        type: $("#ev-type").value,
        date: $("#ev-date").value.trim(),
        dateDisplay: $("#ev-date-display").value.trim(),
        time: $("#ev-time").value.trim(),
        location: $("#ev-location").value.trim(),
        fee: $("#ev-fee").value.trim(),
        zaloGroupUrl: $("#ev-zalo-url").value.trim(),
        reelAudioUrl,
        reelAudioTitle,
        seats: $("#ev-seats").value.trim(),
        seatCapacity: Number($("#ev-seat-capacity").value || 0),
        externalBooked: Number($("#ev-external-booked").value || 0),
        showSeatBar: Boolean($("#ev-show-seat-bar").checked),
        summary: $("#ev-summary").value.trim(),
        summaryEn: $("#ev-summary-en").value.trim(),
        highlights,
        participants: $("#ev-participants").value.trim(),
        image: $("#ev-image").value.trim(),
        imageAlt: $("#ev-image-alt").value.trim(),
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
        if (state.activeTab === "events") loadEvents();
        else if (state.activeTab === "overview") loadOverview();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu & Cập nhật ngay";
      }
    });

    // Posts filter, search, Markdown toolbar & submit
    $("#btn-refresh-posts")?.addEventListener("click", () => loadPosts());
    $("#btn-new-post")?.addEventListener("click", () => openPostDialog(null));
    $$("[data-post-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.postFilter = btn.getAttribute("data-post-filter");
        $$("[data-post-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderPostsList();
      });
    });
    $("#post-search")?.addEventListener("input", (e) => {
      state.postSearch = e.target.value || "";
      renderPostsList();
    });
    $("#post-title")?.addEventListener("input", () => {
      if (!state.slugTouched) $("#post-slug").value = slugifyVi($("#post-title").value);
    });
    $("#post-slug")?.addEventListener("input", () => {
      state.slugTouched = true;
    });
    $("#post-content")?.addEventListener("input", updatePostWordCount);

    $$("[data-md-insert]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ta = $("#post-content");
        if (!ta) return;
        const kind = btn.getAttribute("data-md-insert");
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? start;
        const selected = ta.value.slice(start, end);
        const snippets = {
          h2: `\n\n## ${selected || "Tiêu đề mục"}\n\n`,
          h3: `\n\n### ${selected || "Tiểu mục"}\n\n`,
          bold: `**${selected || "từ khóa nổi bật"}**`,
          quote: `\n\n> ${selected || "Trích dẫn ngắn từ buổi gặp"}\n\n`,
          list: `\n- ${selected || "Ý đầu tiên"}\n- Ý thứ hai\n`,
          link: `[${selected || "Xem lịch hoạt động"}](/lich-hoat-dong/)`,
        };
        const insert = snippets[kind] || "";
        ta.setRangeText(insert, start, end, "end");
        ta.focus();
        updatePostWordCount();
      });
    });

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
        imageAlt: $("#post-image-alt").value.trim(),
        excerpt: $("#post-excerpt").value.trim(),
        content: $("#post-content").value,
        reviewNote: $("#post-review-note")?.value?.trim() || "",
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
        if (state.activeTab === "posts") loadPosts();
        else if (state.activeTab === "overview") loadOverview();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu bài viết";
      }
    });

    // Community: Reflections & Members
    $("#btn-refresh-community")?.addEventListener("click", () => loadCommunity());
    $("#btn-new-reflection")?.addEventListener("click", () => openReflectionDialog(null));
    $("#btn-new-member")?.addEventListener("click", () => openMemberDialog(null));

    $$("[data-ref-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.refStatus = btn.getAttribute("data-ref-status") || "";
        $$("[data-ref-status]").forEach((b) => b.classList.toggle("is-active", b === btn));
        loadAdminReflections();
      });
    });

    // Community: Event Feedbacks filters
    $$("[data-fb-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.fbFilter.status = btn.getAttribute("data-fb-status") || "";
        $$("[data-fb-status]").forEach((b) => b.classList.toggle("is-active", b === btn));
        loadAdminFeedbacks();
      });
    });
    $("#fb-event-filter")?.addEventListener("change", (e) => {
      state.fbFilter.eventId = e.target.value || "";
      loadAdminFeedbacks();
    });
    $("#fb-cat-filter")?.addEventListener("change", (e) => {
      state.fbFilter.category = e.target.value || "";
      loadAdminFeedbacks();
    });

    // Member 360 & Event Command Center sub-tabs & dynamic forms
    $$("[data-m360-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setM360Tab(btn.getAttribute("data-m360-tab")));
    });
    $$("[data-evcmd-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setEvCmdTab(btn.getAttribute("data-evcmd-tab")));
    });

    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "evcmd-attendee-search") {
        state.evCmd.search = e.target.value || "";
        const cursor = e.target.selectionStart ?? state.evCmd.search.length;
        renderEventCommandContent();
        const nextInput = $("#evcmd-attendee-search");
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange?.(cursor, cursor);
        }
      }
    });

    document.addEventListener("submit", async (e) => {
      const form = e.target;
      if (!form || !form.id) return;

      if (form.id === "m360-assign-form") {
        e.preventDefault();
        const eventId = $("#m360-assign-event")?.value || "";
        const status = $("#m360-assign-status")?.value || "attended";
        if (!eventId) {
          toast("Vui lòng chọn sự kiện cần gán.", "error");
          return;
        }
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
          await api(`/api/admin/members/${encodeURIComponent(state.m360.memberId)}/actions`, {
            method: "POST",
            body: { action: "assign_event", eventId, status },
          });
          toast("Đã gán thành viên vào sự kiện!", "success");
          await openMember360(state.m360.memberId, "journey");
          if (state.activeTab === "community") loadAdminMembers();
        } catch (err) {
          toast(formatApiError(err), "error");
        } finally {
          if (btn) btn.disabled = false;
        }
        return;
      }

      if (form.id === "m360-media-form") {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const canViewAllMedia = Boolean($("#m360-view-all-media")?.checked);
        const canAccessMediaPortal = Boolean($("#m360-media-portal")?.checked);
        const albumIds = $$('input[name="albumIds"]:checked', form).map((cb) => cb.value);
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Đang lưu...";
        }
        try {
          await api(`/api/admin/members/${encodeURIComponent(state.m360.memberId)}/actions`, {
            method: "POST",
            body: { action: "set_album_grants", canViewAllMedia, canAccessMediaPortal, albumIds },
          });
          toast("Đã cập nhật quyền xem Media cho thành viên!", "success");
          await openMember360(state.m360.memberId, "media");
          if (state.activeTab === "community") loadAdminMembers();
        } catch (err) {
          toast(formatApiError(err), "error");
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Lưu quyền xem Media";
          }
        }
        return;
      }

      if (form.id === "evcmd-add-attendee-form") {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const payload = {
          action: "add_attendee",
          memberId: $("#evcmd-add-member")?.value || "",
          fullName: ($("#evcmd-add-name")?.value || "").trim(),
          phone: ($("#evcmd-add-phone")?.value || "").trim(),
          organization: ($("#evcmd-add-org")?.value || "").trim(),
          status: $("#evcmd-add-status")?.value || "attended",
        };
        if (btn) btn.disabled = true;
        try {
          await api(`/api/admin/events/${encodeURIComponent(state.evCmd.eventId)}/command`, {
            method: "POST",
            body: payload,
          });
          toast("Đã thêm người tham dự vào sự kiện!", "success");
          await openEventCommand(state.evCmd.eventId, "attendees");
          if (state.activeTab === "events") loadEvents();
        } catch (err) {
          toast(formatApiError(err), "error");
        } finally {
          if (btn) btn.disabled = false;
        }
        return;
      }

      if (form.id === "evcmd-lifecycle-form") {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const audioMode = $("#evcmd-reel-audio-mode")?.value || "";
        const customUrl = ($("#evcmd-reel-audio-url")?.value || "").trim();
        const reelAudioUrl = audioMode === "custom" ? customUrl : audioMode;
        const reelAudioTitle = ($("#evcmd-reel-audio-title")?.value || "").trim();
        if (audioMode === "custom" && !customUrl) {
          toast("Vui lòng tải tệp nhạc lên hoặc dán đường dẫn nhạc hợp lệ.", "error");
          $("#evcmd-reel-audio-url")?.focus();
          return;
        }
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Đang lưu...";
        }
        try {
          await api(`/api/admin/events/${encodeURIComponent(state.evCmd.eventId)}/command`, {
            method: "PATCH",
            body: {
              stageOverride: $("#evcmd-stage-override")?.value || "auto",
              rsvpClosed: Boolean($("#evcmd-rsvp-closed")?.checked),
              status: $("#evcmd-status")?.value || "published",
              seatCapacity: Number($("#evcmd-seat-cap")?.value || 0),
              externalBooked: Number($("#evcmd-ext-booked")?.value || 0),
              showSeatBar: Boolean($("#evcmd-show-seat-bar")?.checked),
              reelAudioUrl,
              reelAudioTitle,
            },
          });
          toast("Đã cập nhật vòng đời, nhạc nền & cấu hình sự kiện!", "success");
          await openEventCommand(state.evCmd.eventId, "lifecycle");
          if (state.activeTab === "events") loadEvents();
          else if (state.activeTab === "overview") loadOverview();
        } catch (err) {
          toast(formatApiError(err), "error");
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Lưu cấu hình điều hành";
          }
        }
        return;
      }

      if (form.id === "evcmd-album-form") {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const albumId = $("#evcmd-album-id")?.value || "";
        if (!albumId) return;
        if (btn) btn.disabled = true;
        try {
          await api(`/api/admin/events/${encodeURIComponent(state.evCmd.eventId)}/command`, {
            method: "PATCH",
            body: {
              albumId,
              albumVisibility: $("#evcmd-album-vis")?.value || "public",
              albumStatus: $("#evcmd-album-status")?.value || "published",
            },
          });
          toast("Đã lưu quyền xem & trạng thái Album!", "success");
          await openEventCommand(state.evCmd.eventId, "media");
        } catch (err) {
          toast(formatApiError(err), "error");
        } finally {
          if (btn) btn.disabled = false;
        }
        return;
      }

      if (form.id === "evcmd-grant-member-form") {
        e.preventDefault();
        const memberId = $("#evcmd-grant-member-select")?.value || "";
        const albumId = state.evCmd.data?.album?.id || "";
        if (!memberId || !albumId) {
          toast("Vui lòng chọn thành viên cần cấp quyền.", "error");
          return;
        }
        try {
          await api(`/api/admin/events/${encodeURIComponent(state.evCmd.eventId)}/command`, {
            method: "POST",
            body: { action: "grant_album_member", albumId, memberId },
          });
          toast("Đã cấp quyền xem Album cho thành viên!", "success");
          await openEventCommand(state.evCmd.eventId, "media");
        } catch (err) {
          toast(formatApiError(err), "error");
        }
      }
    });

    $("#member-search-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      state.memberSearch = ($("#member-search-input")?.value || "").trim();
      loadAdminMembers();
    });

    $("#member-editor-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#member-editor-alert");
      showAlert(alertEl, "");
      const id = ($("#mem-id").value || "").trim();
      const payload = {
        name: $("#mem-name").value.trim(),
        roleTitle: $("#mem-role-title").value.trim(),
        phone: $("#mem-phone").value.trim(),
        email: $("#mem-email").value.trim(),
        organization: $("#mem-org").value.trim(),
        pillarChoice: $("#mem-pillar").value,
        bio: $("#mem-bio").value.trim(),
        notes: $("#mem-notes").value.trim(),
        avatarUrl: $("#mem-avatar").value.trim(),
        isPublicTeam: $("#mem-public-team").checked,
      };
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        if (id) {
          await api(`/api/admin/members/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
          toast("Đã cập nhật hồ sơ thành viên!", "success");
        } else {
          await api("/api/admin/members", { method: "POST", body: payload });
          toast("Đã thêm thành viên mới!", "success");
        }
        $("#member-dialog").close();
        if (state.activeTab === "community") loadAdminMembers();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu thành viên";
      }
    });

    $("#reflection-editor-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#reflection-editor-alert");
      showAlert(alertEl, "");
      const id = ($("#ref-id").value || "").trim();
      const kind = $("#ref-kind").value || "community";

      const payload =
        kind === "member"
          ? {
              status: $("#ref-status").value,
              adminNote: $("#ref-admin-note").value.trim(),
            }
          : {
              authorName: $("#ref-author").value.trim(),
              participantRole: $("#ref-role").value.trim(),
              authorOrg: $("#ref-org").value.trim(),
              activitySlug: $("#ref-slug").value.trim(),
              pullQuote: $("#ref-quote").value.trim(),
              content: $("#ref-content").value.trim(),
              photoUrl: $("#ref-photo").value.trim(),
              status: $("#ref-status").value,
              isFeaturedHome: $("#ref-featured").checked,
            };

      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        if (id) {
          await api(`/api/admin/reflections/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
          toast("Đã cập nhật cảm nhận!", "success");
        } else {
          await api("/api/admin/reflections", { method: "POST", body: payload });
          toast("Đã lưu cảm nhận mới!", "success");
        }
        $("#reflection-dialog").close();
        loadAdminReflections();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu cảm nhận";
      }
    });

    // Settings: Visuals upload, reset & save
    document.addEventListener("change", async (e) => {
      const input = e.target.closest("input[data-visual-upload]");
      if (!input) return;
      const slot = input.getAttribute("data-visual-upload");
      const file = input.files && input.files[0];
      if (!file) return;
      const metaEl = document.getElementById(`vis-meta-${slot}`);
      const urlEl = document.getElementById(`vis-url-${slot}`);
      const prevEl = document.getElementById(`vis-prev-${slot}`);
      if (metaEl) metaEl.textContent = "Đang tải ảnh lên...";
      input.disabled = true;
      try {
        const up = await uploadImageAsset({ file, category: "giao-dien", maxWidth: 1600 });
        if (urlEl) urlEl.value = up.url;
        if (prevEl) prevEl.src = up.url;
        const resetBtn = document.querySelector(`button[data-visual-reset="${slot}"]`);
        if (resetBtn) resetBtn.hidden = false;
        if (metaEl) {
          metaEl.textContent = `Đã tải lên (${formatKb(up.size)}). Bấm “Lưu hình ảnh giao diện” để áp dụng.`;
        }
        toast("Đã tải ảnh lên — nhớ bấm Lưu để xuất bản!", "success");
      } catch (err) {
        if (metaEl) metaEl.textContent = `Lỗi: ${err.message}`;
        toast(err.message, "error");
      } finally {
        input.disabled = false;
        input.value = "";
      }
    });

    // Event Command Center: Per-event custom soundtrack mode, file upload & live preview
    document.addEventListener("change", async (e) => {
      const modeSelect = e.target.closest("#evcmd-reel-audio-mode");
      if (modeSelect) {
        const customWrap = $("#evcmd-reel-custom-wrap");
        const isCustom = modeSelect.value === "custom";
        if (customWrap) customWrap.style.display = isCustom ? "" : "none";
        if (!isCustom) {
          const prev = $("#evcmd-reel-audio-preview");
          if (prev && typeof prev.pause === "function") prev.pause();
        }
        return;
      }

      const audioFileInput = e.target.closest("#evcmd-reel-audio-file");
      if (!audioFileInput) return;
      const file = audioFileInput.files && audioFileInput.files[0];
      if (!file) return;
      const statusEl = $("#evcmd-reel-audio-status");
      const urlInput = $("#evcmd-reel-audio-url");
      const titleInput = $("#evcmd-reel-audio-title");
      const playerWrap = $("#evcmd-reel-audio-player-wrap");
      const previewEl = $("#evcmd-reel-audio-preview");

      if (statusEl) statusEl.textContent = "Đang tải tệp nhạc lên máy chủ...";
      audioFileInput.disabled = true;
      try {
        const form = new FormData();
        form.append("category", "su-kien");
        const evTitle = String(state.evCmd.data?.event?.title || "").trim();
        if (evTitle) form.append("subfolder", evTitle.slice(0, 100));
        form.append("file", file, file.name || "soundtrack.mp3");
        const up = await api("/api/admin/media", { method: "POST", body: form });
        if (urlInput) urlInput.value = up.url || "";
        if (titleInput && !titleInput.value.trim() && file.name) {
          titleInput.value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120);
        }
        if (previewEl && up.url) {
          previewEl.src = up.url;
          if (playerWrap) playerWrap.style.display = "";
        }
        if (statusEl) {
          statusEl.textContent = `Đã tải lên thành công (${formatKb(up.size)}). Bấm “Lưu cấu hình điều hành” để áp dụng.`;
        }
        toast("Đã tải tệp nhạc lên — bấm Lưu để gắn vào sự kiện!", "success");
      } catch (err) {
        if (statusEl) statusEl.textContent = `Lỗi tải nhạc: ${err.message}`;
        toast(formatApiError(err), "error");
      } finally {
        audioFileInput.disabled = false;
        audioFileInput.value = "";
      }
    });

    document.addEventListener("input", (e) => {
      const urlInput = e.target.closest("#evcmd-reel-audio-url");
      if (!urlInput) return;
      const val = urlInput.value.trim();
      const playerWrap = $("#evcmd-reel-audio-player-wrap");
      const previewEl = $("#evcmd-reel-audio-preview");
      const ok = val.startsWith("/") || val.startsWith("https://");
      if (previewEl) {
        if (ok) {
          previewEl.src = val;
        } else {
          previewEl.pause();
          previewEl.removeAttribute("src");
        }
      }
      if (playerWrap) playerWrap.style.display = ok ? "" : "none";
    });

    $("#event-command-dialog")?.addEventListener("close", () => {
      const prev = $("#evcmd-reel-audio-preview");
      if (prev && typeof prev.pause === "function") prev.pause();
    });

    // Event Edit Modal (#event-dialog): Per-event music mode, file upload & live preview
    $("#ev-reel-audio-mode")?.addEventListener("change", (e) => {
      const isCustom = e.currentTarget.value === "custom";
      const wrap = $("#ev-reel-custom-wrap");
      if (wrap) wrap.hidden = !isCustom;
      if (!isCustom) {
        const prev = $("#ev-reel-audio-preview");
        if (prev && typeof prev.pause === "function") prev.pause();
      }
    });

    $("#ev-reel-audio-url")?.addEventListener("input", (e) => {
      const val = e.currentTarget.value.trim();
      const wrap = $("#ev-reel-audio-player-wrap");
      const prev = $("#ev-reel-audio-preview");
      const ok = val.startsWith("/") || val.startsWith("https://");
      if (prev) {
        if (ok) prev.src = val;
        else {
          prev.pause();
          prev.removeAttribute("src");
        }
      }
      if (wrap) wrap.hidden = !ok;
    });

    $("#ev-reel-audio-file")?.addEventListener("change", async (e) => {
      const input = e.currentTarget;
      const file = input.files && input.files[0];
      if (!file) return;
      const statusEl = $("#ev-reel-audio-status");
      const urlEl = $("#ev-reel-audio-url");
      const titleEl = $("#ev-reel-audio-title");
      const wrap = $("#ev-reel-audio-player-wrap");
      const prev = $("#ev-reel-audio-preview");
      if (statusEl) statusEl.textContent = "Đang tải tệp nhạc lên máy chủ...";
      input.disabled = true;
      try {
        const form = new FormData();
        form.append("category", "su-kien");
        const evTitle = ($("#ev-title")?.value || "").trim();
        if (evTitle) form.append("subfolder", evTitle.slice(0, 100));
        form.append("file", file, file.name || "soundtrack.mp3");
        const up = await api("/api/admin/media", { method: "POST", body: form });
        if (urlEl) urlEl.value = up.url || "";
        if (titleEl && !titleEl.value.trim() && file.name) {
          titleEl.value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120);
        }
        if (prev && up.url) {
          prev.src = up.url;
          if (wrap) wrap.hidden = false;
        }
        if (statusEl) statusEl.textContent = `Đã tải nhạc lên thành công (${formatKb(up.size)}). Bấm Lưu để áp dụng.`;
        toast("Đã tải tệp nhạc lên — bấm Lưu để gắn vào sự kiện!", "success");
      } catch (err) {
        if (statusEl) statusEl.textContent = `Lỗi tải nhạc: ${err.message}`;
        toast(formatApiError(err), "error");
      } finally {
        input.disabled = false;
        input.value = "";
      }
    });

    $("#event-dialog")?.addEventListener("close", () => {
      const prev = $("#ev-reel-audio-preview");
      if (prev && typeof prev.pause === "function") prev.pause();
    });

    $("#visuals-editor-grid")?.addEventListener("click", (e) => {
      const resetBtn = e.target.closest("button[data-visual-reset]");
      if (!resetBtn) return;
      const slotKey = resetBtn.getAttribute("data-visual-reset");
      const slot = VISUAL_SLOTS.find((s) => s.key === slotKey);
      if (!slot) return;
      const urlEl = document.getElementById(`vis-url-${slotKey}`);
      const prevEl = document.getElementById(`vis-prev-${slotKey}`);
      const metaEl = document.getElementById(`vis-meta-${slotKey}`);
      if (urlEl) urlEl.value = "";
      if (prevEl) prevEl.src = slot.fallback;
      if (metaEl) metaEl.textContent = "Đã khôi phục ảnh mặc định — bấm Lưu để áp dụng.";
      resetBtn.hidden = true;
    });

    $("#visuals-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#btn-save-visuals");
      const alertEl = $("#visuals-alert");
      showAlert(alertEl, "");
      const payload = { pillars: {} };
      VISUAL_SLOTS.forEach((slot) => {
        const url = (document.getElementById(`vis-url-${slot.key}`)?.value || "").trim() || slot.fallback;
        const alt = (document.getElementById(`vis-alt-${slot.key}`)?.value || "").trim();
        const isReal = Boolean(document.getElementById(`vis-real-${slot.key}`)?.checked);
        if (slot.key === "hero") {
          payload.heroImage = url;
          if (alt) payload.heroImageAlt = alt;
          payload.heroIsIllustration = !isReal;
        } else if (slot.key === "about") {
          payload.aboutImage = url;
          if (alt) payload.aboutImageAlt = alt;
          payload.aboutIsIllustration = !isReal;
        } else {
          payload.pillars[slot.key] = { image: url, imageAlt: alt, isIllustration: !isReal };
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

    // Settings: Partners
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

    // Settings: AI API Keys & Defaults
    $("#ai-key-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#ai-key-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        const res = await api("/api/admin/ai-config", {
          method: "POST",
          body: {
            action: "add_key",
            label: $("#ai-key-label")?.value.trim() || "",
            apiKeys: $("#ai-key-input")?.value.trim() || "",
          },
        });
        if ($("#ai-key-label")) $("#ai-key-label").value = "";
        if ($("#ai-key-input")) $("#ai-key-input").value = "";
        showAlert(alertEl, `Đã thêm ${res.added || 0} khóa API (tổng cộng ${res.keyCount || 0} khóa đang hoạt động).`, true);
        loadSettings();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "+ Thêm API Key";
      }
    });

    $("#ai-api-slots-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-remove-ai-key]");
      if (!btn) return;
      const keyId = btn.getAttribute("data-remove-ai-key");
      const alertEl = $("#ai-key-alert");
      btn.disabled = true;
      btn.textContent = "Đang xóa...";
      try {
        await api("/api/admin/ai-config", {
          method: "POST",
          body: { action: "remove_key", keyId },
        });
        showAlert(alertEl, "Đã xóa khóa API khỏi Admin.", true);
        loadSettings();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
        btn.disabled = false;
        btn.textContent = "Xóa";
      }
    });

    $("#ai-defaults-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#ai-defaults-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        const res = await api("/api/admin/ai-config", {
          method: "POST",
          body: {
            action: "save_defaults",
            model: $("#ai-def-model")?.value.trim() || "",
            fallbackModel: $("#ai-def-fallback-model")?.value.trim() || "",
            defaultImageSize: $("#ai-def-size")?.value || "2K",
            defaultAspectRatio: $("#ai-def-ratio")?.value || "auto",
            defaultSlogan: $("#ai-def-slogan")?.value ?? "",
          },
        });
        renderAiApiConfig(res);
        showAlert(alertEl, "Đã lưu cấu hình AI mặc định.", true);
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu cấu hình AI mặc định";
      }
    });

    // Settings: GAS Webhook
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
        showAlert(alertEl, "Đã lưu cài đặt đồng bộ Google Sheets & Email.", true);
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

    // Settings: Passkey setup
    $("#btn-setup-passkey")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const alertEl = $("#passkey-setup-alert");
      showAlert(alertEl, "");
      if (!window.HolaPasskey?.isSupported?.()) {
        showAlert(alertEl, "Trình duyệt hoặc thiết bị này chưa hỗ trợ WebAuthn Passkey.");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Đang kích hoạt...";
      try {
        await window.HolaPasskey.registerPasskey();
        showAlert(alertEl, "Đã kích hoạt Face ID / Touch ID cho thiết bị này thành công!", true);
        toast("Đã bật đăng nhập sinh trắc học!", "success");
      } catch (err) {
        showAlert(alertEl, err?.message || "Không thể kích hoạt sinh trắc học.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Kích hoạt Face ID / Passkey";
      }
    });

    // Settings: Change own password
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

    // Settings: Create media-only user
    $("#btn-new-media-user")?.addEventListener("click", () => {
      $("#media-user-form").reset();
      showAlert($("#user-alert"), "");
      $("#media-user-dialog").showModal();
    });
    $("#media-user-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('button[type="submit"]');
      const alertEl = $("#user-alert");
      showAlert(alertEl, "");
      btn.disabled = true;
      btn.textContent = "Đang tạo...";
      try {
        const selectedRole = $("#u-role")?.value || "media_ctv";
        const selectedDept = $("#u-department")?.value || "";
        await api("/api/admin/users", {
          method: "POST",
          body: {
            name: $("#u-name").value.trim(),
            email: $("#u-email").value.trim(),
            role: selectedRole,
            department: selectedDept,
            password: $("#u-password").value,
          },
        });
        $("#media-user-dialog").close();
        toast("Đã cấp tài khoản thành viên Ban.", "success");
        if (state.activeTab === "team") window.__holariseManager?.loadTeamAndAudit();
        else loadSettings();
      } catch (err) {
        showAlert(alertEl, formatApiError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Cấp tài khoản";
      }
    });

    // Global delegated click handler
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest(
        "button[data-go-tab], button[data-copy-url], button[data-invite-personal], button[data-open-crop], button[data-quick-reg-status], button[data-open-reg], button[data-event-command], button[data-dup-event], button[data-edit-event], button[data-delete-event], button[data-edit-post], button[data-delete-post], button[data-mod-ref], button[data-pin-ref], button[data-edit-ref], button[data-delete-ref], button[data-fb-status-set], button[data-fb-note], button[data-fb-delete], button[data-member-360], button[data-m360-checkin-reg], button[data-m360-remove-reg], button[data-m360-revoke-sessions], button[data-m360-toggle-active], button[data-m360-edit-profile], button[data-evcmd-reg-status], button[data-evcmd-revoke-member], button[data-evcmd-email-action], button[data-edit-member], button[data-toggle-member], button[data-reset-member-pw], button[data-delete-member], button[data-toggle-partner], button[data-edit-partner], button[data-delete-partner], button[data-toggle-user], button[data-reset-user-pw], button[data-delete-user], button[data-retry], button[data-empty-cta]"
      );
      if (!btn) return;

      const m360Id = btn.getAttribute("data-member-360");
      if (m360Id) {
        openMember360(m360Id, "journey");
        return;
      }

      if (btn.dataset.eventCommand) {
        openEventCommand(btn.dataset.eventCommand, "attendees");
        return;
      }

      if (btn.dataset.m360CheckinReg) {
        try {
          await api(`/api/admin/registrations/${encodeURIComponent(btn.dataset.m360CheckinReg)}`, {
            method: "PATCH",
            body: { status: "attended" },
          });
          toast("Đã check-in tham gia sự kiện!", "success");
          openMember360(state.m360.memberId, "journey");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.m360RemoveReg) {
        const ok = await openConfirmDialog({
          title: "Gỡ lịch sử tham dự",
          message: `Xóa bản ghi đăng ký ${btn.dataset.m360RemoveReg} khỏi hành trình thành viên?`,
          confirmLabel: "Gỡ bản ghi",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/members/${encodeURIComponent(state.m360.memberId)}/actions`, {
            method: "POST",
            body: { action: "remove_registration", registrationId: btn.dataset.m360RemoveReg },
          });
          toast("Đã gỡ lịch sử đăng ký.");
          openMember360(state.m360.memberId, "journey");
          if (state.activeTab === "community") loadAdminMembers();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.m360RevokeSessions) {
        const ok = await openConfirmDialog({
          title: "Đăng xuất toàn bộ thiết bị",
          message: "Thu hồi ngay mọi phiên đăng nhập của thành viên này trên điện thoại và máy tính?",
          confirmLabel: "Đăng xuất ngay",
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api(`/api/admin/members/${encodeURIComponent(btn.dataset.m360RevokeSessions)}/actions`, {
            method: "POST",
            body: { action: "revoke_sessions" },
          });
          toast(res.message || "Đã thu hồi toàn bộ phiên đăng nhập.", "success");
          openMember360(state.m360.memberId, "security");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.m360ToggleActive) {
        const nextActive = btn.dataset.active !== "1";
        try {
          await api(`/api/admin/members/${encodeURIComponent(btn.dataset.m360ToggleActive)}`, {
            method: "PATCH",
            body: { isActive: nextActive },
          });
          toast(nextActive ? "Đã mở khóa tài khoản thành viên." : "Đã khóa tài khoản thành viên.");
          openMember360(state.m360.memberId, "security");
          if (state.activeTab === "community") loadAdminMembers();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.m360EditProfile) {
        const m = state.m360.data?.member || state.members.find((x) => x.id === btn.dataset.m360EditProfile);
        $("#member-360-dialog")?.close();
        if (m) openMemberDialog(m);
        return;
      }

      if (btn.dataset.evcmdRegStatus) {
        const regId = btn.dataset.evcmdRegStatus;
        const nextStatus = btn.dataset.nextStatus;
        try {
          await api(`/api/admin/registrations/${encodeURIComponent(regId)}`, {
            method: "PATCH",
            body: { status: nextStatus },
          });
          toast(
            nextStatus === "attended"
              ? "Đã check-in tham gia!"
              : nextStatus === "contacted"
                ? "Đã đánh dấu Đã liên hệ."
                : "Đã cập nhật trạng thái đơn.",
            "success"
          );
          openEventCommand(state.evCmd.eventId, "attendees");
          if (state.activeTab === "events") loadEvents();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.evcmdRevokeMember) {
        const memberId = btn.dataset.evcmdRevokeMember;
        const albumId = btn.dataset.albumId;
        try {
          await api(`/api/admin/events/${encodeURIComponent(state.evCmd.eventId)}/command`, {
            method: "POST",
            body: { action: "revoke_album_member", albumId, memberId },
          });
          toast("Đã thu hồi quyền xem Album của thành viên.");
          openEventCommand(state.evCmd.eventId, "media");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.evcmdEmailAction) {
        const mode = btn.dataset.evcmdEmailAction;
        if (!state.evCmd.eventId) return;
        const templateType = $("#evcmd-email-tpl")?.value || "event_reminder";
        const audience = $("#evcmd-email-audience")?.value || "active";
        const lang = $("#evcmd-email-lang")?.value || "vi";
        const testEmail = ($("#evcmd-email-test-to")?.value || "").trim();
        const albumUrl = ($("#evcmd-email-album-url")?.value || "").trim();
        const customNote = ($("#evcmd-email-note")?.value || "").trim();
        const alertEl = $("#evcmd-email-alert");
        showAlert(alertEl, "");

        if (mode === "send_all") {
          const tplName = templateType === "event_thankyou" ? "Thư cảm ơn & Kho ảnh" : "Thư nhắc trước giờ G";
          if (!confirm(`Xác nhận gửi "${tplName}" cho toàn bộ khách đủ điều kiện của sự kiện này? (Hệ thống tự động bỏ qua người đã nhận trước đó)`)) {
            return;
          }
        }

        btn.disabled = true;
        try {
          const res = await api(`/api/admin/events/${encodeURIComponent(state.evCmd.eventId)}/send-email`, {
            method: "POST",
            body: { mode, templateType, audience, lang, testEmail, albumUrl, customNote },
          });
          if (mode === "preview" && res.preview) {
            const wrap = $("#evcmd-email-preview-wrap");
            const subj = $("#evcmd-email-preview-subject");
            const meta = $("#evcmd-email-preview-meta");
            const frame = $("#evcmd-email-preview-frame");
            if (subj) subj.textContent = res.preview.subject || "";
            if (meta) {
              meta.textContent = `(${res.pendingCount} khách sẽ nhận · ${res.alreadySentCount} đã gửi trước đó)`;
            }
            if (frame) frame.srcdoc = res.preview.html || "";
            if (wrap) wrap.hidden = false;
          } else {
            toast(res.message || "Đã hoàn tất gửi email.", "success");
            await openEventCommand(state.evCmd.eventId, "email");
          }
        } catch (err) {
          showAlert(alertEl, formatApiError(err));
          toast(formatApiError(err), "error");
        } finally {
          btn.disabled = false;
        }
        return;
      }

      if (btn.dataset.fbStatusSet) {
        const id = btn.dataset.fbStatusSet;
        const nextStatus = btn.dataset.nextStatus;
        const ctx = btn.dataset.fbCtx || "global";
        try {
          await api(`/api/admin/event-feedback/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { status: nextStatus },
          });
          toast(nextStatus === "resolved" ? "Đã đánh dấu Đã xử lý góp ý." : "Đã đánh dấu Đã đọc góp ý.", "success");
          if (ctx === "evcmd" && state.evCmd.eventId) openEventCommand(state.evCmd.eventId, "feedbacks");
          if (state.activeTab === "community") loadAdminFeedbacks();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.fbNote) {
        const id = btn.dataset.fbNote;
        const ctx = btn.dataset.fbCtx || "global";
        const note = await openConfirmDialog({
          title: "Ghi chú nội bộ cho góp ý",
          message: "Ghi chú này chỉ hiển thị trong trang Quản trị, không công khai ra ngoài.",
          confirmLabel: "Lưu ghi chú",
          inputLabel: "Ghi chú điều phối",
          inputValue: btn.dataset.currentNote || "",
          inputPlaceholder: "Ví dụ: Đã trao đổi với MC để điều chỉnh âm thanh...",
        });
        if (note === null) return;
        try {
          await api(`/api/admin/event-feedback/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { adminNote: note },
          });
          toast("Đã lưu ghi chú nội bộ.", "success");
          if (ctx === "evcmd" && state.evCmd.eventId) openEventCommand(state.evCmd.eventId, "feedbacks");
          if (state.activeTab === "community") loadAdminFeedbacks();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.fbDelete) {
        const id = btn.dataset.fbDelete;
        const ctx = btn.dataset.fbCtx || "global";
        const ok = await openConfirmDialog({
          title: "Xóa góp ý sự kiện",
          message: "Xóa vĩnh viễn góp ý này khỏi hộp thư Ban Điều Phối?",
          confirmLabel: "Xóa góp ý",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/event-feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
          toast("Đã xóa góp ý.");
          if (ctx === "evcmd" && state.evCmd.eventId) openEventCommand(state.evCmd.eventId, "feedbacks");
          if (state.activeTab === "community") loadAdminFeedbacks();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.goTab) {
        if (btn.dataset.goTab === "registrations" && btn.dataset.goStatus !== undefined) {
          state.regFilter.status = btn.dataset.goStatus;
          $$("[data-reg-status]").forEach((c) =>
            c.classList.toggle("is-active", (c.getAttribute("data-reg-status") || "") === state.regFilter.status)
          );
        }
        switchTab(btn.dataset.goTab);
        return;
      }

      if (btn.dataset.copyUrl) {
        copyText(btn.dataset.copyUrl, "Đã sao chép đường dẫn để dán vào Zalo.");
        return;
      }

      if (btn.dataset.invitePersonal) {
        const name = await openConfirmDialog({
          title: "Tạo link Thư mời cá nhân hóa",
          message: `Nhập tên người nhận cho sự kiện “${btn.dataset.inviteTitle || ""}” để gắn vào thẻ preview Zalo (?gui=...).`,
          confirmLabel: "Tạo & Sao chép link",
          inputLabel: "Tên người nhận",
          inputPlaceholder: "Ví dụ: Minh Anh",
        });
        if (name) {
          const url = `${btn.dataset.invitePersonal}?gui=${encodeURIComponent(name)}`;
          copyText(url, `Đã sao chép link mời riêng cho ${name}.`);
        }
        return;
      }

      if (btn.dataset.openCrop) {
        const targetInput = document.getElementById(btn.dataset.openCrop);
        const previewImg = document.getElementById(btn.dataset.cropPreview);
        const metaEl = document.getElementById(btn.dataset.cropMeta);
        const src = (targetInput && targetInput.value.trim()) || (previewImg && previewImg.src) || "";
        if (!src) {
          toast("Vui lòng chọn hoặc dán đường dẫn ảnh trước khi cắt khung.", "error");
          return;
        }
        openCropper({
          src,
          targetInput,
          previewImg,
          metaEl,
          category: btn.dataset.cropCategory || "giao-dien",
          defaultRatio: Number(btn.dataset.defaultRatio || 16 / 9),
        });
        return;
      }

      if (btn.dataset.quickRegStatus) {
        const id = btn.dataset.quickRegStatus;
        const nextStatus = btn.dataset.nextStatus;
        btn.disabled = true;
        try {
          await api(`/api/admin/registrations/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { status: nextStatus },
          });
          toast(
            nextStatus === "attended" ? "Đã check-in tham gia sự kiện!" : "Đã đánh dấu Đã liên hệ.",
            "success"
          );
          loadRegistrations(false);
        } catch (err) {
          toast(err.message, "error");
          btn.disabled = false;
        }
        return;
      }

      if (btn.dataset.openReg) {
        openRegDialog(btn.dataset.openReg);
        return;
      }

      if (btn.dataset.dupEvent) {
        const ev = state.events.find((x) => x.id === btn.dataset.dupEvent);
        if (ev) {
          openEventDialog({ ...ev, id: "", title: `${ev.title} (Mới)` });
          $("#event-dialog-title").textContent = "Nhân bản lịch sự kiện";
        }
        return;
      }
      if (btn.dataset.editEvent) {
        const ev = state.events.find((x) => x.id === btn.dataset.editEvent);
        if (ev) openEventDialog(ev);
        return;
      }
      if (btn.dataset.deleteEvent) {
        const ev = state.events.find((x) => x.id === btn.dataset.deleteEvent);
        if (!ev) return;
        const ok = await openConfirmDialog({
          title: "Xóa sự kiện",
          message: `Xóa vĩnh viễn sự kiện “${ev.title}”?`,
          confirmLabel: "Xóa sự kiện",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/events/${encodeURIComponent(ev.id)}`, { method: "DELETE" });
          toast("Đã xóa sự kiện.");
          loadEvents();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.editPost) {
        const p = state.posts.find((x) => x.id === btn.dataset.editPost);
        if (p) openPostDialog(p);
        return;
      }
      if (btn.dataset.deletePost) {
        const p = state.posts.find((x) => x.id === btn.dataset.deletePost);
        if (!p) return;
        const ok = await openConfirmDialog({
          title: "Xóa bài viết",
          message: `Xóa vĩnh viễn bài viết “${p.title}”?`,
          confirmLabel: "Xóa bài",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/posts/${encodeURIComponent(p.id)}`, { method: "DELETE" });
          toast("Đã xóa bài viết.");
          loadPosts();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.modRef) {
        try {
          await api(`/api/admin/reflections/${encodeURIComponent(btn.dataset.modRef)}`, {
            method: "PATCH",
            body: { status: btn.dataset.modStatus },
          });
          toast(btn.dataset.modStatus === "approved" ? "Đã duyệt và xuất bản lưu bút!" : "Đã ẩn lưu bút.", "success");
          loadAdminReflections();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.pinRef) {
        const nextPinned = btn.dataset.pinned !== "1";
        try {
          await api(`/api/admin/reflections/${encodeURIComponent(btn.dataset.pinRef)}`, {
            method: "PATCH",
            body: { isFeaturedHome: nextPinned },
          });
          toast(nextPinned ? "Đã ghim ra Trang chủ." : "Đã bỏ ghim khỏi Trang chủ.", "success");
          loadAdminReflections();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.editRef) {
        const rf = state.reflections.find((x) => x.id === btn.dataset.editRef);
        if (rf) openReflectionDialog(rf);
        return;
      }
      if (btn.dataset.deleteRef) {
        const ok = await openConfirmDialog({
          title: "Xóa cảm nhận",
          message: "Xóa vĩnh viễn lưu bút / cảm nhận này và ảnh đính kèm?",
          confirmLabel: "Xóa",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/reflections/${encodeURIComponent(btn.dataset.deleteRef)}`, { method: "DELETE" });
          toast("Đã xóa cảm nhận.");
          loadAdminReflections();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.editMember) {
        const m = state.members.find((x) => x.id === btn.dataset.editMember);
        if (m) openMemberDialog(m);
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
        const newPw = await openConfirmDialog({
          title: "Cấp mật khẩu tạm cho Thành viên",
          message: "Nhập mật khẩu tạm mới (tối thiểu 6 ký tự). Phiên đăng nhập cũ của thành viên sẽ tự đăng xuất.",
          confirmLabel: "Cập nhật mật khẩu",
          inputLabel: "Mật khẩu tạm mới",
          inputType: "password",
          inputPlaceholder: "Tối thiểu 6 ký tự",
          inputMinLength: 6,
        });
        if (!newPw || newPw.length < 6) return;
        try {
          await api(`/api/admin/members/${encodeURIComponent(btn.dataset.resetMemberPw)}`, {
            method: "PATCH",
            body: { resetPassword: newPw },
          });
          toast("Đã cấp mật khẩu tạm cho thành viên.", "success");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.deleteMember) {
        const ok = await openConfirmDialog({
          title: "Xóa tài khoản thành viên",
          message: "Xóa vĩnh viễn tài khoản thành viên này và các lưu bút liên quan?",
          confirmLabel: "Xóa thành viên",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/members/${encodeURIComponent(btn.dataset.deleteMember)}`, { method: "DELETE" });
          toast("Đã xóa tài khoản thành viên.");
          loadAdminMembers();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.editPartner) {
        const pn = state.partners.find((x) => x.id === btn.dataset.editPartner);
        if (pn) openPartnerDialog(pn);
        return;
      }
      if (btn.dataset.togglePartner) {
        const next = state.partners.map((x) =>
          x.id === btn.dataset.togglePartner ? { ...x, isActive: !x.isActive } : x
        );
        try {
          await savePartnersList(next, "Đã cập nhật trạng thái đối tác.");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.deletePartner) {
        const pn = state.partners.find((x) => x.id === btn.dataset.deletePartner);
        if (!pn) return;
        const ok = await openConfirmDialog({
          title: "Xóa đối tác",
          message: `Xóa đối tác “${pn.name}” khỏi danh sách?`,
          confirmLabel: "Xóa đối tác",
          danger: true,
        });
        if (!ok) return;
        try {
          await savePartnersList(
            state.partners.filter((x) => x.id !== pn.id),
            "Đã xóa đối tác."
          );
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.toggleUser) {
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
        return;
      }
      if (btn.dataset.resetUserPw) {
        const newPw = await openConfirmDialog({
          title: "Đặt lại mật khẩu Ban Hình Ảnh",
          message: "Nhập mật khẩu mới (tối thiểu 8 ký tự). Các phiên đang mở của tài khoản này sẽ bị đăng xuất.",
          confirmLabel: "Đặt lại mật khẩu",
          inputLabel: "Mật khẩu mới",
          inputType: "password",
          inputPlaceholder: "Tối thiểu 8 ký tự",
          inputMinLength: 8,
        });
        if (!newPw || newPw.length < 8) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(btn.dataset.resetUserPw)}`, {
            method: "PATCH",
            body: { newPassword: newPw },
          });
          toast("Đã đặt lại mật khẩu tài khoản.", "success");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      if (btn.dataset.deleteUser) {
        const ok = await openConfirmDialog({
          title: "Xóa tài khoản Ban Hình Ảnh",
          message: "Xóa vĩnh viễn tài khoản này khỏi hệ thống?",
          confirmLabel: "Xóa tài khoản",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(btn.dataset.deleteUser)}`, { method: "DELETE" });
          toast("Đã xóa tài khoản.");
          loadSettings();
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      if (btn.dataset.retry) {
        switchTab(btn.dataset.retry, false);
      } else if (btn.dataset.emptyCta === "new-event") {
        openEventDialog(null);
      } else if (btn.dataset.emptyCta === "new-post") {
        openPostDialog(null);
      } else if (btn.dataset.emptyCta === "new-partner") {
        openPartnerDialog(null);
      } else if (btn.dataset.emptyCta === "new-member") {
        openMemberDialog(null);
      } else if (btn.dataset.emptyCta === "new-reflection") {
        openReflectionDialog(null);
      }
    });
  }

  async function boot() {
    initFormValidationSync();
    initDialogs();
    initPasswordToggles();
    initImageUploaders();
    initCropperControls();
    bindEvents();

    try {
      const inviteParam = new URLSearchParams(window.location.search).get("invite");
      if (inviteParam && window.__holariseManager?.openInviteOnboarding) {
        await window.__holariseManager.openInviteOnboarding(inviteParam, (res) => {
          handleAuthenticatedUser(res.user, Boolean(res.isSoleAdmin), res);
        });
        return;
      }
      const status = await api("/api/auth/status");
      if (status.authenticated && status.user) {
        handleAuthenticatedUser(status.user, Boolean(status.isSoleAdmin), status);
      } else {
        showAuthScreen({ initialized: Boolean(status.initialized) });
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
