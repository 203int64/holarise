/**
 * HolaRise CMS Studio Extensions:
 * 1. Native <canvas> Image Cropper & Rotator (16:9, 4:3, 1:1, Free + Pan/Zoom + Rotate 90deg)
 * 2. Direct Member & Core Team CRUD (POST/PATCH /api/admin/members) + 1-tap Save Attendee as Member
 * 3. Direct Participant Reflection/Testimonial CRUD (POST/PATCH /api/admin/reflections)
 */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  async function apiJson(url, opts = {}) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Thao tác thất bại.");
    return data;
  }

  /* ---------------------------------------------------------
     1. QUICK JUMP TO SITE VISUALS EDITOR
  --------------------------------------------------------- */
  $("#btn-jump-visuals")?.addEventListener("click", () => {
    const settingsBtn = document.querySelector('[data-tab="settings"]');
    if (settingsBtn) settingsBtn.click();
    setTimeout(() => {
      $("#box-visuals")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  });

  /* ---------------------------------------------------------
     2. NATIVE <CANVAS> IMAGE CROPPER & ROTATOR
  --------------------------------------------------------- */
  const cropDialog = $("#image-crop-dialog");
  const cropCanvas = $("#crop-canvas");
  const cropZoomInput = $("#crop-zoom");
  const cropAlert = $("#crop-alert");
  const cropConfirmBtn = $("#crop-confirm-btn");
  const cropRotateBtn = $("#crop-rotate-btn");

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
  };

  function drawCropCanvas() {
    if (!cropCanvas || !cropState.img) return;
    const img = cropState.img;
    const rotRad = (cropState.rotation * Math.PI) / 180;
    const swapped = cropState.rotation % 180 !== 0;
    const natW = swapped ? img.naturalHeight : img.naturalWidth;
    const natH = swapped ? img.naturalWidth : img.naturalHeight;

    const ratio = cropState.ratio > 0 ? cropState.ratio : natW / Math.max(1, natH);
    const outW = 960;
    const outH = Math.round(outW / ratio);
    cropCanvas.width = outW;
    cropCanvas.height = outH;

    const ctx = cropCanvas.getContext("2d");
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

    // Subtle rule-of-thirds guide
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
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

  function openCropperWithSrc(src, { targetInput, previewImg, metaEl, defaultRatio }) {
    if (!cropDialog || !cropCanvas) return;
    if (cropAlert) cropAlert.hidden = true;
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
      if (cropZoomInput) cropZoomInput.value = "1";
      $$("[data-crop-ratio]").forEach((b) => {
        const match = Math.abs(Number(b.dataset.cropRatio) - cropState.ratio) < 0.05;
        b.classList.toggle("btn--primary", match);
        b.classList.toggle("btn--outline", !match);
      });
      drawCropCanvas();
      cropDialog.showModal();
    };
    img.onerror = () => {
      if (metaEl) metaEl.textContent = "Không thể mở ảnh để căn khung.";
    };
    img.src = src;
  }

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

  cropRotateBtn?.addEventListener("click", () => {
    cropState.rotation = (cropState.rotation + 90) % 360;
    cropState.offsetX = 0;
    cropState.offsetY = 0;
    drawCropCanvas();
  });

  cropZoomInput?.addEventListener("input", () => {
    cropState.zoom = Number(cropZoomInput.value) || 1;
    drawCropCanvas();
  });

  if (cropCanvas) {
    const startDrag = (x, y) => {
      cropState.dragging = true;
      cropState.startX = x - cropState.offsetX;
      cropState.startY = y - cropState.offsetY;
    };
    const moveDrag = (x, y) => {
      if (!cropState.dragging) return;
      cropState.offsetX = x - cropState.startX;
      cropState.offsetY = y - cropState.startY;
      drawCropCanvas();
    };
    const endDrag = () => {
      cropState.dragging = false;
    };
    cropCanvas.addEventListener("pointerdown", (e) => {
      cropCanvas.setPointerCapture(e.pointerId);
      startDrag(e.clientX, e.clientY);
    });
    cropCanvas.addEventListener("pointermove", (e) => moveDrag(e.clientX, e.clientY));
    cropCanvas.addEventListener("pointerup", endDrag);
    cropCanvas.addEventListener("pointercancel", endDrag);
  }

  cropConfirmBtn?.addEventListener("click", async () => {
    if (!cropCanvas || !cropState.img) return;
    cropConfirmBtn.disabled = true;
    cropConfirmBtn.textContent = "Đang nén & tải lên...";
    if (cropAlert) cropAlert.hidden = true;
    try {
      // Export clean canvas without rule-of-thirds grid
      const img = cropState.img;
      const swapped = cropState.rotation % 180 !== 0;
      const natW = swapped ? img.naturalHeight : img.naturalWidth;
      const natH = swapped ? img.naturalWidth : img.naturalHeight;
      const ratio = cropState.ratio > 0 ? cropState.ratio : natW / Math.max(1, natH);
      const exportW = Math.min(1280, Math.max(cropCanvas.width, 1080));
      const exportH = Math.round(exportW / ratio);
      const scaleFactor = exportW / cropCanvas.width;

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

      const blob = await new Promise((resolve) => outCanvas.toBlob(resolve, "image/jpeg", 0.95));
      if (!blob) throw new Error("Không thể xuất ảnh đã cắt.");

      const fd = new FormData();
      fd.append("file", new File([blob], "cropped.jpg", { type: "image/jpeg" }));
      fd.append("category", "giao-dien");
      const res = await fetch("/api/admin/media", { method: "POST", credentials: "same-origin", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.message || "Tải ảnh lên thất bại.");

      if (cropState.targetInput) cropState.targetInput.value = data.url;
      if (cropState.previewImg) cropState.previewImg.src = data.url;
      if (cropState.metaEl) {
        cropState.metaEl.textContent = `Đã cắt khung (${exportW}×${exportH}px · ${Math.round(blob.size / 1024)} KB) và tải lên thành công.`;
      }
      cropDialog.close();
    } catch (err) {
      if (cropAlert) {
        cropAlert.textContent = err.message || "Lỗi xử lý ảnh.";
        cropAlert.hidden = false;
      }
    } finally {
      cropConfirmBtn.disabled = false;
      cropConfirmBtn.textContent = "Cắt & Tải ảnh lên";
    }
  });

  // Attach "Cắt & Căn khung" button + intercept file inputs for cropper
  function enhanceUploaders() {
    $$('input[type="file"][data-upload-target]').forEach((input) => {
      if (input.dataset.cropEnhanced === "1") return;
      input.dataset.cropEnhanced = "1";
      const targetInput = document.getElementById(input.dataset.uploadTarget);
      const previewImg = document.getElementById(input.dataset.previewTarget);
      const metaEl = document.getElementById(input.dataset.metaTarget);
      const defaultRatio = input.dataset.defaultRatio || (input.id.includes("logo") ? "1" : "1.7778");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--outline btn--sm";
      btn.style.marginTop = "6px";
      btn.textContent = "✂ Cắt & Căn khung ảnh";
      btn.addEventListener("click", () => {
        const currentUrl = (targetInput && targetInput.value) || (previewImg && previewImg.src) || "";
        if (!currentUrl) {
          input.click();
          return;
        }
        openCropperWithSrc(currentUrl, { targetInput, previewImg, metaEl, defaultRatio });
      });
      input.parentElement?.appendChild(btn);

      input.addEventListener(
        "change",
        (e) => {
          const file = input.files && input.files[0];
          if (!file) return;
          e.stopImmediatePropagation();
          const objUrl = URL.createObjectURL(file);
          openCropperWithSrc(objUrl, { targetInput, previewImg, metaEl, defaultRatio });
          input.value = "";
        },
        true
      );
    });
  }
  enhanceUploaders();

  /* ---------------------------------------------------------
     3. MEMBER & CORE TEAM EDITOR MODAL
  --------------------------------------------------------- */
  const memberDialog = $("#member-dialog");
  const memberForm = $("#member-editor-form");
  const memberAlert = $("#member-editor-alert");

  function openMemberModal(item = null) {
    if (!memberDialog || !memberForm) return;
    memberForm.reset();
    if (memberAlert) memberAlert.hidden = true;
    $("#member-dialog-title").textContent = item ? "Cập nhật thành viên / Đội ngũ" : "Thêm thành viên / Đội ngũ";
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
    memberDialog.showModal();
  }

  $("#btn-new-member")?.addEventListener("click", () => openMemberModal(null));

  memberForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (memberAlert) memberAlert.hidden = true;
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
    try {
      if (id) {
        await apiJson(`/api/admin/members/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson("/api/admin/members", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      memberDialog.close();
      $("#btn-refresh-community")?.click();
    } catch (err) {
      if (memberAlert) {
        memberAlert.textContent = err.message;
        memberAlert.hidden = false;
      }
    }
  });

  /* ---------------------------------------------------------
     4. PARTICIPANT REFLECTION / TESTIMONIAL EDITOR MODAL
  --------------------------------------------------------- */
  const refDialog = $("#reflection-dialog");
  const refForm = $("#reflection-editor-form");
  const refAlert = $("#reflection-editor-alert");

  function openReflectionModal(item = null) {
    if (!refDialog || !refForm) return;
    refForm.reset();
    if (refAlert) refAlert.hidden = true;
    $("#reflection-dialog-title").textContent = item ? "Chỉnh sửa cảm nhận" : "Nhập cảm nhận từ người tham gia";
    $("#ref-id").value = item?.id || "";
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
    refDialog.showModal();
  }

  $("#btn-new-reflection")?.addEventListener("click", () => openReflectionModal(null));

  refForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (refAlert) refAlert.hidden = true;
    const id = ($("#ref-id").value || "").trim();
    const payload = {
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
    try {
      if (id) {
        await apiJson(`/api/admin/reflections/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson("/api/admin/reflections", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      refDialog.close();
      $("#btn-refresh-community")?.click();
    } catch (err) {
      if (refAlert) {
        refAlert.textContent = err.message;
        refAlert.hidden = false;
      }
    }
  });

  // Expose helper for 1-tap attendee -> member conversion & inline editing
  window.HolaAdminStudio = { openMemberModal, openReflectionModal, openCropperWithSrc };

  // Close buttons inside our new dialogs
  [cropDialog, memberDialog, refDialog].forEach((dlg) => {
    if (!dlg) return;
    dlg.querySelectorAll("[data-close-dialog]").forEach((btn) => {
      btn.addEventListener("click", () => dlg.close());
    });
  });

  // Watch #regs-container to inject 1-tap "+ Lưu thành viên" shortcut on rendered registration cards
  const regsContainer = $("#regs-container");
  if (regsContainer) {
    const obs = new MutationObserver(() => {
      regsContainer.querySelectorAll("[data-reg-card], .reg-card").forEach((card) => {
        if (card.dataset.memberBtnAdded === "1") return;
        card.dataset.memberBtnAdded = "1";
        const actions = card.querySelector(".card-actions, .reg-card-actions, .btn-row");
        if (!actions) return;
        const nameText = (card.querySelector("h3, strong, .reg-name")?.textContent || "").trim();
        const phoneLink = card.querySelector('a[href^="tel:"]');
        const phoneText = phoneLink ? phoneLink.textContent.trim() : "";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--outline btn--sm";
        btn.textContent = "+ Lưu thành viên";
        btn.addEventListener("click", () => {
          openMemberModal({ name: nameText, phone: phoneText, notes: "Chuyển từ danh sách đăng ký sự kiện" });
        });
        actions.appendChild(btn);
      });
    });
    obs.observe(regsContainer, { childList: true, subtree: true });
  }
})();
