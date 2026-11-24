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

      if (window.innerWidth > 820 || drawerIsOpen || currentY <= 18) {
        header.classList.remove("is-compact-mobile");
      } else if (delta > 7 && currentY > 76) {
        header.classList.add("is-compact-mobile");
      } else if (delta < -7) {
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
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
  }

  /* 1B. Mobile Default Collapsed Accordions (Zero Dead role="button" Traps on Desktop!) */
  function initMobileCollapsibleCards() {
    var mobileFoldMq = window.matchMedia("(max-width: 820px)");
    var pairs = [];

    document.querySelectorAll("[data-mobile-pillar]").forEach(function (pillar) {
      var trigger = pillar.querySelector("[data-mobile-pillar-toggle]");
      if (trigger) pairs.push({ container: pillar, trigger: trigger });
    });

    document.querySelectorAll("[data-mobile-fold]").forEach(function (card) {
      var trigger = card.querySelector("[data-mobile-fold-toggle]");
      if (trigger) pairs.push({ container: card, trigger: trigger });
    });

    var syncAriaForViewport = function (isMobile) {
      pairs.forEach(function (item) {
        if (isMobile) {
          var isOpen = item.container.classList.contains("is-mobile-open");
          item.trigger.setAttribute("role", "button");
          item.trigger.setAttribute("tabindex", "0");
          item.trigger.setAttribute("aria-expanded", String(isOpen));
        } else {
          item.trigger.removeAttribute("role");
          item.trigger.removeAttribute("tabindex");
          item.trigger.removeAttribute("aria-expanded");
        }
      });
    };

    var toggleItem = function (container, trigger) {
      if (!mobileFoldMq.matches) return;
      var nextOpen = !container.classList.contains("is-mobile-open");
      container.classList.toggle("is-mobile-open", nextOpen);
      trigger.setAttribute("aria-expanded", String(nextOpen));
      if (window.ScrollTrigger) {
        window.ScrollTrigger.refresh();
      }
    };

    pairs.forEach(function (item) {
      item.trigger.addEventListener("click", function () {
        toggleItem(item.container, item.trigger);
      });
      item.trigger.addEventListener("keydown", function (e) {
        if (!mobileFoldMq.matches) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleItem(item.container, item.trigger);
        }
      });
    });

    /* Auto-open target pillar on mobile if user navigates to #holaheart, #holagreen, or #holaconnect */
    var expandHashPillar = function () {
      var hash = (window.location.hash || "").replace(/^#/, "");
      if (!hash) return;
      var target = document.getElementById(hash);
      if (target && target.hasAttribute("data-mobile-pillar")) {
        target.classList.add("is-mobile-open");
        var btn = target.querySelector("[data-mobile-pillar-toggle]");
        if (btn && mobileFoldMq.matches) btn.setAttribute("aria-expanded", "true");
      }
    };

    syncAriaForViewport(mobileFoldMq.matches);
    expandHashPillar();
    window.addEventListener("hashchange", expandHashPillar);
    if (typeof mobileFoldMq.addEventListener === "function") {
      mobileFoldMq.addEventListener("change", function (e) {
        syncAriaForViewport(e.matches);
      });
    }
  }
  initMobileCollapsibleCards();

  /* 2. Full-Screen Mobile Editorial Glass Drawer */
  if (navToggle && mobileDrawer) {
    var setDrawerState = function (open) {
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Đóng menu điều hướng" : "Mở menu điều hướng");
      mobileDrawer.classList.toggle("is-open", open);
      mobileDrawer.setAttribute("aria-hidden", String(!open));
      document.body.style.overflow = open ? "hidden" : "";
      if (window.HolaSmoothScroll) {
        window.HolaSmoothScroll.setLocked(open);
      }
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

  /* 3. Pillar & Category Filters (?nhom= or legacy ?loc=) */
  var initialGroupFilter = "";
  try {
    var qs = new URLSearchParams(window.location.search);
    initialGroupFilter = (qs.get("nhom") || qs.get("loc") || "").trim().toLowerCase();
  } catch (e) {
    initialGroupFilter = "";
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

    if (initialGroupFilter) {
      buttons.forEach(function (btn) {
        if ((btn.getAttribute("data-filter") || "").toLowerCase() === initialGroupFilter) {
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
    if (window.HolaSmoothScroll) {
      window.HolaSmoothScroll.setLocked(true);
    }
    dialog.showModal();
  }

  window.__holaRiseOpenDialog = openDialog;
  window.__holaRiseCloseDialog = closeDialog;

  function syncSmoothUnlockAfterClose() {
    if (!window.HolaSmoothScroll) return;
    var anyOpen = Boolean(document.querySelector("dialog.club-dialog[open]"));
    if (!anyOpen) {
      window.HolaSmoothScroll.setLocked(false);
    }
  }

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
      syncSmoothUnlockAfterClose();
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

  /* 5. Lightbox v2 Trigger (Single Photos + Dynamic Guestbook Photos + Album Viewer + Prev/Next + Swipe) */
  var lightbox = document.getElementById("gallery-lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxCaption = document.getElementById("lightbox-caption");
  var lightboxCounter = document.getElementById("lightbox-counter");
  var lightboxPrevBtn = lightbox ? lightbox.querySelector("[data-lightbox-prev]") : null;
  var lightboxNextBtn = lightbox ? lightbox.querySelector("[data-lightbox-next]") : null;

  if (lightbox && lightboxImg && lightboxCaption) {
    var activeSlides = [];
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
      if (lightboxCounter) {
        lightboxCounter.textContent = formatIdx(activeGalleryIdx + 1) + " / " + formatIdx(total);
      }
      var multi = total > 1;
      if (lightboxPrevBtn) lightboxPrevBtn.hidden = !multi;
      if (lightboxNextBtn) lightboxNextBtn.hidden = !multi;
    };

    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-lightbox-src]");
      if (!trigger) return;
      e.preventDefault();
      var allTriggers = Array.prototype.slice.call(document.querySelectorAll("[data-lightbox-src]"));
      activeSlides = allTriggers.map(function (btn) {
        return {
          src: btn.getAttribute("data-lightbox-src") || "",
          alt: btn.getAttribute("data-lightbox-alt") || "",
          caption: btn.getAttribute("data-lightbox-caption") || "",
          photographer: "",
        };
      });
      var clickedIdx = allTriggers.indexOf(trigger);
      showGalleryIndex(clickedIdx >= 0 ? clickedIdx : 0);
      openDialog(lightbox);
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
  var eventDetailLink = document.getElementById("modal-event-detail-link");
  var modalIcsBtn = document.getElementById("modal-ics-btn");
  var eventInputHidden = document.getElementById("modal-event-input");
  var eventIdHidden = document.getElementById("modal-event-id");

  if (eventModal) {
    document.querySelectorAll("[data-register-event]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var title = btn.getAttribute("data-register-event") || "Hoạt động cộng đồng HolaRise";
        var eventId = btn.getAttribute("data-event-id") || "";
        var eventDate = btn.getAttribute("data-event-date") || "Công bố theo từng hoạt động";
        var eventTime = btn.getAttribute("data-event-time") || "";
        var eventLocation = btn.getAttribute("data-event-location") || "Hòa Lạc – Thạch Thất, Hà Nội";
        var eventFee = btn.getAttribute("data-event-fee") || "Phi lợi nhuận · Minh bạch";
        var eventType = btn.getAttribute("data-event-type") || "Cộng đồng HolaRise";
        var eventHref = btn.getAttribute("data-event-href") || "";

        if (eventTitleDisplay) eventTitleDisplay.textContent = title;
        if (eventTypeDisplay) eventTypeDisplay.textContent = eventType;
        if (eventMetaDisplay) {
          eventMetaDisplay.textContent = [eventDate, eventTime, eventLocation, eventFee]
            .filter(Boolean)
            .join(" · ");
        }
        if (eventDetailLink) {
          if (eventHref && eventHref.indexOf("/") === 0) {
            eventDetailLink.href = eventHref;
            eventDetailLink.hidden = false;
          } else {
            eventDetailLink.hidden = true;
          }
        }
        if (modalIcsBtn) {
          if (eventHref && eventHref.indexOf("/su-kien/") === 0) {
            modalIcsBtn.hidden = false;
            modalIcsBtn.setAttribute("data-ics-title", title);
            modalIcsBtn.setAttribute("data-ics-location", eventLocation);
            modalIcsBtn.setAttribute("data-ics-url", window.location.origin + eventHref);
          } else {
            modalIcsBtn.hidden = true;
          }
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
        eventModal.dataset.eventHref = eventHref;

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
  var DRAFT_FIELDS = ["fullName", "phone", "email", "role", "eventChoice", "seatCount", "organization", "note"];
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
      var anonCheckEl = form.querySelector('input[type="checkbox"][name="anonShare"]');
      if (anonCheckEl) {
        data.anonShare = Boolean(anonCheckEl.checked);
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
      if (typeof existingDraft.anonShare === "boolean") {
        var restoredAnonEl = form.querySelector('input[type="checkbox"][name="anonShare"]');
        if (restoredAnonEl) restoredAnonEl.checked = existingDraft.anonShare;
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
    var formFields = form.querySelectorAll("input:not([type='hidden']):not([type='radio']):not([type='checkbox']), select, textarea");
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

      var isEventStudio = form.hasAttribute("data-event-studio") || form.hasAttribute("data-father-studio");
      var checkedRoleRadio = form.querySelector('input[type="radio"][name="role"]:checked');
      var checkedEventRadio = form.querySelector('input[type="radio"][name="eventChoice"]:checked');
      var checkedSeatRadio = form.querySelector('input[type="radio"][name="seatCount"]:checked');
      var anonCheckInput = form.querySelector('input[type="checkbox"][name="anonShare"]');
      var seatValue = checkedSeatRadio ? checkedSeatRadio.value || "" : "";
      var seatShort = checkedSeatRadio ? checkedSeatRadio.getAttribute("data-seat-short") || seatValue : "";

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
      delete payload.seatCount;
      delete payload.anonShare;

      var activeVibeBtn = form.querySelector('[data-vibe-chip][aria-pressed="true"]');
      var vibeValue = activeVibeBtn ? activeVibeBtn.getAttribute("data-vibe-chip") || "" : "";
      var skillValues = [];
      form.querySelectorAll('[data-skill-chip][aria-pressed="true"]').forEach(function (btn) {
        var sv = btn.getAttribute("data-skill-chip");
        if (sv) skillValues.push(sv);
      });
      var partnerValues = [];
      form.querySelectorAll('[data-partner-chip][aria-pressed="true"]').forEach(function (btn) {
        var pv = btn.getAttribute("data-partner-chip");
        if (pv) partnerValues.push(pv);
      });
      var pillarValues = [];
      form.querySelectorAll('[data-pillar-chip][aria-pressed="true"]').forEach(function (btn) {
        var pv = btn.getAttribute("data-pillar-chip");
        if (pv) pillarValues.push(pv);
      });
      var isPartnerMode = form.getAttribute("data-join-mode") === "partner" || Boolean(checkedRoleRadio && checkedRoleRadio.getAttribute("data-mode") === "partner");
      var modalContainer = form.closest("#event-register-modal");
      var invitedBy = form.dataset.invitedBy || "";
      var rawNote = (payload.note || "").trim();
      var metaParts = [];

      if (isEventStudio) {
        if (seatValue) metaParts.push("Số chỗ: " + seatValue);
        if (rawNote) {
          metaParts.push(
            anonCheckInput && anonCheckInput.checked
              ? "Chia sẻ: Giữ ẩn danh khi trích đọc"
              : "Chia sẻ: Chỉ gửi riêng BTC"
          );
        }
      } else if (modalContainer || form.id === "join-rsvp-form") {
        if (pillarValues.length) metaParts.push("Mảng quan tâm: " + pillarValues.join(", "));
        if (vibeValue) metaParts.push("Số chỗ: " + vibeValue);
      } else if (isPartnerMode) {
        if (partnerValues.length) metaParts.push("Hợp tác: " + partnerValues.join(", "));
      } else {
        if (pillarValues.length) metaParts.push("Mảng quan tâm: " + pillarValues.join(", "));
        if (vibeValue) metaParts.push("Tâm thế: " + vibeValue);
        if (skillValues.length) metaParts.push("Hứng thú: " + skillValues.join(", "));
      }
      if (invitedBy) metaParts.push("Rủ bởi: " + invitedBy);

      if (metaParts.length) {
        payload.note = ("[" + metaParts.join(" | ") + "]" + (rawNote ? " " + rawNote : "")).slice(0, 1000);
      }

      var resolvedEventId = (payload.eventId || "").trim();
      var resolvedEventSlug = form.getAttribute("data-event-slug") || "";
      var resolvedEventImage = form.getAttribute("data-event-image") || "";
      var resolvedEventUrl =
        form.getAttribute("data-event-url") ||
        (modalContainer && modalContainer.dataset.eventHref) ||
        (resolvedEventSlug ? "/su-kien/" + resolvedEventSlug + "/" : "");

      var passSnapshot = {
        id: "",
        source: payload.source || "join_page",
        formKind: isEventStudio ? "workshop" : modalContainer ? "modal" : "join",
        isFatherWorkshop: isEventStudio,
        eventSlug: resolvedEventSlug,
        eventImage: resolvedEventImage,
        eventUrl: resolvedEventUrl,
        fullName: nameVal,
        phone: ((phoneEl || {}).value || "").trim(),
        organization: (payload.organization || "").trim(),
        role: (payload.role || "").trim(),
        badge: isEventStudio
          ? (payload.activity || "Cộng đồng HolaRise").toUpperCase()
          : (checkedRoleRadio && checkedRoleRadio.getAttribute("data-badge")) ||
            (modalContainer && modalContainer.dataset.eventType) ||
            "Cộng đồng HolaRise",
        theme: isEventStudio
          ? "father-sunset"
          : (checkedRoleRadio && checkedRoleRadio.getAttribute("data-theme")) || "emerald",
        greeting: (checkedRoleRadio && checkedRoleRadio.getAttribute("data-greeting")) || "",
        eventId: resolvedEventId,
        eventTitle:
          (payload.activity || "").trim() ||
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-title")) ||
          (isPartnerMode ? "Hợp tác Tổ chức · Chapter 01" : "Nhịp tuần Hòa Lạc – Thạch Thất"),
        eventDate:
          form.getAttribute("data-event-date") ||
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-date")) ||
          (modalContainer && modalContainer.dataset.eventDate) ||
          "Theo lịch từng hoạt động",
        eventTime:
          form.getAttribute("data-event-time") ||
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-time")) ||
          (modalContainer && modalContainer.dataset.eventTime) ||
          "1–2 buổi / tuần",
        eventLocation:
          form.getAttribute("data-event-location") ||
          (checkedEventRadio && checkedEventRadio.getAttribute("data-event-location")) ||
          (modalContainer && modalContainer.dataset.eventLocation) ||
          "Hòa Lạc – Thạch Thất, Hà Nội",
        vibe: isFatherStudio
          ? seatShort || seatValue || "01 chỗ · Đi một mình"
          : isPartnerMode
            ? partnerValues[0] || "Hợp tác tổ chức"
            : vibeValue || "Đi 1 mình (1 chỗ)",
        skills: skillValues,
        isPartner: isPartnerMode,
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
          var hiddenRoleInput = form.querySelector('input[type="hidden"][name="role"]');
          var preservedRole = hiddenRoleInput ? hiddenRoleInput.value : "";
          form.reset();
          formFields.forEach(function (field) {
            if (interactedFields) interactedFields.delete(field);
            setFieldErrorState(field, "", false);
          });
          form.querySelectorAll("[data-org-chip], [data-skill-chip], [data-partner-chip]").forEach(function (chip) {
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
          if (hiddenRoleInput && preservedRole) hiddenRoleInput.value = preservedRole;
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

  /* 9. Clean 2-tab Hub Switcher & Post-RSVP Zalo Confirmation on /tham-gia/ */
  var joinTabs = Array.from(document.querySelectorAll("[data-join-tab]"));
  var joinPanes = Array.from(document.querySelectorAll("[data-join-pane]"));
  if (joinTabs.length && joinPanes.length) {
    function activateJoinTab(key) {
      joinTabs.forEach(function (tab) {
        var active = tab.getAttribute("data-join-tab") === key;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
      joinPanes.forEach(function (pane) {
        pane.hidden = pane.getAttribute("data-join-pane") !== key;
      });
    }
    joinTabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        activateJoinTab(tab.getAttribute("data-join-tab") || "rsvp");
      });
    });
    var params = new URLSearchParams(window.location.search);
    if (params.get("chuong-trinh") === "hoptac" || params.get("tab") === "partner") {
      activateJoinTab("partner");
    }
  }

  document.addEventListener("holarise:registration-success", function (ev) {
    var detail = ev.detail || {};
    if (!detail.form || detail.form.id !== "join-rsvp-form") return;
    var box = document.getElementById("join-rsvp-success");
    var codeEl = document.getElementById("join-rsvp-code");
    var sumEl = document.getElementById("join-rsvp-summary");
    if (codeEl) codeEl.textContent = detail.id || "HOLA";
    if (sumEl) {
      var snap = detail.snapshot || {};
      sumEl.textContent =
        "Đã giữ chỗ cho " + (snap.fullName || "bạn") +
        (snap.activity ? " tại " + snap.activity : "") +
        ". Mời bạn vào Nhóm Zalo để nhận định vị, ghép xe và lịch nhắc trước giờ gặp.";
    }
    if (box) {
      box.hidden = false;
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  /* 10. Passwordless Participant Reflections on /hanh-trinh/<slug>/ */
  var gbSection = document.getElementById("activity-guestbook");
  if (gbSection) {
    var gbSlug = gbSection.getAttribute("data-guestbook-slug") || "";
    var gbList = document.getElementById("guestbook-list");
    var gbCount = document.getElementById("guestbook-count-pill");
    var prForm = document.getElementById("public-reflection-form");
    var prStatus = document.getElementById("pr-status");
    var prBtn = document.getElementById("pr-submit-btn");

    function escTxt(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function loadPublicReflections() {
      if (!gbSlug || !gbList) return;
      fetch("/api/reflections?slug=" + encodeURIComponent(gbSlug))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var items = (data && data.items) || [];
          if (gbCount) {
            gbCount.textContent = items.length ? items.length + " cảm nhận" : "Chưa có cảm nhận";
          }
          if (!items.length) {
            gbList.innerHTML = '<p class="member-empty-hint">Mời bạn là người đầu tiên chia sẻ cảm nhận sau buổi gặp này.</p>';
            return;
          }
          gbList.innerHTML = items
            .map(function (it) {
              var quoteHtml = it.pullQuote ? '<blockquote class="gb-pull-quote">“' + escTxt(it.pullQuote) + '”</blockquote>' : "";
              var photoHtml = it.photoUrl
                ? '<figure class="gb-card-photo"><img src="' + escTxt(it.photoUrl) + '" alt="Ảnh kỷ niệm từ ' + escTxt(it.authorName) + '" loading="lazy"></figure>'
                : "";
              var meta = [it.participantRole, it.authorOrg].filter(Boolean).join(" · ");
              return (
                '<article class="gb-card">' +
                photoHtml +
                quoteHtml +
                '<p class="gb-content">' + escTxt(it.content) + "</p>" +
                '<div class="gb-meta"><strong>' + escTxt(it.authorName) + "</strong>" +
                (meta ? "<span>" + escTxt(meta) + "</span>" : "") +
                "</div></article>"
              );
            })
            .join("");
        })
        .catch(function () {
          if (gbCount) gbCount.textContent = "Cảm nhận cộng đồng";
        });
    }

    loadPublicReflections();

    if (prForm) {
      prForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (prStatus) {
          prStatus.className = "form-status";
          prStatus.textContent = "";
        }
        var fd = new FormData(prForm);
        var payload = {
          activitySlug: gbSlug,
          authorName: String(fd.get("authorName") || "").trim(),
          authorOrg: String(fd.get("authorOrg") || "").trim(),
          participantRole: String(fd.get("participantRole") || "").trim(),
          pullQuote: String(fd.get("pullQuote") || "").trim(),
          content: String(fd.get("content") || "").trim(),
          website: String(fd.get("website") || "").trim(),
        };
        if (payload.authorName.length < 2 || payload.content.length < 12) {
          if (prStatus) {
            prStatus.className = "form-status is-error";
            prStatus.textContent = "Vui lòng nhập tên (ít nhất 2 ký tự) và cảm nhận (ít nhất 12 ký tự).";
          }
          return;
        }
        if (prBtn) {
          prBtn.disabled = true;
          prBtn.textContent = "Đang gửi...";
        }
        fetch("/api/reflections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error((res.data && res.data.message) || "Không thể gửi cảm nhận lúc này.");
            prForm.reset();
            if (prStatus) {
              prStatus.className = "form-status is-success";
              prStatus.textContent = (res.data && res.data.message) || "Đã gửi cảm nhận tới Ban Điều Phối duyệt hiển thị.";
            }
          })
          .catch(function (err) {
            if (prStatus) {
              prStatus.className = "form-status is-error";
              prStatus.textContent = err.message || "Có lỗi xảy ra, vui lòng thử lại.";
            }
          })
          .finally(function () {
            if (prBtn) {
              prBtn.disabled = false;
              prBtn.textContent = "Gửi cảm nhận";
            }
          });
      });
    }
  }

  /* -----------------------------------------------------------------------
   * 15. Multi-Select Pillar Cards & 1-Tap Note Presets
   * ----------------------------------------------------------------------- */
  function syncSelectAllButton(scope) {
    var selectAllBtn = scope.querySelector("[data-pillar-select-all]");
    if (!selectAllBtn) return;
    var chips = Array.prototype.slice.call(scope.querySelectorAll("[data-pillar-chip]"));
    var allOn = chips.length > 0 && chips.every(function (c) { return c.getAttribute("aria-pressed") === "true"; });
    selectAllBtn.setAttribute("aria-pressed", allOn ? "true" : "false");
    selectAllBtn.classList.toggle("is-active", allOn);
    selectAllBtn.textContent = allOn ? "Bỏ chọn cả 3" : "Chọn cả 3";
  }

  document.addEventListener("click", function (e) {
    var pillarChip = e.target.closest("[data-pillar-chip]");
    if (pillarChip) {
      var next = pillarChip.getAttribute("aria-pressed") !== "true";
      pillarChip.setAttribute("aria-pressed", next ? "true" : "false");
      pillarChip.classList.toggle("is-selected", next);
      var scope = pillarChip.closest(".field") || document;
      syncSelectAllButton(scope);
      return;
    }

    var selectAllBtn = e.target.closest("[data-pillar-select-all]");
    if (selectAllBtn) {
      var field = selectAllBtn.closest(".field") || document;
      var chips = field.querySelectorAll("[data-pillar-chip]");
      var nextAll = selectAllBtn.getAttribute("aria-pressed") !== "true";
      chips.forEach(function (c) {
        c.setAttribute("aria-pressed", nextAll ? "true" : "false");
        c.classList.toggle("is-selected", nextAll);
      });
      syncSelectAllButton(field);
      return;
    }

    var notePreset = e.target.closest("[data-note-preset]");
    if (notePreset) {
      var text = notePreset.getAttribute("data-note-preset") || "";
      var container = notePreset.closest(".field") || notePreset.closest("form");
      var textarea = container ? container.querySelector('textarea[name="note"]') : null;
      if (!textarea || !text) return;
      var current = textarea.value.trim();
      if (current.indexOf(text) !== -1) {
        notePreset.classList.remove("is-selected");
        textarea.value = current.replace(text, "").replace(/\s{2,}/g, " ").trim();
      } else {
        notePreset.classList.add("is-selected");
        textarea.value = current ? current + " " + text : text;
      }
      textarea.focus();
    }
  });
})();
