/**
 * HolaRise – Hòa Lạc | Core UI Interactions
 * Follows modern-web-guidance for native <dialog closedby="any">,
 * top-layer exit animation fallback, Safari backdrop click fallback, and forms.
 */
(function () {
  "use strict";

  /* 1. Sticky / Smart Mobile In-Place Logo Morph (Wordmark <-> HR Badge) */
  var header = document.querySelector(".site-header");
  var navToggle = document.querySelector("[data-nav-toggle]");
  var mobileDrawer = document.querySelector("[data-mobile-drawer]");
  var lastScrollY = window.scrollY || 0;

  if (header) {
    var scrollRafPending = false;
    var onScroll = function () {
      var currentY = window.scrollY || 0;
      var delta = currentY - lastScrollY;
      var drawerIsOpen = mobileDrawer && mobileDrawer.classList.contains("is-open");

      header.classList.toggle("is-scrolled", currentY > 36);

      if (window.innerWidth <= 820 && !drawerIsOpen) {
        if (currentY <= 44) {
          header.classList.remove("is-compact-mobile");
        } else if (delta > 5) {
          /* Scrolling down on mobile -> wordmark shrinks into compact HR logo badge */
          header.classList.add("is-compact-mobile");
        } else if (delta < -8) {
          /* Scrolling up -> HR badge expands back into HolaRise wordmark */
          header.classList.remove("is-compact-mobile");
        }
      } else {
        header.classList.remove("is-compact-mobile");
      }

      lastScrollY = currentY;
    };
    window.addEventListener(
      "scroll",
      function () {
        if (scrollRafPending) return;
        scrollRafPending = true;
        window.requestAnimationFrame(function () {
          scrollRafPending = false;
          onScroll();
        });
      },
      { passive: true }
    );
    onScroll();
  }

  /* 2. Full-Screen Mobile Editorial Glass Drawer */
  if (navToggle && mobileDrawer) {
    var setDrawerState = function (open) {
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Đóng menu điều hướng" : "Mở menu điều hướng");
      mobileDrawer.classList.toggle("is-open", open);
      mobileDrawer.setAttribute("aria-hidden", String(!open));
      document.body.style.overflow = open ? "hidden" : "";
      if (open && header) {
        header.classList.remove("is-compact-mobile");
      }
    };

    navToggle.addEventListener("click", function () {
      var expanded = navToggle.getAttribute("aria-expanded") === "true";
      setDrawerState(!expanded);
    });

    mobileDrawer.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setDrawerState(false);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && mobileDrawer.classList.contains("is-open")) {
        setDrawerState(false);
      }
    });

    window.__holaRiseCloseDrawer = function () {
      if (mobileDrawer.classList.contains("is-open")) {
        setDrawerState(false);
      }
    };
  }

  /* 3. Category & 4-Word Value Filters (Home, Activities, Workshops & News) */
  var initialLocFilter = "";
  try {
    initialLocFilter = (new URLSearchParams(window.location.search).get("loc") || "").trim();
  } catch (e) {
    initialLocFilter = "";
  }

  document.querySelectorAll("[data-filter-group]").forEach(function (group) {
    var buttons = group.querySelectorAll("[data-filter]");
    var targetSelector = group.getAttribute("data-filter-group");
    var cards = document.querySelectorAll(targetSelector);
    var countEl = document.querySelector('[data-filter-count="' + targetSelector + '"]');
    var emptyEl = document.querySelector('[data-filter-empty="' + targetSelector + '"]');
    var resetBtn = document.querySelector('[data-filter-reset="' + targetSelector + '"]');
    var totalCount = cards.length;

    var updateMeta = function (visibleCount) {
      if (countEl) {
        countEl.textContent = visibleCount + " / " + totalCount + " mục";
      }
      if (emptyEl) {
        emptyEl.hidden = visibleCount > 0 || totalCount === 0;
      }
    };

    var applyFilter = function (activeBtn) {
      var filter = activeBtn.getAttribute("data-filter");
      buttons.forEach(function (b) {
        b.classList.toggle("is-active", b === activeBtn);
        b.setAttribute("aria-pressed", String(b === activeBtn));
      });
      var visibleCount = 0;
      cards.forEach(function (card) {
        var tokens = (card.getAttribute("data-category") || "").trim().split(/\s+/);
        var match = filter === "all" || tokens.indexOf(filter) !== -1;
        card.style.display = match ? "" : "none";
        if (match) visibleCount += 1;
      });
      updateMeta(visibleCount);
      if (window.ScrollTrigger) {
        window.ScrollTrigger.refresh();
      }
    };

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyFilter(btn);
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        var allBtn = group.querySelector('[data-filter="all"]');
        if (allBtn) {
          applyFilter(allBtn);
          allBtn.focus();
        }
      });
    }

    updateMeta(totalCount);

    if (initialLocFilter) {
      buttons.forEach(function (btn) {
        if (btn.getAttribute("data-filter") === initialLocFilter) {
          applyFilter(btn);
        }
      });
    }
  });

  /* 4. Native <dialog> Helpers (modern-web-guidance: animate-to-from-top-layer & light-dismiss-a-dialog) */
  var supportsDisplayTransition;
  function canTransitionDisplay() {
    if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
    if (!(window.CSS && CSS.supports && CSS.supports("transition-behavior", "allow-discrete")) || !document.body) {
      return false;
    }
    var probe = document.createElement("div");
    probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
    document.body.appendChild(probe);
    getComputedStyle(probe).display;
    probe.style.display = "none";
    supportsDisplayTransition = getComputedStyle(probe).display === "block";
    probe.remove();
    return supportsDisplayTransition;
  }

  function supportsTopLayerExit() {
    return Boolean(window.CSS && CSS.supports && CSS.supports("overlay", "auto") && canTransitionDisplay());
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    dialog.removeAttribute("data-closing");
    dialog.showModal();
  }

  window.__holaRiseOpenDialog = openDialog;

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    if (!supportsTopLayerExit()) {
      dialog.setAttribute("data-closing", "");
      var anims = dialog.getAnimations ? dialog.getAnimations({ subtree: true }) : [];
      if (anims.length > 0) {
        Promise.race([
          Promise.allSettled(
            anims.map(function (a) {
              return a.finished;
            })
          ),
          new Promise(function (resolve) {
            setTimeout(resolve, 600);
          })
        ]).then(function () {
          if (!dialog.hasAttribute("data-closing")) return;
          dialog.removeAttribute("data-closing");
          dialog.close();
        });
        return;
      }
      dialog.removeAttribute("data-closing");
    }
    dialog.close();
  }

  document.querySelectorAll("dialog.club-dialog").forEach(function (dialog) {
    /* Route native close requests (Esc / closedby) cleanly when exit fallback is needed */
    dialog.addEventListener("cancel", function (event) {
      if (!supportsTopLayerExit()) {
        event.preventDefault();
        closeDialog(dialog);
      }
    });

    dialog.addEventListener("close", function () {
      dialog.removeAttribute("data-closing");
    });

    /* Mandatory Safari fallback when closedby="any" is unsupported */
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialog.addEventListener("click", function (event) {
        if (event.target !== dialog) return;
        var rect = dialog.getBoundingClientRect();
        var inside =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!inside) {
          closeDialog(dialog);
        }
      });
    }

    dialog.querySelectorAll("[data-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeDialog(dialog);
      });
    });
  });

  /* 5. Lightbox v2 Trigger (Single Photos + Album Viewer + Prev/Next + Keyboard + Touch Swipe) */
  var lightbox = document.getElementById("gallery-lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxCaption = document.getElementById("lightbox-caption");
  var lightboxCounter = document.getElementById("lightbox-counter");
  var lightboxDownload = document.getElementById("lightbox-download");
  var lightboxDrive = document.getElementById("lightbox-drive");
  var lightboxPrevBtn = lightbox ? lightbox.querySelector("[data-lightbox-prev]") : null;
  var lightboxNextBtn = lightbox ? lightbox.querySelector("[data-lightbox-next]") : null;

  if (lightbox && lightboxImg && lightboxCaption) {
    var galleryTriggers = Array.prototype.slice.call(document.querySelectorAll("[data-lightbox-src]"));
    var defaultSlides = galleryTriggers.map(function (btn) {
      return {
        src: btn.getAttribute("data-lightbox-src") || "",
        alt: btn.getAttribute("data-lightbox-alt") || "",
        caption: btn.getAttribute("data-lightbox-caption") || "",
        photographer: "",
        driveUrl: "",
      };
    });
    var activeSlides = defaultSlides;
    var activeGalleryIdx = 0;

    var formatIdx = function (n) {
      return n < 10 ? "0" + n : String(n);
    };

    var showGalleryIndex = function (idx) {
      if (!activeSlides.length) return;
      var total = activeSlides.length;
      activeGalleryIdx = ((idx % total) + total) % total;
      var item = activeSlides[activeGalleryIdx];
      lightboxImg.src = item.src || "";
      lightboxImg.alt = item.alt || "";
      var captionText = item.caption || "";
      if (item.photographer) {
        captionText = captionText ? captionText + " · Ảnh: " + item.photographer : "Ảnh: " + item.photographer;
      }
      lightboxCaption.textContent = captionText;
      if (lightboxDownload) {
        if (item.src) {
          lightboxDownload.href = item.src;
          lightboxDownload.hidden = false;
        } else {
          lightboxDownload.hidden = true;
        }
      }
      if (lightboxDrive) {
        if (item.driveUrl && item.driveUrl.indexOf("https://") === 0) {
          lightboxDrive.href = item.driveUrl;
          lightboxDrive.hidden = false;
        } else {
          lightboxDrive.hidden = true;
        }
      }
      if (lightboxCounter) {
        lightboxCounter.textContent = formatIdx(activeGalleryIdx + 1) + " / " + formatIdx(total);
      }
      var multi = total > 1;
      if (lightboxPrevBtn) lightboxPrevBtn.hidden = !multi;
      if (lightboxNextBtn) lightboxNextBtn.hidden = !multi;
    };

    galleryTriggers.forEach(function (btn, idx) {
      btn.addEventListener("click", function () {
        activeSlides = defaultSlides;
        showGalleryIndex(idx);
        openDialog(lightbox);
      });
    });

    document.querySelectorAll("[data-album-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest("[data-album-card]");
        var scriptEl = card ? card.querySelector("script.album-photos-data") : null;
        if (!scriptEl) return;
        try {
          var payload = JSON.parse(scriptEl.textContent || "{}");
          var photos = Array.isArray(payload.photos) ? payload.photos : [];
          if (!photos.length) return;
          activeSlides = photos.map(function (p) {
            return {
              src: p.src || "",
              alt: p.alt || payload.title || "",
              caption: p.caption || payload.title || "",
              photographer: p.photographer || "",
              driveUrl: payload.driveUrl || "",
            };
          });
          showGalleryIndex(0);
          openDialog(lightbox);
        } catch (err) {
          // ignore malformed album JSON
        }
      });
    });

    if (lightboxPrevBtn) {
      lightboxPrevBtn.addEventListener("click", function () {
        showGalleryIndex(activeGalleryIdx - 1);
      });
    }

    if (lightboxNextBtn) {
      lightboxNextBtn.addEventListener("click", function () {
        showGalleryIndex(activeGalleryIdx + 1);
      });
    }

    lightbox.addEventListener("keydown", function (e) {
      if (!lightbox.open || activeSlides.length <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        showGalleryIndex(activeGalleryIdx - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        showGalleryIndex(activeGalleryIdx + 1);
      }
    });

    var lbTouchX = 0;
    var lbTouchY = 0;
    lightbox.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches || !e.touches.length) return;
        lbTouchX = e.touches[0].clientX;
        lbTouchY = e.touches[0].clientY;
      },
      { passive: true }
    );
    lightbox.addEventListener(
      "touchend",
      function (e) {
        if (!e.changedTouches || !e.changedTouches.length || activeSlides.length <= 1) return;
        var dx = e.changedTouches[0].clientX - lbTouchX;
        var dy = e.changedTouches[0].clientY - lbTouchY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          showGalleryIndex(dx < 0 ? activeGalleryIdx + 1 : activeGalleryIdx - 1);
        }
      },
      { passive: true }
    );
  }

  /* 6. Quick Event Registration Dialog Trigger */
  var eventModal = document.getElementById("event-register-modal");
  var eventTitleDisplay = document.getElementById("modal-event-title");
  var eventTypeDisplay = document.getElementById("modal-event-type");
  var eventMetaDisplay = document.getElementById("modal-event-meta");
  var eventInputHidden = document.getElementById("modal-event-input");
  var eventIdHidden = document.getElementById("modal-event-id");

  if (eventModal) {
    document.querySelectorAll("[data-register-event]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var title = btn.getAttribute("data-register-event") || "Hoạt động cộng đồng HolaRise";
        var eventId = btn.getAttribute("data-event-id") || "";
        var eventDate = btn.getAttribute("data-event-date") || "Ngày đầu của tuần - Chủ nhật";
        var eventTime = btn.getAttribute("data-event-time") || "";
        var eventLocation = btn.getAttribute("data-event-location") || "Hòa Lạc, Hà Nội";
        var eventFee = btn.getAttribute("data-event-fee") || "Chi phí theo thông báo";
        var eventType = btn.getAttribute("data-event-type") || "Chủ nhật tại Hòa Lạc";

        if (eventTitleDisplay) eventTitleDisplay.textContent = title;
        if (eventTypeDisplay) eventTypeDisplay.textContent = eventType;
        if (eventMetaDisplay) {
          eventMetaDisplay.textContent = [eventDate, eventTime, eventLocation, eventFee]
            .filter(Boolean)
            .join(" · ");
        }
        if (eventInputHidden) eventInputHidden.value = title;
        if (eventIdHidden) eventIdHidden.value = eventId;

        eventModal.dataset.eventTitle = title;
        eventModal.dataset.eventId = eventId;
        eventModal.dataset.eventDate = eventDate;
        eventModal.dataset.eventTime = eventTime;
        eventModal.dataset.eventLocation = eventLocation;
        eventModal.dataset.eventFee = eventFee;
        eventModal.dataset.eventType = eventType;

        var modalForm = eventModal.querySelector("form[data-club-form]");
        var modalSuccess = document.getElementById("modal-pass-success");
        if (modalForm) modalForm.hidden = false;
        if (modalSuccess) modalSuccess.hidden = true;

        var statusEl = eventModal.querySelector(".form-status");
        if (statusEl) {
          statusEl.className = "form-status";
          statusEl.textContent = "";
        }
        eventModal.querySelectorAll('[aria-invalid="true"]').forEach(function (field) {
          setFieldErrorState(field, "", false);
        });
        openDialog(eventModal);
      });
    });
  }

  /* 7. Registration & Contact Form Submission + Local Offline Drafts + Accessible Inline Validation */
  var DRAFT_FIELDS = ["fullName", "phone", "email", "role", "eventChoice", "organization", "note"];
  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var supportsHasSelector = Boolean(window.CSS && CSS.supports && CSS.supports("selector(:has(a))"));

  var liveAnnouncer = null;
  var announceTimer = null;
  var announcedField = null;
  var announcedFields = typeof WeakSet !== "undefined" ? new WeakSet() : null;
  var interactedFields = typeof WeakSet !== "undefined" ? new WeakSet() : null;

  function ensureLiveAnnouncer() {
    if (liveAnnouncer || !document.body) return liveAnnouncer;
    liveAnnouncer = document.createElement("div");
    liveAnnouncer.setAttribute("aria-live", "polite");
    liveAnnouncer.className = "sr-only";
    document.body.appendChild(liveAnnouncer);
    return liveAnnouncer;
  }

  function spokenText(node) {
    if (!node) return "";
    var copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach(function (n) {
      n.remove();
    });
    return (copy.textContent || "").replace(/\s+/g, " ").trim();
  }

  function linkError(el, shown) {
    if (!el) return;
    var errorId = el.getAttribute("data-error");
    if (!errorId) return;
    var ids = (el.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(function (id) {
        return id && id !== errorId;
      });
    if (shown) ids.push(errorId);
    if (ids.length) {
      el.setAttribute("aria-describedby", ids.join(" "));
    } else {
      el.removeAttribute("aria-describedby");
    }
  }

  function announceFieldError(el) {
    var errorId = el ? el.getAttribute("data-error") : "";
    if (!errorId) return;
    var errorEl = document.getElementById(errorId);
    if (!errorEl) return;
    var announcer = ensureLiveAnnouncer();
    if (!announcer) return;
    var labelEl = el.labels && el.labels[0] ? el.labels[0] : null;
    var prefix = labelEl ? spokenText(labelEl) + ": " : "";
    var msg = spokenText(errorEl);
    if (!msg) return;
    if (announceTimer) clearTimeout(announceTimer);
    announcer.textContent = "";
    announcedField = el;
    announceTimer = setTimeout(function () {
      announcer.textContent = prefix + msg;
    }, 500);
  }

  function validateClubField(field) {
    if (!field) return "";
    var name = field.getAttribute("name") || "";
    var val = (field.value || "").trim();

    if (name === "fullName") {
      if (val.length < 2) {
        return "Lỗi: Vui lòng nhập họ và tên đầy đủ (tối thiểu 2 ký tự).";
      }
      return "";
    }

    if (name === "phone" || name === "contact") {
      var digits = val.replace(/\D/g, "").length;
      if (digits < 8) {
        return "Lỗi: Vui lòng nhập số điện thoại / Zalo hợp lệ (ít nhất 8 chữ số).";
      }
      return "";
    }

    if (name === "email") {
      if (val && !EMAIL_REGEX.test(val)) {
        return "Lỗi: Email chưa đúng định dạng (ví dụ: tenban@gmail.com), hoặc bạn có thể để trống.";
      }
      return "";
    }

    return "";
  }

  function setFieldErrorState(field, errorMessage, shouldAnnounce) {
    if (!field) return;
    var errorId = field.getAttribute("data-error");
    var errorEl = errorId ? document.getElementById(errorId) : null;
    var fieldGroup = !supportsHasSelector && field.closest ? field.closest(".field") : null;

    if (errorMessage) {
      if (errorEl) {
        var textTarget = errorEl.querySelector("[data-error-text]") || errorEl;
        textTarget.textContent = errorMessage;
      }
      field.setAttribute("aria-invalid", "true");
      linkError(field, true);
      if (fieldGroup) fieldGroup.classList.add("has-error-fallback");
      if (shouldAnnounce && (!announcedFields || !announcedFields.has(field))) {
        announceFieldError(field);
        if (announcedFields) announcedFields.add(field);
      }
    } else {
      field.setAttribute("aria-invalid", "false");
      linkError(field, false);
      if (fieldGroup) fieldGroup.classList.remove("has-error-fallback");
      if (announcedFields) announcedFields.delete(field);
      if (announcedField === field && liveAnnouncer) {
        if (announceTimer) clearTimeout(announceTimer);
        liveAnnouncer.textContent = "";
        announcedField = null;
      }
    }
  }

  function readDraft(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }

  function saveDraft(key, form) {
    try {
      var data = {};
      var hasValue = false;
      DRAFT_FIELDS.forEach(function (name) {
        var firstEl = form.querySelector('[name="' + name + '"]');
        if (!firstEl) return;
        if (firstEl.type === "radio") {
          var checkedRadio = form.querySelector('input[type="radio"][name="' + name + '"]:checked');
          var rVal = checkedRadio ? checkedRadio.value : "";
          data[name] = rVal;
          if (name === "eventChoice" && rVal) hasValue = true;
          return;
        }
        var val = (firstEl.value || "").trim();
        data[name] = firstEl.value || "";
        if (val && name !== "role") hasValue = true;
      });
      var activeVibe = form.querySelector('[data-vibe-chip][aria-pressed="true"]');
      if (activeVibe) {
        data.vibe = activeVibe.getAttribute("data-vibe-chip") || "";
      }
      var selectedSkills = [];
      form.querySelectorAll('[data-skill-chip][aria-pressed="true"]').forEach(function (chip) {
        var sv = chip.getAttribute("data-skill-chip");
        if (sv) selectedSkills.push(sv);
      });
      if (selectedSkills.length) {
        data.skills = selectedSkills;
        hasValue = true;
      }
      if (hasValue) {
        data.savedAt = Date.now();
        window.localStorage.setItem(key, JSON.stringify(data));
      } else {
        window.localStorage.removeItem(key);
      }
    } catch (_e) {}
  }

  function clearDraft(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (_e) {}
  }

  function renderOfflineNotice(statusEl, form) {
    if (!statusEl) return;
    statusEl.className = "form-status is-offline";
    statusEl.textContent = "";

    var msg = document.createElement("span");
    msg.textContent =
      "Bạn đang ngoại tuyến. Thông tin đăng ký đã được lưu nháp trên máy — hãy bấm gửi lại khi có mạng, hoặc liên hệ trực tiếp:";
    statusEl.appendChild(msg);

    var phone = form.getAttribute("data-phone") || "";
    var phoneRaw = form.getAttribute("data-phone-raw") || phone.replace(/[^0-9+]/g, "");
    var zalo = form.getAttribute("data-zalo") || "";

    if (phoneRaw || zalo) {
      var linksWrap = document.createElement("div");
      linksWrap.className = "form-offline-links";
      if (phoneRaw) {
        var telLink = document.createElement("a");
        telLink.href = "tel:" + phoneRaw;
        telLink.className = "btn btn--outline btn--sm";
        telLink.textContent = "Gọi " + (phone || phoneRaw);
        linksWrap.appendChild(telLink);
      }
      if (zalo) {
        var zaloLink = document.createElement("a");
        zaloLink.href = zalo;
        zaloLink.target = "_blank";
        zaloLink.rel = "noopener noreferrer";
        zaloLink.className = "btn btn--outline btn--sm";
        zaloLink.textContent = "Nhắn Zalo CLB";
        linksWrap.appendChild(zaloLink);
      }
      statusEl.appendChild(linksWrap);
    }
  }

  document.querySelectorAll("[data-club-form]").forEach(function (form, idx) {
    var draftKey = "holarise_form_draft:" + (form.getAttribute("data-draft-key") || window.location.pathname + "#" + idx);
    var statusEl = form.querySelector(".form-status");
    var saveTimer = null;

    /* Restore saved draft cleanly on load */
    var existingDraft = readDraft(draftKey);
    if (existingDraft) {
      var restoredAny = false;
      DRAFT_FIELDS.forEach(function (name) {
        var firstEl = form.querySelector('[name="' + name + '"]');
        if (!firstEl || typeof existingDraft[name] !== "string") return;
        if (firstEl.type === "radio") {
          var radios = form.querySelectorAll('input[type="radio"][name="' + name + '"]');
          var matched = null;
          radios.forEach(function (r) {
            if (r.value === existingDraft[name]) matched = r;
          });
          if (matched) {
            matched.checked = true;
            if (name === "eventChoice" && matched.value) restoredAny = true;
          }
          return;
        }
        if (existingDraft[name]) {
          firstEl.value = existingDraft[name];
          if (name !== "role") restoredAny = true;
        }
      });
      if (typeof existingDraft.vibe === "string" && existingDraft.vibe) {
        var vibeBtns = form.querySelectorAll("[data-vibe-chip]");
        var matchedVibe = false;
        vibeBtns.forEach(function (btn) {
          var isMatch = btn.getAttribute("data-vibe-chip") === existingDraft.vibe;
          if (isMatch) matchedVibe = true;
          btn.classList.toggle("is-selected", isMatch);
          btn.setAttribute("aria-pressed", isMatch ? "true" : "false");
        });
        if (!matchedVibe && vibeBtns.length) {
          vibeBtns[0].classList.add("is-selected");
          vibeBtns[0].setAttribute("aria-pressed", "true");
        }
      }
      if (Array.isArray(existingDraft.skills)) {
        form.querySelectorAll("[data-skill-chip]").forEach(function (btn) {
          var isMatch = existingDraft.skills.indexOf(btn.getAttribute("data-skill-chip")) !== -1;
          btn.classList.toggle("is-selected", isMatch);
          btn.setAttribute("aria-pressed", isMatch ? "true" : "false");
        });
      }
      var orgInputEl = form.querySelector('[name="organization"]');
      if (orgInputEl && orgInputEl.value) {
        form.querySelectorAll("[data-org-chip]").forEach(function (btn) {
          var isMatch = btn.getAttribute("data-org-chip") === orgInputEl.value.trim();
          btn.classList.toggle("is-selected", isMatch);
          btn.setAttribute("aria-pressed", isMatch ? "true" : "false");
        });
      }
      if (restoredAny && statusEl && !statusEl.textContent) {
        statusEl.className = "form-status is-draft";
        statusEl.textContent = "Đã khôi phục bản nháp bạn nhập gần đây.";
      }
      form.dispatchEvent(new CustomEvent("holarise:draft-restored", { bubbles: true }));
    }

    var scheduleDraftSave = function () {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveDraft(draftKey, form);
      }, 250);
    };
    form.addEventListener("input", scheduleDraftSave);
    form.addEventListener("change", scheduleDraftSave);
    form.addEventListener("holarise:chips-changed", scheduleDraftSave);

    /* Validate-after-interaction ARIA sync (modern-web-guidance: accessible-error-announcement & required-field-feedback) */
    var formFields = form.querySelectorAll("input:not([type='hidden']):not([type='radio']), select, textarea");
    formFields.forEach(function (field) {
      field.setAttribute("aria-invalid", "false");
      linkError(field, false);

      field.addEventListener("blur", function () {
        var trimmed = (field.value || "").trim();
        if (!field.required && trimmed.length === 0) {
          setFieldErrorState(field, "", false);
          return;
        }
        var hasInteracted = interactedFields && interactedFields.has(field);
        var matchesUserInvalid = false;
        try {
          matchesUserInvalid = Boolean(field.matches && CSS.supports && CSS.supports("selector(:user-invalid)") && field.matches(":user-invalid"));
        } catch (_e) {}
        if (!hasInteracted && trimmed.length === 0 && !matchesUserInvalid) {
          return;
        }
        var err = validateClubField(field);
        setFieldErrorState(field, err, Boolean(err));
      });

      field.addEventListener("input", function () {
        if (interactedFields) interactedFields.add(field);
        if (field.getAttribute("aria-invalid") === "true") {
          var err = validateClubField(field);
          setFieldErrorState(field, err, false);
        }
      });

      field.addEventListener("change", function () {
        if (interactedFields) interactedFields.add(field);
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var submitBtn = form.querySelector('button[type="submit"]');
      var endpoint = form.getAttribute("data-endpoint") || "/api/registrations";

      var nameEl = form.querySelector('[name="fullName"]');
      var phoneEl = form.querySelector('[name="phone"]') || form.querySelector('[name="contact"]');
      var emailEl = form.querySelector('[name="email"]');

      var nameVal = ((nameEl || {}).value || "").trim();

      var checks = [
        { el: nameEl, error: validateClubField(nameEl), summary: "Vui lòng nhập họ và tên đầy đủ (tối thiểu 2 ký tự)." },
        { el: phoneEl, error: validateClubField(phoneEl), summary: "Vui lòng nhập số điện thoại / Zalo hợp lệ (ít nhất 8 chữ số) để Ban Điều Phối liên hệ." },
        { el: emailEl, error: validateClubField(emailEl), summary: "Email chưa đúng định dạng (ví dụ: tenban@gmail.com). Bạn có thể sửa lại hoặc để trống." }
      ];

      var firstInvalid = null;
      checks.forEach(function (item) {
        if (!item.el) return;
        if (item.error) {
          setFieldErrorState(item.el, item.error, false);
          if (announcedFields) announcedFields.add(item.el);
          if (!firstInvalid) firstInvalid = item;
        } else {
          setFieldErrorState(item.el, "", false);
        }
      });

      if (firstInvalid) {
        firstInvalid.el.focus();
        if (statusEl) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = firstInvalid.summary;
        }
        return;
      }

      /* Persist draft immediately and guide user gracefully when offline */
      if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
        saveDraft(draftKey, form);
        renderOfflineNotice(statusEl, form);
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("is-loading");
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = "Đang gửi thông tin...";
      }

      var payload = {};
      new FormData(form).forEach(function (value, key) {
        payload[key] = value;
      });
      payload.submittedAt = new Date().toISOString();

      var checkedRoleRadio = form.querySelector('input[type="radio"][name="role"]:checked');
      var checkedEventRadio = form.querySelector('input[type="radio"][name="eventChoice"]:checked');
      if (checkedEventRadio) {
        if (checkedEventRadio.value) {
          payload.eventId = checkedEventRadio.value;
          payload.activity = checkedEventRadio.getAttribute("data-event-title") || "";
        } else if (form.hasAttribute("data-join-studio")) {
          payload.eventId = "";
          payload.activity = "";
        }
      }
      delete payload.eventChoice;

      var activeVibeBtn = form.querySelector('[data-vibe-chip][aria-pressed="true"]');
      var vibeValue = activeVibeBtn ? activeVibeBtn.getAttribute("data-vibe-chip") || "" : "";
      var skillValues = [];
      form.querySelectorAll('[data-skill-chip][aria-pressed="true"]').forEach(function (btn) {
        var sv = btn.getAttribute("data-skill-chip");
        if (sv) skillValues.push(sv);
      });
      var invitedBy = form.dataset.invitedBy || "";
      var metaParts = [];
      if (vibeValue) metaParts.push("Phong cách: " + vibeValue);
      if (skillValues.length) metaParts.push("Hứng thú: " + skillValues.join(", "));
      if (invitedBy) metaParts.push("Rủ bởi: " + invitedBy);
      var rawNote = (payload.note || "").trim();
      if (metaParts.length) {
        payload.note = ("[" + metaParts.join(" | ") + "]" + (rawNote ? " " + rawNote : "")).slice(0, 1000);
      }

      var modalContainer = form.closest("#event-register-modal");
      var passSnapshot = {
        id: "",
        source: payload.source || "join_page",
        fullName: nameVal,
        phone: ((phoneEl || {}).value || "").trim(),
        organization: (payload.organization || "").trim(),
        role: (payload.role || "").trim(),
        badge:
          (checkedRoleRadio && checkedRoleRadio.getAttribute("data-badge")) ||
          (modalContainer && modalContainer.dataset.eventType) ||
          "Cộng đồng HolaRise",
        theme: (checkedRoleRadio && checkedRoleRadio.getAttribute("data-theme")) || "emerald",
        greeting: (checkedRoleRadio && checkedRoleRadio.getAttribute("data-greeting")) || "",
        eventId: (payload.eventId || "").trim(),
        eventTitle:
          (payload.activity || "").trim() ||
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-title")) ||
          "Chưa có sự kiện cụ thể",
        eventDate:
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-date")) ||
          (modalContainer && modalContainer.dataset.eventDate) ||
          "Ngày đầu của tuần - Chủ nhật",
        eventTime:
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-time")) ||
          (modalContainer && modalContainer.dataset.eventTime) ||
          "Nhận lịch chi tiết qua Zalo",
        eventLocation:
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-location")) ||
          (modalContainer && modalContainer.dataset.eventLocation) ||
          "Hòa Lạc, Hà Nội",
        vibe: vibeValue || "Quan tâm tìm hiểu",
        skills: skillValues,
      };

      var resetBtn = function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("is-loading");
          submitBtn.textContent = submitBtn.dataset.originalText || "Gửi đăng ký";
        }
      };

      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              return { ok: res.ok, status: res.status, data: data };
            });
        })
        .then(function (result) {
          if (!result.ok || result.data.ok === false) {
            var errMsg =
              (result.data && result.data.error && result.data.error.message) ||
              "Không thể gửi đăng ký lúc này. Vui lòng thử lại sau ít phút.";
            throw new Error(errMsg);
          }
          clearDraft(draftKey);
          if (statusEl) {
            statusEl.className = "form-status is-success";
            statusEl.textContent =
              (result.data && result.data.message) ||
              "Cảm ơn " +
                nameVal +
                "! HolaRise đã ghi nhận thông tin quan tâm của bạn. Đây chưa phải xác nhận tham dự một sự kiện.";
          }
          passSnapshot.id = (result.data && result.data.id) || "REG-HOLARISE";
          var preservedActivity = (form.querySelector('[name="activity"]') || {}).value || "";
          var preservedEventId = (form.querySelector('[name="eventId"]') || {}).value || "";
          form.reset();
          formFields.forEach(function (field) {
            if (interactedFields) interactedFields.delete(field);
            setFieldErrorState(field, "", false);
          });
          form.querySelectorAll("[data-org-chip], [data-skill-chip]").forEach(function (chip) {
            chip.classList.remove("is-selected");
            chip.setAttribute("aria-pressed", "false");
          });
          var vibeChips = form.querySelectorAll("[data-vibe-chip]");
          vibeChips.forEach(function (chip, chipIdx) {
            var on = chipIdx === 0;
            chip.classList.toggle("is-selected", on);
            chip.setAttribute("aria-pressed", on ? "true" : "false");
          });
          var actInput = form.querySelector('[name="activity"]');
          var evIdInput = form.querySelector('[name="eventId"]');
          if (actInput && preservedActivity) actInput.value = preservedActivity;
          if (evIdInput && preservedEventId) evIdInput.value = preservedEventId;
          form.dispatchEvent(
            new CustomEvent("holarise:registration-success", {
              bubbles: true,
              detail: {
                form: form,
                id: passSnapshot.id,
                payload: payload,
                snapshot: passSnapshot,
                response: result.data,
              },
            })
          );
          resetBtn();
        })
        .catch(function (err) {
          saveDraft(draftKey, form);
          if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
            renderOfflineNotice(statusEl, form);
          } else if (statusEl) {
            statusEl.className = "form-status is-error";
            statusEl.textContent =
              (err && err.message && err.message !== "Failed to fetch"
                ? err.message
                : "Không thể kết nối máy chủ gửi biểu mẫu lúc này. Thông tin đã được lưu nháp trên máy — bạn vui lòng thử lại hoặc liên hệ trực tiếp qua Hotline/Zalo HolaRise nhé.");
          }
          resetBtn();
        });
    });
  });
})();
