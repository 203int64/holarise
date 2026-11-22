/**
 * HolaRise – Hòa Lạc | Interactive Sunday Join Studio, Live Sunrise Pass & PNG Exporter
 * Follows modern-web-guidance: Invoker Commands (command="--copy" + fallback),
 * accessible aria-pressed quick-tap chips, safe textContent URL hydration, and Canvas 2x PNG export.
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var SITE_URL = "https://holarise.pages.dev";
  var DEFAULT_SCHEDULE = "Ngày đầu của tuần - Chủ nhật";

  var joinForm = document.querySelector("[data-join-studio]");
  var passEl = document.querySelector("[data-sunrise-pass]");
  var joinActionsEl = document.getElementById("join-pass-actions");
  var joinInviteTarget = document.getElementById("join-pass-invite-text");
  var inviteBanner = document.getElementById("join-invite-banner");
  var inviteBannerText = document.getElementById("join-invite-text");

  var passNameEl = passEl ? passEl.querySelector("[data-pass-name]") : null;
  var passOrgEl = passEl ? passEl.querySelector("[data-pass-org]") : null;
  var passBadgeEl = passEl ? passEl.querySelector("[data-pass-badge]") : null;
  var passGreetingEl = passEl ? passEl.querySelector("[data-pass-greeting]") : null;
  var passEventEl = passEl ? passEl.querySelector("[data-pass-event]") : null;
  var passScheduleEl = passEl ? passEl.querySelector("[data-pass-schedule]") : null;
  var passVibeEl = passEl ? passEl.querySelector("[data-pass-vibe]") : null;
  var passCodeEl = passEl ? passEl.querySelector("[data-pass-code]") : null;
  var passStateEl = passEl ? passEl.querySelector("[data-pass-state]") : null;

  var readinessPctEl = document.querySelector("[data-pass-pct]");
  var readinessBarEl = document.querySelector("[data-pass-bar]");
  var readinessHintEl = document.querySelector("[data-pass-hint]");

  var eventModal = document.getElementById("event-register-modal");
  var modalSuccessEl = document.getElementById("modal-pass-success");
  var modalPassCodeEl = document.getElementById("modal-pass-code");
  var modalPassSummaryEl = document.getElementById("modal-pass-summary");
  var modalInviteTarget = document.getElementById("modal-pass-invite-text");

  var confirmedSnapshots = { join: null, modal: null };

  function cleanParamText(val, maxLen) {
    return String(val || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen || 60);
  }

  /* 1. Safe Friend-Invite URL Hydration (?ru=, ?event=, ?chuong-trinh=) */
  if (joinForm) {
    try {
      var params = new URLSearchParams(window.location.search);
      var ruParam = cleanParamText(params.get("ru"), 60);
      var eventParam = cleanParamText(params.get("event"), 120);
      var programParam = cleanParamText(params.get("chuong-trinh"), 40).toLowerCase();

      if (ruParam && inviteBanner && inviteBannerText) {
        joinForm.dataset.invitedBy = ruParam;
        inviteBannerText.textContent =
          ruParam + " đang rủ bạn cùng tham gia Chủ nhật này tại Hòa Lạc! Chọn buổi phù hợp bên dưới nhé.";
        inviteBanner.hidden = false;
      }

      if (eventParam) {
        joinForm.querySelectorAll('input[type="radio"][name="eventChoice"]').forEach(function (radio) {
          if (radio.value === eventParam) {
            radio.checked = true;
          }
        });
      }

      var programMap = {
        holagreen: "join-role-green",
        holaheart: "join-role-heart",
        holaconnect: "join-role-connect",
        kynang: "join-role-skill",
        hoptac: "join-role-partner",
      };
      if (programParam && programMap[programParam]) {
        var targetRoleRadio = document.getElementById(programMap[programParam]);
        if (targetRoleRadio) targetRoleRadio.checked = true;
      }
    } catch (_e) {}
  }

  /* 2. Quick-Tap Chips (Org, Vibe, Skills) across Join Studio & Quick Modal */
  function syncOrgChipsForForm(form, value) {
    var trimmed = (value || "").trim();
    form.querySelectorAll("[data-org-chip]").forEach(function (chip) {
      var on = (chip.getAttribute("data-org-chip") || "") === trimmed;
      chip.classList.toggle("is-selected", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  document.querySelectorAll("[data-club-form]").forEach(function (form) {
    var orgInput = form.querySelector('[name="organization"]');

    form.querySelectorAll("[data-org-chip]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var val = chip.getAttribute("data-org-chip") || "";
        var currentlySelected = chip.getAttribute("aria-pressed") === "true";
        var nextVal = currentlySelected ? "" : val;
        if (orgInput) {
          orgInput.value = nextVal;
          orgInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        syncOrgChipsForForm(form, nextVal);
        form.dispatchEvent(new CustomEvent("holarise:chips-changed", { bubbles: true }));
      });
    });

    if (orgInput) {
      orgInput.addEventListener("input", function () {
        syncOrgChipsForForm(form, orgInput.value);
      });
    }

    form.querySelectorAll("[data-vibe-chip]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var row = chip.closest(".quick-chip-row") || form;
        row.querySelectorAll("[data-vibe-chip]").forEach(function (peer) {
          var on = peer === chip;
          peer.classList.toggle("is-selected", on);
          peer.setAttribute("aria-pressed", on ? "true" : "false");
        });
        form.dispatchEvent(new CustomEvent("holarise:chips-changed", { bubbles: true }));
      });
    });

    form.querySelectorAll("[data-skill-chip]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var nextState = chip.getAttribute("aria-pressed") !== "true";
        chip.classList.toggle("is-selected", nextState);
        chip.setAttribute("aria-pressed", nextState ? "true" : "false");
        form.dispatchEvent(new CustomEvent("holarise:chips-changed", { bubbles: true }));
      });
    });
  });

  /* 3. Live Sunrise Pass Renderer & Readiness Meter */
  function syncJoinPass() {
    if (!joinForm || !passEl) return;
    if (confirmedSnapshots.join) return;

    var nameInput = joinForm.querySelector('[name="fullName"]');
    var phoneInput = joinForm.querySelector('[name="phone"]');
    var emailInput = joinForm.querySelector('[name="email"]');
    var orgInput = joinForm.querySelector('[name="organization"]');
    var noteInput = joinForm.querySelector('[name="note"]');
    var hiddenEventId = document.getElementById("join-event-id-input");
    var hiddenActivity = document.getElementById("join-activity-input");

    var nameVal = ((nameInput || {}).value || "").trim();
    var phoneVal = ((phoneInput || {}).value || "").trim();
    var emailVal = ((emailInput || {}).value || "").trim();
    var orgVal = ((orgInput || {}).value || "").trim();

    var checkedRole = joinForm.querySelector('input[type="radio"][name="role"]:checked');
    var checkedEvent = joinForm.querySelector('input[type="radio"][name="eventChoice"]:checked');
    var activeVibe = joinForm.querySelector('[data-vibe-chip][aria-pressed="true"]');

    var theme = (checkedRole && checkedRole.getAttribute("data-theme")) || "emerald";
    var badge = (checkedRole && checkedRole.getAttribute("data-badge")) || "HolaGreen · Sạch";
    var greeting =
      (checkedRole && checkedRole.getAttribute("data-greeting")) ||
      "Găng tay, kẹp rác và nhóm đồng đội đã sẵn sàng cho sáng Chủ nhật!";
    var placeholder = checkedRole && checkedRole.getAttribute("data-placeholder");

    if (noteInput && placeholder) {
      noteInput.placeholder = placeholder;
    }

    var evId = (checkedEvent && checkedEvent.value) || "";
    var evTitle = (checkedEvent && checkedEvent.getAttribute("data-event-title")) || "";
    var evDate = (checkedEvent && checkedEvent.getAttribute("data-event-date")) || "Chủ nhật gần nhất";
    var evTime = (checkedEvent && checkedEvent.getAttribute("data-event-time")) || DEFAULT_SCHEDULE;

    if (hiddenEventId) hiddenEventId.value = evId;
    if (hiddenActivity) hiddenActivity.value = evTitle;

    passEl.setAttribute("data-pass-theme", theme);
    passEl.classList.remove("is-confirmed");
    if (passStateEl) passStateEl.textContent = "Bản xem trước";
    if (passBadgeEl) passBadgeEl.textContent = badge;
    if (passNameEl) passNameEl.textContent = nameVal || "Tên của bạn";
    if (passOrgEl) passOrgEl.textContent = orgVal || "Thanh niên · Sinh viên Hòa Lạc";
    if (passGreetingEl) passGreetingEl.textContent = greeting;
    if (passEventEl) passEventEl.textContent = evTitle || "Chủ nhật gần nhất";
    if (passScheduleEl) passScheduleEl.textContent = evId ? evDate + " (" + evTime + ")" : DEFAULT_SCHEDULE;
    if (passVibeEl) {
      passVibeEl.textContent = (activeVibe && activeVibe.getAttribute("data-vibe-chip")) || "Đi một mình (ghép nhóm)";
    }
    if (passCodeEl) passCodeEl.textContent = "CHỜ XÁC NHẬN";

    var pct = 25;
    if (nameVal.length >= 2) pct += 35;
    var phoneDigits = phoneVal.replace(/\D/g, "").length;
    if (phoneDigits >= 8) pct += 35;
    if (orgVal.length > 0 || emailVal.length > 0) pct += 5;
    pct = Math.min(100, pct);

    if (readinessPctEl) readinessPctEl.textContent = pct + "%";
    if (readinessBarEl) readinessBarEl.style.width = pct + "%";
    if (readinessHintEl) {
      if (pct >= 95) {
        readinessHintEl.textContent = "Thẻ đã sẵn sàng! Bấm giữ chỗ để đóng dấu xác nhận.";
      } else if (nameVal.length < 2) {
        readinessHintEl.textContent = "Nhập họ tên và SĐT/Zalo để hoàn thiện thẻ.";
      } else if (phoneDigits < 8) {
        readinessHintEl.textContent = "Thêm số điện thoại / Zalo (ít nhất 8 chữ số) để nhận điểm hẹn.";
      } else {
        readinessHintEl.textContent = "Chọn thêm trường/đơn vị nếu muốn thẻ in đầy đủ 100%.";
      }
    }
  }

  function clearJoinConfirmationForEdit() {
    if (!confirmedSnapshots.join || !passEl) return;
    confirmedSnapshots.join = null;
    passEl.classList.remove("is-confirmed");
    if (joinActionsEl) joinActionsEl.hidden = true;
    syncJoinPass();
  }

  if (joinForm && passEl) {
    syncJoinPass();
    joinForm.addEventListener("input", function () {
      clearJoinConfirmationForEdit();
      syncJoinPass();
    });
    joinForm.addEventListener("change", function () {
      clearJoinConfirmationForEdit();
      syncJoinPass();
    });
    joinForm.addEventListener("holarise:chips-changed", function () {
      clearJoinConfirmationForEdit();
      syncJoinPass();
    });
    joinForm.addEventListener("holarise:draft-restored", syncJoinPass);

    /* Subtle desktop 3D card tilt + specular glare */
    if (isFinePointer && !prefersReduced) {
      var tiltRaf = null;
      passEl.addEventListener("pointermove", function (e) {
        if (tiltRaf) cancelAnimationFrame(tiltRaf);
        tiltRaf = requestAnimationFrame(function () {
          var rect = passEl.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          var nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          var ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
          var ry = (nx - 0.5) * 8;
          var rx = (0.5 - ny) * 7;
          passEl.style.setProperty("--rx", rx.toFixed(2) + "deg");
          passEl.style.setProperty("--ry", ry.toFixed(2) + "deg");
          passEl.style.setProperty("--px", (nx * 100).toFixed(1) + "%");
          passEl.style.setProperty("--py", (ny * 100).toFixed(1) + "%");
        });
      });
      passEl.addEventListener("pointerleave", function () {
        if (tiltRaf) cancelAnimationFrame(tiltRaf);
        passEl.style.setProperty("--rx", "0deg");
        passEl.style.setProperty("--ry", "0deg");
        passEl.style.setProperty("--px", "50%");
        passEl.style.setProperty("--py", "30%");
      });
    }
  }

  /* 4. Post-Submit Stamped Ticket & Share Message Builder */
  function buildInviteLink(snapshot) {
    var url = new URL("/tham-gia/", SITE_URL);
    if (snapshot.eventId) url.searchParams.set("event", snapshot.eventId);
    if (snapshot.fullName) url.searchParams.set("ru", snapshot.fullName);
    return url.toString();
  }

  function buildInviteText(snapshot) {
    var link = buildInviteLink(snapshot);
    var label =
      snapshot.eventTitle && snapshot.eventTitle !== "Chủ nhật gần nhất"
        ? '"' + snapshot.eventTitle + '"'
        : "hoạt động Chủ nhật của HolaRise";
    return (
      "Chủ nhật này đi cùng mình không? Mình vừa giữ chỗ " +
      label +
      " tại Hòa Lạc (Miễn phí 100%, có sẵn dụng cụ). Đăng ký nhanh ở đây nhé: " +
      link
    );
  }

  document.addEventListener("holarise:registration-success", function (e) {
    var detail = e.detail || {};
    var snap = detail.snapshot;
    if (!snap) return;

    var inviteMsg = buildInviteText(snap);

    if (snap.source === "event_modal" && eventModal && modalSuccessEl) {
      confirmedSnapshots.modal = snap;
      var modalForm = eventModal.querySelector("form[data-club-form]");
      if (modalForm) modalForm.hidden = true;
      if (modalPassCodeEl) modalPassCodeEl.textContent = snap.id || "REG-HOLARISE";
      if (modalPassSummaryEl) {
        modalPassSummaryEl.textContent =
          (snap.fullName || "Bạn") +
          " đã giữ chỗ \"" +
          (snap.eventTitle || "Hoạt động HolaRise") +
          "\" (" +
          [snap.eventDate, snap.eventTime].filter(Boolean).join(" · ") +
          "). Ban Điều Phối sẽ liên hệ qua Zalo trong 24 giờ.";
      }
      if (modalInviteTarget) modalInviteTarget.textContent = inviteMsg;
      modalSuccessEl.hidden = false;
      var modalInner = eventModal.querySelector(".dialog-inner");
      if (modalInner && modalInner.scrollTo) modalInner.scrollTo({ top: 0 });
      eventModal.scrollTop = 0;
      return;
    }

    if (joinForm && passEl) {
      confirmedSnapshots.join = snap;
      passEl.setAttribute("data-pass-theme", snap.theme || "emerald");
      passEl.classList.add("is-confirmed");
      if (passStateEl) passStateEl.textContent = "Đã giữ chỗ";
      if (passBadgeEl) passBadgeEl.textContent = snap.badge || "HolaGreen · Sạch";
      if (passNameEl) passNameEl.textContent = snap.fullName || "Thành viên mới";
      if (passOrgEl) passOrgEl.textContent = snap.organization || "Thanh niên · Sinh viên Hòa Lạc";
      if (passGreetingEl && snap.greeting) passGreetingEl.textContent = snap.greeting;
      if (passEventEl) passEventEl.textContent = snap.eventTitle || "Chủ nhật gần nhất";
      if (passScheduleEl) {
        passScheduleEl.textContent = snap.eventId
          ? snap.eventDate + " (" + snap.eventTime + ")"
          : DEFAULT_SCHEDULE;
      }
      if (passVibeEl) passVibeEl.textContent = snap.vibe || "Đi một mình (ghép nhóm)";
      if (passCodeEl) passCodeEl.textContent = snap.id || "REG-HOLARISE";

      if (readinessPctEl) readinessPctEl.textContent = "100%";
      if (readinessBarEl) readinessBarEl.style.width = "100%";
      if (readinessHintEl) {
        readinessHintEl.textContent = "Đã giữ chỗ thành công! Tải ảnh thẻ hoặc rủ bạn bè cùng đi.";
      }

      if (joinInviteTarget) joinInviteTarget.textContent = inviteMsg;
      if (joinActionsEl) joinActionsEl.hidden = false;

      if (window.innerWidth <= 1024 && passEl.scrollIntoView) {
        passEl.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
      }
    }
  });

  document.querySelectorAll("[data-pass-new]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-pass-new");
      if (mode === "modal" && eventModal && modalSuccessEl) {
        confirmedSnapshots.modal = null;
        modalSuccessEl.hidden = true;
        var modalForm = eventModal.querySelector("form[data-club-form]");
        if (modalForm) {
          modalForm.hidden = false;
          var st = modalForm.querySelector(".form-status");
          if (st) {
            st.className = "form-status";
            st.textContent = "";
          }
          var mName = modalForm.querySelector('[name="fullName"]');
          if (mName) mName.focus();
        }
        return;
      }

      if (mode === "join" && joinForm) {
        confirmedSnapshots.join = null;
        if (passEl) passEl.classList.remove("is-confirmed");
        if (joinActionsEl) joinActionsEl.hidden = true;
        var jStatus = joinForm.querySelector(".form-status");
        if (jStatus) {
          jStatus.className = "form-status";
          jStatus.textContent = "";
        }
        syncJoinPass();
        var jName = joinForm.querySelector('[name="fullName"]');
        if (jName) jName.focus();
      }
    });
  });

  /* 5. Deterministic Canvas 2x PNG Pass Generator (1080x1350 Story/Zalo Format) */
  function waitForFonts() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return Promise.race([
      document.fonts.ready.catch(function () {}),
      new Promise(function (resolve) {
        setTimeout(resolve, 1200);
      }),
    ]);
  }

  function loadSameOriginLogo(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var finish = function (res) {
        if (done) return;
        done = true;
        resolve(res);
      };
      img.onload = function () {
        finish(img);
      };
      img.onerror = function () {
        finish(null);
      };
      setTimeout(function () {
        finish(null);
      }, 1500);
      img.src = src;
    });
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawWrappedLines(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [];
    var current = "";
    for (var i = 0; i < words.length; i++) {
      var testLine = current ? current + " " + words[i] : words[i];
      if (ctx.measureText(testLine).width > maxWidth && current) {
        lines.push(current);
        current = words[i];
        if (maxLines && lines.length >= maxLines) break;
      } else {
        current = testLine;
      }
    }
    if (current && (!maxLines || lines.length < maxLines)) {
      lines.push(current);
    }
    for (var j = 0; j < lines.length; j++) {
      ctx.fillText(lines[j], x, y + j * lineHeight);
    }
    return y + lines.length * lineHeight;
  }

  function downloadPassPng(snapshot) {
    if (!snapshot) return;
    Promise.all([waitForFonts(), loadSameOriginLogo("/assets/images/logo-mark.png")]).then(function (assets) {
      var logoImg = assets[1];
      var canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;

      /* Outer Editorial Mist Frame */
      ctx.fillStyle = "#F6F7F6";
      ctx.fillRect(0, 0, 1080, 1350);

      /* Main Obsidian Pass Card */
      var cardX = 72;
      var cardY = 84;
      var cardW = 936;
      var cardH = 1182;

      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 42);
      ctx.fillStyle = snapshot.theme === "sunrise" ? "#111512" : "#0B110F";
      ctx.fill();
      ctx.clip();

      var glowTop = ctx.createRadialGradient(890, 190, 20, 890, 190, 520);
      glowTop.addColorStop(0, snapshot.theme === "sunrise" ? "rgba(217, 121, 72, 0.36)" : "rgba(217, 121, 72, 0.24)");
      glowTop.addColorStop(1, "rgba(217, 121, 72, 0)");
      ctx.fillStyle = glowTop;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      var glowBottom = ctx.createRadialGradient(200, 1120, 20, 200, 1120, 560);
      glowBottom.addColorStop(0, "rgba(11, 110, 79, 0.38)");
      glowBottom.addColorStop(1, "rgba(11, 110, 79, 0)");
      ctx.fillStyle = glowBottom;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      /* Card Border */
      drawRoundedRect(ctx, cardX + 1.5, cardY + 1.5, cardW - 3, cardH - 3, 41);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 3;
      ctx.stroke();

      var padX = cardX + 64;
      var innerW = cardW - 128;

      /* Top Brand Header */
      if (logoImg) {
        ctx.drawImage(logoImg, padX, cardY + 56, 56, 56);
      } else {
        drawRoundedRect(ctx, padX, cardY + 56, 56, 56, 12);
        ctx.fillStyle = "#0B6E4F";
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = '700 22px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText("HR", padX + 11, cardY + 92);
      }

      ctx.fillStyle = "rgba(244, 247, 245, 0.88)";
      ctx.font = '600 22px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HOLARISE · HÒA LẠC", padX + 76, cardY + 92);

      /* Status Pill */
      drawRoundedRect(ctx, cardX + cardW - 64 - 220, cardY + 58, 220, 50, 25);
      ctx.fillStyle = "#0B6E4F";
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 21px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("ĐÃ GIỮ CHỖ", cardX + cardW - 64 - 110, cardY + 91);
      ctx.textAlign = "left";

      /* Program Tag Pill */
      var tagText = (snapshot.badge || "CỘNG ĐỒNG HOLARISE").toUpperCase();
      ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
      var tagW = Math.min(480, ctx.measureText(tagText).width + 48);
      drawRoundedRect(ctx, padX, cardY + 168, tagW, 48, 24);
      ctx.fillStyle = "rgba(217, 121, 72, 0.18)";
      ctx.fill();
      ctx.strokeStyle = "rgba(217, 121, 72, 0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#F5B38C";
      ctx.fillText(tagText, padX + 24, cardY + 199);

      /* Member Name & Org */
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 60px "Be Vietnam Pro", -apple-system, sans-serif';
      var afterNameY = drawWrappedLines(
        ctx,
        snapshot.fullName || "Thành viên HolaRise",
        padX,
        cardY + 292,
        innerW - 140,
        74,
        2
      );

      ctx.fillStyle = "rgba(244, 247, 245, 0.76)";
      ctx.font = '400 28px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(snapshot.organization || "Thanh niên · Sinh viên Hòa Lạc", padX, afterNameY + 18);

      /* Editorial Lora Quote */
      ctx.fillStyle = "rgba(244, 247, 245, 0.88)";
      ctx.font = 'italic 400 27px "Lora", Georgia, serif';
      drawWrappedLines(
        ctx,
        "“" +
          (snapshot.greeting ||
            "Small Beginnings. Great Impact. Hẹn gặp bạn vào sáng Chủ nhật tại Hòa Lạc.") +
          "”",
        padX,
        cardY + 510,
        innerW,
        42,
        3
      );

      /* Rotated Circular Confirmation Stamp */
      ctx.save();
      ctx.translate(cardX + cardW - 155, cardY + 275);
      ctx.rotate(-0.21);
      ctx.beginPath();
      ctx.arc(0, 0, 88, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(11, 17, 15, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "#F5B38C";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 74, 0, Math.PI * 2);
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = "rgba(245, 179, 140, 0.65)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#F5B38C";
      ctx.textAlign = "center";
      ctx.font = '700 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("ĐÃ GIỮ CHỖ", 0, -4);
      ctx.font = '600 17px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HÒA LẠC", 0, 24);
      ctx.restore();

      /* Perforation Line & Side Cutouts */
      var divY = cardY + 695;
      ctx.save();
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cardX + 36, divY);
      ctx.lineTo(cardX + cardW - 36, divY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "#F6F7F6";
      ctx.beginPath();
      ctx.arc(cardX, divY, 24, 0, Math.PI * 2);
      ctx.arc(cardX + cardW, divY, 24, 0, Math.PI * 2);
      ctx.fill();

      /* 2x2 Ticket Metadata Grid */
      var metaY1 = divY + 68;
      var metaY2 = divY + 236;
      var col2X = padX + innerW / 2 + 16;
      var colW = innerW / 2 - 24;

      function drawMeta(label, val, x, y, valColor) {
        ctx.fillStyle = "rgba(244, 247, 245, 0.56)";
        ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText(label, x, y);
        ctx.fillStyle = valColor || "#FFFFFF";
        ctx.font = '600 28px "Be Vietnam Pro", -apple-system, sans-serif';
        drawWrappedLines(ctx, val, x, y + 40, colW, 38, 2);
      }

      drawMeta("BUỔI HẸN", snapshot.eventTitle || "Chủ nhật gần nhất", padX, metaY1);
      drawMeta(
        "THỜI GIAN",
        snapshot.eventId ? snapshot.eventDate + " · " + snapshot.eventTime : DEFAULT_SCHEDULE,
        col2X,
        metaY1
      );
      drawMeta("PHONG CÁCH", snapshot.vibe || "Đi một mình (ghép nhóm)", padX, metaY2);
      drawMeta("MÃ GIỮ CHỖ", snapshot.id || "REG-HOLARISE", col2X, metaY2, "#F5B38C");

      /* Bottom Barcode & Coordinates */
      var footY = cardY + cardH - 115;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, footY);
      ctx.lineTo(cardX + cardW - 64, footY);
      ctx.stroke();

      var barWidths = [6, 12, 5, 4, 9, 6, 14, 5, 4, 10, 6, 12, 6, 4, 9, 6, 10];
      var bx = padX;
      ctx.fillStyle = "rgba(244, 247, 245, 0.78)";
      for (var k = 0; k < barWidths.length; k++) {
        ctx.fillRect(bx, footY + 32, barWidths[k], 42);
        bx += barWidths[k] + 8;
      }

      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(244, 247, 245, 0.65)";
      ctx.font = '500 21px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("21°00'N · 105°31'E · MIỄN PHÍ 100%", cardX + cardW - 64, footY + 60);
      ctx.restore();

      var fileName =
        "holarise-pass-" + String(snapshot.id || "chu-nhat").toLowerCase().replace(/[^a-z0-9-]+/g, "-") + ".png";

      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) return;
          var objUrl = URL.createObjectURL(blob);
          var link = document.createElement("a");
          link.href = objUrl;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(function () {
            URL.revokeObjectURL(objUrl);
          }, 1000);
        }, "image/png");
      } else {
        var dataLink = document.createElement("a");
        dataLink.href = canvas.toDataURL("image/png");
        dataLink.download = fileName;
        document.body.appendChild(dataLink);
        dataLink.click();
        dataLink.remove();
      }
    });
  }

  document.querySelectorAll("[data-pass-download]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-pass-download");
      downloadPassPng(confirmedSnapshots[mode]);
    });
  });

  /* 6. Invoker Commands Copy + Web Share (modern-web-guidance: copy-button) */
  var copyTimers = new WeakMap();
  var lastCopyMessage = "";

  function legacyCopy(text) {
    var field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
    document.body.appendChild(field);
    field.select();
    try {
      return document.execCommand("copy");
    } finally {
      field.remove();
    }
  }

  function reportCopy(button, ok) {
    var wrapper = button.closest(".copy-control");
    var tip = button.nextElementSibling;
    if (!tip) return;
    clearTimeout(copyTimers.get(button));
    button.removeAttribute("data-copied");
    button.removeAttribute("data-failed");
    if (wrapper) wrapper.classList.remove("is-tip-shown");

    var message = ok ? "Đã sao chép lời mời!" : "Không thể sao chép";
    if (message === lastCopyMessage) message += "\u00A0";
    lastCopyMessage = message;

    tip.textContent = "";
    void button.offsetWidth;
    button.setAttribute(ok ? "data-copied" : "data-failed", "");
    if (wrapper) wrapper.classList.add("is-tip-shown");

    requestAnimationFrame(function () {
      tip.textContent = message;
    });

    copyTimers.set(
      button,
      setTimeout(function () {
        button.removeAttribute("data-copied");
        button.removeAttribute("data-failed");
        if (wrapper) wrapper.classList.remove("is-tip-shown");
        tip.textContent = "";
      }, 2200)
    );
  }

  function copyFromTarget(button, target) {
    if (!button || !target) return;
    var text = target.matches("input, textarea") ? target.value : (target.textContent || "").trim();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          reportCopy(button, true);
        })
        .catch(function () {
          reportCopy(button, Boolean(legacyCopy(text)));
        });
    } else {
      reportCopy(button, Boolean(legacyCopy(text)));
    }
  }

  if ("CommandEvent" in window) {
    document.addEventListener(
      "command",
      function (event) {
        if (event.command === "--copy" && event.source && event.target) {
          copyFromTarget(event.source, event.target);
        }
      },
      true
    );
  } else {
    document.addEventListener("click", function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button[command="--copy"]') : null;
      if (!btn) return;
      var target = document.getElementById(btn.getAttribute("commandfor") || "");
      if (target) copyFromTarget(btn, target);
    });
  }

  function triggerSiblingCopy(btn) {
    var scope = btn.closest(".pass-actions, .modal-pass-success");
    var copyBtn = scope ? scope.querySelector("[data-copy-invite]") : null;
    if (!copyBtn) return;
    var target = document.getElementById(copyBtn.getAttribute("commandfor") || "");
    if (target) copyFromTarget(copyBtn, target);
  }

  document.querySelectorAll("[data-pass-share]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-pass-share");
      var snap = confirmedSnapshots[mode];
      if (!snap) return;
      var link = buildInviteLink(snap);
      var msg = buildInviteText(snap);

      if (navigator.share) {
        navigator
          .share({
            title: "Đi Chủ nhật cùng mình tại HolaRise Hòa Lạc!",
            text: msg,
            url: link,
          })
          .catch(function (err) {
            if (err && err.name === "AbortError") return;
            triggerSiblingCopy(btn);
          });
        return;
      }

      triggerSiblingCopy(btn);
    });
  });
})();
