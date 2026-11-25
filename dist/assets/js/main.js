/**
 * HolaRise – Hòa Lạc | Core UI Interactions
 * Follows modern-web-guidance for native <dialog closedby="any">,
 * top-layer exit animation fallback, Safari backdrop click fallback, and forms.
 */
(function () {
  "use strict";

  /* 0. Standalone App Mode Detection (iOS Safari navigator.standalone + display-mode: standalone) */
  var isStandaloneApp =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  if (isStandaloneApp) {
    document.documentElement.classList.add("is-standalone");
  }

  /* 1. Sticky / Smart Mobile In-Place Logo Morph (Wordmark <-> HR Badge) & Floating Capsule Dock */
  var header = document.querySelector(".site-header");
  var navToggle = document.querySelector("[data-nav-toggle]");
  var mobileDrawer = document.querySelector("[data-mobile-drawer]");
  var mobileDock = document.querySelector("[data-mobile-dock]");
  var prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var lastScrollY = window.scrollY || 0;
  var dockExpanded = 1;

  if (header || mobileDock) {
    var scrollRafPending = false;
    var onScroll = function () {
      var currentY = window.scrollY || 0;
      var delta = currentY - lastScrollY;
      var drawerIsOpen = mobileDrawer && mobileDrawer.classList.contains("is-open");

      if (header) {
        header.classList.toggle("is-scrolled", currentY > 36);

        if (window.innerWidth > 820 || drawerIsOpen || currentY <= 18) {
          header.classList.remove("is-compact-mobile");
        } else if (delta > 7 && currentY > 76) {
          header.classList.add("is-compact-mobile");
        } else if (delta < -7) {
          header.classList.remove("is-compact-mobile");
        }
      }

      if (mobileDock) {
        if (currentY <= 8 || prefersReducedMotion || drawerIsOpen) {
          dockExpanded = 1;
        } else if (delta > 2 && currentY > 48) {
          dockExpanded = 0;
        } else if (delta < -2) {
          dockExpanded = 1;
        }
        var shimmer = prefersReducedMotion ? 0 : Math.abs(((currentY / 420) % 2) - 1);
        mobileDock.style.setProperty("--k", String(dockExpanded));
        mobileDock.style.setProperty("--sh", String(shimmer));
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
      var drawerCloseBtn = e.target.closest("[data-drawer-close]");
      if (drawerCloseBtn) {
        var drawer = drawerCloseBtn.closest("details.archive-drawer");
        if (drawer && drawer.open) {
          drawer.open = false;
          var summary = drawer.querySelector("summary");
          if (summary) {
            var rect = drawer.getBoundingClientRect();
            if (rect.top < 80) {
              drawer.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
            }
            summary.focus({ preventScroll: true });
          }
        }
        return;
      }

      var trigger = e.target.closest("[data-lightbox-src]");
      if (!trigger) return;
      e.preventDefault();
      var scope = trigger.closest("[data-lightbox-group]") || document;
      var allTriggers = Array.prototype.slice.call(scope.querySelectorAll("[data-lightbox-src]"));
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

    // Exclusive accordion fallback for older WebViews without <details name=""> support
    var archiveDrawers = Array.prototype.slice.call(document.querySelectorAll("details.archive-drawer[name]"));
    archiveDrawers.forEach(function (drawer) {
      drawer.addEventListener("toggle", function () {
        if (!drawer.open) return;
        var groupName = drawer.getAttribute("name");
        archiveDrawers.forEach(function (other) {
          if (other !== drawer && other.open && other.getAttribute("name") === groupName) {
            other.open = false;
          }
        });
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
  var modalKickerDisplay = document.getElementById("modal-kicker");
  var modalHeadingDisplay = document.getElementById("modal-heading");
  var eventWhenDisplay = document.getElementById("modal-event-when");
  var eventVenueDisplay = document.getElementById("modal-event-venue");
  var eventDetailLink = document.getElementById("modal-event-detail-link");
  var modalIcsBtn = document.getElementById("modal-ics-btn");
  var modalZaloBtn = document.getElementById("modal-zalo-group-btn");
  var modalNoteSummary = document.getElementById("modal-note-summary");
  var modalNoteInput = document.getElementById("modal-note");
  var modalNoteDetails = document.getElementById("modal-note-details");
  var modalAnonWrap = document.getElementById("modal-anon-wrap");
  var eventInputHidden = document.getElementById("modal-event-input");
  var eventIdHidden = document.getElementById("modal-event-id");

  if (eventModal) {
    var defaultNoteSummary = modalNoteSummary ? modalNoteSummary.textContent : "+ Ghi chú cho người điều phối (tùy chọn)";
    var defaultNotePlaceholder = modalNoteInput ? modalNoteInput.getAttribute("placeholder") || "" : "";
    var defaultModalZalo = modalZaloBtn ? modalZaloBtn.getAttribute("href") || "" : "";

    var extractCleanVenue = function (raw) {
      var text = String(raw || "").trim();
      if (!text) return "Hòa Lạc, Hà Nội";
      var clean = text.split("·")[0].replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
      return clean || text;
    };

    var renderFactLines = function (el, primary, secondary) {
      if (!el) return;
      el.textContent = "";
      el.appendChild(document.createTextNode(primary || "—"));
      if (secondary) {
        var sub = document.createElement("span");
        sub.className = "rsvp-fact-sub";
        sub.textContent = secondary;
        el.appendChild(sub);
      }
    };

    var openEventModalFromTrigger = function (btn) {
      var title = btn.getAttribute("data-register-event") || "Hoạt động cộng đồng HolaRise";
      var eventId = btn.getAttribute("data-event-id") || "";
      var eventSlug = btn.getAttribute("data-event-slug") || "";
      var eventDate = btn.getAttribute("data-event-date") || "";
      var eventTime = btn.getAttribute("data-event-time") || "";
      var eventLocation = btn.getAttribute("data-event-location") || "Hòa Lạc, Hà Nội";
      var venueUrl = btn.getAttribute("data-venue-url") || "";
      var eventFee = btn.getAttribute("data-event-fee") || "Phi lợi nhuận · Minh bạch";
      var eventSeats = btn.getAttribute("data-event-seats") || "";
      var eventType = btn.getAttribute("data-event-type") || "Cộng đồng HolaRise";
      var eventHref = btn.getAttribute("data-event-href") || "";
      var eventImage = btn.getAttribute("data-event-image") || "";
      var eventZalo = btn.getAttribute("data-zalo-group") || defaultModalZalo;
      var icsStart = btn.getAttribute("data-ics-start") || "";
      var icsEnd = btn.getAttribute("data-ics-end") || "";
      var noteSummary = btn.getAttribute("data-note-summary") || defaultNoteSummary;
      var notePlaceholder = btn.getAttribute("data-note-placeholder") || defaultNotePlaceholder;
      var allowAnonShare = btn.getAttribute("data-anon-share") === "true";

      if (modalKickerDisplay) {
        modalKickerDisplay.textContent = eventSeats ? "Xác nhận tham dự · " + eventSeats : "Xác nhận tham dự";
      }
      if (modalHeadingDisplay) modalHeadingDisplay.textContent = title;
      if (eventWhenDisplay) {
        var timePrimary = eventTime;
        var dateSecondary = eventDate;
        if (eventTime && eventTime.indexOf(",") !== -1) {
          var parts = eventTime.split(",");
          timePrimary = parts[0].trim();
          dateSecondary = parts.slice(1).join(",").trim();
        }
        renderFactLines(eventWhenDisplay, timePrimary || dateSecondary || "Công bố sau", timePrimary ? dateSecondary : "");
      }
      if (eventVenueDisplay) {
        var cleanVenue = extractCleanVenue(eventLocation);
        if (/^https?:\/\//i.test(venueUrl)) {
          eventVenueDisplay.textContent = "";
          var venueLink = document.createElement("a");
          venueLink.className = "rsvp-venue-link";
          venueLink.href = venueUrl;
          venueLink.target = "_blank";
          venueLink.rel = "noopener noreferrer";
          venueLink.textContent = cleanVenue + " ↗";
          eventVenueDisplay.appendChild(venueLink);
        } else {
          renderFactLines(eventVenueDisplay, cleanVenue, "");
        }
      }
      if (eventDetailLink) {
        var currentPath = (window.location.pathname || "/").replace(/\/+$/, "/");
        var normalizedHref = eventHref ? eventHref.replace(/\/+$/, "/") : "";
        if (eventHref && eventHref.indexOf("/") === 0 && normalizedHref !== currentPath) {
          eventDetailLink.href = eventHref;
          eventDetailLink.hidden = false;
        } else {
          eventDetailLink.hidden = true;
        }
      }
      if (modalIcsBtn) {
        if (icsStart || (eventHref && eventHref.indexOf("/su-kien/") === 0)) {
          modalIcsBtn.hidden = false;
          modalIcsBtn.setAttribute("data-ics-title", title);
          modalIcsBtn.setAttribute("data-ics-location", eventLocation);
          modalIcsBtn.setAttribute("data-ics-url", eventHref ? window.location.origin + eventHref : window.location.href);
          if (icsStart) modalIcsBtn.setAttribute("data-ics-start", icsStart);
          else modalIcsBtn.removeAttribute("data-ics-start");
          if (icsEnd) modalIcsBtn.setAttribute("data-ics-end", icsEnd);
          else modalIcsBtn.removeAttribute("data-ics-end");
        } else {
          modalIcsBtn.hidden = true;
        }
      }
      if (modalZaloBtn && eventZalo) {
        modalZaloBtn.href = eventZalo;
      }
      if (modalNoteSummary) modalNoteSummary.textContent = noteSummary;
      if (modalNoteInput) modalNoteInput.setAttribute("placeholder", notePlaceholder);
      if (modalNoteDetails) modalNoteDetails.open = false;
      if (modalAnonWrap) modalAnonWrap.hidden = !allowAnonShare;

      if (eventInputHidden) eventInputHidden.value = title;
      if (eventIdHidden) eventIdHidden.value = eventId;

      eventModal.dataset.eventTitle = title;
      eventModal.dataset.eventId = eventId;
      eventModal.dataset.eventSlug = eventSlug;
      eventModal.dataset.eventDate = eventDate;
      eventModal.dataset.eventTime = eventTime;
      eventModal.dataset.eventLocation = eventLocation;
      eventModal.dataset.eventFee = eventFee;
      eventModal.dataset.eventType = eventType;
      eventModal.dataset.eventHref = eventHref;
      eventModal.dataset.eventImage = eventImage;
      eventModal.dataset.zaloGroup = eventZalo;

      var modalForm = eventModal.querySelector("form[data-club-form]");
      var modalSuccess = document.getElementById("modal-pass-success");
      if (modalForm) {
        modalForm.hidden = false;
        if (eventZalo) modalForm.setAttribute("data-zalo-group", eventZalo);
      }
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
    };

    document.querySelectorAll("[data-register-event]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openEventModalFromTrigger(btn);
      });
    });

    if (window.location.hash === "#giu-cho") {
      var hashTrigger = document.querySelector('[data-open-on-hash="giu-cho"]');
      if (hashTrigger) {
        setTimeout(function () {
          openEventModalFromTrigger(hashTrigger);
        }, 120);
      }
    }
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
        if (seatValue || vibeValue) metaParts.push("Số chỗ: " + (seatValue || vibeValue));
        var anonWrap = modalContainer ? modalContainer.querySelector("#modal-anon-wrap") : null;
        if (rawNote && anonCheckInput && anonWrap && !anonWrap.hidden) {
          metaParts.push(
            anonCheckInput.checked
              ? "Chia sẻ: Giữ ẩn danh khi trích đọc"
              : "Chia sẻ: Chỉ gửi riêng BTC"
          );
        }
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
      var resolvedEventSlug =
        form.getAttribute("data-event-slug") ||
        (modalContainer && modalContainer.dataset.eventSlug) ||
        "";
      var resolvedEventImage =
        form.getAttribute("data-event-image") ||
        (modalContainer && modalContainer.dataset.eventImage) ||
        "";
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
        vibe:
          seatShort ||
          seatValue ||
          (isPartnerMode ? partnerValues[0] || "Hợp tác tổ chức" : vibeValue || "01 chỗ · Đi một mình"),
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

    var prPhotoInput = document.getElementById("pr-photo-file");
    var prPhotoTrigger = document.getElementById("pr-photo-trigger");
    var prPhotoWrap = document.getElementById("pr-photo-preview-wrap");
    var prPhotoPreview = document.getElementById("pr-photo-preview");
    var prPhotoMeta = document.getElementById("pr-photo-meta");
    var prPhotoClear = document.getElementById("pr-photo-clear");
    var selectedPhotoFile = null;
    var selectedPhotoObjectUrl = "";

    function escTxt(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function getInitialsTxt(name) {
      var parts = String(name || "H").trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return "H";
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function formatDateShortVi(iso) {
      if (!iso) return "";
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    }

    function parseJsonSafe(res) {
      return res.text().then(function (raw) {
        var data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (_e) {
            data = null;
          }
        }
        if (!data) {
          var fallbackMsg =
            res.status >= 500
              ? "Hệ thống đang tạm bận (mã " + res.status + "). Bạn vui lòng thử lại sau giây lát."
              : res.status === 413
                ? "Ảnh tải lên vượt quá dung lượng cho phép."
                : "Phản hồi máy chủ không hợp lệ. Vui lòng tải lại trang và thử lại.";
          data = { ok: false, message: fallbackMsg };
        }
        return { ok: res.ok, status: res.status, data: data };
      });
    }

    function compressReflectionImage(file, maxDim, quality) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        var objUrl = URL.createObjectURL(file);
        img.onload = function () {
          URL.revokeObjectURL(objUrl);
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) {
            reject(new Error("Không đọc được kích thước ảnh."));
            return;
          }
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var tw = Math.max(1, Math.round(w * scale));
          var th = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Trình duyệt không hỗ trợ nén ảnh."));
            return;
          }
          ctx.drawImage(img, 0, 0, tw, th);
          canvas.toBlob(
            function (blob) {
              if (!blob) {
                reject(new Error("Không thể nén ảnh đã chọn."));
                return;
              }
              if (blob.size > 1.15 * 1024 * 1024 && quality > 0.65) {
                canvas.toBlob(
                  function (smaller) {
                    resolve(smaller || blob);
                  },
                  "image/jpeg",
                  0.68
                );
                return;
              }
              resolve(blob);
            },
            "image/jpeg",
            quality
          );
        };
        img.onerror = function () {
          URL.revokeObjectURL(objUrl);
          reject(new Error("Không đọc được tệp ảnh. Vui lòng chọn ảnh JPEG, PNG hoặc WebP."));
        };
        img.src = objUrl;
      });
    }

    function clearSelectedPhoto() {
      selectedPhotoFile = null;
      if (selectedPhotoObjectUrl) {
        URL.revokeObjectURL(selectedPhotoObjectUrl);
        selectedPhotoObjectUrl = "";
      }
      if (prPhotoInput) prPhotoInput.value = "";
      if (prPhotoPreview) prPhotoPreview.removeAttribute("src");
      if (prPhotoWrap) prPhotoWrap.hidden = true;
      if (prPhotoTrigger) {
        var span = prPhotoTrigger.querySelector("span");
        if (span) span.textContent = "Thêm ảnh kỷ niệm";
      }
    }

    if (prPhotoTrigger && prPhotoInput) {
      prPhotoTrigger.addEventListener("click", function () {
        prPhotoInput.click();
      });
      prPhotoInput.addEventListener("change", function () {
        var file = prPhotoInput.files && prPhotoInput.files[0];
        if (!file) return;
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
          if (prStatus) {
            prStatus.className = "form-status is-error";
            prStatus.textContent = "Vui lòng chọn ảnh định dạng JPEG, PNG hoặc WebP.";
          }
          prPhotoInput.value = "";
          return;
        }
        if (file.size > 12 * 1024 * 1024) {
          if (prStatus) {
            prStatus.className = "form-status is-error";
            prStatus.textContent = "Ảnh gốc quá lớn (tối đa 12 MB). Vui lòng chọn ảnh nhẹ hơn.";
          }
          prPhotoInput.value = "";
          return;
        }
        if (selectedPhotoObjectUrl) URL.revokeObjectURL(selectedPhotoObjectUrl);
        selectedPhotoFile = file;
        selectedPhotoObjectUrl = URL.createObjectURL(file);
        if (prPhotoPreview) prPhotoPreview.src = selectedPhotoObjectUrl;
        if (prPhotoWrap) prPhotoWrap.hidden = false;
        if (prPhotoMeta) {
          var sizeMb = (file.size / (1024 * 1024)).toFixed(1);
          prPhotoMeta.textContent = "Đã chọn 1 ảnh (" + sizeMb + " MB) · Tự động nén gọn khi gửi";
        }
        if (prPhotoTrigger) {
          var span = prPhotoTrigger.querySelector("span");
          if (span) span.textContent = "Đổi ảnh khác";
        }
        if (prStatus && prStatus.classList.contains("is-error")) {
          prStatus.className = "form-status";
          prStatus.textContent = "";
        }
      });
    }

    if (prPhotoClear) {
      prPhotoClear.addEventListener("click", clearSelectedPhoto);
    }

    function loadPublicReflections() {
      if (!gbSlug || !gbList) return;
      fetch("/api/reflections?slug=" + encodeURIComponent(gbSlug))
        .then(parseJsonSafe)
        .then(function (res) {
          var data = res.data || {};
          var items = data.items || [];
          var photoCount = items.filter(function (x) { return Boolean(x.photoUrl); }).length;
          if (gbCount) {
            if (!items.length) {
              gbCount.textContent = "Chưa có lưu bút công khai";
            } else if (photoCount > 0) {
              gbCount.textContent = items.length + " mảnh ký ức · " + photoCount + " ảnh";
            } else {
              gbCount.textContent = items.length + " cảm nhận đã xuất bản";
            }
          }
          if (!items.length) {
            gbList.innerHTML =
              '<div class="guestbook-empty"><p>Mời bạn là người đầu tiên lưu lại cảm nhận và một khoảnh khắc đáng nhớ sau buổi gặp này.</p></div>';
            return;
          }
          gbList.innerHTML = items
            .map(function (it) {
              var hasPhoto = Boolean(it.photoUrl);
              var avHtml = it.authorAvatarUrl
                ? '<img class="gb-avatar-img" src="' + escTxt(it.authorAvatarUrl) + '" alt="Ảnh đại diện ' + escTxt(it.authorName) + '" width="38" height="38" loading="lazy">'
                : '<span class="gb-avatar-initials" aria-hidden="true">' + escTxt(getInitialsTxt(it.authorName)) + "</span>";
              var quoteHtml = it.pullQuote
                ? '<blockquote class="gb-pull-quote">“' + escTxt(it.pullQuote) + "”</blockquote>"
                : "";
              var captionBits = [it.authorName, it.authorOrg || it.participantRole].filter(Boolean).join(" · ");
              var photoHtml = hasPhoto
                ? '<figure class="gb-card-photo">' +
                  '<button type="button" class="gb-photo-btn" data-lightbox-src="' + escTxt(it.photoUrl) + '" data-lightbox-alt="Khoảnh khắc của ' + escTxt(it.authorName) + '" data-lightbox-caption="' + escTxt(captionBits) + '">' +
                  '<img src="' + escTxt(it.photoUrl) + '" alt="Khoảnh khắc kỷ niệm của ' + escTxt(it.authorName) + '" loading="lazy" decoding="async">' +
                  "</button></figure>"
                : "";
              var roleLabel = it.participantRole === "member" ? "Thành viên" : it.participantRole === "volunteer" ? "Tình nguyện viên" : it.participantRole === "speaker" ? "Diễn giả" : it.participantRole;
              var metaParts = [it.authorOrg || roleLabel, formatDateShortVi(it.createdAt)].filter(Boolean);
              var heartCount = Number(it.heartCount || 0);
              var isHearted = Boolean(it.heartedByMe);
              return (
                '<article class="gb-card' + (hasPhoto ? " gb-card--photo" : "") + '" data-reflection-id="' + escTxt(it.id) + '">' +
                photoHtml +
                '<div class="gb-card-inner">' +
                quoteHtml +
                '<p class="gb-card-body">' + escTxt(it.content) + "</p>" +
                '<footer class="gb-card-foot">' +
                '<div class="gb-author">' +
                avHtml +
                '<div class="gb-author-meta"><strong>' + escTxt(it.authorName) + "</strong>" +
                (metaParts.length ? "<span>" + escTxt(metaParts.join(" · ")) + "</span>" : "") +
                "</div></div>" +
                '<button type="button" class="gb-heart-btn' + (isHearted ? " is-hearted" : "") + '" data-heart-reflection="' + escTxt(it.id) + '" aria-pressed="' + (isHearted ? "true" : "false") + '" aria-label="Thả tim cảm nhận này">' +
                '<span class="gb-heart-icon" aria-hidden="true">' + (isHearted ? "♥" : "♡") + "</span>" +
                '<span class="gb-heart-count">' + heartCount + "</span>" +
                "</button></footer></div></article>"
              );
            })
            .join("");
        })
        .catch(function () {
          if (gbCount) gbCount.textContent = "Cảm nhận cộng đồng";
        });
    }

    loadPublicReflections();
    window.addEventListener("hola:member-changed", loadPublicReflections);

    gbSection.addEventListener("click", function (e) {
      var heartBtn = e.target.closest("[data-heart-reflection]");
      if (!heartBtn || heartBtn.disabled) return;
      var refId = heartBtn.getAttribute("data-heart-reflection");
      if (!refId) return;
      heartBtn.disabled = true;
      fetch("/api/reflections/" + encodeURIComponent(refId) + "/heart", { method: "POST" })
        .then(parseJsonSafe)
        .then(function (res) {
          if (!res.ok || !res.data) return;
          var hearted = Boolean(res.data.hearted);
          heartBtn.classList.toggle("is-hearted", hearted);
          heartBtn.setAttribute("aria-pressed", hearted ? "true" : "false");
          var icon = heartBtn.querySelector(".gb-heart-icon");
          var cnt = heartBtn.querySelector(".gb-heart-count");
          if (icon) icon.textContent = hearted ? "♥" : "♡";
          if (cnt && typeof res.data.heartCount !== "undefined") {
            cnt.textContent = String(res.data.heartCount);
          }
        })
        .catch(function () {})
        .finally(function () {
          heartBtn.disabled = false;
        });
    });

    if (prForm) {
      var prAnonCheck = document.getElementById("pr-anon-check");
      var prNameField = document.getElementById("pr-name");
      if (prAnonCheck && prNameField) {
        prAnonCheck.addEventListener("change", function () {
          if (prAnonCheck.checked) {
            prNameField.dataset.prevName = prNameField.value;
            prNameField.value = "Ẩn danh";
            prNameField.readOnly = true;
          } else {
            prNameField.readOnly = false;
            prNameField.value = prNameField.dataset.prevName || "";
            prNameField.focus();
          }
        });
      }

      prForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (prStatus) {
          prStatus.className = "form-status";
          prStatus.textContent = "";
        }
        var fd = new FormData(prForm);
        var rawName = String(fd.get("authorName") || "").trim();
        var prMemberBar = document.getElementById("pr-member-bar");
        var isMemberSignedIn = prMemberBar && !prMemberBar.hidden;
        if (prAnonCheck && prAnonCheck.checked) rawName = "Ẩn danh";
        var contentVal = String(fd.get("content") || "").trim();
        if ((!isMemberSignedIn && rawName.length < 2) || contentVal.length < 12) {
          if (prStatus) {
            prStatus.className = "form-status is-error";
            prStatus.textContent = isMemberSignedIn
              ? "Cảm nhận cần ít nhất 12 ký tự."
              : "Vui lòng nhập tên (hoặc chọn Gửi ẩn danh) và viết ít nhất 12 ký tự.";
          }
          return;
        }
        if (prBtn) {
          prBtn.disabled = true;
          prBtn.textContent = selectedPhotoFile ? "Đang nén & tải ảnh..." : "Đang gửi...";
        }

        var uploadStep = selectedPhotoFile
          ? compressReflectionImage(selectedPhotoFile, 1280, 0.82).then(function (blob) {
              var upFd = new FormData();
              upFd.append("file", blob, "reflection.jpg");
              return fetch("/api/reflections/media", { method: "POST", body: upFd })
                .then(parseJsonSafe)
                .then(function (upRes) {
                  if (!upRes.ok || !upRes.data || !upRes.data.url) {
                    throw new Error((upRes.data && upRes.data.message) || "Không thể tải ảnh lên lúc này.");
                  }
                  return upRes.data.url;
                });
            })
          : Promise.resolve("");

        uploadStep
          .then(function (uploadedPhotoUrl) {
            if (prBtn) prBtn.textContent = "Đang gửi cảm nhận...";
            var payload = {
              activitySlug: gbSlug,
              authorName: rawName,
              authorOrg: String(fd.get("authorOrg") || "").trim(),
              participantRole: String(fd.get("participantRole") || "").trim() || "Người tham dự",
              pullQuote: String(fd.get("pullQuote") || "").trim(),
              content: contentVal,
              photoUrl: uploadedPhotoUrl,
              website: String(fd.get("website") || "").trim(),
            };
            return fetch("/api/reflections", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }).then(parseJsonSafe);
          })
          .then(function (res) {
            if (!res.ok) {
              throw new Error((res.data && res.data.message) || "Không thể gửi cảm nhận lúc này.");
            }
            var contentInput = document.getElementById("pr-content");
            if (contentInput) contentInput.value = "";
            clearSelectedPhoto();
            if (!isMemberSignedIn) {
              prForm.reset();
              if (prNameField) prNameField.readOnly = false;
            }
            if (prStatus) {
              prStatus.className = "form-status is-success";
              prStatus.textContent =
                (res.data && res.data.message) || "Đã gửi cảm nhận tới Ban Điều Phối duyệt hiển thị.";
            }
          })
          .catch(function (err) {
            if (prStatus) {
              prStatus.className = "form-status is-error";
              prStatus.textContent = (err && err.message) || "Có lỗi xảy ra, vui lòng thử lại.";
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

  /* -----------------------------------------------------------------------
   * Feedback Modal, Auto Screen Diagnostics, Lazy Viewport Capture & Shake
   * ----------------------------------------------------------------------- */
  (function initFeedbackAndShakeReport() {
    var dialog = document.getElementById("feedback-modal");
    var form = document.getElementById("feedback-form");
    if (!dialog || !form) return;

    var noteEl = document.getElementById("fb-note");
    var nameEl = document.getElementById("fb-name");
    var contactEl = document.getElementById("fb-contact");
    var statusEl = document.getElementById("fb-status");
    var submitBtn = document.getElementById("fb-submit-btn");
    var shotStateEl = document.getElementById("fb-shot-state");
    var shotPreviewEl = document.getElementById("fb-shot-preview");
    var shotImgEl = document.getElementById("fb-shot-img");
    var captureBtn = document.getElementById("fb-capture-btn");
    var fileInputEl = document.getElementById("fb-file-input");
    var clearBtn = document.getElementById("fb-shot-clear");
    var diagPreviewEl = document.getElementById("fb-diag-preview");
    var shakeRowEl = document.getElementById("fb-shake-row");
    var shakeTextEl = document.getElementById("fb-shake-text");
    var shakeToggleBtn = document.getElementById("fb-shake-toggle");

    var recentErrors = [];
    var currentShotDataUrl = "";
    var currentDiagnostics = "";
    var modernScreenshotPromise = null;
    var captureInFlight = false;
    var SHAKE_OFF_KEY = "holarise_shake_off";

    function pushRuntimeError(msg) {
      var clean = String(msg || "").replace(/\s+/g, " ").trim().slice(0, 140);
      if (!clean) return;
      recentErrors.push(clean);
      if (recentErrors.length > 5) recentErrors.shift();
    }

    window.addEventListener("error", function (ev) {
      var loc = ev && ev.filename ? " (" + ev.filename.split("/").pop() + ":" + (ev.lineno || 0) + ")" : "";
      pushRuntimeError((ev && ev.message ? ev.message : "Script error") + loc);
    });

    window.addEventListener("unhandledrejection", function (ev) {
      var reason = ev && ev.reason;
      var msg = reason && reason.message ? reason.message : String(reason || "Unhandled promise rejection");
      pushRuntimeError("Promise: " + msg);
    });

    function detectClientEnv() {
      var ua = navigator.userAgent || "";
      var browser = "Browser";
      if (/Zalo/i.test(ua)) browser = "Zalo WebView";
      else if (/FBAN|FBAV|Messenger/i.test(ua)) browser = "Messenger/FB WebView";
      else if (/Edg/i.test(ua)) browser = "Edge";
      else if (/Chrome|CriOS/i.test(ua)) browser = "Chrome";
      else if (/Safari/i.test(ua)) browser = "Safari";
      else if (/Firefox|FxiOS/i.test(ua)) browser = "Firefox";

      var os = "Desktop";
      if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
      else if (/Android/i.test(ua)) os = "Android";
      return browser + " / " + os;
    }

    function findVisibleSectionTitle() {
      var headings = document.querySelectorAll("main h1, main h2, section h2");
      var best = "";
      var bestDist = Infinity;
      for (var i = 0; i < headings.length; i += 1) {
        var rect = headings[i].getBoundingClientRect();
        if (rect.height === 0) continue;
        var dist = Math.abs(rect.top - 96);
        if (dist < bestDist) {
          bestDist = dist;
          best = (headings[i].textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
        }
      }
      return best;
    }

    function collectDiagnosticsText() {
      var docH = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      var scrollPct = Math.min(100, Math.max(0, Math.round((window.scrollY / docH) * 100)));
      var lines = [
        "Trang: " + (window.location.pathname || "/") + (window.location.search || ""),
        "Khung hình: " + window.innerWidth + "x" + window.innerHeight + " (cuộn " + scrollPct + "%)",
        "Môi trường: " + detectClientEnv(),
      ];
      var sec = findVisibleSectionTitle();
      if (sec) lines.push("Vùng đang xem: " + sec);
      if (recentErrors.length > 0) {
        lines.push("Lỗi JS gần nhất: " + recentErrors.join(" | "));
      } else {
        lines.push("Lỗi JS gần nhất: Không ghi nhận");
      }
      return lines.join("\n").slice(0, 880);
    }

    function setFeedbackStatus(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.className = "form-status" + (type ? " is-" + type : "");
    }

    function setScreenshotPreview(dataUrl, label) {
      currentShotDataUrl = dataUrl || "";
      if (shotImgEl && shotPreviewEl && clearBtn) {
        if (currentShotDataUrl) {
          shotImgEl.src = currentShotDataUrl;
          shotPreviewEl.hidden = false;
          clearBtn.hidden = false;
        } else {
          shotImgEl.removeAttribute("src");
          shotPreviewEl.hidden = true;
          clearBtn.hidden = true;
        }
      }
      if (shotStateEl) {
        shotStateEl.textContent = label || "";
      }
    }

    function loadModernScreenshot() {
      if (window.modernScreenshot && typeof window.modernScreenshot.domToCanvas === "function") {
        return Promise.resolve(window.modernScreenshot);
      }
      if (modernScreenshotPromise) return modernScreenshotPromise;
      modernScreenshotPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "/assets/vendor/modern-screenshot.min.js";
        s.async = true;
        s.onload = function () {
          if (window.modernScreenshot && typeof window.modernScreenshot.domToCanvas === "function") {
            resolve(window.modernScreenshot);
          } else {
            reject(new Error("modernScreenshot unavailable"));
          }
        };
        s.onerror = function () {
          modernScreenshotPromise = null;
          reject(new Error("Failed to load screenshot library"));
        };
        document.head.appendChild(s);
      });
      return modernScreenshotPromise;
    }

    function resizeCanvasToJpeg(sourceCanvas, maxWidth, quality) {
      var w = sourceCanvas.width || 1;
      var h = sourceCanvas.height || 1;
      var ratio = w > maxWidth ? maxWidth / w : 1;
      var out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(w * ratio));
      out.height = Math.max(1, Math.round(h * ratio));
      var ctx = out.getContext("2d");
      if (!ctx) return "";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", quality || 0.72);
    }

    function compressImageBlob(blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error("Không đọc được tệp ảnh.")); };
        reader.onload = function () {
          var img = new Image();
          img.onerror = function () { reject(new Error("Tệp không phải ảnh hợp lệ.")); };
          img.onload = function () {
            var maxW = 960;
            var ratio = img.width > maxW ? maxW / img.width : 1;
            var canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * ratio));
            canvas.height = Math.max(1, Math.round(img.height * ratio));
            var ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Trình duyệt không hỗ trợ xử lý ảnh."));
              return;
            }
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            var dataUrl = canvas.toDataURL("image/jpeg", 0.74);
            if (dataUrl.length > 700000) {
              dataUrl = canvas.toDataURL("image/jpeg", 0.52);
            }
            resolve(dataUrl);
          };
          img.src = String(reader.result || "");
        };
        reader.readAsDataURL(blob);
      });
    }

    function captureViewportScreenshot() {
      if (captureInFlight) return Promise.resolve();
      captureInFlight = true;
      if (shotStateEl) shotStateEl.textContent = "Đang đọc khung hình...";

      var vw = Math.max(320, window.innerWidth || 390);
      var vh = Math.max(320, window.innerHeight || 720);
      var sx = window.scrollX || window.pageXOffset || 0;
      var sy = window.scrollY || window.pageYOffset || 0;

      // Temporarily mask sensitive text inputs outside feedback modal before DOM capture
      var maskedNodes = [];
      var inputs = document.querySelectorAll("input, textarea");
      for (var i = 0; i < inputs.length; i += 1) {
        var el = inputs[i];
        if (dialog.contains(el)) continue;
        if (el.type === "hidden" || el.type === "checkbox" || el.type === "radio") continue;
        if (el.value) {
          maskedNodes.push({ el: el, color: el.style.color, shadow: el.style.textShadow });
          el.style.color = "transparent";
          el.style.textShadow = "0 0 6px rgba(15,23,20,0.45)";
        }
      }

      function restoreMasked() {
        for (var j = 0; j < maskedNodes.length; j += 1) {
          maskedNodes[j].el.style.color = maskedNodes[j].color;
          maskedNodes[j].el.style.textShadow = maskedNodes[j].shadow;
        }
      }

      var timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("capture_timeout")); }, 2800);
      });

      return Promise.race([
        loadModernScreenshot().then(function (lib) {
          return lib.domToCanvas(document.body, {
            width: vw,
            height: vh,
            scale: Math.min(window.devicePixelRatio || 1, 1.25),
            backgroundColor: "#ffffff",
            style: {
              transform: "translate(" + (-sx) + "px, " + (-sy) + "px)",
              transformOrigin: "top left",
              width: document.documentElement.scrollWidth + "px",
              height: document.documentElement.scrollHeight + "px",
            },
            filter: function (node) {
              if (!node || node.nodeType !== 1) return true;
              if (node.id === "feedback-modal" || node.id === "orbital-top-btn") return false;
              if (node.tagName === "DIALOG" && node.hasAttribute("open")) return false;
              return true;
            },
          });
        }),
        timeoutPromise,
      ])
        .then(function (canvas) {
          restoreMasked();
          var dataUrl = resizeCanvasToJpeg(canvas, 960, 0.72);
          if (dataUrl && dataUrl.length <= 700000) {
            var kb = Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));
            setScreenshotPreview(dataUrl, "Đã chụp (~" + kb + " KB)");
          } else {
            setScreenshotPreview("", "Ảnh quá lớn, hãy chọn ảnh từ máy.");
          }
        })
        .catch(function () {
          restoreMasked();
          if (shotStateEl) {
            shotStateEl.textContent = "Chưa tự chụp được, bạn có thể chọn hoặc dán ảnh.";
          }
        })
        .finally(function () {
          captureInFlight = false;
        });
    }

    function openFeedbackDialog(opts) {
      var options = opts || {};
      setFeedbackStatus("", "");
      currentDiagnostics = collectDiagnosticsText();
      if (diagPreviewEl) diagPreviewEl.textContent = currentDiagnostics;
      var diagDetailsEl = document.getElementById("fb-diag-details");
      if (diagDetailsEl) diagDetailsEl.open = false;

      if (options.bugMode) {
        var bugRadio = form.querySelector('input[name="feedbackKind"][value="Báo lỗi kỹ thuật"]');
        if (bugRadio) bugRadio.checked = true;
      }

      if (typeof dialog.showModal === "function" && !dialog.open) {
        dialog.showModal();
      }
      var noteInput = document.getElementById("fb-note");
      if (noteInput) {
        setTimeout(function () { noteInput.focus(); }, 60);
      }
      if (options.autoCapture) {
        captureViewportScreenshot();
      }
    }

    var fbNoteEl = document.getElementById("fb-note");
    if (fbNoteEl) {
      fbNoteEl.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          if (typeof form.requestSubmit === "function") form.requestSubmit();
        }
      });
    }

    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-open-feedback-modal]");
      if (!trigger) return;
      var isBugQuick = trigger.getAttribute("data-feedback-bug") === "1";
      openFeedbackDialog({ bugMode: isBugQuick, autoCapture: isBugQuick });
    });

    if (captureBtn) {
      captureBtn.addEventListener("click", function () {
        captureViewportScreenshot();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        setScreenshotPreview("", "");
        if (fileInputEl) fileInputEl.value = "";
      });
    }

    if (fileInputEl) {
      fileInputEl.addEventListener("change", function () {
        var file = fileInputEl.files && fileInputEl.files[0];
        if (!file) return;
        if (shotStateEl) shotStateEl.textContent = "Đang nén ảnh...";
        compressImageBlob(file)
          .then(function (dataUrl) {
            var kb = Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));
            setScreenshotPreview(dataUrl, "Đã chọn ảnh (~" + kb + " KB)");
          })
          .catch(function (err) {
            setScreenshotPreview("", err.message || "Không thể đọc ảnh này.");
          });
      });
    }

    document.addEventListener("paste", function (e) {
      if (!dialog.open) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].type && items[i].type.indexOf("image/") === 0) {
          var blob = items[i].getAsFile();
          if (!blob) return;
          e.preventDefault();
          if (shotStateEl) shotStateEl.textContent = "Đang xử lý ảnh vừa dán...";
          compressImageBlob(blob)
            .then(function (dataUrl) {
              var kb = Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));
              setScreenshotPreview(dataUrl, "Đã dán ảnh (~" + kb + " KB)");
            })
            .catch(function (err) {
              setScreenshotPreview("", err.message || "Không thể dán ảnh này.");
            });
          return;
        }
      }
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      setFeedbackStatus("", "");

      var checkedKind = form.querySelector('input[name="feedbackKind"]:checked');
      var kind = checkedKind ? checkedKind.value : "Góp ý cộng đồng";
      var note = (noteEl && noteEl.value ? noteEl.value : "").trim();
      if (note.length < 8) {
        setFeedbackStatus("Vui lòng chia sẻ ít nhất 8 ký tự để Ban Điều Phối nắm rõ ý của bạn.", "error");
        if (noteEl) noteEl.focus();
        return;
      }

      var hp = form.querySelector('input[name="website"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Đang gửi đóng góp...";
      }
      try {
        var res = await fetch("/api/registrations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "feedback",
            website: hp ? hp.value : "",
            activity: "Đóng góp · " + kind,
            role: kind,
            fullName: (nameEl && nameEl.value ? nameEl.value : "").trim() || "Thành viên đóng góp",
            phone: (contactEl && contactEl.value ? contactEl.value : "").trim(),
            organization: window.location.pathname || "/",
            note: note,
            diagnostics: currentDiagnostics || collectDiagnosticsText(),
            screenshotDataUrl: currentShotDataUrl || "",
          }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || data.ok === false) {
          throw new Error(data.message || "Chưa gửi được đóng góp lúc này. Vui lòng thử lại.");
        }
        form.reset();
        setScreenshotPreview("", "");
        setFeedbackStatus(
          "Cảm ơn bạn đã gửi phản hồi. Ban Điều Phối HolaRise đã tiếp nhận đầy đủ thông tin.",
          "success"
        );
      } catch (err) {
        setFeedbackStatus(err && err.message ? err.message : "Đã có lỗi xảy ra khi gửi.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Gửi đóng góp tới Ban Điều Phối";
        }
      }
    });

    // Shake-to-report detector (45ms throttle, dual linear/delta detection, 8s cooldown)
    var hasMotion = typeof window.DeviceMotionEvent !== "undefined";
    var needsIosPermission = hasMotion && typeof window.DeviceMotionEvent.requestPermission === "function";
    var SHAKE_IOS_GRANTED_KEY = "holarise_shake_ios_granted";
    var shakeAttached = false;
    var shakeEnabled = false;
    var motionSignalSeen = false;
    var lastSampleTs = 0;
    var lastAx = null;
    var lastAy = null;
    var lastAz = null;
    var peakCount = 0;
    var firstPeakTs = 0;
    var lastPeakTs = 0;
    var lastTriggerTs = 0;

    function onDeviceMotion(ev) {
      if (!shakeEnabled) return;
      var accG = ev.accelerationIncludingGravity;
      var accL = ev.acceleration;
      var hasG = Boolean(accG && (accG.x != null || accG.y != null || accG.z != null));
      var hasL = Boolean(accL && (accL.x != null || accL.y != null || accL.z != null));
      if (!hasG && !hasL) return;

      motionSignalSeen = true;
      if (dialog.open) return;

      var now = Date.now();
      if (now - lastSampleTs < 45) return;
      lastSampleTs = now;

      if (now - lastTriggerTs < 8000) return;
      var active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (document.querySelector("dialog[open]")) return;

      var triggeredPeak = false;
      if (hasL) {
        var lx = accL.x || 0;
        var ly = accL.y || 0;
        var lz = accL.z || 0;
        var linearMag = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (linearMag >= 11.5) {
          triggeredPeak = true;
        }
      }

      if (hasG) {
        var gx = accG.x || 0;
        var gy = accG.y || 0;
        var gz = accG.z || 0;
        if (lastAx !== null) {
          var delta = Math.abs(gx - lastAx) + Math.abs(gy - lastAy) + Math.abs(gz - lastAz);
          if (delta >= 13.5) {
            triggeredPeak = true;
          }
        }
        lastAx = gx;
        lastAy = gy;
        lastAz = gz;
      }

      if (triggeredPeak) {
        if (now - firstPeakTs > 1200) {
          peakCount = 1;
          firstPeakTs = now;
          lastPeakTs = now;
        } else if (now - lastPeakTs >= 110) {
          peakCount += 1;
          lastPeakTs = now;
        }
        if (peakCount >= 2) {
          peakCount = 0;
          lastTriggerTs = now;
          openFeedbackDialog({ bugMode: true, autoCapture: true });
        }
      }
    }

    function updateShakeUi() {
      if (!shakeRowEl || !shakeToggleBtn || !shakeTextEl) return;
      if (!hasMotion) {
        shakeRowEl.hidden = true;
        return;
      }
      shakeRowEl.hidden = false;
      if (!window.isSecureContext) {
        shakeTextEl.textContent = "Cảm biến lắc chỉ chạy trên HTTPS (holarise.org).";
        shakeToggleBtn.hidden = true;
        return;
      }
      shakeToggleBtn.hidden = false;
      if (shakeEnabled) {
        shakeTextEl.textContent = "Đang bật: đóng cửa sổ rồi lắc nhẹ điện thoại 2 nhịp để báo lỗi";
        shakeToggleBtn.textContent = "Tắt lắc máy";
      } else {
        shakeTextEl.textContent = "Bấm Báo lỗi nhanh ở cuối trang khi cần gửi góp ý";
        shakeToggleBtn.textContent = "Bật";
      }
    }

    function verifyMotionSignalSoon() {
      setTimeout(function () {
        if (shakeEnabled && !motionSignalSeen && shakeTextEl) {
          shakeTextEl.textContent =
            "Trình duyệt này chưa gửi tín hiệu cảm biến lắc — bạn dùng nút Báo lỗi nhanh ở cuối trang nhé.";
        }
      }, 1500);
    }

    function enableShake(fromUserTap) {
      if (!shakeAttached) {
        window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
        shakeAttached = true;
      }
      shakeEnabled = true;
      try { localStorage.removeItem(SHAKE_OFF_KEY); } catch (_) {}
      updateShakeUi();
      if (fromUserTap) verifyMotionSignalSoon();
    }

    function disableShake() {
      shakeEnabled = false;
      try {
        localStorage.setItem(SHAKE_OFF_KEY, "1");
        localStorage.removeItem(SHAKE_IOS_GRANTED_KEY);
      } catch (_) {}
      updateShakeUi();
    }

    // Shake-to-report disabled by design: users use the footer feedback button instead.
    if (shakeRowEl) shakeRowEl.hidden = true;

    if (shakeToggleBtn) {
      shakeToggleBtn.addEventListener("click", function () {
        if (shakeEnabled) {
          disableShake();
          return;
        }
        if (needsIosPermission) {
          window.DeviceMotionEvent.requestPermission()
            .then(function (state) {
              if (state === "granted") {
                try { localStorage.setItem(SHAKE_IOS_GRANTED_KEY, "1"); } catch (_) {}
                enableShake(true);
              } else if (shakeTextEl) {
                shakeTextEl.textContent = "Trình duyệt chưa cấp quyền cảm biến chuyển động.";
              }
            })
            .catch(function () {
              if (shakeTextEl) {
                shakeTextEl.textContent = "Thiết bị này không hỗ trợ bật cảm biến lắc.";
              }
            });
        } else {
          enableShake(true);
        }
      });
    }

    // One-time mobile guide toast (skipped on /su-kien/* to keep event invitations calm)
    var toastEl = document.getElementById("shake-guide-toast");
    var toastTextEl = document.getElementById("shake-guide-text");
    var toastCtaBtn = document.getElementById("shake-guide-cta");
    var toastCloseBtn = document.getElementById("shake-guide-close");
    var SHAKE_TIP_SEEN_KEY = "holarise_shake_tip_seen";
    var isMobileViewport = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    var isEventInvitationPage = (window.location.pathname || "").indexOf("/su-kien/") === 0;

    function dismissShakeToast() {
      if (toastEl) toastEl.hidden = true;
      try { localStorage.setItem(SHAKE_TIP_SEEN_KEY, "1"); } catch (_) {}
    }

    if (toastEl && hasMotion && isMobileViewport && !isEventInvitationPage) {
      var tipSeen = false;
      try { tipSeen = localStorage.getItem(SHAKE_TIP_SEEN_KEY) === "1"; } catch (_) {}
      if (!tipSeen) {
        if (needsIosPermission && !shakeEnabled) {
          if (toastTextEl) {
            toastTextEl.textContent = "Mẹo nhỏ: Bật lắc điện thoại để tự đọc màn hình và báo lỗi nhanh bất cứ lúc nào.";
          }
          if (toastCtaBtn) toastCtaBtn.textContent = "Bật lắc máy";
        } else {
          if (toastTextEl) {
            toastTextEl.textContent = "Mẹo nhỏ: Lắc nhẹ điện thoại khi gặp lỗi để tự đọc màn hình và báo nhanh.";
          }
          if (toastCtaBtn) toastCtaBtn.textContent = "Thử ngay";
        }

        var autoHideTimer = null;
        setTimeout(function () {
          if (dialog.open || document.querySelector("dialog[open]")) return;
          toastEl.hidden = false;
          autoHideTimer = setTimeout(dismissShakeToast, 9000);
        }, 3500);

        if (toastCloseBtn) {
          toastCloseBtn.addEventListener("click", function () {
            if (autoHideTimer) clearTimeout(autoHideTimer);
            dismissShakeToast();
          });
        }

        if (toastCtaBtn) {
          toastCtaBtn.addEventListener("click", function () {
            if (autoHideTimer) clearTimeout(autoHideTimer);
            if (needsIosPermission && !shakeEnabled) {
              window.DeviceMotionEvent.requestPermission()
                .then(function (state) {
                  if (state === "granted") {
                    try { localStorage.setItem(SHAKE_IOS_GRANTED_KEY, "1"); } catch (_) {}
                    enableShake(true);
                    if (toastTextEl) toastTextEl.textContent = "Đã bật. Giờ bạn có thể lắc máy bất cứ lúc nào để báo lỗi.";
                    if (toastCtaBtn) toastCtaBtn.hidden = true;
                    setTimeout(dismissShakeToast, 2600);
                  } else {
                    dismissShakeToast();
                  }
                })
                .catch(function () {
                  dismissShakeToast();
                });
            } else {
              dismissShakeToast();
              openFeedbackDialog({ bugMode: true, autoCapture: true });
            }
          });
        }
      }
    }
  })();

  /* Editorial Hairline FAQ — Fluid Exclusive Accordion (Aesop x Linear x Apple) */
  (function () {
    var faqList = document.querySelector("[data-faq-accordion]");
    if (!faqList) return;

    var rows = Array.prototype.slice.call(faqList.querySelectorAll("[data-faq-row]"));
    rows.forEach(function (row) {
      var btn = row.querySelector(".faq-trigger");
      if (!btn) return;
      btn.addEventListener("click", function () {
        var willOpen = !row.classList.contains("is-open");
        rows.forEach(function (other) {
          var isTarget = other === row && willOpen;
          other.classList.toggle("is-open", isTarget);
          var otherBtn = other.querySelector(".faq-trigger");
          if (otherBtn) otherBtn.setAttribute("aria-expanded", String(isTarget));
        });
      });
    });
  })();

  /* Orientation Visual Chip — Click/Tap to Reveal, Click Outside or Esc to Collapse */
  (function () {
    var chips = document.querySelectorAll(".visual-orientation-chip");
    chips.forEach(function (chip) {
      if (!chip.hasAttribute("role")) chip.setAttribute("role", "button");
      if (!chip.hasAttribute("tabindex")) chip.setAttribute("tabindex", "0");
      chip.setAttribute("aria-expanded", "false");
    });

    function closeAll(except) {
      document.querySelectorAll(".visual-orientation-chip.is-open").forEach(function (el) {
        if (el !== except) {
          el.classList.remove("is-open");
          el.setAttribute("aria-expanded", "false");
        }
      });
    }

    function toggleChip(chip, e) {
      e.preventDefault();
      e.stopPropagation();
      var willOpen = !chip.classList.contains("is-open");
      closeAll(chip);
      chip.classList.toggle("is-open", willOpen);
      chip.setAttribute("aria-expanded", String(willOpen));
    }

    document.addEventListener("click", function (e) {
      var chip = e.target.closest(".visual-orientation-chip");
      if (chip) {
        toggleChip(chip, e);
      } else {
        closeAll(null);
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAll(null);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        var chip = e.target.closest && e.target.closest(".visual-orientation-chip");
        if (chip) toggleChip(chip, e);
      }
    });
  })();
})();
