/**
 * HolaRise – Hòa Lạc | Interactive Sunday Join Studio, Live Sunrise Pass & PNG Exporter
 * Follows modern-web-guidance: Invoker Commands (command="--copy" + fallback),
 * accessible aria-pressed quick-tap chips, safe textContent URL hydration, and Canvas 2x PNG export.
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var SITE_URL = "https://holarise.org";
  var DEFAULT_SCHEDULE = "1–2 buổi / tuần";

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

  var wsForm = document.querySelector("[data-father-studio]");
  var wsPassEl = document.querySelector("[data-ws-pass]");
  var wsActionsEl = document.getElementById("ws-pass-actions");
  var wsInviteTarget = document.getElementById("ws-pass-invite-text");
  var wsInviteBanner = document.getElementById("ws-invite-banner");
  var wsInviteBannerText = document.getElementById("ws-invite-text");

  var wsPassNameEl = wsPassEl ? wsPassEl.querySelector("[data-ws-pass-name]") : null;
  var wsPassOrgEl = wsPassEl ? wsPassEl.querySelector("[data-ws-pass-org]") : null;
  var wsPassSeatsEl = wsPassEl ? wsPassEl.querySelector("[data-ws-pass-seats]") : null;
  var wsPassCodeEl = wsPassEl ? wsPassEl.querySelector("[data-ws-pass-code]") : null;
  var wsPassStateEl = wsPassEl ? wsPassEl.querySelector("[data-ws-pass-state]") : null;

  var confirmedSnapshots = { join: null, modal: null, workshop: null };

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
          ruParam + " mời bạn tìm hiểu và đồng hành cùng HolaRise tại Hòa Lạc.";
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

  if (wsForm) {
    try {
      var wsParams = new URLSearchParams(window.location.search);
      var wsRu = cleanParamText(wsParams.get("ru"), 60);
      if (wsRu && wsInviteBanner && wsInviteBannerText) {
        wsForm.dataset.invitedBy = wsRu;
        wsInviteBannerText.textContent =
          wsRu + " gửi tặng bạn tấm thiệp mời tham dự buổi tối “Cuộc Đời Của Cha” (19h15 Chủ Nhật 29/11 tại Cafe Mây Lang Thang).";
        wsInviteBanner.hidden = false;
      }
    } catch (_e2) {}
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

    form.querySelectorAll("[data-skill-chip], [data-partner-chip]").forEach(function (chip) {
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
    var activePartner = joinForm.querySelector('[data-partner-chip][aria-pressed="true"]');
    var isPartnerMode = Boolean(checkedRole && checkedRole.getAttribute("data-mode") === "partner");

    joinForm.setAttribute("data-join-mode", isPartnerMode ? "partner" : "youth");
    joinForm.querySelectorAll("[data-youth-only]").forEach(function (el) {
      el.hidden = isPartnerMode;
    });
    joinForm.querySelectorAll("[data-partner-only]").forEach(function (el) {
      el.hidden = !isPartnerMode;
    });
    var eventsStep = joinForm.querySelector("[data-join-events-step]");
    if (eventsStep) eventsStep.hidden = isPartnerMode;

    var orgLabelEl = document.getElementById("join-org-label");
    var nameLabelEl = document.getElementById("join-name-label");
    var howLegendEl = document.getElementById("join-how-legend");
    var noteLabelEl = document.getElementById("join-note-label");
    var submitBtnEl = document.getElementById("join-submit-btn");
    var passEventLabelEl = passEl.querySelector("[data-pass-event-label]");
    var passVibeLabelEl = passEl.querySelector("[data-pass-vibe-label]");

    if (orgLabelEl) {
      orgLabelEl.textContent = isPartnerMode
        ? "Tên Nhà trường / CLB / Tổ chức / Doanh nghiệp"
        : "Đơn vị học tập / công tác";
    }
    if (orgInput) {
      orgInput.placeholder = isPartnerMode
        ? "Ví dụ: CLB Tình nguyện ĐH FPT, MusicSpace, Doanh nghiệp..."
        : "Ví dụ: ĐH FPT, ĐHQGHN, THPT Thạch Thất...";
    }
    if (nameLabelEl) {
      nameLabelEl.innerHTML = isPartnerMode
        ? 'Người đại diện liên hệ <span aria-hidden="true">*</span>'
        : 'Họ và tên <span aria-hidden="true">*</span>';
    }
    if (howLegendEl) {
      howLegendEl.textContent = isPartnerMode ? "Đề xuất hợp tác" : "Cách bạn muốn đồng hành";
    }
    if (noteLabelEl) {
      noteLabelEl.textContent = isPartnerMode
        ? "Nội dung đề xuất hợp tác & thời gian dự kiến"
        : "Lời nhắn hoặc câu chuyện bạn muốn chia sẻ";
    }
    if (submitBtnEl && !submitBtnEl.classList.contains("is-loading")) {
      submitBtnEl.textContent = isPartnerMode
        ? "Gửi đề xuất kết nối đối tác"
        : "Tạo Thẻ Thành Viên Hola";
    }

    var theme = (checkedRole && checkedRole.getAttribute("data-theme")) || "sunrise";
    var badge = (checkedRole && checkedRole.getAttribute("data-badge")) || "HolaHeart · Nội lực";
    var greeting =
      (checkedRole && checkedRole.getAttribute("data-greeting")) ||
      "Hạt mầm nội lực đã được gieo — hẹn gặp bạn trong những buổi gặp gỡ đầy chiều sâu.";
    var placeholder = checkedRole && checkedRole.getAttribute("data-placeholder");

    if (noteInput && placeholder) {
      noteInput.placeholder = placeholder;
    }

    var evId = !isPartnerMode && checkedEvent ? checkedEvent.value || "" : "";
    var evTitle = !isPartnerMode && checkedEvent ? checkedEvent.getAttribute("data-event-title") || "" : "";
    var evDate = (checkedEvent && checkedEvent.getAttribute("data-event-date")) || "Theo lịch tuần";
    var evTime = (checkedEvent && checkedEvent.getAttribute("data-event-time")) || DEFAULT_SCHEDULE;

    if (hiddenEventId) hiddenEventId.value = evId;
    if (hiddenActivity) hiddenActivity.value = evTitle;

    passEl.setAttribute("data-pass-theme", theme);
    passEl.classList.remove("is-confirmed");
    if (passStateEl) passStateEl.textContent = isPartnerMode ? "Hồ sơ Đối tác" : "Thẻ Thành Viên Hola";
    if (passBadgeEl) passBadgeEl.textContent = badge;
    if (passNameEl) passNameEl.textContent = nameVal || (isPartnerMode ? "Đại diện đơn vị" : "Tên của bạn");
    if (passOrgEl) {
      passOrgEl.textContent =
        orgVal || (isPartnerMode ? "Đối tác · Tổ chức đồng hành" : "Cộng đồng Hòa Lạc");
    }
    if (passGreetingEl) passGreetingEl.textContent = greeting;
    if (passEventLabelEl) passEventLabelEl.textContent = isPartnerMode ? "Định hướng" : "Hành trình chọn";
    if (passEventEl) {
      passEventEl.textContent =
        evTitle || (isPartnerMode ? "Hợp tác cùng HolaRise" : "Nhịp tuần Hòa Lạc");
    }
    if (passScheduleEl) passScheduleEl.textContent = evId ? evDate + " (" + evTime + ")" : DEFAULT_SCHEDULE;
    if (passVibeLabelEl) passVibeLabelEl.textContent = isPartnerMode ? "Hình thức" : "Quyền lợi";
    if (passVibeEl) {
      passVibeEl.textContent = isPartnerMode
        ? (activePartner && activePartner.getAttribute("data-partner-chip")) || "Đồng hành chiến lược"
        : (activeVibe && activeVibe.getAttribute("data-vibe-chip")) || "Giữ chỗ 1 chạm & Lưu bút";
    }
    if (passCodeEl) passCodeEl.textContent = "HOLA-2026-XXXX";

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
        readinessHintEl.textContent = "Phiếu xem trước đã đủ thông tin để gửi.";
      } else if (nameVal.length < 2) {
        readinessHintEl.textContent = "Nhập họ tên và SĐT/Zalo để hoàn thiện phiếu thông tin.";
      } else if (phoneDigits < 8) {
        readinessHintEl.textContent = "Thêm số điện thoại / Zalo để HolaRise có thể phản hồi.";
      } else {
        readinessHintEl.textContent = "Có thể bổ sung đơn vị học tập/công tác nếu bạn muốn.";
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

  function attachPassTilt(targetCard) {
    if (!targetCard || !isFinePointer || prefersReduced) return;
    var tiltRaf = null;
    targetCard.addEventListener("pointermove", function (e) {
      if (tiltRaf) cancelAnimationFrame(tiltRaf);
      tiltRaf = requestAnimationFrame(function () {
        var rect = targetCard.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        var ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        var ry = (nx - 0.5) * 8;
        var rx = (0.5 - ny) * 7;
        targetCard.style.setProperty("--rx", rx.toFixed(2) + "deg");
        targetCard.style.setProperty("--ry", ry.toFixed(2) + "deg");
        targetCard.style.setProperty("--px", (nx * 100).toFixed(1) + "%");
        targetCard.style.setProperty("--py", (ny * 100).toFixed(1) + "%");
      });
    });
    targetCard.addEventListener("pointerleave", function () {
      if (tiltRaf) cancelAnimationFrame(tiltRaf);
      targetCard.style.setProperty("--rx", "0deg");
      targetCard.style.setProperty("--ry", "0deg");
      targetCard.style.setProperty("--px", "50%");
      targetCard.style.setProperty("--py", "30%");
    });
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
    attachPassTilt(passEl);
  }

  /* 3B. Live Invitation Card Sync */
  function syncFatherPass() {
    if (!wsForm || !wsPassEl) return;
    if (confirmedSnapshots.workshop) return;

    var nameInput = wsForm.querySelector('[name="fullName"]');
    var orgInput = wsForm.querySelector('[name="organization"]');
    var checkedSeat = wsForm.querySelector('input[type="radio"][name="seatCount"]:checked');

    var nameVal = ((nameInput || {}).value || "").trim();
    var orgVal = ((orgInput || {}).value || "").trim();
    var seatShort =
      (checkedSeat && (checkedSeat.getAttribute("data-seat-short") || checkedSeat.value)) ||
      "01 chỗ · Đi một mình";

    wsPassEl.classList.remove("is-confirmed");
    if (wsPassStateEl) wsPassStateEl.textContent = "Chờ xác nhận";
    if (wsPassNameEl) wsPassNameEl.textContent = nameVal || "Tên người tham dự";
    if (wsPassOrgEl) wsPassOrgEl.textContent = orgVal || "Hòa Lạc";
    if (wsPassSeatsEl) wsPassSeatsEl.textContent = seatShort;
    if (wsPassCodeEl) wsPassCodeEl.textContent = "—";
  }

  function clearFatherConfirmationForEdit() {
    if (!confirmedSnapshots.workshop || !wsPassEl) return;
    confirmedSnapshots.workshop = null;
    wsPassEl.classList.remove("is-confirmed");
    if (wsActionsEl) wsActionsEl.hidden = true;
    syncFatherPass();
  }

  if (wsForm && wsPassEl) {
    syncFatherPass();
    wsForm.addEventListener("input", function () {
      clearFatherConfirmationForEdit();
      syncFatherPass();
    });
    wsForm.addEventListener("change", function () {
      clearFatherConfirmationForEdit();
      syncFatherPass();
    });
    wsForm.addEventListener("holarise:chips-changed", function () {
      clearFatherConfirmationForEdit();
      syncFatherPass();
    });
    wsForm.addEventListener("holarise:draft-restored", syncFatherPass);
  }

  /* 4. Post-submit ticket & share message builder */
  function buildInviteLink(snapshot) {
    var basePath = snapshot && snapshot.isFatherWorkshop ? "/su-kien/cuoc-doi-cua-cha/" : "/tham-gia/";
    var url = new URL(basePath, SITE_URL);
    if (!snapshot.isFatherWorkshop && snapshot.eventId) {
      url.searchParams.set("event", snapshot.eventId);
    }
    if (snapshot.fullName) url.searchParams.set("ru", snapshot.fullName);
    return url.toString();
  }

  function buildInviteText(snapshot) {
    var link = buildInviteLink(snapshot);
    if (snapshot && snapshot.isFatherWorkshop) {
      return (
        "Mình vừa giữ chỗ buổi tối đặc biệt Workshop “Cuộc Đời Của Cha” (19h15 Chủ Nhật 29/11 tại Cafe Mây Lang Thang, Hòa Lạc). Cùng mình dành một tối lắng nghe và nhìn lại câu chuyện về Cha nhé: " +
        link
      );
    }
    return (
      "Mình vừa nhận Thẻ Thành Viên Hola cùng HolaRise tại Hòa Lạc. Cùng xem hành trình và tham gia cuối tuần này nhé: " +
      link
    );
  }

  document.addEventListener("holarise:registration-success", function (e) {
    var detail = e.detail || {};
    var snap = detail.snapshot;
    if (!snap) return;

    var inviteMsg = buildInviteText(snap);

    if (snap.formKind === "workshop" && wsForm && wsPassEl) {
      confirmedSnapshots.workshop = snap;
      wsPassEl.classList.add("is-confirmed");
      if (wsPassStateEl) wsPassStateEl.textContent = "Đã giữ chỗ";
      if (wsPassNameEl) wsPassNameEl.textContent = snap.fullName || "Khách mời HolaHeart";
      if (wsPassOrgEl) wsPassOrgEl.textContent = snap.organization || "Hòa Lạc";
      if (wsPassSeatsEl) wsPassSeatsEl.textContent = snap.vibe || "01 chỗ · Đi một mình";
      if (wsPassCodeEl) wsPassCodeEl.textContent = snap.id || "—";
      if (wsInviteTarget) wsInviteTarget.textContent = inviteMsg;
      if (wsActionsEl) wsActionsEl.hidden = false;

      if (window.innerWidth <= 1024 && wsPassEl.scrollIntoView) {
        wsPassEl.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
      }
      return;
    }

    if (snap.source === "event_modal" && eventModal && modalSuccessEl) {
      confirmedSnapshots.modal = snap;
      var modalForm = eventModal.querySelector("form[data-club-form]");
      if (modalForm) modalForm.hidden = true;
      if (modalPassCodeEl) modalPassCodeEl.textContent = snap.id || "REG-HOLARISE";
      if (modalPassSummaryEl) {
        modalPassSummaryEl.textContent =
          "HolaRise đã ghi nhận giữ chỗ của " +
          (snap.fullName || "bạn") +
          " cho " +
          (snap.eventTitle || "hoạt động") +
          " (mã vé " +
          (snap.id || "REG-HOLARISE") +
          "). Hẹn gặp bạn tại buổi gặp gỡ!";
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
      passEl.setAttribute("data-pass-theme", snap.theme || "sunrise");
      passEl.classList.add("is-confirmed");
      if (passStateEl) passStateEl.textContent = snap.isPartner ? "Đã tiếp nhận" : "Thành viên Hola";
      if (passBadgeEl) passBadgeEl.textContent = snap.badge || "HolaHeart · Nội lực";
      if (passNameEl) passNameEl.textContent = snap.fullName || "Thành viên mới";
      if (passOrgEl) {
        passOrgEl.textContent =
          snap.organization || (snap.isPartner ? "Đối tác · Tổ chức đồng hành" : "Cộng đồng Hòa Lạc");
      }
      if (passGreetingEl && snap.greeting) passGreetingEl.textContent = snap.greeting;
      if (passEventEl) passEventEl.textContent = snap.eventTitle || "Nhịp tuần Hòa Lạc";
      if (passScheduleEl) {
        passScheduleEl.textContent = snap.eventId
          ? snap.eventDate + " (" + snap.eventTime + ")"
          : DEFAULT_SCHEDULE;
      }
      if (passVibeEl) passVibeEl.textContent = snap.vibe || "Giữ chỗ 1 chạm & Lưu bút";
      if (passCodeEl) passCodeEl.textContent = snap.id || "HOLA-2026-0001";

      if (readinessPctEl) readinessPctEl.textContent = "100%";
      if (readinessBarEl) readinessBarEl.style.width = "100%";
      if (readinessHintEl) {
        readinessHintEl.textContent = "Đã ghi nhận thông tin. Lưu phiếu nếu bạn muốn.";
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
        return;
      }

      if (mode === "workshop" && wsForm) {
        confirmedSnapshots.workshop = null;
        if (wsPassEl) wsPassEl.classList.remove("is-confirmed");
        if (wsActionsEl) wsActionsEl.hidden = true;
        var wStatus = wsForm.querySelector(".form-status");
        if (wStatus) {
          wStatus.className = "form-status";
          wStatus.textContent = "";
        }
        syncFatherPass();
        var wName = wsForm.querySelector('[name="fullName"]');
        if (wName) wName.focus();
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

  function downloadFatherInvitePng(snapshot) {
    Promise.all([
      waitForFonts(),
      loadSameOriginLogo("/assets/images/events/cuoc-doi-cua-cha-poster.jpg"),
    ]).then(function (assets) {
      var posterImg = assets[1];
      var canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;

      /* Calm editorial paper mat */
      ctx.fillStyle = "#F6F7F6";
      ctx.fillRect(0, 0, 1080, 1350);

      var cardX = 64;
      var cardY = 64;
      var cardW = 952;
      var cardH = 1222;

      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.clip();

      /* Real official poster at top (16:9) */
      var imgH = Math.round((cardW * 9) / 16);
      if (posterImg) {
        ctx.drawImage(posterImg, cardX, cardY, cardW, imgH);
      } else {
        ctx.fillStyle = "#14110F";
        ctx.fillRect(cardX, cardY, cardW, imgH);
      }

      var padX = cardX + 56;
      var innerW = cardW - 112;
      var curY = cardY + imgH + 54;

      /* Top quiet header */
      ctx.fillStyle = "#5F6B64";
      ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HOLAHEART · THIỆP MỜI THAM DỰ", padX, curY);

      ctx.textAlign = "right";
      ctx.fillStyle = "#0B6E4F";
      ctx.font = '600 22px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("Đã giữ chỗ", cardX + cardW - 56, curY);
      ctx.textAlign = "left";

      /* Guest name */
      curY += 54;
      ctx.fillStyle = "#5F6B64";
      ctx.font = 'italic 400 26px "Lora", Georgia, serif';
      ctx.fillText("Kính mời", padX, curY);

      curY += 58;
      ctx.fillStyle = "#0B110F";
      ctx.font = '600 54px "Be Vietnam Pro", -apple-system, sans-serif';
      var afterNameY = drawWrappedLines(
        ctx,
        snapshot.fullName || "Khách mời HolaHeart",
        padX,
        curY,
        innerW,
        66,
        2
      );

      ctx.fillStyle = "#4A5550";
      ctx.font = '400 26px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(snapshot.organization || "Hòa Lạc", padX, afterNameY + 8);

      /* Hairline divider */
      var ruleY = cardY + imgH + 298;
      ctx.strokeStyle = "#E4E7E5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, ruleY);
      ctx.lineTo(cardX + cardW - 56, ruleY);
      ctx.stroke();

      /* Clean 2x2 details */
      var metaY1 = ruleY + 56;
      var metaY2 = ruleY + 190;
      var col2X = padX + innerW / 2 + 16;
      var colW = innerW / 2 - 20;

      function drawQuietMeta(label, val, x, y, valColor) {
        ctx.fillStyle = "#6B7770";
        ctx.font = '500 20px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText(label, x, y);
        ctx.fillStyle = valColor || "#0B110F";
        ctx.font = '600 27px "Be Vietnam Pro", -apple-system, sans-serif';
        drawWrappedLines(ctx, val, x, y + 38, colW, 36, 2);
      }

      drawQuietMeta("Thời gian", "19h15 · Chủ Nhật, 29/11/2026", padX, metaY1);
      drawQuietMeta("Địa điểm", "Quán Cafe Mây Lang Thang", col2X, metaY1);
      drawQuietMeta("Số chỗ", snapshot.vibe || "01 chỗ · Đi một mình", padX, metaY2);
      drawQuietMeta("Mã giữ chỗ", snapshot.id || "—", col2X, metaY2, "#0B6E4F");

      /* Quiet footer */
      var footY = cardY + cardH - 52;
      ctx.strokeStyle = "#E4E7E5";
      ctx.beginPath();
      ctx.moveTo(padX, footY - 40);
      ctx.lineTo(cardX + cardW - 56, footY - 40);
      ctx.stroke();

      ctx.fillStyle = "#5F6B64";
      ctx.font = '400 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HolaHeart · Cộng đồng Thanh niên HolaRise", padX, footY);
      ctx.textAlign = "right";
      ctx.fillText("holarise.org/su-kien/cuoc-doi-cua-cha", cardX + cardW - 56, footY);
      ctx.textAlign = "left";

      ctx.restore();

      /* Subtle outer card hairline */
      drawRoundedRect(ctx, cardX + 1, cardY + 1, cardW - 2, cardH - 2, 28);
      ctx.strokeStyle = "#E4E7E5";
      ctx.lineWidth = 2;
      ctx.stroke();

      var fileName =
        "thiep-moi-cuoc-doi-cua-cha-" +
        String(snapshot.id || "holarise").toLowerCase().replace(/[^a-z0-9-]+/g, "-") +
        ".png";

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

  function downloadPassPng(snapshot) {
    if (!snapshot) return;
    if (snapshot.isFatherWorkshop) {
      downloadFatherInvitePng(snapshot);
      return;
    }
    Promise.all([waitForFonts(), loadSameOriginLogo("/assets/images/logo-mark.png")]).then(function (assets) {
      var logoImg = assets[1];
      var canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;

      var isFather = Boolean(snapshot.isFatherWorkshop);

      /* Outer Editorial Frame */
      ctx.fillStyle = isFather ? "#FCF8F1" : "#F6F7F6";
      ctx.fillRect(0, 0, 1080, 1350);

      /* Main Obsidian / Sunset Espresso Pass Card */
      var cardX = 72;
      var cardY = 84;
      var cardW = 936;
      var cardH = 1182;

      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 42);
      ctx.fillStyle = isFather ? "#1A110B" : snapshot.theme === "sunrise" ? "#111512" : "#0B110F";
      ctx.fill();
      ctx.clip();

      var glowTop = ctx.createRadialGradient(880, 185, 20, 880, 185, 560);
      glowTop.addColorStop(
        0,
        isFather
          ? "rgba(236, 148, 76, 0.44)"
          : snapshot.theme === "sunrise"
            ? "rgba(217, 121, 72, 0.36)"
            : "rgba(217, 121, 72, 0.24)"
      );
      glowTop.addColorStop(1, "rgba(217, 121, 72, 0)");
      ctx.fillStyle = glowTop;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      var glowBottom = ctx.createRadialGradient(200, 1120, 20, 200, 1120, 560);
      glowBottom.addColorStop(0, isFather ? "rgba(168, 73, 23, 0.36)" : "rgba(11, 110, 79, 0.38)");
      glowBottom.addColorStop(1, isFather ? "rgba(168, 73, 23, 0)" : "rgba(11, 110, 79, 0)");
      ctx.fillStyle = glowBottom;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      if (isFather) {
        /* Golden Sunset Horizon & Lake Shimmer Motif */
        var sunOrb = ctx.createRadialGradient(810, 470, 8, 810, 470, 120);
        sunOrb.addColorStop(0, "rgba(255, 222, 168, 0.32)");
        sunOrb.addColorStop(1, "rgba(236, 148, 76, 0)");
        ctx.fillStyle = sunOrb;
        ctx.beginPath();
        ctx.arc(810, 470, 120, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(245, 179, 140, 0.16)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cardX + 540, 495);
        ctx.lineTo(cardX + cardW - 64, 495);
        ctx.moveTo(cardX + 610, 512);
        ctx.lineTo(cardX + cardW - 110, 512);
        ctx.moveTo(cardX + 665, 528);
        ctx.lineTo(cardX + cardW - 150, 528);
        ctx.stroke();
      }

      /* Card Border */
      drawRoundedRect(ctx, cardX + 1.5, cardY + 1.5, cardW - 3, cardH - 3, 41);
      ctx.strokeStyle = isFather ? "rgba(245, 179, 140, 0.24)" : "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 3;
      ctx.stroke();

      var padX = cardX + 64;
      var innerW = cardW - 128;

      /* Top Brand Header */
      if (logoImg) {
        ctx.drawImage(logoImg, padX, cardY + 56, 56, 56);
      } else {
        drawRoundedRect(ctx, padX, cardY + 56, 56, 56, 12);
        ctx.fillStyle = isFather ? "#A84917" : "#0B6E4F";
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = '700 22px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText("HR", padX + 11, cardY + 92);
      }

      ctx.fillStyle = "rgba(244, 247, 245, 0.88)";
      ctx.font = '600 22px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(isFather ? "HOLAHEART · THƯ MỜI ĐẶC BIỆT" : "HOLARISE · HÒA LẠC", padX + 76, cardY + 92);

      /* Status Pill */
      drawRoundedRect(ctx, cardX + cardW - 64 - 230, cardY + 58, 230, 50, 25);
      ctx.fillStyle = isFather ? "#A84917" : "#0B6E4F";
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 21px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(
        isFather ? "ĐÃ GIỮ CHỖ" : snapshot.isPartner ? "ĐÃ TIẾP NHẬN" : "THÀNH VIÊN HOLA",
        cardX + cardW - 64 - 115,
        cardY + 91
      );
      ctx.textAlign = "left";

      /* Program Tag Pill */
      var tagText = (isFather ? "WORKSHOP · CUỘC ĐỜI CỦA CHA" : snapshot.badge || "CỘNG ĐỒNG HOLARISE").toUpperCase();
      ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
      var tagW = Math.min(540, ctx.measureText(tagText).width + 48);
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
        snapshot.fullName || "Khách mời HolaHeart",
        padX,
        cardY + 292,
        innerW - 140,
        74,
        2
      );

      ctx.fillStyle = "rgba(244, 247, 245, 0.76)";
      ctx.font = '400 28px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(
        snapshot.organization || (isFather ? "Khách mời · Hòa Lạc" : "Cộng đồng Hòa Lạc"),
        padX,
        afterNameY + 18
      );

      /* Editorial Lora Quote */
      ctx.fillStyle = "rgba(253, 245, 234, 0.9)";
      ctx.font = 'italic 400 27px "Lora", Georgia, serif';
      drawWrappedLines(
        ctx,
        "“" +
          (snapshot.greeting ||
            "Cha có thể không nói nhiều, nhưng cả cuộc đời Cha chính là minh chứng cho tình yêu ấy.") +
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
      ctx.fillStyle = isFather ? "rgba(26, 17, 11, 0.85)" : "rgba(11, 17, 15, 0.8)";
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
      ctx.fillText(isFather ? "ĐÃ GIỮ CHỖ" : snapshot.isPartner ? "ĐỐI TÁC ĐỒNG HÀNH" : "THÀNH VIÊN HOLA", 0, -4);
      ctx.font = '600 17px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(isFather ? "19H15 · 29/11" : "HÒA LẠC", 0, 24);
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

      ctx.fillStyle = isFather ? "#FCF8F1" : "#F6F7F6";
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

      if (isFather) {
        drawMeta("THỜI GIAN", "19h15 · Chủ Nhật, 29/11/2026", padX, metaY1);
        drawMeta("ĐỊA ĐIỂM", "Cafe Mây Lang Thang · Hòa Lạc", col2X, metaY1);
        drawMeta("SỐ CHỖ GIỮ", snapshot.vibe || "01 chỗ · Đi một mình", padX, metaY2);
        drawMeta("MÃ THIỆP VÉ", snapshot.id || "CHA-2911", col2X, metaY2, "#F5B38C");
      } else {
        drawMeta(snapshot.isPartner ? "ĐỊNH HƯỚNG" : "HÀNH TRÌNH", snapshot.eventTitle || "Nhịp tuần Hòa Lạc", padX, metaY1);
        drawMeta(
          "NHỊP HOẠT ĐỘNG",
          snapshot.eventId ? snapshot.eventDate + " · " + snapshot.eventTime : DEFAULT_SCHEDULE,
          col2X,
          metaY1
        );
        drawMeta(snapshot.isPartner ? "HÌNH THỨC" : "QUYỀN LỢI", snapshot.vibe || "Giữ chỗ 1 chạm & Lưu bút", padX, metaY2);
        drawMeta("MÃ THÀNH VIÊN", snapshot.id || "HOLA-2026-0001", col2X, metaY2, "#F5B38C");
      }

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
      ctx.fillStyle = isFather ? "rgba(245, 179, 140, 0.85)" : "rgba(244, 247, 245, 0.65)";
      ctx.font = '500 21px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(
        isFather ? "LẮNG NGHE · TRI ÂN · YÊU THƯƠNG" : "TOGETHER WE RISE, TOGETHER WE SERVE",
        cardX + cardW - 64,
        footY + 60
      );
      ctx.restore();

      var filePrefix = isFather ? "thiep-moi-cuoc-doi-cua-cha-" : "holarise-pass-";
      var fileName =
        filePrefix + String(snapshot.id || "hola-rise").toLowerCase().replace(/[^a-z0-9-]+/g, "-") + ".png";

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

  /* 5C. Member Pass 1080x1350 Canvas PNG Exporter (with Avatar + 90/10 3-Pillar Harmony) */
  function downloadMemberPassPng(member) {
    if (!member) return;
    var pillar = String(member.primaryPillar || "holaheart").toLowerCase();
    var palette =
      pillar === "holagreen"
        ? { accent: "#145A40", soft: "rgba(20, 90, 64, 0.38)", chip: "#86D9B5", badge: "HOLAGREEN · SINH THÁI" }
        : pillar === "holaconnect"
          ? { accent: "#1F4E5F", soft: "rgba(31, 78, 95, 0.42)", chip: "#9AD2E4", badge: "HOLACONNECT · PHỤNG SỰ" }
          : { accent: "#B85D3B", soft: "rgba(184, 93, 59, 0.40)", chip: "#F5B38C", badge: "HOLAHEART · NỘI LỰC" };

    var tasks = [waitForFonts(), loadSameOriginLogo("/assets/images/logo-mark.png")];
    if (member.avatarUrl) tasks.push(loadSameOriginLogo(member.avatarUrl));

    Promise.all(tasks).then(function (assets) {
      var logoImg = assets[1];
      var avatarImg = assets[2] || null;
      var canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#F6F7F6";
      ctx.fillRect(0, 0, 1080, 1350);

      var cardX = 72;
      var cardY = 84;
      var cardW = 936;
      var cardH = 1182;

      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 42);
      ctx.fillStyle = "#0F1412";
      ctx.fill();
      ctx.clip();

      var glowTop = ctx.createRadialGradient(860, 190, 20, 860, 190, 560);
      glowTop.addColorStop(0, palette.soft);
      glowTop.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glowTop;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      drawRoundedRect(ctx, cardX + 1.5, cardY + 1.5, cardW - 3, cardH - 3, 41);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 3;
      ctx.stroke();

      var padX = cardX + 64;
      var innerW = cardW - 128;

      if (logoImg) {
        ctx.drawImage(logoImg, padX, cardY + 56, 56, 56);
      }
      ctx.fillStyle = "rgba(244, 247, 245, 0.88)";
      ctx.font = '600 22px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HOLARISE · HÒA LẠC", padX + 76, cardY + 92);

      drawRoundedRect(ctx, cardX + cardW - 64 - 246, cardY + 58, 246, 50, 25);
      ctx.fillStyle = palette.accent;
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("THÀNH VIÊN HOLA", cardX + cardW - 64 - 123, cardY + 90);
      ctx.textAlign = "left";

      /* Avatar Circle (152px) */
      var avX = padX;
      var avY = cardY + 178;
      var avSize = 152;
      ctx.save();
      ctx.beginPath();
      ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (avatarImg) {
        var iw = avatarImg.naturalWidth || avatarImg.width;
        var ih = avatarImg.naturalHeight || avatarImg.height;
        var scale = Math.max(avSize / iw, avSize / ih);
        var dw = iw * scale;
        var dh = ih * scale;
        ctx.drawImage(avatarImg, avX + (avSize - dw) / 2, avY + (avSize - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(avX, avY, avSize, avSize);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = '600 54px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.textAlign = "center";
        var initials = String(member.name || "HR")
          .split(/\s+/)
          .filter(Boolean)
          .slice(-2)
          .map(function (w) { return w[0].toUpperCase(); })
          .join("");
        ctx.fillText(initials || "HR", avX + avSize / 2, avY + avSize / 2 + 20);
        ctx.textAlign = "left";
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2 + 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 3;
      ctx.stroke();

      /* Pillar Pill & Member Name */
      var infoX = avX + avSize + 36;
      var infoW = innerW - avSize - 36;
      ctx.font = '600 19px "Be Vietnam Pro", -apple-system, sans-serif';
      var bW = Math.min(infoW, ctx.measureText(palette.badge).width + 40);
      drawRoundedRect(ctx, infoX, avY + 6, bW, 42, 21);
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fill();
      ctx.strokeStyle = palette.chip;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = palette.chip;
      ctx.fillText(palette.badge, infoX + 20, avY + 34);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 48px "Be Vietnam Pro", -apple-system, sans-serif';
      var nameEndY = drawWrappedLines(ctx, member.name || "Thành viên Hola", infoX, avY + 104, infoW, 58, 2);
      ctx.fillStyle = "rgba(244, 247, 245, 0.72)";
      ctx.font = '400 25px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(member.organization || "Cộng đồng Hòa Lạc", infoX, nameEndY + 10);

      /* Bio Quote */
      ctx.fillStyle = "rgba(253, 245, 234, 0.9)";
      ctx.font = 'italic 400 27px "Lora", Georgia, serif';
      drawWrappedLines(
        ctx,
        "“" + (member.bio || "Cùng nhau kiến tạo những cuối tuần tử tế, sâu sắc và kết nối tại Hòa Lạc.") + "”",
        padX,
        cardY + 470,
        innerW,
        42,
        3
      );

      /* Perforation Line */
      var divY = cardY + 680;
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

      var metaY1 = divY + 68;
      var metaY2 = divY + 228;
      var col2X = padX + innerW / 2 + 16;
      var colW = innerW / 2 - 24;

      function drawM(label, val, x, y, valColor) {
        ctx.fillStyle = "rgba(244, 247, 245, 0.56)";
        ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText(label, x, y);
        ctx.fillStyle = valColor || "#FFFFFF";
        ctx.font = '600 29px "Be Vietnam Pro", -apple-system, sans-serif';
        drawWrappedLines(ctx, val, x, y + 40, colW, 38, 2);
      }

      drawM("MÃ THÀNH VIÊN", member.memberCode || "HOLA-2026-0001", padX, metaY1, palette.chip);
      drawM("CỘNG ĐỒNG", "HolaRise · Hòa Lạc", col2X, metaY1);
      drawM("TRỤ CỘT CHÍNH", palette.badge.split(" · ")[0], padX, metaY2);
      drawM("TRẠNG THÁI", "Đang hoạt động", col2X, metaY2);

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
      ctx.fillStyle = "rgba(244, 247, 245, 0.68)";
      ctx.font = '500 21px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("TOGETHER WE RISE, TOGETHER WE SERVE", cardX + cardW - 64, footY + 60);
      ctx.restore();

      var fileName =
        "the-thanh-vien-" + String(member.memberCode || "holarise").toLowerCase().replace(/[^a-z0-9-]+/g, "-") + ".png";
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
          setTimeout(function () { URL.revokeObjectURL(objUrl); }, 1000);
        }, "image/png");
      }
    });
  }

  window.HolaPass = {
    downloadMemberPassPng: downloadMemberPassPng,
    downloadPassPng: downloadPassPng,
  };

  document.querySelectorAll("[data-pass-download]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-pass-download");
      downloadPassPng(confirmedSnapshots[mode]);
    });
  });

  /* 5B. RFC 5545 .ics Calendar Exporter (Apple Calendar, iOS, Outlook) */
  function escapeIcsText(val) {
    return String(val || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  document.querySelectorAll("[data-ics-download]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var title = btn.getAttribute("data-ics-title") || 'Workshop "Cuộc Đời Của Cha" · HolaHeart';
      var startUtc = btn.getAttribute("data-ics-start") || "20261129T121500Z";
      var endUtc = btn.getAttribute("data-ics-end") || "20261129T143000Z";
      var location = btn.getAttribute("data-ics-location") || "Quán Cafe Mây Lang Thang, Hòa Lạc";
      var url = btn.getAttribute("data-ics-url") || "https://holarise.org/su-kien/cuoc-doi-cua-cha/";
      var mode = btn.getAttribute("data-ics-download") || "workshop";
      var snap = confirmedSnapshots[mode];
      var codeNote = snap && snap.id ? "Mã vé giữ chỗ: " + snap.id + "\n" : "";
      var description =
        codeNote +
        "Lắng nghe – Tri ân – Yêu thương. Tham dự miễn phí (tự túc đồ uống tại quán).\nThư mời chi tiết: " +
        url;

      var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      var icsLines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//HolaRise//HolaHeart Workshop//VI",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:holaheart-cuoc-doi-cua-cha-20261129@holarise.org",
        "DTSTAMP:" + stamp,
        "DTSTART:" + startUtc,
        "DTEND:" + endUtc,
        "SUMMARY:" + escapeIcsText(title),
        "LOCATION:" + escapeIcsText(location),
        "DESCRIPTION:" + escapeIcsText(description),
        "URL:" + url,
        "BEGIN:VALARM",
        "TRIGGER:-PT2H",
        "ACTION:DISPLAY",
        "DESCRIPTION:" + escapeIcsText("Nhắc lịch 19h15 tối nay: " + title),
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
      ];

      var blob = new Blob([icsLines.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
      var objUrl = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = objUrl;
      a.download = "cuoc-doi-cua-cha-29-11-2026.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(objUrl);
      }, 1000);
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
            title: snap.isFatherWorkshop
              ? 'Thư mời Workshop "Cuộc Đời Của Cha" · 19h15 CN 29/11'
              : "Đi Chủ nhật cùng mình tại HolaRise Hòa Lạc!",
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
