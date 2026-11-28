/**
 * HolaRise – Hòa Lạc | Interactive Sunday Join Studio, Live Sunrise Pass & PNG Exporter
 * Follows modern-web-guidance: Invoker Commands (command="--copy" + fallback),
 * accessible aria-pressed quick-tap chips, safe textContent URL hydration, and Canvas 2x PNG export.
 */
(function () {
  "use strict";

  var isEn =
    (document.documentElement &&
      (document.documentElement.lang === "en" ||
        document.documentElement.getAttribute("data-lang") === "en")) ||
    /^\/en(\/|$)/i.test((window.location && window.location.pathname) || "");
  function t(vi, en) {
    return isEn ? en : vi;
  }

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var SITE_URL = "https://holarise.org";
  function canonicalizeShareUrl(rawUrl) {
    try {
      var u = new URL(rawUrl || (window.location && window.location.pathname) || "/", SITE_URL);
      var host = (u.hostname || "").toLowerCase();
      if (host === "holarise.pages.dev" || host.endsWith(".pages.dev") || host === "www.holarise.org") {
        return new URL(u.pathname + u.search, SITE_URL).toString();
      }
      return u.toString();
    } catch (_e) {
      return SITE_URL + ((window.location && window.location.pathname) || "/");
    }
  }
  var DEFAULT_SCHEDULE = t("1–2 buổi / tuần", "1–2 sessions / week");

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
  var modalPassGuestEl = document.getElementById("modal-pass-guest");
  var modalPassTimeEl = document.getElementById("modal-pass-time");
  var modalPassLocationEl = document.getElementById("modal-pass-location");
  var modalPassSeatsEl = document.getElementById("modal-pass-seats");
  var modalPassSummaryEl = document.getElementById("modal-pass-summary");
  var modalInviteTarget = document.getElementById("modal-pass-invite-text");

  var wsForm = document.querySelector("[data-event-studio], [data-father-studio]");
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

  if (wsInviteBanner && wsInviteBannerText) {
    try {
      var wsParams = new URLSearchParams(window.location.search);
      var wsRu = cleanParamText(wsParams.get("ru"), 60);
      if (wsRu) {
        var openRsvpBtn = document.getElementById("ws-open-rsvp-btn");
        var invitedEventTitle = (openRsvpBtn && openRsvpBtn.getAttribute("data-register-event")) || "buổi gặp gỡ cùng HolaRise";
        var modalRsvpForm = document.getElementById("modal-rsvp-form");
        if (modalRsvpForm) modalRsvpForm.dataset.invitedBy = wsRu;
        if (wsForm) wsForm.dataset.invitedBy = wsRu;
        wsInviteBannerText.textContent =
          wsRu + " mời bạn cùng tham dự “" + invitedEventTitle + "”.";
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
    var hasRoleRadios = Boolean(joinForm.querySelector('input[type="radio"][name="role"]'));
    var checkedEvent = joinForm.querySelector('input[type="radio"][name="eventChoice"]:checked');
    var activeVibe = joinForm.querySelector('[data-vibe-chip][aria-pressed="true"]');
    var activePartner = joinForm.querySelector('[data-partner-chip][aria-pressed="true"]');
    var isPartnerMode = hasRoleRadios
      ? Boolean(checkedRole && checkedRole.getAttribute("data-mode") === "partner")
      : joinForm.getAttribute("data-join-mode") === "partner";

    // Modern /tham-gia/ & /en/join/ partner-only form has no role radio tabs; preserve its template labels & hidden activity
    if (!hasRoleRadios && isPartnerMode) {
      return;
    }

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
        ? t("Tên Nhà trường / CLB / Tổ chức / Doanh nghiệp", "Organization / University / Club")
        : t("Đơn vị học tập / công tác", "University / Organization");
    }
    if (orgInput) {
      orgInput.placeholder = isPartnerMode
        ? t("Ví dụ: CLB Tình nguyện ĐH FPT, MusicSpace, Doanh nghiệp...", "e.g. University, Student Club, NGO, Venue...")
        : t("Ví dụ: ĐH FPT, ĐHQGHN, THPT Thạch Thất...", "e.g. FPT University, VNU Hoa Lac, HHTP...");
    }
    if (nameLabelEl) {
      nameLabelEl.innerHTML = isPartnerMode
        ? t('Người đại diện liên hệ <span aria-hidden="true">*</span>', 'Contact person <span aria-hidden="true">*</span>')
        : t('Họ và tên <span aria-hidden="true">*</span>', 'Full name <span aria-hidden="true">*</span>');
    }
    if (howLegendEl) {
      howLegendEl.textContent = isPartnerMode ? t("Đề xuất hợp tác", "Partnership proposal") : t("Cách bạn muốn đồng hành", "How you want to join");
    }
    if (noteLabelEl) {
      noteLabelEl.textContent = isPartnerMode
        ? t("Nội dung đề xuất hợp tác & thời gian dự kiến", "Collaboration idea & proposed timeline")
        : t("Lời nhắn hoặc câu chuyện bạn muốn chia sẻ", "Note or message you would like to share");
    }
    if (submitBtnEl && !submitBtnEl.classList.contains("is-loading")) {
      submitBtnEl.textContent = isPartnerMode
        ? t("Gửi đề xuất kết nối đối tác", "Send partnership inquiry")
        : t("Tạo Thẻ Thành Viên Hola", "Create HolaRise Member Pass");
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
      if (modalPassGuestEl) modalPassGuestEl.textContent = snap.fullName || "Khách mời HolaRise";
      if (modalPassTimeEl) {
        var timeDisplay = snap.eventTime || "";
        var dateDisplay = snap.eventDate || "";
        modalPassTimeEl.textContent =
          timeDisplay && dateDisplay && timeDisplay.indexOf(dateDisplay) === -1
            ? timeDisplay + " · " + dateDisplay
            : timeDisplay || dateDisplay || t("Theo lịch buổi gặp", "See gathering schedule");
      }
      if (modalPassLocationEl) modalPassLocationEl.textContent = snap.eventLocation || t("Hòa Lạc, Hà Nội", "Hoa Lac, Hanoi");
      if (modalPassSeatsEl) modalPassSeatsEl.textContent = snap.vibe || t("01 chỗ · Đi một mình", "01 seat · Coming solo");
      if (modalPassSummaryEl) {
        modalPassSummaryEl.textContent = t(
          "Mời bạn vào Nhóm Zalo buổi gặp để nhận định vị, ghép xe và lưu lịch trước giờ bắt đầu.",
          "Join the gathering Zalo group for location pins, carpool coordination, or add the event to your calendar below."
        );
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
        var joinTimeParts = [snap.eventTime, snap.eventDate].filter(Boolean);
        passScheduleEl.textContent = snap.eventId
          ? joinTimeParts.join(" · ") || DEFAULT_SCHEDULE
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
    var posterSrc = (snapshot && snapshot.eventImage) || "/assets/images/og-cover.jpg";
    Promise.all([
      waitForFonts(),
      loadSameOriginLogo(posterSrc),
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
      ctx.fillText("Cộng đồng HolaRise", padX, footY);
      ctx.textAlign = "right";
      var cleanUrlLabel = String((snapshot && snapshot.eventUrl) || "holarise.org/lich-hoat-dong/")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
      ctx.fillText(cleanUrlLabel.indexOf("holarise.org") === 0 ? cleanUrlLabel : "holarise.org" + cleanUrlLabel, cardX + cardW - 56, footY);
      ctx.textAlign = "left";

      ctx.restore();

      /* Subtle outer card hairline */
      drawRoundedRect(ctx, cardX + 1, cardY + 1, cardW - 2, cardH - 2, 28);
      ctx.strokeStyle = "#E4E7E5";
      ctx.lineWidth = 2;
      ctx.stroke();

      var slugPart = String((snapshot && snapshot.eventSlug) || "su-kien").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      var fileName =
        "thiep-moi-" + slugPart + "-" +
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

  function resolveEventCardPalette(snapshot) {
    var hay = String(
      (snapshot.pillar || "") + " " + (snapshot.eventType || "") + " " + (snapshot.eventId || "") + " " + (snapshot.eventTitle || "")
    ).toLowerCase();
    if (hay.indexOf("holagreen") >= 0 || hay.indexOf("sinh thái") >= 0 || hay.indexOf("cảnh quan") >= 0) {
      return {
        pillarName: "HolaGreen",
        badge: "HolaGreen · Sinh thái & Cảnh quan",
        bg: "#0C1511",
        glowTop: "rgba(38, 162, 105, 0.34)",
        glowBot: "rgba(20, 90, 64, 0.42)",
        accent: "#6EE7B7",
        pillBg: "#145A40",
        pillBorder: "rgba(110, 231, 183, 0.45)",
        pillTint: "rgba(20, 90, 64, 0.28)",
        fallbackQuote: "Cùng nhau giữ gìn cảnh quan xanh và bước chậm giữa thiên nhiên Hòa Lạc.",
      };
    }
    if (hay.indexOf("holaconnect") >= 0 || hay.indexOf("leo núi") >= 0 || hay.indexOf("tri thức") >= 0 || hay.indexOf("phụng sự") >= 0) {
      return {
        pillarName: "HolaConnect",
        badge: "HolaConnect · Tri thức & Phụng sự",
        bg: "#0D1519",
        glowTop: "rgba(56, 152, 182, 0.34)",
        glowBot: "rgba(31, 78, 95, 0.44)",
        accent: "#93D5EA",
        pillBg: "#1F4E5F",
        pillBorder: "rgba(147, 213, 234, 0.45)",
        pillTint: "rgba(31, 78, 95, 0.28)",
        fallbackQuote: "Đi cùng nhau trên những cung đường thật, mở rộng kết nối và sẻ chia tri thức.",
      };
    }
    return {
      pillarName: "HolaHeart",
      badge: "HolaHeart · Tĩnh tại & Lắng nghe",
      bg: "#16110E",
      glowTop: "rgba(217, 121, 72, 0.36)",
      glowBot: "rgba(168, 73, 23, 0.32)",
      accent: "#F5B38C",
      pillBg: "#9C4625",
      pillBorder: "rgba(245, 179, 140, 0.48)",
      pillTint: "rgba(217, 121, 72, 0.2)",
      fallbackQuote: "Một buổi gặp gỡ chậm rãi để lắng nghe, trò chuyện và đồng hành cùng nhau.",
    };
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

      var palette = resolveEventCardPalette(snapshot);
      var status = String(snapshot.status || "").toLowerCase();
      var isEventTicket = Boolean(snapshot.eventId || snapshot.eventTitle || String(snapshot.id || "").indexOf("REG-") === 0);

      var statusLabel = snapshot.isPartner
        ? "ĐÃ TIẾP NHẬN"
        : status === "attended"
          ? "ĐÃ THAM DỰ"
          : status === "contacted"
            ? "ĐÃ XÁC NHẬN"
            : status === "cancelled"
              ? "ĐÃ HỦY CHỖ"
              : isEventTicket
                ? "ĐÃ GIỮ CHỖ"
                : "THÀNH VIÊN HOLA";

      var stampTop = snapshot.isPartner
        ? "ĐỐI TÁC"
        : status === "attended"
          ? "ĐÃ THAM DỰ"
          : status === "cancelled"
            ? "ĐÃ HỦY"
            : isEventTicket
              ? "ĐÃ GIỮ CHỖ"
              : "THÀNH VIÊN";
      var stampBottom = status === "attended" ? "HOLARISE" : "HÒA LẠC";

      /* Outer Editorial Frame */
      ctx.fillStyle = "#F6F7F6";
      ctx.fillRect(0, 0, 1080, 1350);

      /* Main Pass Card */
      var cardX = 72;
      var cardY = 84;
      var cardW = 936;
      var cardH = 1182;

      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 42);
      ctx.fillStyle = palette.bg;
      ctx.fill();
      ctx.clip();

      var glowTop = ctx.createRadialGradient(880, 185, 20, 880, 185, 560);
      glowTop.addColorStop(0, palette.glowTop);
      glowTop.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glowTop;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      var glowBottom = ctx.createRadialGradient(200, 1120, 20, 200, 1120, 560);
      glowBottom.addColorStop(0, palette.glowBot);
      glowBottom.addColorStop(1, "rgba(0, 0, 0, 0)");
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
        ctx.fillStyle = palette.pillBg;
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = '700 22px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText("HR", padX + 11, cardY + 92);
      }

      ctx.fillStyle = "rgba(244, 247, 245, 0.88)";
      ctx.font = '600 22px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(isEventTicket ? "HOLARISE · THẺ SỰ KIỆN" : "HOLARISE · HÒA LẠC", padX + 76, cardY + 92);

      /* Status Pill */
      ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
      var pillW = Math.max(210, Math.min(280, ctx.measureText(statusLabel).width + 52));
      drawRoundedRect(ctx, cardX + cardW - 64 - pillW, cardY + 58, pillW, 50, 25);
      ctx.fillStyle = status === "cancelled" ? "rgba(180, 62, 62, 0.85)" : palette.pillBg;
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.fillText(statusLabel, cardX + cardW - 64 - pillW / 2, cardY + 91);
      ctx.textAlign = "left";

      /* Program Tag Pill */
      var tagText = String(snapshot.badge || snapshot.eventType || palette.badge).toUpperCase();
      ctx.font = '600 19px "Be Vietnam Pro", -apple-system, sans-serif';
      var tagW = Math.min(innerW - 180, ctx.measureText(tagText).width + 44);
      drawRoundedRect(ctx, padX, cardY + 166, tagW, 46, 23);
      ctx.fillStyle = palette.pillTint;
      ctx.fill();
      ctx.strokeStyle = palette.pillBorder;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = palette.accent;
      ctx.fillText(tagText, padX + 22, cardY + 196);

      /* Member Name & Org */
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 58px "Be Vietnam Pro", -apple-system, sans-serif';
      var afterNameY = drawWrappedLines(
        ctx,
        snapshot.fullName || "Thành viên Hola",
        padX,
        cardY + 290,
        innerW - 190,
        72,
        2
      );

      ctx.fillStyle = "rgba(244, 247, 245, 0.76)";
      ctx.font = '400 27px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(
        snapshot.organization || "Cộng đồng HolaRise",
        padX,
        afterNameY + 18
      );

      /* Editorial Lora Quote (Never hardcoded to a single event) */
      var quoteBody = String(snapshot.greeting || snapshot.eventSummary || palette.fallbackQuote).trim();
      ctx.fillStyle = "rgba(253, 245, 234, 0.9)";
      ctx.font = 'italic 400 26px "Lora", Georgia, serif';
      drawWrappedLines(
        ctx,
        "“" + quoteBody + "”",
        padX,
        cardY + 504,
        innerW,
        40,
        3
      );

      /* Rotated Circular Confirmation Stamp (Sized cleanly inside circle) */
      ctx.save();
      ctx.translate(cardX + cardW - 150, cardY + 278);
      ctx.rotate(-0.18);
      ctx.beginPath();
      ctx.arc(0, 0, 86, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(11, 17, 15, 0.82)";
      ctx.fill();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 73, 0, Math.PI * 2);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = palette.pillBorder;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = palette.accent;
      ctx.textAlign = "center";
      ctx.font = '700 16px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(stampTop, 0, -4);
      ctx.font = '600 14px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(stampBottom, 0, 20);
      ctx.restore();

      /* Perforation Line & Side Cutouts */
      var divY = cardY + 690;
      ctx.save();
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
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
      var metaY1 = divY + 66;
      var metaY2 = divY + 232;
      var col2X = padX + innerW / 2 + 16;
      var colW = innerW / 2 - 24;

      function drawMeta(label, val, x, y, valColor) {
        ctx.fillStyle = "rgba(244, 247, 245, 0.56)";
        ctx.font = '600 19px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText(label, x, y);
        ctx.fillStyle = valColor || "#FFFFFF";
        ctx.font = '600 26px "Be Vietnam Pro", -apple-system, sans-serif';
        drawWrappedLines(ctx, val, x, y + 38, colW, 36, 2);
      }

      var scheduleParts = [snapshot.eventTime, snapshot.eventDate].filter(Boolean);
      var scheduleVal = scheduleParts.length ? scheduleParts.join(" · ") : "Cập nhật qua Nhóm Zalo";
      var locationOrVibeLabel = snapshot.isPartner ? "HÌNH THỨC" : snapshot.eventLocation ? "ĐỊA ĐIỂM" : "GHI CHÚ";
      var locationOrVibeVal = snapshot.isPartner
        ? snapshot.vibe || "Đồng hành tổ chức"
        : snapshot.eventLocation || snapshot.vibe || "Hòa Lạc, Hà Nội";
      var codeLabel = isEventTicket ? "MÃ GIỮ CHỖ" : "MÃ THÀNH VIÊN";

      drawMeta(snapshot.isPartner ? "ĐỊNH HƯỚNG" : "SỰ KIỆN", snapshot.eventTitle || "Hoạt động HolaRise", padX, metaY1);
      drawMeta("THỜI GIAN", scheduleVal, col2X, metaY1);
      drawMeta(locationOrVibeLabel, locationOrVibeVal, padX, metaY2);
      drawMeta(codeLabel, snapshot.id || "HOLA-2026-0001", col2X, metaY2, palette.accent);

      /* Clean Typographic Footer (Zero fake barcode, 100% Vietnamese) */
      var footY = cardY + cardH - 110;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, footY);
      ctx.lineTo(cardX + cardW - 64, footY);
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(244, 247, 245, 0.72)";
      ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HOLARISE.ORG", padX, footY + 56);

      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(244, 247, 245, 0.62)";
      ctx.font = '500 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HÒA LẠC · CỘNG ĐỒNG THANH NIÊN", cardX + cardW - 64, footY + 56);
      ctx.restore();

      var filePrefix = isEventTicket ? "the-su-kien-holarise-" : "holarise-pass-";
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

  /* Helper: Safe mobile-first PNG delivery (Web Share API -> <a download> -> Hold-to-Save Preview Dialog) */
  function showPassPreviewFallback(dataUrl, fileName) {
    var existing = document.getElementById("hola-pass-preview-dlg");
    if (existing) existing.remove();
    var dlg = document.createElement("dialog");
    dlg.id = "hola-pass-preview-dlg";
    dlg.className = "club-dialog pass-preview-dialog";
    dlg.setAttribute("closedby", "any");
    dlg.setAttribute("aria-label", "Lưu Thẻ Thành Viên");
    dlg.innerHTML =
      '<div class="dialog-inner auth-dialog-inner">' +
      '<button class="modal-close" type="button" aria-label="Đóng">×</button>' +
      '<h3 class="auth-dialog-title" style="margin-bottom:4px;">Thẻ Thành Viên HolaRise</h3>' +
      '<p class="auth-dialog-sub">Nhấn giữ vào ảnh bên dưới rồi chọn <strong>Lưu ảnh</strong> về máy.</p>' +
      '<img class="pass-preview-img" alt="Thẻ Thành Viên HolaRise">' +
      '<a class="auth-submit-btn" style="display:flex;align-items:center;justify-content:center;text-decoration:none;min-height:44px;" download>Tải ảnh PNG</a>' +
      "</div>";
    var img = dlg.querySelector("img");
    var link = dlg.querySelector("a");
    var closeBtn = dlg.querySelector(".modal-close");
    if (img) img.src = dataUrl;
    if (link) {
      link.href = dataUrl;
      link.download = fileName;
    }
    if (closeBtn) closeBtn.addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (ev) { if (ev.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === "function") dlg.showModal();
  }

  function deliverPngBlob(blob, dataUrl, fileName, shareTitle) {
    var isMobileOrApp =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean(window.navigator.standalone) ||
      window.matchMedia("(pointer: coarse)").matches;

    if (isMobileOrApp && blob && typeof File === "function" && navigator.share && navigator.canShare) {
      try {
        var pngFile = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare({ files: [pngFile] })) {
          return navigator
            .share({ files: [pngFile], title: shareTitle || "Thẻ Thành Viên HolaRise" })
            .then(function () { return "shared"; })
            .catch(function (err) {
              if (err && err.name === "AbortError") return "shared";
              showPassPreviewFallback(dataUrl, fileName);
              return "preview";
            });
        }
      } catch (_e) {
        // Fall through to preview / download
      }
    }

    if (isMobileOrApp) {
      showPassPreviewFallback(dataUrl, fileName);
      return Promise.resolve("preview");
    }

    var objUrl = blob ? URL.createObjectURL(blob) : dataUrl;
    var link = document.createElement("a");
    link.href = objUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (blob) {
      setTimeout(function () { URL.revokeObjectURL(objUrl); }, 1500);
    }
    return Promise.resolve("downloaded");
  }

  /* 5C. Member Pass 1080x1350 Luxe Foil Canvas PNG Exporter (with Avatar + EXP + Mobile Share) */
  function downloadMemberPassPng(member, expData) {
    if (!member) return Promise.resolve("skipped");
    var pillar = String(member.primaryPillar || "holaheart").toLowerCase();
    var palette =
      pillar === "holagreen"
        ? {
            accent: "#145A40",
            soft: "rgba(34, 158, 112, 0.44)",
            soft2: "rgba(134, 217, 181, 0.24)",
            chip: "#86D9B5",
            barA: "#27A373",
            barB: "#96E6C5",
            badge: "HOLAGREEN · SINH THÁI",
          }
        : pillar === "holaconnect"
          ? {
              accent: "#1F4E5F",
              soft: "rgba(66, 154, 184, 0.44)",
              soft2: "rgba(154, 210, 228, 0.26)",
              chip: "#9AD2E4",
              barA: "#4FA4C2",
              barB: "#B3E3F2",
              badge: "HOLACONNECT · PHỤNG SỰ",
            }
          : {
              accent: "#B85D3B",
              soft: "rgba(232, 134, 88, 0.42)",
              soft2: "rgba(247, 198, 138, 0.26)",
              chip: "#F5B38C",
              barA: "#E5936A",
              barB: "#F7D2A8",
              badge: "HOLAHEART · NỘI LỰC",
            };

    var exp = expData || {
      tierBadge: "LV.1 · KHỞI HÀNH",
      tierName: "Khởi hành",
      expText: "20 / 150 EXP",
      progressPct: 14,
      breakdownText: "0 hoạt động · 0 lưu bút",
    };

    var canLoadAvatar =
      member.avatarUrl &&
      (String(member.avatarUrl).startsWith("/") || String(member.avatarUrl).startsWith("data:image/"));
    var tasks = [waitForFonts(), loadSameOriginLogo("/assets/images/logo-mark.png")];
    if (canLoadAvatar) tasks.push(loadSameOriginLogo(member.avatarUrl));

    return Promise.all(tasks).then(function (assets) {
      var logoImg = assets[1];
      var avatarImg = assets[2] || null;
      var canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      var ctx = canvas.getContext("2d");
      if (!ctx) return "skipped";

      /* Clean warm editorial backdrop */
      ctx.fillStyle = "#F4F5F3";
      ctx.fillRect(0, 0, 1080, 1350);

      var cardX = 64;
      var cardY = 72;
      var cardW = 952;
      var cardH = 1206;

      ctx.save();
      ctx.shadowColor = "rgba(10, 18, 15, 0.28)";
      ctx.shadowBlur = 48;
      ctx.shadowOffsetY = 24;
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 44);
      ctx.fillStyle = "#0E1412";
      ctx.fill();
      ctx.restore();

      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 44);
      ctx.clip();

      /* Dual-corner luminescence + diagonal foil sheen */
      var glowTop = ctx.createRadialGradient(880, 180, 20, 880, 180, 580);
      glowTop.addColorStop(0, palette.soft);
      glowTop.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glowTop;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      var glowBot = ctx.createRadialGradient(180, 1140, 20, 180, 1140, 520);
      glowBot.addColorStop(0, palette.soft2);
      glowBot.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glowBot;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      var foil = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
      foil.addColorStop(0, "rgba(255,255,255,0.12)");
      foil.addColorStop(0.45, "rgba(255,255,255,0.01)");
      foil.addColorStop(0.75, palette.soft2);
      foil.addColorStop(1, "rgba(255,255,255,0.14)");
      ctx.fillStyle = foil;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      /* Subtle optical dot mesh */
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      for (var gx = cardX + 28; gx < cardX + cardW - 20; gx += 34) {
        for (var gy = cardY + 28; gy < cardY + cardH - 20; gy += 34) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      /* Double metallic hairline border */
      drawRoundedRect(ctx, cardX + 2, cardY + 2, cardW - 4, cardH - 4, 42);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = 3;
      ctx.stroke();

      var padX = cardX + 64;
      var innerW = cardW - 128;

      if (logoImg) {
        ctx.drawImage(logoImg, padX, cardY + 54, 54, 54);
      }
      ctx.fillStyle = "rgba(244, 247, 245, 0.88)";
      ctx.font = '600 21px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HOLARISE · HÒA LẠC", padX + 72, cardY + 89);

      /* Tier Pill top right */
      ctx.font = '600 19px "Be Vietnam Pro", -apple-system, sans-serif';
      var tierLabel = String(exp.tierBadge || "LV.1 · KHỞI HÀNH");
      var tierW = Math.max(220, ctx.measureText(tierLabel).width + 48);
      drawRoundedRect(ctx, cardX + cardW - 64 - tierW, cardY + 56, tierW, 48, 24);
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.26)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.fillText(tierLabel, cardX + cardW - 64 - tierW / 2, cardY + 87);
      ctx.textAlign = "left";

      /* Avatar Circle (148px) */
      var avX = padX;
      var avY = cardY + 168;
      var avSize = 148;
      ctx.save();
      ctx.beginPath();
      ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      var drewAvatar = false;
      if (avatarImg) {
        try {
          var iw = avatarImg.naturalWidth || avatarImg.width;
          var ih = avatarImg.naturalHeight || avatarImg.height;
          if (iw && ih) {
            var scale = Math.max(avSize / iw, avSize / ih);
            var dw = iw * scale;
            var dh = ih * scale;
            ctx.drawImage(avatarImg, avX + (avSize - dw) / 2, avY + (avSize - dh) / 2, dw, dh);
            drewAvatar = true;
          }
        } catch (_err) {
          drewAvatar = false;
        }
      }
      if (!drewAvatar) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(avX, avY, avSize, avSize);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = '600 52px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.textAlign = "center";
        var initials = String(member.name || "HR")
          .split(/\s+/)
          .filter(Boolean)
          .slice(-2)
          .map(function (w) { return w[0].toUpperCase(); })
          .join("");
        ctx.fillText(initials || "HR", avX + avSize / 2, avY + avSize / 2 + 18);
        ctx.textAlign = "left";
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2 + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = palette.chip;
      ctx.lineWidth = 3;
      ctx.stroke();

      /* Pillar Pill & Member Name */
      var infoX = avX + avSize + 36;
      var infoW = innerW - avSize - 36;
      ctx.font = '600 18px "Be Vietnam Pro", -apple-system, sans-serif';
      var bW = Math.min(infoW, ctx.measureText(palette.badge).width + 38);
      drawRoundedRect(ctx, infoX, avY + 4, bW, 40, 20);
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fill();
      ctx.strokeStyle = palette.chip;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = palette.chip;
      ctx.fillText(palette.badge, infoX + 19, avY + 31);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 46px "Be Vietnam Pro", -apple-system, sans-serif';
      var nameEndY = drawWrappedLines(ctx, member.name || "Thành viên Hola", infoX, avY + 98, infoW, 56, 2);
      ctx.fillStyle = "rgba(244, 247, 245, 0.72)";
      ctx.font = '400 24px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(member.organization || "Cộng đồng Hòa Lạc", infoX, nameEndY + 8);

      /* Bio Quote */
      ctx.fillStyle = "rgba(253, 245, 234, 0.9)";
      ctx.font = 'italic 400 26px "Lora", Georgia, serif';
      drawWrappedLines(
        ctx,
        "“" + (member.bio || "Sống sâu hơn, xanh hơn và bền bỉ sẻ chia cùng HolaRise.") + "”",
        padX,
        cardY + 412,
        innerW,
        40,
        2
      );

      /* EXP Progress Panel */
      var expY = cardY + 518;
      var expH = 144;
      drawRoundedRect(ctx, padX, expY, innerW, expH, 22);
      ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "rgba(244, 247, 245, 0.78)";
      ctx.font = '500 21px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("Hành trình · " + (exp.tierName || "Khởi hành"), padX + 28, expY + 44);

      ctx.textAlign = "right";
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '600 22px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(exp.expText || "20 / 150 EXP", padX + innerW - 28, expY + 44);
      ctx.textAlign = "left";

      var barX = padX + 28;
      var barY = expY + 68;
      var barW = innerW - 56;
      var barH = 14;
      drawRoundedRect(ctx, barX, barY, barW, barH, 7);
      ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
      ctx.fill();

      var fillW = Math.max(24, Math.round((barW * Math.max(6, Math.min(100, Number(exp.progressPct) || 12))) / 100));
      var barGrad = ctx.createLinearGradient(barX, barY, barX + fillW, barY);
      barGrad.addColorStop(0, palette.barA);
      barGrad.addColorStop(1, palette.barB);
      drawRoundedRect(ctx, barX, barY, fillW, barH, 7);
      ctx.fillStyle = barGrad;
      ctx.fill();

      ctx.fillStyle = "rgba(244, 247, 245, 0.62)";
      ctx.font = '400 19px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText(exp.breakdownText || "0 hoạt động · 0 lưu bút", padX + 28, expY + 118);

      /* Perforation Line */
      var divY = cardY + 720;
      ctx.save();
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cardX + 36, divY);
      ctx.lineTo(cardX + cardW - 36, divY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "#F4F5F3";
      ctx.beginPath();
      ctx.arc(cardX, divY, 24, 0, Math.PI * 2);
      ctx.arc(cardX + cardW, divY, 24, 0, Math.PI * 2);
      ctx.fill();

      var metaY1 = divY + 64;
      var metaY2 = divY + 216;
      var col2X = padX + innerW / 2 + 16;
      var colW = innerW / 2 - 24;

      function drawM(label, val, x, y, valColor) {
        ctx.fillStyle = "rgba(244, 247, 245, 0.54)";
        ctx.font = '600 19px "Be Vietnam Pro", -apple-system, sans-serif';
        ctx.fillText(label, x, y);
        ctx.fillStyle = valColor || "#FFFFFF";
        ctx.font = '600 28px "Be Vietnam Pro", -apple-system, sans-serif';
        drawWrappedLines(ctx, val, x, y + 38, colW, 36, 2);
      }

      drawM("MÃ THÀNH VIÊN", member.memberCode || "HOLA-2026-0001", padX, metaY1, palette.chip);
      drawM("CỘNG ĐỒNG", "HolaRise · Hòa Lạc", col2X, metaY1);
      drawM("TRỤ CỘT CHÍNH", palette.badge.split(" · ")[0], padX, metaY2);
      drawM("TRẠNG THÁI", "Đang hoạt động", col2X, metaY2);

      var footY = cardY + cardH - 104;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, footY);
      ctx.lineTo(cardX + cardW - 64, footY);
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(244, 247, 245, 0.72)";
      ctx.font = '600 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HOLARISE.ORG", padX, footY + 54);

      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(244, 247, 245, 0.62)";
      ctx.font = '500 20px "Be Vietnam Pro", -apple-system, sans-serif';
      ctx.fillText("HÒA LẠC · CỘNG ĐỒNG THANH NIÊN", cardX + cardW - 64, footY + 54);
      ctx.restore();

      var fileName =
        "the-thanh-vien-" + String(member.memberCode || "holarise").toLowerCase().replace(/[^a-z0-9-]+/g, "-") + ".png";
      var dataUrl = canvas.toDataURL("image/png");
      if (canvas.toBlob) {
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            deliverPngBlob(blob, dataUrl, fileName, "Thẻ Thành Viên HolaRise").then(resolve);
          }, "image/png");
        });
      }
      return deliverPngBlob(null, dataUrl, fileName, "Thẻ Thành Viên HolaRise");
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
      var title = btn.getAttribute("data-ics-title") || "Hoạt động Cộng đồng HolaRise";
      var startUtc = btn.getAttribute("data-ics-start") || "";
      var endUtc = btn.getAttribute("data-ics-end") || "";
      var location = btn.getAttribute("data-ics-location") || "Hòa Lạc, Hà Nội";
      var url = canonicalizeShareUrl(btn.getAttribute("data-ics-url") || ((window.location && window.location.pathname) || "/"));
      if (!startUtc || !endUtc) {
        var now = new Date();
        var fallbackStart = new Date(now.getTime() + 86400000);
        var fallbackEnd = new Date(fallbackStart.getTime() + 7200000);
        startUtc = fallbackStart.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
        endUtc = fallbackEnd.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      }
      var mode = btn.getAttribute("data-ics-download") || "workshop";
      var snap = confirmedSnapshots[mode];
      var codeNote = snap && snap.id ? "Mã vé giữ chỗ: " + snap.id + "\n" : "";
      var description =
        codeNote +
        "Hoạt động cộng đồng phi lợi nhuận HolaRise.\nThư mời chi tiết: " +
        url;

      var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      var uidSlug = String((snap && snap.eventSlug) || title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
      var icsLines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//HolaRise//Community Event//VI",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:" + uidSlug + "-" + startUtc.slice(0, 8) + "@holarise.org",
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
        "DESCRIPTION:" + escapeIcsText("Nhắc lịch trước 2 giờ: " + title),
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
      ];

      var blob = new Blob([icsLines.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
      var objUrl = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = objUrl;
      a.download = "holarise-" + uidSlug + ".ics";
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
            title: document.title || (snap.activity ? snap.activity + " | HolaRise" : "HolaRise"),
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

  /* MusicSpace-style 3D Sealed Envelope + Handwritten Note & Personalized Share Modal */
  (function initEventShareAndEnvelope() {
    var modal = document.getElementById("event-share-modal");
    var envStage = document.getElementById("hl-env-stage");
    var envBox = document.getElementById("hl-env-box");
    var mainFlow = document.getElementById("hl-invite-main-flow");
    var handnoteWrap = document.getElementById("hl-handnote-wrap");
    var hwBody = document.getElementById("hl-hw-body");

    function escHtmlSimple(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function wrapHandLines(text, maxChars) {
      var words = String(text || "").split(/\s+/).filter(Boolean);
      var out = [];
      var cur = "";
      words.forEach(function (w) {
        if (cur && (cur + " " + w).length > (maxChars || 26)) {
          out.push(cur);
          cur = w;
        } else {
          cur = cur ? cur + " " + w : w;
        }
      });
      if (cur) out.push(cur);
      return out;
    }

    function renderHandwrittenNote(recipient, inviter, note) {
      if (!handnoteWrap || !hwBody) return;
      var cleanNote = String(note || "").trim();
      if (!cleanNote) {
        handnoteWrap.hidden = true;
        return;
      }
      var penSvg =
        '<svg class="hl-pen" width="24" height="24" viewBox="0 0 24 24" fill="#FFFFFF" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
      var lines = wrapHandLines(cleanNote, 28);
      var t = 1.1;
      var tilts = [0.4, -0.35, 0.25, -0.45, 0.3];
      var html =
        '<div style="transform:rotate(-0.8deg)"><span class="hl-wl" style="--t:0.35s;--d:0.65s;--n:5;font-size:1.55rem;font-weight:700;"><span class="hl-ink">' +
        t("Gửi ", "Dear ") +
        escHtmlSimple(recipient || t("bạn", "friend")) +
        ",</span>" +
        penSvg +
        "</span></div>";

      lines.forEach(function (line, i) {
        var writes = i < 3;
        var d = writes ? Math.max(0.45, line.length * 0.048) : 0.7;
        var cls = writes ? "hl-wl" : "hl-wl hl-wfade";
        html +=
          '<div style="transform:rotate(' +
          tilts[i % tilts.length] +
          'deg)"><span class="' +
          cls +
          '" style="--t:' +
          t.toFixed(2) +
          "s;--d:" +
          d.toFixed(2) +
          "s;--n:" +
          Math.max(2, Math.round(d / 0.13)) +
          ';"><span class="hl-ink">' +
          escHtmlSimple(line) +
          "</span>" +
          penSvg +
          "</span></div>";
        if (writes) t += d + 0.22;
      });

      var signT = t + 0.25;
      html +=
        '<div class="hl-hw-sign"><span class="hl-wl" style="--t:' +
        signT.toFixed(2) +
        's;--d:0.6s;--n:5;font-size:1.7rem;font-weight:700;"><span class="hl-ink">' +
        escHtmlSimple(inviter || "HolaRise") +
        "</span>" +
        penSvg +
        '</span><svg class="hl-wdraw" width="150" height="20" viewBox="0 0 170 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="--t:' +
        (signT + 0.55).toFixed(2) +
        's;--d:0.55s;margin-top:-6px;"><path pathLength="1" d="M4 13C34 3 66 20 98 10s44-5 58 2c6 3 4 8-3 6"/></svg></div>';

      hwBody.innerHTML = html;
      handnoteWrap.hidden = false;
    }

    var envTimer = 0;
    var activeEnvData = null;

    function revealMainInvitation(instant) {
      if (envTimer) {
        window.clearTimeout(envTimer);
        envTimer = 0;
      }
      if (envStage) envStage.hidden = true;
      if (envBox) envBox.classList.remove("hl-open");
      if (mainFlow) {
        mainFlow.hidden = false;
        if (!instant) {
          mainFlow.classList.remove("hl-invin");
          void mainFlow.offsetWidth;
          mainFlow.classList.add("hl-invin");
        }
      }
      if (activeEnvData) {
        renderHandwrittenNote(activeEnvData.recipient, activeEnvData.inviter, activeEnvData.note);
      }
    }

    function openEnvelopeStage(data) {
      if (!envStage || !envBox || !mainFlow) return;
      activeEnvData = data || {};
      var recipient = String(activeEnvData.recipient || "").trim() || t("bạn", "friend");
      var inviter = String(activeEnvData.inviter || "").trim() || "HolaRise";
      var initial = inviter.charAt(0).toUpperCase() || "H";

      var salEl = document.getElementById("hl-env-salutation");
      var invEl = document.getElementById("hl-env-inviter-txt");
      var cardRecEl = document.getElementById("hl-env-card-recipient");
      var sealBtn = document.getElementById("hl-env-seal-btn");
      if (salEl) salEl.textContent = t("Gửi ", "Dear ") + recipient + ",";
      if (invEl) invEl.textContent = inviter;
      if (cardRecEl) cardRecEl.textContent = recipient;
      if (sealBtn) sealBtn.textContent = initial;

      envBox.classList.remove("hl-open");
      envStage.hidden = false;
      mainFlow.hidden = true;
      window.scrollTo({ top: 0, behavior: "instant" });
    }

    function triggerEnvelopeOpen() {
      if (!envBox || envBox.classList.contains("hl-open")) return;
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        revealMainInvitation(true);
        return;
      }
      envBox.classList.add("hl-open");
      envTimer = window.setTimeout(function () {
        revealMainInvitation(false);
      }, 2450);
    }

    if (envStage) {
      document.getElementById("hl-env-seal-btn")?.addEventListener("click", triggerEnvelopeOpen);
      document.getElementById("hl-env-open-btn")?.addEventListener("click", triggerEnvelopeOpen);
      document.getElementById("hl-env-skip-btn")?.addEventListener("click", function () {
        revealMainInvitation(true);
      });

      try {
        var qs = new URLSearchParams(window.location.search);
        var urlRecipient = (qs.get("gui") || qs.get("to") || "").trim().slice(0, 60);
        var urlInviter = (qs.get("moi") || qs.get("from") || "").trim().slice(0, 60);
        var urlNote = (qs.get("loi") || qs.get("note") || "").trim().slice(0, 140);
        if (urlRecipient || urlInviter) {
          openEnvelopeStage({ recipient: urlRecipient, inviter: urlInviter, note: urlNote });
        }
      } catch (_e) {}
    }

    if (!modal) return;

    var baseUrl = canonicalizeShareUrl(modal.getAttribute("data-share-url") || ((window.location && window.location.pathname) || "/"));
    var baseShareTitle = modal.getAttribute("data-share-title") || document.title;
    var shareTime = modal.getAttribute("data-share-time") || "";
    var shareVenue = modal.getAttribute("data-share-venue") || "";
    var urlInput = document.getElementById("share-url-input");
    var recipientInput = document.getElementById("share-recipient-name");
    var inviterInput = document.getElementById("share-inviter-name");
    var noteInput = document.getElementById("share-personal-note");
    var previewTitleEl = document.getElementById("share-preview-title");
    var copyBtn = document.getElementById("share-copy-btn");
    var previewEnvBtn = document.getElementById("share-preview-env-btn");

    function getCurrentShareTitle() {
      var rec = recipientInput ? recipientInput.value.trim() : "";
      if (!rec) return baseShareTitle;
      return baseShareTitle.indexOf("| " + rec) >= 0 ? baseShareTitle : baseShareTitle + " | " + rec;
    }

    function buildCurrentShareUrl() {
      var rec = recipientInput ? recipientInput.value.trim() : "";
      var inviter = inviterInput ? inviterInput.value.trim() : "";
      var note = noteInput ? noteInput.value.trim() : "";
      try {
        var u = new URL(baseUrl, SITE_URL);
        if (rec) u.searchParams.set("gui", rec);
        if (inviter) u.searchParams.set("moi", inviter);
        if (note) u.searchParams.set("loi", note);
        return u.toString();
      } catch (_e) {
        return baseUrl;
      }
    }

    function syncSharePreview() {
      if (urlInput) urlInput.value = buildCurrentShareUrl();
      if (previewTitleEl) previewTitleEl.textContent = getCurrentShareTitle();
    }

    [recipientInput, inviterInput, noteInput].forEach(function (inp) {
      if (inp) inp.addEventListener("input", syncSharePreview);
    });

    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-open-invite-share]");
      if (!trigger) return;
      if (inviterInput && !inviterInput.value.trim() && window.HolaMember && window.HolaMember.member && window.HolaMember.member.name) {
        inviterInput.value = window.HolaMember.member.name;
      }
      syncSharePreview();
      if (copyBtn) copyBtn.textContent = t("Sao chép", "Copy");
      if (typeof modal.showModal === "function" && !modal.open) {
        modal.showModal();
      }
    });

    if (previewEnvBtn) {
      previewEnvBtn.addEventListener("click", function () {
        var rec = recipientInput ? recipientInput.value.trim() : "";
        var inv = inviterInput ? inviterInput.value.trim() : "";
        var note = noteInput ? noteInput.value.trim() : "";
        if (modal.open) modal.close();
        openEnvelopeStage({
          recipient: rec || t("bạn", "friend"),
          inviter: inv || "HolaRise",
          note: note || t("Hẹn gặp bạn ở buổi sinh hoạt thật ấm cúng này nhé.", "Hope to see you at this warm community gathering."),
        });
      });
    }

    if (copyBtn && urlInput) {
      copyBtn.addEventListener("click", function () {
        var currentUrl = buildCurrentShareUrl();
        urlInput.value = currentUrl;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(currentUrl).catch(function () {
            urlInput.select();
            document.execCommand("copy");
          });
        } else {
          urlInput.select();
          document.execCommand("copy");
        }
        copyBtn.textContent = t("Đã chép ✓", "Copied ✓");
        setTimeout(function () {
          copyBtn.textContent = t("Sao chép", "Copy");
        }, 2200);
      });
    }

    modal.querySelectorAll("[data-share-platform]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var platform = btn.getAttribute("data-share-platform");
        var link = buildCurrentShareUrl();
        var titleNow = getCurrentShareTitle();
        var summary = [titleNow, [shareTime, shareVenue].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
        var encUrl = encodeURIComponent(link);
        var encText = encodeURIComponent(summary);

        if (platform === "zalo") {
          if (navigator.share) {
            navigator.share({ title: titleNow, text: summary, url: link }).catch(function () {});
            return;
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(summary + "\n" + link).catch(function () {});
          }
          window.open("https://chat.zalo.me/", "_blank", "noopener,noreferrer");
          if (copyBtn) copyBtn.textContent = "Đã chép cho Zalo ✓";
          return;
        }
        if (platform === "facebook") {
          window.open("https://www.facebook.com/sharer/sharer.php?u=" + encUrl, "_blank", "noopener,noreferrer");
          return;
        }
        if (platform === "messenger") {
          if (navigator.share) {
            navigator.share({ title: titleNow, text: summary, url: link }).catch(function () {});
            return;
          }
          window.open("https://www.facebook.com/dialog/send?link=" + encUrl + "&redirect_uri=" + encUrl, "_blank", "noopener,noreferrer");
          return;
        }
        if (platform === "telegram") {
          window.open("https://t.me/share/url?url=" + encUrl + "&text=" + encText, "_blank", "noopener,noreferrer");
        }
      });
    });
  })();
})();
