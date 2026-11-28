/**
 * HolaRise – Hòa Lạc | Core UI Interactions
 * Follows modern-web-guidance for native <dialog closedby="any">,
 * top-layer exit animation fallback, Safari backdrop click fallback, and forms.
 */
(function () {
  "use strict";

  var CANONICAL_ORIGIN = "https://holarise.org";

  var isEn =
    (document.documentElement &&
      (document.documentElement.lang === "en" ||
        document.documentElement.getAttribute("data-lang") === "en")) ||
    /^\/en(\/|$)/i.test((window.location && window.location.pathname) || "");
  function t(vi, en) {
    return isEn ? en : vi;
  }

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
  var dockExpanded = document.documentElement.classList.contains("is-dock-compact") ? 0 : 1;
  var setDockExpanded = function (val) {
    if (val === dockExpanded) return;
    dockExpanded = val;
    document.documentElement.classList.toggle("is-dock-compact", dockExpanded === 0);
    try {
      window.sessionStorage.setItem("holarise_dock_k", String(dockExpanded));
    } catch (_e) {}
  };

  /* MusicSpace-style spring pill glide across tab navigations (no view-transition backdrop halo) */
  if (mobileDock) {
    var curTabIdx = parseInt(mobileDock.getAttribute("data-active") || "-1", 10);
    var prevTabRaw = null;
    try {
      prevTabRaw = window.sessionStorage.getItem("holarise_dock_prev_i");
      window.sessionStorage.removeItem("holarise_dock_prev_i");
    } catch (_e) {}
    var prevTabIdx = prevTabRaw !== null ? parseInt(prevTabRaw, 10) : NaN;
    var dockInd = mobileDock.querySelector(".mobile-dock-ind");
    if (
      dockInd &&
      !prefersReducedMotion &&
      curTabIdx >= 0 &&
      Number.isFinite(prevTabIdx) &&
      prevTabIdx >= 0 &&
      prevTabIdx !== curTabIdx
    ) {
      dockInd.style.transition = "none";
      mobileDock.style.setProperty("--i", String(prevTabIdx));
      void dockInd.offsetWidth;
      dockInd.style.transition = "";
      mobileDock.style.setProperty("--i", String(curTabIdx));
      mobileDock.classList.add("is-tab-arrived");
    }
    mobileDock.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest(".mobile-dock-link") : null;
      if (!link) return;
      try {
        window.sessionStorage.setItem("holarise_dock_prev_i", String(curTabIdx));
      } catch (_e) {}
    });
  }

  if (header || mobileDock) {
    var scrollRafPending = false;
    var onScroll = function () {
      var currentY = Math.max(0, window.scrollY || 0);
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
        var nearBottom = currentY + window.innerHeight >= document.documentElement.scrollHeight - 24;
        if (prefersReducedMotion || drawerIsOpen) {
          setDockExpanded(1);
        } else if (delta > 14 && currentY > 72) {
          setDockExpanded(0);
        } else if ((delta < -14 && !nearBottom) || (delta < 0 && currentY <= 16)) {
          setDockExpanded(1);
        }
        var shimmer = prefersReducedMotion ? 0 : Math.abs(((currentY / 420) % 2) - 1);
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
      navToggle.setAttribute("aria-label", open ? t("Đóng menu điều hướng", "Close navigation menu") : t("Mở menu điều hướng", "Open navigation menu"));
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
        countEl.textContent = visibleCount + " / " + totalCount + t(" mục", " items");
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

  /* 5. Lightbox v2 Trigger (Images + Videos + Dynamic Guestbook + Album Viewer + Prev/Next + Swipe) */
  var lightbox = document.getElementById("gallery-lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxVideo = document.getElementById("lightbox-video");
  var lightboxCaption = document.getElementById("lightbox-caption");
  var lightboxCounter = document.getElementById("lightbox-counter");
  var lightboxFilmstrip = document.getElementById("lightbox-filmstrip");
  var lightboxDownload = document.getElementById("lightbox-download");
  var lightboxPrevBtn = lightbox ? lightbox.querySelector("[data-lightbox-prev]") : null;
  var lightboxNextBtn = lightbox ? lightbox.querySelector("[data-lightbox-next]") : null;

  function isVideoUrl(url) {
    return /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(url || ""));
  }

  if (lightbox && lightboxImg && lightboxCaption) {
    var activeSlides = [];
    var activeGalleryIdx = 0;

    var formatIdx = function (n) {
      return n < 10 ? "0" + n : String(n);
    };

    var stopLightboxVideo = function () {
      if (!lightboxVideo) return;
      try {
        lightboxVideo.pause();
      } catch (_e) {}
      lightboxVideo.removeAttribute("src");
      try {
        lightboxVideo.load();
      } catch (_e) {}
      lightboxVideo.hidden = true;
    };

    lightbox.addEventListener("close", stopLightboxVideo);

    var renderLightboxFilmstrip = function () {
      if (!lightboxFilmstrip) return;
      if (activeSlides.length <= 1) {
        lightboxFilmstrip.hidden = true;
        lightboxFilmstrip.innerHTML = "";
        return;
      }
      lightboxFilmstrip.hidden = false;
      lightboxFilmstrip.innerHTML = "";
      activeSlides.forEach(function (slide, idx) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lightbox-strip-thumb" + (idx === activeGalleryIdx ? " is-active" : "");
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", idx === activeGalleryIdx ? "true" : "false");
        btn.setAttribute("aria-label", formatIdx(idx + 1));
        btn.setAttribute("data-strip-idx", String(idx));
        var isVid = slide.type === "video" || isVideoUrl(slide.src);
        if (isVid) {
          btn.classList.add("is-video");
          btn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
        } else {
          var im = document.createElement("img");
          im.src = slide.thumb || slide.src || "";
          im.alt = "";
          im.loading = "lazy";
          im.decoding = "async";
          btn.appendChild(im);
        }
        lightboxFilmstrip.appendChild(btn);
      });
    };

    var syncFilmstripActive = function () {
      if (!lightboxFilmstrip || lightboxFilmstrip.hidden) return;
      var btns = lightboxFilmstrip.querySelectorAll(".lightbox-strip-thumb");
      btns.forEach(function (btn, idx) {
        var on = idx === activeGalleryIdx;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        if (on && typeof btn.scrollIntoView === "function") {
          try {
            btn.scrollIntoView({
              behavior: prefersReducedMotion ? "auto" : "smooth",
              inline: "center",
              block: "nearest",
            });
          } catch (_e) {}
        }
      });
    };

    if (lightboxFilmstrip) {
      lightboxFilmstrip.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-strip-idx]");
        if (!btn) return;
        var idx = parseInt(btn.getAttribute("data-strip-idx") || "0", 10);
        if (!isNaN(idx)) showGalleryIndex(idx);
      });
    }

    var lightboxLoadSeq = 0;
    var toDriveDetailUrl = function (rawSrc) {
      var s = String(rawSrc || "");
      if (s.indexOf("/api/media/drive/") === 0 && !/[?&](?:kind=(?:video|audio)|download=1|raw=1)\b/i.test(s)) {
        return s.split("?")[0] + "?raw=1";
      }
      return s;
    };
    var toDriveDownloadUrl = function (rawSrc) {
      var s = String(rawSrc || "");
      if (s.indexOf("/api/media/drive/") === 0) {
        return s.split("?")[0] + "?download=1";
      }
      return s;
    };

    var showGalleryIndex = function (idx) {
      if (!activeSlides.length) return;
      var total = activeSlides.length;
      activeGalleryIdx = ((idx % total) + total) % total;
      var item = activeSlides[activeGalleryIdx];
      var isVid = item.type === "video" || isVideoUrl(item.src);
      var loadSeq = ++lightboxLoadSeq;
      if (isVid && lightboxVideo) {
        lightboxImg.hidden = true;
        lightboxImg.removeAttribute("src");
        lightboxVideo.hidden = false;
        lightboxVideo.src = item.src || "";
        lightboxVideo.setAttribute("aria-label", item.alt || "Video buổi gặp");
        try {
          lightboxVideo.load();
        } catch (_e) {}
      } else {
        stopLightboxVideo();
        lightboxImg.hidden = false;
        var detailSrc = toDriveDetailUrl(item.src || "");
        var previewSrc = item.thumb || detailSrc;
        lightboxImg.src = previewSrc;
        lightboxImg.alt = item.alt || "";
        if (detailSrc && detailSrc !== previewSrc) {
          var hiImg = new Image();
          hiImg.onload = function () {
            if (loadSeq === lightboxLoadSeq && !lightboxImg.hidden) {
              lightboxImg.src = detailSrc;
            }
          };
          hiImg.src = detailSrc;
        }
      }
      var captionText = item.caption || "";
      if (item.photographer) {
        captionText = captionText
          ? captionText + " · " + (isVid ? "Video: " : "Ảnh: ") + item.photographer
          : (isVid ? "Video: " : "Ảnh: ") + item.photographer;
      }
      lightboxCaption.textContent = captionText;
      if (lightboxCounter) {
        lightboxCounter.textContent = formatIdx(activeGalleryIdx + 1) + " / " + formatIdx(total);
      }
      if (lightboxDownload) {
        var src = String(item.src || "");
        if (src) {
          lightboxDownload.hidden = false;
          lightboxDownload.href = toDriveDownloadUrl(src);
        } else {
          lightboxDownload.hidden = true;
        }
      }
      var multi = total > 1;
      if (lightboxPrevBtn) lightboxPrevBtn.hidden = !multi;
      if (lightboxNextBtn) lightboxNextBtn.hidden = !multi;
      syncFilmstripActive();
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
      var allTriggers = Array.prototype.slice.call(scope.querySelectorAll("[data-lightbox-src]")).filter(function (btn) {
        return !btn.hidden;
      });
      activeSlides = allTriggers.map(function (btn) {
        var src = btn.getAttribute("data-lightbox-src") || "";
        var innerImg = btn.querySelector("img");
        return {
          src: src,
          thumb: (innerImg && (innerImg.currentSrc || innerImg.getAttribute("src"))) || src,
          type: btn.getAttribute("data-lightbox-type") || (isVideoUrl(src) ? "video" : "image"),
          alt: btn.getAttribute("data-lightbox-alt") || "",
          caption: btn.getAttribute("data-lightbox-caption") || "",
          photographer: "",
        };
      });
      var clickedIdx = allTriggers.indexOf(trigger);
      activeGalleryIdx = clickedIdx >= 0 ? clickedIdx : 0;
      renderLightboxFilmstrip();
      showGalleryIndex(activeGalleryIdx);
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
          activeGalleryIdx = 0;
          renderLightboxFilmstrip();
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
    var defaultNoteSummary = modalNoteSummary ? modalNoteSummary.textContent : t("+ Ghi chú cho người điều phối (tùy chọn)", "+ Note for coordinators (optional)");
    var defaultNotePlaceholder = modalNoteInput ? modalNoteInput.getAttribute("placeholder") || "" : "";
    var defaultModalZalo = modalZaloBtn ? modalZaloBtn.getAttribute("href") || "" : "";

    var extractCleanVenue = function (raw) {
      var text = String(raw || "").trim();
      if (!text) return t("Hòa Lạc, Hà Nội", "Hoa Lac, Hanoi");
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
      var title = btn.getAttribute("data-register-event") || t("Hoạt động cộng đồng HolaRise", "HolaRise Community Gathering");
      var eventId = btn.getAttribute("data-event-id") || "";
      var eventSlug = btn.getAttribute("data-event-slug") || "";
      var eventDate = btn.getAttribute("data-event-date") || "";
      var eventTime = btn.getAttribute("data-event-time") || "";
      var eventLocation = btn.getAttribute("data-event-location") || t("Hòa Lạc, Hà Nội", "Hoa Lac, Hanoi");
      var venueUrl = btn.getAttribute("data-venue-url") || "";
      var eventFee = btn.getAttribute("data-event-fee") || t("Phi lợi nhuận · Minh bạch", "Free admission · Non-profit");
      var eventSeats = btn.getAttribute("data-event-seats") || "";
      var eventType = btn.getAttribute("data-event-type") || t("Cộng đồng HolaRise", "HolaRise Community");
      var eventHref = btn.getAttribute("data-event-href") || "";
      var eventImage = btn.getAttribute("data-event-image") || "";
      var eventZalo = btn.getAttribute("data-zalo-group") || defaultModalZalo;
      var icsStart = btn.getAttribute("data-ics-start") || "";
      var icsEnd = btn.getAttribute("data-ics-end") || "";
      var noteSummary = btn.getAttribute("data-note-summary") || defaultNoteSummary;
      var notePlaceholder = btn.getAttribute("data-note-placeholder") || defaultNotePlaceholder;
      var allowAnonShare = btn.getAttribute("data-anon-share") === "true";

      if (modalKickerDisplay) {
        modalKickerDisplay.textContent = eventSeats ? t("Xác nhận tham dự · ", "Event RSVP · ") + eventSeats : t("Xác nhận tham dự", "Event RSVP");
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
        renderFactLines(eventWhenDisplay, timePrimary || dateSecondary || t("Công bố sau", "TBA"), timePrimary ? dateSecondary : "");
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
        if (icsStart || (eventHref && (eventHref.indexOf("/su-kien/") === 0 || eventHref.indexOf("/en/events/") === 0))) {
          modalIcsBtn.hidden = false;
          modalIcsBtn.setAttribute("data-ics-title", title);
          modalIcsBtn.setAttribute("data-ics-location", eventLocation);
          modalIcsBtn.setAttribute(
            "data-ics-url",
            eventHref ? CANONICAL_ORIGIN + eventHref : CANONICAL_ORIGIN + (window.location.pathname || "/")
          );
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

    if (window.location.hash === "#giu-cho" || window.location.hash === "#rsvp") {
      var hashKey = window.location.hash.slice(1);
      var hashTrigger = document.querySelector('[data-open-on-hash="' + hashKey + '"]');
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
        return t(
          "Vui lòng nhập tên gọi của bạn (tối thiểu 2 ký tự).",
          "Please enter your name (at least 2 characters)."
        );
      }
      return "";
    }

    if (name === "phone" || name === "contact") {
      var digits = val.replace(/\D/g, "").length;
      if (digits < 8 && !EMAIL_REGEX.test(val)) {
        return t(
          "Vui lòng nhập số điện thoại / Zalo (ít nhất 8 chữ số) hoặc email hợp lệ.",
          "Please enter a valid phone number (8+ digits) or email address."
        );
      }
      return "";
    }

    if (name === "email") {
      if (val && !EMAIL_REGEX.test(val)) {
        return t(
          "Email chưa đúng định dạng (ví dụ: tenban@gmail.com), hoặc bạn có thể để trống.",
          "Please enter a valid email address (e.g. name@example.com), or leave it blank."
        );
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
    msg.textContent = t(
      "Bạn đang ngoại tuyến. Thông tin đăng ký đã được lưu nháp trên máy — hãy bấm gửi lại khi có mạng, hoặc liên hệ trực tiếp:",
      "You are currently offline. Your draft has been saved locally — please submit again when back online, or contact us directly:"
    );
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
        telLink.textContent = t("Gọi ", "Call ") + (phone || phoneRaw);
        linksWrap.appendChild(telLink);
      }
      if (zalo) {
        var zaloLink = document.createElement("a");
        zaloLink.href = zalo;
        zaloLink.target = "_blank";
        zaloLink.rel = "noopener noreferrer";
        zaloLink.className = "btn btn--outline btn--sm";
        zaloLink.textContent = t("Nhắn Zalo CLB", "Message on Zalo");
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
        statusEl.textContent = t("Đã khôi phục bản nháp bạn nhập gần đây.", "Restored your recent draft.");
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
        { el: nameEl, error: validateClubField(nameEl), summary: t("Vui lòng nhập họ và tên đầy đủ (tối thiểu 2 ký tự).", "Please enter your name (at least 2 characters).") },
        { el: phoneEl, error: validateClubField(phoneEl), summary: t("Vui lòng nhập số điện thoại / Zalo hợp lệ (ít nhất 8 chữ số) để Ban Điều Phối liên hệ.", "Please enter a valid phone number (8+ digits) or email address so coordinators can reach you.") },
        { el: emailEl, error: validateClubField(emailEl), summary: t("Email chưa đúng định dạng (ví dụ: tenban@gmail.com). Bạn có thể sửa lại hoặc để trống.", "Please enter a valid email address, or leave it blank.") }
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
        submitBtn.textContent = t("Đang gửi thông tin...", "Sending...");
      }

      var payload = {};
      new FormData(form).forEach(function (value, key) {
        payload[key] = value;
      });
      payload.lang = isEn ? "en" : "vi";
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
        (resolvedEventSlug ? (isEn ? "/en/events/" : "/su-kien/") + resolvedEventSlug + "/" : "");

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
          submitBtn.textContent = submitBtn.dataset.originalText || t("Gửi đăng ký", "Submit");
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
              t("Không thể gửi đăng ký lúc này. Vui lòng thử lại sau ít phút.", "Could not submit right now. Please try again in a moment.");
            throw new Error(errMsg);
          }
          clearDraft(draftKey);
          if (statusEl) {
            statusEl.className = "form-status is-success";
            statusEl.textContent =
              (result.data && result.data.message) ||
              t(
                "Cảm ơn " + nameVal + "! HolaRise đã ghi nhận thông tin quan tâm của bạn. Đây chưa phải xác nhận tham dự một sự kiện.",
                "Thank you, " + nameVal + "! HolaRise has received your submission and will follow up soon."
              );
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
                : t(
                    "Không thể kết nối máy chủ gửi biểu mẫu lúc này. Thông tin đã được lưu nháp trên máy — bạn vui lòng thử lại hoặc liên hệ trực tiếp qua Hotline/Zalo HolaRise nhé.",
                    "Could not reach the server right now. Your draft has been saved locally — please try again or email phungsu@holarise.org."
                  ));
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

  /* 10. Member-Only Editorial Reflections (up to 7 photos) on /hanh-trinh/<slug>/ */
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
    var prPhotoGrid = document.getElementById("pr-photo-grid");
    var prPhotoMeta = document.getElementById("pr-photo-meta");
    var prPhotoClear = document.getElementById("pr-photo-clear");
    var MAX_REFLECTION_PHOTOS = 7;
    var selectedPhotos = []; // Array<{ file: File, objectUrl: string }>

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
      return d.toLocaleDateString(isEn ? "en-GB" : "vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
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
              ? t(
                  "Hệ thống đang tạm bận (mã " + res.status + "). Bạn vui lòng thử lại sau giây lát.",
                  "The service is temporarily busy (HTTP " + res.status + "). Please try again in a moment."
                )
              : res.status === 413
                ? t("Ảnh tải lên vượt quá dung lượng cho phép.", "Uploaded file exceeds the maximum allowed size.")
                : t(
                    "Phản hồi máy chủ không hợp lệ. Vui lòng tải lại trang và thử lại.",
                    "Invalid server response. Please reload the page and try again."
                  );
          data = { ok: false, message: fallbackMsg };
        }
        return { ok: res.ok, status: res.status, data: data };
      });
    }

    function extractErrMessage(data, fallback) {
      if (data && data.error && data.error.message) return data.error.message;
      if (data && data.message) return data.message;
      return fallback;
    }

    function canvasEncodeJpeg(source, w, h, maxDim, quality) {
      return new Promise(function (resolve, reject) {
        if (!w || !h) {
          reject(new Error(t("Không đọc được kích thước ảnh.", "Could not read image dimensions.")));
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
          reject(new Error(t("Trình duyệt không hỗ trợ nén ảnh.", "Browser canvas is unavailable.")));
          return;
        }
        ctx.drawImage(source, 0, 0, tw, th);
        canvas.toBlob(
          function (blob) {
            if (!blob) {
              reject(new Error(t("Không thể nén ảnh đã chọn.", "Could not compress selected image.")));
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
      });
    }

    function decodeViaDataUrl(file, maxDim, quality) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () {
          reject(new Error("filereader_error"));
        };
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            canvasEncodeJpeg(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim, quality)
              .then(resolve)
              .catch(reject);
          };
          img.onerror = function () {
            reject(new Error("img_decode_error"));
          };
          img.src = String(reader.result || "");
        };
        reader.readAsDataURL(file);
      });
    }

    function compressReflectionImage(file, maxDim, quality, fallbackImgEl) {
      var tryBitmap =
        typeof window.createImageBitmap === "function"
          ? window
              .createImageBitmap(file)
              .then(function (bmp) {
                return canvasEncodeJpeg(bmp, bmp.width, bmp.height, maxDim, quality).then(
                  function (blob) {
                    if (typeof bmp.close === "function") bmp.close();
                    return blob;
                  },
                  function (err) {
                    if (typeof bmp.close === "function") bmp.close();
                    throw err;
                  }
                );
              })
          : Promise.reject(new Error("no_bitmap"));

      return tryBitmap
        .catch(function () {
          return decodeViaDataUrl(file, maxDim, quality);
        })
        .catch(function () {
          if (fallbackImgEl && fallbackImgEl.complete && fallbackImgEl.naturalWidth > 0) {
            return canvasEncodeJpeg(
              fallbackImgEl,
              fallbackImgEl.naturalWidth,
              fallbackImgEl.naturalHeight,
              maxDim,
              quality
            );
          }
          throw new Error("fallback_img_unavailable");
        })
        .catch(function () {
          var mime = String(file && file.type || "").toLowerCase();
          if (file && file.size > 0 && file.size <= 1.2 * 1024 * 1024 && /^image\/(jpeg|jpg|png|webp)$/i.test(mime)) {
            return file;
          }
          throw new Error(
            t(
              "Không đọc được tệp ảnh. Vui lòng chọn ảnh JPEG, PNG hoặc WebP.",
              "Could not read image file. Please select JPEG, PNG, or WebP."
            )
          );
        });
    }

    function isReflectionVideoFile(file) {
      if (!file) return false;
      var mime = String(file.type || "").toLowerCase();
      if (/^video\/(mp4|quicktime|webm)$/i.test(mime)) return true;
      return /\.(mp4|mov|webm)$/i.test(String(file.name || ""));
    }

    function isReflectionImageFile(file) {
      if (!file) return false;
      var mime = String(file.type || "").toLowerCase();
      if (/^image\//i.test(mime)) return true;
      return /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(String(file.name || ""));
    }

    function renderSelectedPhotoPreviews() {
      var count = selectedPhotos.length;
      if (prPhotoWrap) prPhotoWrap.hidden = count === 0;
      if (prPhotoMeta) {
        var vidCount = selectedPhotos.filter(function (x) { return x.mediaType === "video"; }).length;
        prPhotoMeta.textContent = isEn
          ? count + " / " + MAX_REFLECTION_PHOTOS + " files selected" +
            (vidCount > 0 ? " (including " + vidCount + " video)" : " · Auto-optimized on upload")
          : count + " / " + MAX_REFLECTION_PHOTOS + " tệp đã chọn" +
            (vidCount > 0 ? " (gồm " + vidCount + " video)" : " · Tự động nén gọn khi gửi");
      }
      if (prPhotoTrigger) {
        var span = prPhotoTrigger.querySelector("span");
        if (span) {
          span.textContent = isEn
            ? count >= MAX_REFLECTION_PHOTOS
              ? "Maximum " + MAX_REFLECTION_PHOTOS + " files reached"
              : count > 0
                ? "Add photos / videos (" + count + "/" + MAX_REFLECTION_PHOTOS + ")"
                : "Photos / Videos (up to " + MAX_REFLECTION_PHOTOS + ")"
            : count >= MAX_REFLECTION_PHOTOS
              ? "Đã đủ " + MAX_REFLECTION_PHOTOS + " tệp"
              : count > 0
                ? "Thêm ảnh / video (" + count + "/" + MAX_REFLECTION_PHOTOS + ")"
                : "Thêm ảnh / video (tối đa " + MAX_REFLECTION_PHOTOS + ")";
        }
        prPhotoTrigger.disabled = count >= MAX_REFLECTION_PHOTOS;
      }
      if (prPhotoGrid) {
        prPhotoGrid.innerHTML = selectedPhotos
          .map(function (item, idx) {
            var isVid = item.mediaType === "video";
            var mediaHtml = isVid
              ? '<video src="' + escTxt(item.objectUrl) + '" muted playsinline preload="metadata"></video>' +
                '<span class="gb-preview-video-badge" aria-hidden="true">Video</span>'
              : '<img src="' + escTxt(item.objectUrl) + '" alt="' + escTxt(t("Ảnh xem trước ", "Preview image ") + (idx + 1)) + '">';
            return (
              '<div class="gb-preview-tile' + (isVid ? " is-video" : "") + '">' +
              mediaHtml +
              '<button type="button" class="gb-preview-remove" data-remove-pr-photo="' + idx + '" aria-label="' + escTxt(t("Gỡ tệp ", "Remove file ") + (idx + 1)) + '">×</button>' +
              "</div>"
            );
          })
          .join("");
      }
    }

    function clearSelectedPhotos() {
      selectedPhotos.forEach(function (item) {
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
      });
      selectedPhotos = [];
      if (prPhotoInput) prPhotoInput.value = "";
      renderSelectedPhotoPreviews();
    }

    function extractClipboardImages(clipboardData) {
      if (!clipboardData) return [];
      var out = [];
      if (clipboardData.items && clipboardData.items.length) {
        for (var i = 0; i < clipboardData.items.length; i++) {
          var item = clipboardData.items[i];
          if (item && item.kind === "file" && /^image\//i.test(item.type || "")) {
            var f = item.getAsFile();
            if (f) out.push(f);
          }
        }
      }
      if (!out.length && clipboardData.files && clipboardData.files.length) {
        for (var j = 0; j < clipboardData.files.length; j++) {
          var fl = clipboardData.files[j];
          if (fl && /^image\//i.test(fl.type || "")) out.push(fl);
        }
      }
      return out;
    }

    function addReflectionFiles(files, fromPaste) {
      if (!files || !files.length) return;
      var errors = [];
      var remaining = MAX_REFLECTION_PHOTOS - selectedPhotos.length;
      if (remaining <= 0) {
        errors.push(t("Mỗi hương khí chỉ đính kèm tối đa " + MAX_REFLECTION_PHOTOS + " ảnh hoặc video.", "Up to " + MAX_REFLECTION_PHOTOS + " photos or videos per reflection."));
      } else if (files.length > remaining) {
        errors.push(t("Mỗi hương khí chỉ đính kèm tối đa " + MAX_REFLECTION_PHOTOS + " ảnh hoặc video.", "Up to " + MAX_REFLECTION_PHOTOS + " photos or videos per reflection."));
      }

      var addedCount = 0;
      files.slice(0, Math.max(0, remaining)).forEach(function (file, idx) {
        var isVid = isReflectionVideoFile(file);
        var isImg = !isVid && isReflectionImageFile(file);
        if (!isImg && !isVid) {
          errors.push((file.name || t("Tệp", "File")) + t(": chỉ hỗ trợ ảnh JPEG/PNG/WebP hoặc video MP4/MOV/WebM.", ": only JPEG/PNG/WebP images or MP4/MOV/WebM videos are supported."));
          return;
        }
        if (isVid && file.size > 25 * 1024 * 1024) {
          errors.push((file.name || "Video") + t(": video vượt quá giới hạn 25 MB.", ": video exceeds the 25 MB limit."));
          return;
        }
        if (isImg && file.size > 15 * 1024 * 1024) {
          errors.push((file.name || t("Ảnh", "Image")) + t(": ảnh vượt quá 15 MB.", ": image exceeds the 15 MB limit."));
          return;
        }
        var itemObj = {
          file: file,
          mediaType: isVid ? "video" : "image",
          objectUrl: URL.createObjectURL(file),
          name: file.name || (isVid ? "video-" : "pasted-") + (selectedPhotos.length + idx + 1) + (isVid ? ".mp4" : ".png"),
          preparedPromise: null,
        };
        // Eagerly compress images while Android content:// picker permission is fresh
        if (!isVid) {
          itemObj.preparedPromise = compressReflectionImage(file, 1280, 0.82, null).catch(function () {
            return null;
          });
        }
        selectedPhotos.push(itemObj);
        addedCount += 1;
      });

      renderSelectedPhotoPreviews();
      if (prStatus) {
        if (errors.length) {
          prStatus.className = "form-status is-error";
          prStatus.textContent = errors[0];
        } else if (fromPaste && addedCount > 0) {
          prStatus.className = "form-status is-success";
          prStatus.textContent = t(
            "Đã dán " + addedCount + " ảnh từ bộ nhớ tạm (" + selectedPhotos.length + "/" + MAX_REFLECTION_PHOTOS + ").",
            "Pasted " + addedCount + " image(s) from clipboard."
          );
        } else if (prStatus.classList.contains("is-error")) {
          prStatus.className = "form-status";
          prStatus.textContent = "";
        }
      }
    }

    if (prPhotoTrigger && prPhotoInput) {
      prPhotoTrigger.addEventListener("click", function () {
        if (selectedPhotos.length >= MAX_REFLECTION_PHOTOS) return;
        prPhotoInput.click();
      });
      prPhotoInput.addEventListener("change", function () {
        var files = Array.prototype.slice.call(prPhotoInput.files || []);
        addReflectionFiles(files, false);
        setTimeout(function () {
          prPhotoInput.value = "";
        }, 0);
      });
    }

    if (prForm) {
      prForm.addEventListener("paste", function (e) {
        var imgs = extractClipboardImages(e.clipboardData);
        if (!imgs.length) return;
        e.preventDefault();
        addReflectionFiles(imgs, true);
      });
    }

    if (prPhotoGrid) {
      prPhotoGrid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-remove-pr-photo]");
        if (!btn) return;
        var idx = parseInt(btn.getAttribute("data-remove-pr-photo") || "-1", 10);
        if (idx >= 0 && idx < selectedPhotos.length) {
          var removed = selectedPhotos.splice(idx, 1)[0];
          if (removed && removed.objectUrl) URL.revokeObjectURL(removed.objectUrl);
          renderSelectedPhotoPreviews();
        }
      });
    }

    if (prPhotoClear) {
      prPhotoClear.addEventListener("click", clearSelectedPhotos);
    }

    function renderCardMediaTileInner(url, altText) {
      if (isVideoUrl(url)) {
        return (
          '<video src="' + escTxt(url) + '" muted playsinline preload="metadata" aria-hidden="true"></video>' +
          '<span class="gb-video-badge" aria-hidden="true">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>' +
          "<span>Video</span></span>"
        );
      }
      return '<img src="' + escTxt(url) + '" alt="' + escTxt(altText) + '" loading="lazy" decoding="async">';
    }

    function renderCardPhotosHtml(it, captionBits) {
      var photos = Array.isArray(it.photoUrls) && it.photoUrls.length
        ? it.photoUrls
        : it.photoUrl
          ? [it.photoUrl]
          : [];
      if (!photos.length) return "";

      if (photos.length === 1) {
        var singleVid = isVideoUrl(photos[0]);
        return (
          '<figure class="gb-card-photo' + (singleVid ? " is-video" : "") + '">' +
          '<button type="button" class="gb-photo-btn" data-lightbox-src="' + escTxt(photos[0]) + '" data-lightbox-type="' + (singleVid ? "video" : "image") + '" data-lightbox-alt="Khoảnh khắc của ' + escTxt(it.authorName) + '" data-lightbox-caption="' + escTxt(captionBits) + '">' +
          renderCardMediaTileInner(photos[0], "Khoảnh khắc kỷ niệm của " + it.authorName) +
          "</button></figure>"
        );
      }

      var stackCards = photos
        .map(function (url, idx) {
          var isVid = isVideoUrl(url);
          var depth = idx < 3 ? String(idx) : "hidden";
          return (
            '<button type="button" class="gb-stack-card' + (isVid ? " is-video" : "") + '" data-stack-idx="' + idx + '" data-stack-depth="' + depth + '" data-lightbox-src="' + escTxt(url) + '" data-lightbox-type="' + (isVid ? "video" : "image") + '" data-lightbox-alt="' + (isVid ? "Video " : "Ảnh ") + (idx + 1) + ' của ' + escTxt(it.authorName) + '" data-lightbox-caption="' + escTxt(captionBits) + '">' +
            renderCardMediaTileInner(url, "Khoảnh khắc " + (idx + 1) + " của " + it.authorName) +
            "</button>"
          );
        })
        .join("");

      return (
        '<div class="gb-photo-stack-wrap">' +
        '<div class="gb-photo-stack" data-gb-stack data-stack-cur="0" data-stack-total="' + photos.length + '" data-lightbox-group>' +
        stackCards +
        '<button type="button" class="gb-stack-flip-btn" data-gb-stack-flip aria-label="' + escTxt(t("Lật ảnh tiếp theo", "Flip next photo")) + '">' +
        '<span data-gb-stack-label>1 / ' + photos.length + ' · ' + escTxt(t("Lật", "Flip")) + '</span>' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
        "</button>" +
        "</div></div>"
      );
    }

    var MOOD_META = {
      "am-long": t("Ấm lòng", "Heartwarming"),
      "cham-sau": t("Chạm sâu", "Deeply moving"),
      "biet-on": t("Biết ơn", "Grateful"),
      "dang-nho": t("Đáng nhớ", "Memorable"),
      "tiep-suc": t("Tiếp sức", "Inspiring"),
    };

    var REACTION_META = [
      {
        key: "heart",
        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
        label: t("Ấm lòng", "Warm"),
      },
      {
        key: "warm",
        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/></svg>',
        label: t("Đồng cảm", "Resonate"),
      },
      {
        key: "inspire",
        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
        label: t("Tiếp sức", "Inspire"),
      },
    ];

    function renderReflectionCardHtml(it, isPendingMine) {
      var photos = Array.isArray(it.photoUrls) && it.photoUrls.length
        ? it.photoUrls
        : it.photoUrl
          ? [it.photoUrl]
          : [];
      var hasPhoto = photos.length > 0;
      var avHtml = it.authorAvatarUrl
        ? '<img class="gb-avatar-img" src="' + escTxt(it.authorAvatarUrl) + '" alt="Ảnh đại diện ' + escTxt(it.authorName) + '" width="38" height="38" loading="lazy">'
        : '<span class="gb-avatar-initials" aria-hidden="true">' + escTxt(getInitialsTxt(it.authorName)) + "</span>";
      var moodLabel = it.mood && MOOD_META[it.mood] ? MOOD_META[it.mood] : "";
      var moodHtml = moodLabel
        ? '<span class="gb-mood-tag gb-mood-tag--' + escTxt(it.mood) + '"><i class="mood-dot" aria-hidden="true"></i>' + escTxt(moodLabel) + "</span>"
        : "";
      var pendingBannerHtml = isPendingMine
        ? '<div class="gb-pending-banner">' +
          '<span class="gb-pending-dot" aria-hidden="true"></span>' +
          '<span>' +
          (it.status === "rejected"
            ? t("Hương khí của bạn hiện đang tạm ẩn.", "Your reflection is currently hidden.")
            : t("Hương khí của bạn đang chờ Ban Điều Phối duyệt hiển thị công khai.", "Your reflection is pending review before appearing publicly.")) +
          "</span></div>"
        : "";
      var quoteHtml = it.pullQuote
        ? '<blockquote class="gb-pull-quote">“' + escTxt(it.pullQuote) + "”</blockquote>"
        : "";
      var captionBits = [it.authorName, it.authorOrg || it.participantRole].filter(Boolean).join(" · ");
      var photoHtml = renderCardPhotosHtml(it, captionBits);
      var roleLabel =
        it.participantRole === "member"
          ? t("Thành viên", "Member")
          : it.participantRole === "volunteer"
            ? t("Tình nguyện viên", "Volunteer")
            : it.participantRole === "speaker"
              ? t("Diễn giả", "Speaker")
              : it.participantRole;
      var metaParts = [it.authorOrg || roleLabel, formatDateShortVi(it.createdAt)].filter(Boolean);
      var myReaction = it.myReaction || (it.heartedByMe ? "heart" : "");
      var reactions = it.reactions || { heart: Number(it.heartCount || 0), warm: 0, inspire: 0 };
      var reactionsHtml = isPendingMine
        ? '<span class="gb-pending-pill">' + (it.status === "rejected" ? t("Đang ẩn", "Hidden") : t("Chờ duyệt", "Pending")) + "</span>"
        : '<div class="gb-reactions-bar" role="group" aria-label="' + escTxt(t("Thả cảm xúc", "React")) + '">' +
          REACTION_META.map(function (rm) {
            var isActive = myReaction === rm.key;
            var cnt = Number(reactions[rm.key] || 0);
            return (
              '<button type="button" class="gb-react-btn' + (isActive ? " is-active" : "") + '" data-heart-reflection="' + escTxt(it.id) + '" data-reaction-type="' + rm.key + '" aria-pressed="' + (isActive ? "true" : "false") + '" aria-label="' + escTxt(rm.label) + '">' +
              '<span class="gb-react-icon" aria-hidden="true">' + rm.icon + "</span>" +
              '<span class="gb-react-label">' + escTxt(rm.label) + "</span>" +
              '<span class="gb-react-count"' + (cnt > 0 ? "" : " hidden") + ">" + cnt + "</span>" +
              "</button>"
            );
          }).join("") +
          "</div>";
      return (
        '<article class="gb-card' + (hasPhoto ? " gb-card--photo" : "") + (isPendingMine ? " gb-card--pending" : "") + '" data-reflection-id="' + escTxt(it.id) + '" data-mood-key="' + escTxt(it.mood || "") + '" data-lightbox-group>' +
        pendingBannerHtml +
        photoHtml +
        '<div class="gb-card-inner">' +
        moodHtml +
        quoteHtml +
        '<p class="gb-card-body">' + escTxt(it.content) + "</p>" +
        '<footer class="gb-card-foot gb-card-foot--reactions">' +
        '<div class="gb-author">' +
        avHtml +
        '<div class="gb-author-meta"><strong>' + escTxt(it.authorName) + "</strong>" +
        (metaParts.length ? "<span>" + escTxt(metaParts.join(" · ")) + "</span>" : "") +
        "</div></div>" +
        reactionsHtml +
        "</footer></div></article>"
      );
    }

    function loadPublicReflections() {
      if (!gbSlug || !gbList) return;
      fetch("/api/reflections?slug=" + encodeURIComponent(gbSlug), { credentials: "same-origin" })
        .then(parseJsonSafe)
        .then(function (res) {
          var data = res.data || {};
          var items = data.items || [];
          var myRef = data.myReflection || null;
          var hasPendingMine = Boolean(myRef && myRef.status !== "approved" && !items.some(function (x) { return x.id === myRef.id; }));
          var isSignedIn = Boolean(prForm && !prForm.hidden);
          var photoCount = items.reduce(function (sum, x) {
            var n = Array.isArray(x.photoUrls) ? x.photoUrls.length : x.photoUrl ? 1 : 0;
            return sum + n;
          }, 0);
          if (gbCount) {
            if (!items.length && hasPendingMine) {
              gbCount.textContent = t("1 hương khí đang chờ duyệt", "1 reflection pending review");
            } else if (!items.length) {
              gbCount.textContent = t("Chưa có hương khí", "No reflections yet");
            } else if (photoCount > 0) {
              gbCount.textContent = isEn
                ? items.length + " reflections · " + photoCount + " photos"
                : items.length + " hương khí · " + photoCount + " ảnh";
            } else {
              gbCount.textContent = isEn
                ? items.length + " reflections"
                : items.length + " hương khí";
            }
          }
          if (!items.length && !hasPendingMine) {
            gbList.innerHTML =
              '<div class="guestbook-empty"><p>' +
              (isSignedIn
                ? t(
                    "Chưa có hương khí nào — hãy viết đôi dòng đọng lại ở khung phía trên để mở đầu nhé.",
                    "No reflections yet — share the first note from this gathering above."
                  )
                : t(
                    "Chưa có hương khí công khai nào cho buổi gặp này.",
                    "No public reflections yet for this gathering."
                  )) +
              "</p></div>";
            return;
          }
          var cardsHtml = [];
          if (hasPendingMine) {
            cardsHtml.push(renderReflectionCardHtml(myRef, true));
          }
          items.forEach(function (it) {
            cardsHtml.push(renderReflectionCardHtml(it, false));
          });
          gbList.innerHTML = cardsHtml.join("");
        })
        .catch(function () {
          if (gbCount) gbCount.textContent = t("Hương khí cộng đồng", "Community reflections");
        });
    }

    loadPublicReflections();
    window.addEventListener("hola:member-changed", loadPublicReflections);

    gbSection.addEventListener("click", function (e) {
      var reactBtn = e.target.closest("[data-heart-reflection]");
      if (!reactBtn || reactBtn.disabled) return;
      var refId = reactBtn.getAttribute("data-heart-reflection");
      var reactionType = reactBtn.getAttribute("data-reaction-type") || "heart";
      if (!refId) return;
      var card = reactBtn.closest("[data-reflection-id]");
      var allBtns = card ? Array.prototype.slice.call(card.querySelectorAll("[data-heart-reflection]")) : [reactBtn];
      allBtns.forEach(function (b) { b.disabled = true; });
      fetch("/api/reflections/" + encodeURIComponent(refId) + "/heart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: reactionType }),
      })
        .then(parseJsonSafe)
        .then(function (res) {
          if (!res.ok || !res.data) return;
          var activeKey = res.data.myReaction || "";
          var reactions = res.data.reactions || { heart: Number(res.data.heartCount || 0), warm: 0, inspire: 0 };
          allBtns.forEach(function (b) {
            var k = b.getAttribute("data-reaction-type") || "heart";
            var isOn = activeKey === k;
            var cnt = Number(reactions[k] || 0);
            b.classList.toggle("is-active", isOn);
            b.setAttribute("aria-pressed", isOn ? "true" : "false");
            var cntEl = b.querySelector(".gb-react-count");
            if (cntEl) {
              cntEl.textContent = String(cnt);
              cntEl.hidden = cnt <= 0;
            }
          });
        })
        .catch(function () {})
        .finally(function () {
          allBtns.forEach(function (b) { b.disabled = false; });
        });
    });

    if (prForm) {
      prForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (prStatus) {
          prStatus.className = "form-status";
          prStatus.textContent = "";
        }
        var fd = new FormData(prForm);
        var contentVal = String(fd.get("content") || "").trim();
        if (contentVal.length < 12) {
          if (prStatus) {
            prStatus.className = "form-status is-error";
            prStatus.textContent = t("Cảm nhận cần ít nhất 12 ký tự.", "Please write at least 12 characters.");
          }
          return;
        }
        if (selectedPhotos.length > MAX_REFLECTION_PHOTOS) {
          if (prStatus) {
            prStatus.className = "form-status is-error";
            prStatus.textContent = t(
              "Mỗi lưu bút chỉ đính kèm tối đa " + MAX_REFLECTION_PHOTOS + " ảnh.",
              "You can attach up to " + MAX_REFLECTION_PHOTOS + " photos per reflection."
            );
          }
          return;
        }
        if (prBtn) {
          prBtn.disabled = true;
          prBtn.textContent = selectedPhotos.length
            ? t("Đang nén & tải ảnh...", "Compressing & uploading photos...")
            : t("Đang gửi...", "Posting...");
        }

        var filesToUpload = selectedPhotos.slice();
        var uploadedUrls = [];

        var previewImgs = prPhotoGrid ? Array.prototype.slice.call(prPhotoGrid.querySelectorAll(".gb-preview-tile")) : [];
        var uploadChain = filesToUpload.reduce(function (promise, item, idx) {
          return promise.then(function () {
            var isVid = item.mediaType === "video" || isReflectionVideoFile(item.file);
            if (prBtn) {
              prBtn.textContent = t(
                (isVid ? "Đang tải video " : "Đang tải ảnh ") + (idx + 1) + "/" + filesToUpload.length + "...",
                "Uploading media " + (idx + 1) + "/" + filesToUpload.length + "..."
              );
            }
            var previewImgEl = previewImgs[idx] ? previewImgs[idx].querySelector("img") : null;
            var prepareBlob = isVid
              ? Promise.resolve({ blob: item.file, filename: item.name || "reflection-" + (idx + 1) + ".mp4" })
              : Promise.resolve(item.preparedPromise)
                  .then(function (cachedBlob) {
                    if (cachedBlob) return cachedBlob;
                    return compressReflectionImage(item.file, 1280, 0.82, previewImgEl);
                  })
                  .then(function (blob) {
                    return { blob: blob, filename: "reflection-" + (idx + 1) + ".jpg" };
                  });
            return prepareBlob.then(function (prepared) {
              var upFd = new FormData();
              upFd.append("file", prepared.blob, prepared.filename);
              return fetch("/api/reflections/media", { method: "POST", body: upFd })
                .then(parseJsonSafe)
                .then(function (upRes) {
                  if (!upRes.ok || !upRes.data || !upRes.data.url) {
                    throw new Error(extractErrMessage(upRes.data, t("Không thể tải tệp lên lúc này.", "Could not upload media right now.")));
                  }
                  uploadedUrls.push(upRes.data.url);
                });
            });
          });
        }, Promise.resolve());

        uploadChain
          .then(function () {
            if (prBtn) prBtn.textContent = t("Đang gửi hương khí...", "Submitting reflection...");
            var payload = {
              activitySlug: gbSlug,
              participantRole: String(fd.get("participantRole") || "").trim() || "member",
              pullQuote: String(fd.get("pullQuote") || "").trim(),
              mood: String(fd.get("mood") || "").trim(),
              content: contentVal,
              photoUrls: uploadedUrls,
              photoUrl: uploadedUrls[0] || "",
              website: String(fd.get("website") || "").trim(),
            };
            return fetch("/api/reflections", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }).then(parseJsonSafe);
          })
          .then(function (res) {
            if (!res.ok) {
              throw new Error(extractErrMessage(res.data, t("Không thể gửi hương khí lúc này.", "Could not submit reflection right now.")));
            }
            var contentInput = document.getElementById("pr-content");
            if (contentInput) contentInput.value = "";
            var quoteInput = document.getElementById("pr-quote");
            if (quoteInput) quoteInput.value = "";
            clearSelectedPhotos();
            if (prStatus) {
              prStatus.className = "form-status is-success";
              prStatus.textContent = t(
                (res.data && res.data.message) || "Đã gửi hương khí — bài của bạn đang chờ Ban Điều Phối duyệt hiển thị.",
                "Thank you! Your reflection is pending review before publishing."
              );
            }
            loadPublicReflections();
          })
          .catch(function (err) {
            if (prStatus) {
              prStatus.className = "form-status is-error";
              prStatus.textContent = (err && err.message) || t("Có lỗi xảy ra, vui lòng thử lại.", "Something went wrong. Please try again.");
            }
          })
          .finally(function () {
            if (prBtn) {
              prBtn.disabled = false;
              prBtn.textContent = t("Gửi hương khí", "Post reflection");
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
   * Unified Feedback Modal (Direct to /api/event-feedback, Optional Attach/Paste)
   * ----------------------------------------------------------------------- */
  (function initFeedbackModal() {
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
    var diagDetailsEl = document.getElementById("fb-diag-details");
    var diagPreviewEl = document.getElementById("fb-diag-preview");

    var recentErrors = [];
    var currentAttachmentDataUrl = "";
    var currentDiagnostics = "";
    var modernScreenshotPromise = null;
    var captureInFlight = false;
    var userClearedAutoShot = false;

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

    function collectDiagnosticsText() {
      var docH = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      var scrollPct = Math.min(100, Math.max(0, Math.round((window.scrollY / docH) * 100)));
      var lines = [
        "Trang: " + (window.location.pathname || "/") + (window.location.search || ""),
        "Khung hình: " + window.innerWidth + "x" + window.innerHeight + " (cuộn " + scrollPct + "%)",
        "Môi trường: " + detectClientEnv(),
      ];
      if (recentErrors.length > 0) {
        lines.push("Lỗi JS gần nhất: " + recentErrors.join(" | "));
      }
      return lines.join("\n").slice(0, 880);
    }

    function isBugSelected() {
      var checked = form.querySelector('input[name="feedbackKind"]:checked');
      return Boolean(checked && /lỗi|bug|technical/i.test(checked.value || ""));
    }

    function syncFeedbackPlaceholder() {
      if (!noteEl) return;
      var checked = form.querySelector('input[name="feedbackKind"]:checked');
      var val = checked ? checked.value || "" : "";
      if (/lỗi|bug|technical/i.test(val)) {
        noteEl.placeholder = t(
          "Mô tả ngắn chỗ bị lỗi (màn hình đã tự chụp sẵn)...",
          "Briefly describe the issue (screen is captured automatically)..."
        );
      } else if (/đề xuất|idea|suggestion/i.test(val)) {
        noteEl.placeholder = t(
          "Bạn muốn HolaRise tổ chức hoặc bổ sung điều gì?",
          "What gathering idea or improvement would you suggest?"
        );
      } else {
        noteEl.placeholder = t(
          "Chia sẻ nhanh cảm nhận hoặc điều cần cải thiện...",
          "Share quick feedback or anything we can improve..."
        );
      }
    }

    function showQuickToast(msg) {
      var prev = document.getElementById("fb-quick-toast");
      if (prev) prev.remove();
      var el = document.createElement("div");
      el.id = "fb-quick-toast";
      el.className = "fb-quick-toast";
      el.setAttribute("role", "status");
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 2600);
    }

    function syncDiagnosticsVisibility() {
      if (!diagDetailsEl) return;
      var show = isBugSelected();
      diagDetailsEl.hidden = !show;
      if (!show) diagDetailsEl.open = false;
      syncFeedbackPlaceholder();
    }

    function setFeedbackStatus(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.className = "form-status" + (type ? " is-" + type : "");
    }

    function setAttachmentPreview(dataUrl, label) {
      currentAttachmentDataUrl = dataUrl || "";
      if (shotImgEl && shotPreviewEl && clearBtn) {
        if (currentAttachmentDataUrl) {
          shotImgEl.src = currentAttachmentDataUrl;
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

    function compressImageBlob(blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error(t("Không đọc được tệp ảnh.", "Could not read image file."))); };
        reader.onload = function () {
          var img = new Image();
          img.onerror = function () { reject(new Error(t("Tệp không phải ảnh hợp lệ.", "File is not a valid image."))); };
          img.onload = function () {
            var maxW = 960;
            var ratio = img.width > maxW ? maxW / img.width : 1;
            var canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * ratio));
            canvas.height = Math.max(1, Math.round(img.height * ratio));
            var ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error(t("Trình duyệt không hỗ trợ xử lý ảnh.", "Browser cannot process image.")));
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

    function captureViewportScreenshot() {
      if (captureInFlight) return Promise.resolve();
      captureInFlight = true;
      if (shotStateEl) shotStateEl.textContent = t("Đang chụp màn hình...", "Capturing screen...");

      var vw = Math.max(320, window.innerWidth || 390);
      var vh = Math.max(320, window.innerHeight || 720);
      var sx = window.scrollX || window.pageXOffset || 0;
      var sy = window.scrollY || window.pageYOffset || 0;

      // Mask sensitive text inputs outside feedback modal before DOM capture
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
        setTimeout(function () { reject(new Error("capture_timeout")); }, 6000);
      });

      return Promise.race([
        loadModernScreenshot().then(function (lib) {
          return lib.domToCanvas(document.body, {
            width: vw,
            height: vh,
            scale: 1,
            timeout: 350,
            font: false,
            backgroundColor: "#ffffff",
            style: {
              transform: "translate(" + (-sx) + "px, " + (-sy) + "px)",
              transformOrigin: "top left",
              width: document.documentElement.scrollWidth + "px",
              height: document.documentElement.scrollHeight + "px",
            },
            filter: function (node) {
              if (!node || node.nodeType !== 1) return true;
              var tag = node.tagName;
              if (
                tag === "DIALOG" ||
                tag === "SCRIPT" ||
                tag === "NOSCRIPT" ||
                tag === "VIDEO" ||
                tag === "IFRAME"
              ) {
                return false;
              }
              if (
                node.id === "feedback-modal" ||
                node.id === "feedback-pulse-fab" ||
                node.id === "orbital-top-btn" ||
                node.id === "pwa-install-banner"
              ) {
                return false;
              }
              if (tag === "IMG") {
                var r = node.getBoundingClientRect();
                if ((r.width === 0 && r.height === 0) || r.bottom < -120 || r.top > vh + 120) {
                  return false;
                }
              }
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
            setAttachmentPreview(dataUrl, t("Đã chụp (~" + kb + " KB)", "Captured (~" + kb + " KB)"));
          } else {
            setAttachmentPreview("", t("Ảnh quá lớn, hãy chọn ảnh từ máy.", "Image too large — please attach from device."));
          }
        })
        .catch(function () {
          restoreMasked();
          if (shotStateEl) {
            shotStateEl.textContent = t(
              "Chưa tự chụp được, bạn có thể đính kèm hoặc dán ảnh.",
              "Auto-capture unavailable — you can attach or paste an image."
            );
          }
        })
        .finally(function () {
          captureInFlight = false;
        });
    }

    function openFeedbackDialog(opts) {
      var options = opts || {};
      setFeedbackStatus("", "");
      userClearedAutoShot = false;
      currentDiagnostics = collectDiagnosticsText();
      if (diagPreviewEl) diagPreviewEl.textContent = currentDiagnostics;

      // Close mobile drawer if feedback was triggered from it
      var drawer = document.getElementById("mobile-drawer");
      if (drawer && drawer.classList.contains("is-open")) {
        var navToggleBtn = document.querySelector("[data-nav-toggle]");
        if (navToggleBtn) navToggleBtn.click();
      }

      if (options.bugMode) {
        var bugRadio = form.querySelector('input[name="feedbackKind"][value*="lỗi"], input[name="feedbackKind"][value*="Bug"]');
        if (bugRadio) bugRadio.checked = true;
      }
      syncDiagnosticsVisibility();

      if (typeof dialog.showModal === "function" && !dialog.open) {
        dialog.showModal();
      }
      // Pre-warm lazy screenshot script silently while user types so 1-tap capture is instant
      loadModernScreenshot().catch(function () {});
      if (noteEl) {
        setTimeout(function () { noteEl.focus(); }, 60);
      }
      if ((options.autoCapture || isBugSelected()) && !currentAttachmentDataUrl) {
        captureViewportScreenshot();
      }
    }

    form.addEventListener("change", function (e) {
      if (e.target && e.target.name === "feedbackKind") {
        syncDiagnosticsVisibility();
        if (isBugSelected() && !currentAttachmentDataUrl && !userClearedAutoShot) {
          captureViewportScreenshot();
        }
      }
    });

    if (noteEl) {
      noteEl.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          if (typeof form.requestSubmit === "function") form.requestSubmit();
        }
      });
    }

    function handleImagePaste(e) {
      if (!dialog.open) return;
      var cb = e.clipboardData;
      if (!cb) return;
      var imgFile = null;
      if (cb.items && cb.items.length) {
        for (var i = 0; i < cb.items.length; i += 1) {
          if (cb.items[i] && cb.items[i].kind === "file" && /^image\//i.test(cb.items[i].type || "")) {
            imgFile = cb.items[i].getAsFile();
            break;
          }
        }
      }
      if (!imgFile && cb.files && cb.files.length) {
        for (var j = 0; j < cb.files.length; j += 1) {
          if (cb.files[j] && /^image\//i.test(cb.files[j].type || "")) {
            imgFile = cb.files[j];
            break;
          }
        }
      }
      if (!imgFile) return;
      e.preventDefault();
      if (shotStateEl) shotStateEl.textContent = t("Đang xử lý ảnh vừa dán...", "Processing pasted image...");
      compressImageBlob(imgFile)
        .then(function (dataUrl) {
          var kb = Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));
          setAttachmentPreview(dataUrl, t("Đã dán ảnh (~" + kb + " KB)", "Image pasted (~" + kb + " KB)"));
        })
        .catch(function (err) {
          setAttachmentPreview("", (err && err.message) || t("Không xử lý được ảnh vừa dán.", "Could not process pasted image."));
        });
    }

    dialog.addEventListener("paste", handleImagePaste);

    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-open-feedback-modal]");
      if (!trigger) return;
      var isBugQuick = trigger.getAttribute("data-feedback-bug") === "1";
      openFeedbackDialog({ bugMode: isBugQuick });
    });

    if (captureBtn) {
      captureBtn.addEventListener("click", function () {
        userClearedAutoShot = false;
        captureViewportScreenshot();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        userClearedAutoShot = true;
        setAttachmentPreview("", "");
        if (fileInputEl) fileInputEl.value = "";
      });
    }

    if (fileInputEl) {
      fileInputEl.addEventListener("change", function () {
        var file = fileInputEl.files && fileInputEl.files[0];
        if (!file) return;
        if (shotStateEl) shotStateEl.textContent = t("Đang nén ảnh...", "Compressing image...");
        compressImageBlob(file)
          .then(function (dataUrl) {
            var kb = Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));
            setAttachmentPreview(dataUrl, t("Đã chọn ảnh (~" + kb + " KB)", "Image attached (~" + kb + " KB)"));
          })
          .catch(function (err) {
            setAttachmentPreview("", (err && err.message) || t("Không thể đọc ảnh này.", "Could not read this image."));
          });
      });
    }

    function mapKindToCategory(kind) {
      if (/đề xuất|idea|suggestion/i.test(kind)) return "de-xuat";
      if (/khác|other/i.test(kind)) return "khac";
      return "cai-thien";
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      setFeedbackStatus("", "");

      var checkedKind = form.querySelector('input[name="feedbackKind"]:checked');
      var kind = checkedKind ? checkedKind.value : t("Góp ý trải nghiệm", "Experience Feedback");
      var bugSelected = isBugSelected();
      var note = (noteEl && noteEl.value ? noteEl.value : "").trim();
      var minLen = currentAttachmentDataUrl ? 2 : 4;
      if (note.length < minLen) {
        setFeedbackStatus(
          currentAttachmentDataUrl
            ? t("Ghi chú ngắn ít nhất 2 ký tự kèm ảnh nhé.", "Please add at least a 2-character note with the image.")
            : t("Vui lòng nhập ít nhất 4 ký tự để Ban Điều Phối nắm rõ ý của bạn.", "Please enter at least 4 characters."),
          "error"
        );
        if (noteEl) noteEl.focus();
        return;
      }

      var authorName = (nameEl && nameEl.value ? nameEl.value : "").trim();
      var authorContact = (contactEl && contactEl.value ? contactEl.value : "").trim();
      var memberBar = document.getElementById("fb-member-bar");
      var isSignedInBarVisible = Boolean(memberBar && !memberBar.hidden);
      var isAnon = !isSignedInBarVisible && !authorName && !authorContact;
      var hp = form.querySelector('input[name="website"]');

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = t("Đang gửi phản hồi...", "Sending feedback...");
      }
      try {
        var res = await fetch("/api/event-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceKind: bugSelected ? "bug" : "site",
            category: mapKindToCategory(kind),
            topicLabel: kind,
            lang: isEn ? "en" : "vi",
            website: hp ? hp.value : "",
            pageUrl: (window.location.pathname || "/") + (window.location.search || ""),
            content: note,
            authorName: authorName,
            authorContact: authorContact,
            isAnonymous: isAnon,
            diagnostics: bugSelected ? (currentDiagnostics || collectDiagnosticsText()) : "",
            attachmentDataUrl: currentAttachmentDataUrl || "",
          }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || data.ok === false) {
          throw new Error(data.message || t("Chưa gửi được đóng góp lúc này. Vui lòng thử lại.", "Could not send feedback right now. Please try again."));
        }
        if (noteEl) noteEl.value = "";
        setAttachmentPreview("", "");
        if (fileInputEl) fileInputEl.value = "";
        var okMsg =
          data.message ||
          t(
            "Đã gửi góp ý · Cảm ơn bạn!",
            "Feedback sent — thank you!"
          );
        setFeedbackStatus(okMsg, "success");
        setTimeout(function () {
          if (dialog.open) dialog.close();
          showQuickToast(t("Đã gửi góp ý tới Ban Điều Phối ✓", "Feedback sent to HolaRise ✓"));
        }, 850);
      } catch (err) {
        setFeedbackStatus(err && err.message ? err.message : t("Đã có lỗi xảy ra khi gửi.", "Something went wrong while sending."), "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = t("Gửi phản hồi", "Send feedback");
        }
      }
    });
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

  /* =========================================================================
     Apple Hybrid Cinema Memory Stage Engine
     - Smart Media Filter (All / Photos / Videos)
     - Apple Photos Memories Ken Burns Reel Player (Story Progress + Swipe + Keyboard)
     - Apple Journal Mood Filter + Reaction Spring Pop
     - Floating Frosted Glass Action Dock + Share
     ========================================================================= */
  (function initAppleMemoryStage() {
    var stageRoot = document.querySelector(".memory-stage-root--cinema");
    if (!stageRoot) return;

    var isEnStage =
      (document.documentElement && document.documentElement.lang === "en") ||
      /^\/en(\/|$)/i.test(window.location.pathname || "");
    var tStage = function (vi, en) {
      return isEnStage ? en : vi;
    };
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 1. Collect all gallery slides for Curated 5-Tile Mosaic, Contact Sheet & Memory Reel
    var galleryWrap = document.getElementById("memory-gallery-group");
    var gridEl = galleryWrap ? galleryWrap.querySelector(".memory-exhibition-grid") : null;
    var thumbs = galleryWrap
      ? Array.prototype.slice.call(galleryWrap.querySelectorAll(".memory-stage-thumb[data-lightbox-src]"))
      : [];
    var photoCount = thumbs.filter(function (el) {
      return (el.getAttribute("data-media-kind") || "image") !== "video";
    }).length;
    var videoCount = thumbs.length - photoCount;

    var MAX_VISIBLE_MOSAIC = 5;
    var sheetDlg = document.getElementById("memory-all-photos-dialog");
    var sheetGrid = document.getElementById("memory-sheet-grid");
    var sheetCloseBtn = document.getElementById("memory-sheet-close");
    var sheetPlayBtn = document.getElementById("memory-sheet-play-reel");
    var openAllBtn = document.getElementById("memory-open-all-btn");
    var openAllLabel = document.getElementById("memory-open-all-label");
    var sheetHydrated = false;

    function openAllPhotosSheet() {
      if (!sheetDlg || !sheetGrid) return;
      if (!sheetHydrated) {
        sheetHydrated = true;
        sheetGrid.innerHTML = "";
        thumbs.forEach(function (origTile) {
          var clone = origTile.cloneNode(true);
          clone.classList.remove("is-lead", "is-wide", "is-mosaic-overflow", "has-more-overlay");
          clone.removeAttribute("data-open-all-sheet");
          var oldOv = clone.querySelector(".memory-more-overlay");
          if (oldOv) oldOv.remove();
          clone.classList.add("memory-sheet-tile");
          clone.hidden = false;
          sheetGrid.appendChild(clone);
        });
      }
      if (!sheetDlg.open) sheetDlg.showModal();
    }

    var photoCountEl = document.getElementById("memory-photo-count");
    if (photoCountEl && thumbs.length > 0) {
      photoCountEl.textContent = isEnStage
        ? thumbs.length + (thumbs.length === 1 ? " photo" : " photos")
        : thumbs.length + " ảnh";
    }

    // Interactive Physical Apple Photo Stack Deck (Act 2 main showcase)
    var deckLayout = document.getElementById("apple-deck-layout");
    var deckStage = document.getElementById("apple-photo-deck");
    var deckFallback = document.getElementById("apple-gallery-fallback");
    var deckCurEl = document.getElementById("apple-deck-cur");
    var deckTotalEl = document.getElementById("apple-deck-total");
    var deckCaptionEl = document.getElementById("apple-deck-caption");
    var deckPrevBtn = document.getElementById("apple-deck-prev");
    var deckNextBtn = document.getElementById("apple-deck-next");
    var deckZoomBtn = document.getElementById("apple-deck-zoom");

    if (deckLayout && deckStage && thumbs.length > 0) {
      var deckSlides = thumbs.map(function (el) {
        var imgEl = el.querySelector("img");
        return {
          src: el.getAttribute("data-lightbox-src") || "",
          thumbSrc: imgEl ? imgEl.currentSrc || imgEl.getAttribute("src") || "" : el.getAttribute("data-lightbox-src") || "",
          type: el.getAttribute("data-lightbox-type") || "image",
          alt: el.getAttribute("data-lightbox-alt") || "",
          caption: el.getAttribute("data-lightbox-caption") || "",
        };
      });

      var deckIdx = 0;
      var deckAnimating = false;
      var VISIBLE_DEPTHS = Math.min(4, deckSlides.length);
      var pad2 = function (n) {
        return n < 10 ? "0" + n : String(n);
      };

      function createDeckCardEl(slideIdx, depth) {
        var slide = deckSlides[slideIdx];
        var card = document.createElement("div");
        card.className = "apple-deck-card";
        card.setAttribute("data-depth", String(depth));
        card.setAttribute("data-slide-idx", String(slideIdx));
        if (slide.type === "video") {
          var vid = document.createElement("video");
          vid.src = slide.src;
          vid.muted = true;
          vid.playsInline = true;
          vid.preload = "metadata";
          card.appendChild(vid);
        } else {
          var img = document.createElement("img");
          img.src = slide.thumbSrc || slide.src;
          img.alt = slide.alt || "";
          img.decoding = "async";
          card.appendChild(img);
        }
        return card;
      }

      function syncDeckMeta() {
        var total = deckSlides.length;
        var curSlide = deckSlides[deckIdx];
        if (deckCurEl) deckCurEl.textContent = pad2(deckIdx + 1);
        if (deckTotalEl) deckTotalEl.textContent = pad2(total);
        if (deckCaptionEl) {
          deckCaptionEl.classList.add("is-fading");
          setTimeout(function () {
            deckCaptionEl.textContent = curSlide.caption || curSlide.alt || "";
            deckCaptionEl.classList.remove("is-fading");
          }, 90);
        }
      }

      function renderDeckFresh() {
        deckStage.innerHTML = "";
        for (var d = VISIBLE_DEPTHS - 1; d >= 0; d -= 1) {
          var sIdx = (deckIdx + d) % deckSlides.length;
          deckStage.appendChild(createDeckCardEl(sIdx, d));
        }
        syncDeckMeta();
      }

      function flipDeck(step) {
        if (deckSlides.length <= 1 || deckAnimating) return;
        deckAnimating = true;
        var frontCard = deckStage.querySelector('.apple-deck-card[data-depth="0"]');
        var isPrev = step < 0;
        var nextIdx = (deckIdx + step + deckSlides.length) % deckSlides.length;

        if (frontCard) {
          frontCard.style.transform = "";
          frontCard.classList.remove("is-dragging-card");
          frontCard.classList.add(isPrev ? "is-toss-prev" : "is-toss-next");
        }

        if (!isPrev) {
          // Promote underlying cards forward simultaneously while top card sweeps out
          deckStage.querySelectorAll(".apple-deck-card").forEach(function (c) {
            if (c === frontCard) return;
            var curD = Number(c.getAttribute("data-depth"));
            if (curD > 0) c.setAttribute("data-depth", String(curD - 1));
          });
          if (deckSlides.length >= VISIBLE_DEPTHS) {
            var incomingIdx = (nextIdx + VISIBLE_DEPTHS - 1) % deckSlides.length;
            var newBack = createDeckCardEl(incomingIdx, VISIBLE_DEPTHS - 1);
            deckStage.insertBefore(newBack, deckStage.firstChild);
          }
          deckIdx = nextIdx;
          syncDeckMeta();
          setTimeout(function () {
            if (frontCard && frontCard.parentNode) frontCard.remove();
            deckAnimating = false;
          }, 340);
        } else {
          deckIdx = nextIdx;
          setTimeout(function () {
            renderDeckFresh();
            deckAnimating = false;
          }, 220);
        }
      }

      // Physical pointer drag & touch swipe on the deck
      var dragActive = false;
      var dragStartX = 0;
      var dragStartY = 0;
      var dragDx = 0;
      var dragCard = null;

      deckStage.addEventListener("pointerdown", function (e) {
        if (deckAnimating || e.button > 0) return;
        dragCard = deckStage.querySelector('.apple-deck-card[data-depth="0"]');
        if (!dragCard) return;
        dragActive = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragDx = 0;
        deckStage.classList.add("is-dragging");
        dragCard.classList.add("is-dragging-card");
        try {
          deckStage.setPointerCapture(e.pointerId);
        } catch (_e) {}
      });

      deckStage.addEventListener("pointermove", function (e) {
        if (!dragActive || !dragCard) return;
        dragDx = e.clientX - dragStartX;
        var dy = (e.clientY - dragStartY) * 0.16;
        var rot = dragDx * 0.045;
        dragCard.style.transform =
          "translate3d(" + dragDx.toFixed(1) + "px, " + dy.toFixed(1) + "px, 0) rotate(" + rot.toFixed(2) + "deg)";
      });

      function finishDrag() {
        if (!dragActive) return;
        dragActive = false;
        deckStage.classList.remove("is-dragging");
        var card = dragCard;
        var dx = dragDx;
        dragCard = null;
        dragDx = 0;
        if (!card) return;
        card.classList.remove("is-dragging-card");
        if (Math.abs(dx) >= 52) {
          flipDeck(dx < 0 ? 1 : -1);
        } else if (Math.abs(dx) < 8) {
          card.style.transform = "";
          flipDeck(1);
        } else {
          card.style.transform = "";
        }
      }

      deckStage.addEventListener("pointerup", finishDrag);
      deckStage.addEventListener("pointercancel", finishDrag);
      deckStage.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === " ") {
          e.preventDefault();
          flipDeck(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          flipDeck(-1);
        }
      });

      if (deckPrevBtn) deckPrevBtn.addEventListener("click", function () { flipDeck(-1); });
      if (deckNextBtn) deckNextBtn.addEventListener("click", function () { flipDeck(1); });
      if (deckZoomBtn) {
        deckZoomBtn.addEventListener("click", function () {
          if (thumbs[deckIdx]) thumbs[deckIdx].click();
        });
      }

      renderDeckFresh();
      deckLayout.hidden = false;
      if (deckFallback) deckFallback.hidden = true;

      if (openAllBtn && thumbs.length >= 2) {
        openAllBtn.hidden = false;
        if (openAllLabel) {
          openAllLabel.textContent = isEnStage
            ? "View all " + thumbs.length + " photos"
            : "Tất cả " + thumbs.length + " ảnh";
        }
      }
    }

    // Interactive Mini Photo Stack inside Multi-Photo Reflection Cards (Act 3)
    function flipReflectionStack(stackEl) {
      if (!stackEl || stackEl.dataset.flipping === "1") return;
      var cards = Array.prototype.slice.call(stackEl.querySelectorAll(".gb-stack-card"));
      if (cards.length <= 1) return;
      stackEl.dataset.flipping = "1";
      var cur = Number(stackEl.getAttribute("data-stack-cur") || "0");
      var frontCard = cards[cur];
      var next = (cur + 1) % cards.length;
      if (frontCard) frontCard.classList.add("is-toss-next");

      setTimeout(function () {
        if (frontCard) frontCard.classList.remove("is-toss-next");
        stackEl.setAttribute("data-stack-cur", String(next));
        cards.forEach(function (c, i) {
          var rel = (i - next + cards.length) % cards.length;
          c.setAttribute("data-stack-depth", rel < 3 ? String(rel) : "hidden");
        });
        var lbl = stackEl.querySelector("[data-gb-stack-label]");
        if (lbl) {
          lbl.textContent = (next + 1) + " / " + cards.length + " · " + tStage("Lật", "Flip");
        }
        stackEl.dataset.flipping = "0";
      }, 240);
    }

    document.addEventListener("click", function (e) {
      var flipBtn = e.target.closest("[data-gb-stack-flip]");
      if (!flipBtn) return;
      e.preventDefault();
      e.stopPropagation();
      var stackEl = flipBtn.closest("[data-gb-stack]");
      flipReflectionStack(stackEl);
    });

    var gbStackTouchX = 0;
    var gbStackTarget = null;
    document.addEventListener(
      "touchstart",
      function (e) {
        var st = e.target.closest("[data-gb-stack]");
        if (st && e.touches && e.touches.length) {
          gbStackTarget = st;
          gbStackTouchX = e.touches[0].clientX;
        }
      },
      { passive: true }
    );
    document.addEventListener(
      "touchend",
      function (e) {
        if (!gbStackTarget || !e.changedTouches || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - gbStackTouchX;
        var st = gbStackTarget;
        gbStackTarget = null;
        if (Math.abs(dx) > 42) {
          flipReflectionStack(st);
        }
      },
      { passive: true }
    );

    if (openAllBtn) {
      openAllBtn.addEventListener("click", openAllPhotosSheet);
    }
    if (sheetCloseBtn && sheetDlg) {
      sheetCloseBtn.addEventListener("click", function () {
        if (sheetDlg.open) sheetDlg.close();
      });
    }

    // Media filter inside All-Photos Contact Sheet (shows when both photos & videos exist)
    var filterBar = stageRoot.querySelector("[data-memory-media-filter]");
    if (filterBar && photoCount > 0 && videoCount > 0) {
      filterBar.hidden = false;
      var allBtn = filterBar.querySelector('[data-filter="all"]');
      var imgBtn = filterBar.querySelector('[data-filter="image"]');
      var vidBtn = filterBar.querySelector('[data-filter="video"]');
      if (allBtn) allBtn.textContent = tStage("Tất cả", "All") + " (" + thumbs.length + ")";
      if (imgBtn) imgBtn.textContent = tStage("Ảnh", "Photos") + " (" + photoCount + ")";
      if (vidBtn) vidBtn.textContent = "Video (" + videoCount + ")";

      filterBar.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-filter]");
        if (!btn || !sheetGrid) return;
        var mode = btn.getAttribute("data-filter") || "all";
        filterBar.querySelectorAll("[data-filter]").forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });
        sheetGrid.querySelectorAll(".memory-sheet-tile").forEach(function (tile) {
          var kind = tile.getAttribute("data-media-kind") || "image";
          tile.hidden = mode !== "all" && kind !== mode;
        });
      });
    }

    // 2. Unhide "Play Memory Reel" buttons when gallery has >= 1 item
    var reelBtns = Array.prototype.slice.call(stageRoot.querySelectorAll("[data-memory-play-reel]"));
    if (thumbs.length >= 1) {
      reelBtns.forEach(function (btn) {
        btn.hidden = false;
      });
    }

    // 3. Share Button (native Web Share API + clipboard fallback)
    stageRoot.querySelectorAll("[data-memory-share]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var canonicalLink = document.querySelector('link[rel="canonical"]');
        var canonicalHref = canonicalLink ? canonicalLink.getAttribute("href") : "";
        var url = canonicalHref || (CANONICAL_ORIGIN + (window.location.pathname || "/"));
        var title = btn.getAttribute("data-share-title") || document.title;
        var labelSpan = btn.querySelector("span");
        var origText = labelSpan ? labelSpan.textContent : "";
        if (navigator.share) {
          navigator.share({ title: title, url: url }).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            if (labelSpan) {
              labelSpan.textContent = tStage("Đã sao chép", "Copied");
              setTimeout(function () {
                labelSpan.textContent = origText;
              }, 2000);
            }
          });
        }
      });
    });

    // 4. Smooth reveal & focus on composer when clicking "Write reflection"
    stageRoot.querySelectorAll("[data-memory-jump-write]").forEach(function (link) {
      link.addEventListener("click", function () {
        var wrap = document.getElementById("public-reflection-wrap");
        if (wrap) wrap.hidden = false;
        setTimeout(function () {
          var ta = document.getElementById("pr-content");
          if (ta && !ta.closest("[hidden]")) {
            try {
              ta.focus({ preventScroll: true });
            } catch (_e) {}
          }
        }, 420);
      });
    });

    // 5. Adaptive Liquid Glass Navbar (dark frosted over Full-Bleed Hero -> light frosted on #ffffff/#f5f5f7)
    var heroPoster = stageRoot.querySelector("[data-memory-hero-poster]");
    if (heroPoster && "IntersectionObserver" in window) {
      var headerObserver = new IntersectionObserver(
        function (entries) {
          var heroVisible = entries[0] && entries[0].isIntersecting;
          document.body.classList.toggle("is-header-light", !heroVisible);
        },
        { rootMargin: "-68px 0px 0px 0px", threshold: 0 }
      );
      headerObserver.observe(heroPoster);
    }

    // 6. Interactive Apple Journal Story Rail + Collapsible Composer + Spark Reactions
    var gbListEl = document.getElementById("guestbook-list");
    var moodFilterEl = document.getElementById("memory-mood-filter");
    var composerWrapEl = document.getElementById("public-reflection-wrap");
    var composerFormEl = document.getElementById("public-reflection-form");
    var toggleComposerBtn = document.getElementById("apple-toggle-composer");
    var pcBarEl = document.getElementById("apple-postcard-bar");
    var pcDockEl = document.getElementById("apple-avatar-dock");
    var pcPrevBtn = document.getElementById("apple-pc-prev");
    var pcNextBtn = document.getElementById("apple-pc-next");
    var pcOpenAllBtn = document.getElementById("apple-pc-open-all");
    var refSheetDlg = document.getElementById("memory-all-reflections-dialog");
    var refSheetList = document.getElementById("apple-ref-sheet-list");
    var refSheetClose = document.getElementById("apple-ref-sheet-close");

    function openReflectionComposer() {
      var isSignedIn = Boolean(composerFormEl && !composerFormEl.hidden);
      if (!isSignedIn) {
        var authTrigger = composerWrapEl
          ? composerWrapEl.querySelector("[data-open-member-auth]")
          : document.querySelector("[data-open-member-auth]");
        if (authTrigger) {
          authTrigger.click();
          return;
        }
      }
      if (composerWrapEl) {
        composerWrapEl.hidden = !composerWrapEl.hidden;
        if (toggleComposerBtn) {
          var lbl = toggleComposerBtn.querySelector("span");
          if (lbl) {
            lbl.textContent = composerWrapEl.hidden
              ? tStage("Viết hương khí", "Write a reflection")
              : tStage("Đóng khung viết", "Close");
          }
          toggleComposerBtn.setAttribute("aria-expanded", composerWrapEl.hidden ? "false" : "true");
        }
        if (!composerWrapEl.hidden) {
          setTimeout(function () {
            var ta = document.getElementById("pr-content");
            if (ta && !ta.closest("[hidden]")) {
              try {
                ta.focus({ preventScroll: true });
              } catch (_e) {}
            }
          }, 120);
        }
      }
    }

    if (toggleComposerBtn) {
      toggleComposerBtn.addEventListener("click", openReflectionComposer);
    }

    var MOOD_LABELS = {
      "am-long": tStage("Ấm lòng", "Heartwarming"),
      "cham-sau": tStage("Chạm sâu", "Deeply moving"),
      "biet-on": tStage("Biết ơn", "Grateful"),
      "dang-nho": tStage("Đáng nhớ", "Memorable"),
      "tiep-suc": tStage("Tiếp sức", "Inspiring"),
    };
    var activeMood = "all";
    var pcIdx = 0;
    var pcVisibleCards = [];

    function readCardSummary(card) {
      var nameEl = card.querySelector(".gb-author-meta strong");
      var subEl = card.querySelector(".gb-author-meta span");
      var avImg = card.querySelector(".gb-avatar-img");
      var avInit = card.querySelector(".gb-avatar-initials");
      var quoteEl = card.querySelector(".gb-pull-quote");
      var bodyEl = card.querySelector(".gb-card-body");
      var moodKey = card.getAttribute("data-mood-key") || "";
      return {
        name: nameEl ? nameEl.textContent.trim() : tStage("Thành viên", "Member"),
        sub: subEl ? subEl.textContent.trim() : "",
        avatarSrc: avImg ? avImg.getAttribute("src") || "" : "",
        initials: avInit ? avInit.textContent.trim() : "H",
        quote: quoteEl ? quoteEl.textContent.trim() : "",
        body: bodyEl ? bodyEl.textContent.trim() : "",
        moodKey: moodKey,
      };
    }

    function syncRailArrows() {
      if (!gbListEl) return;
      var overflow = gbListEl.scrollWidth > gbListEl.clientWidth + 12;
      if (pcPrevBtn) {
        pcPrevBtn.hidden = !overflow;
        pcPrevBtn.disabled = gbListEl.scrollLeft <= 8;
      }
      if (pcNextBtn) {
        pcNextBtn.hidden = !overflow;
        pcNextBtn.disabled = gbListEl.scrollLeft + gbListEl.clientWidth >= gbListEl.scrollWidth - 8;
      }
    }

    function setActiveDockChip(idx) {
      pcIdx = Math.max(0, Math.min(idx, Math.max(0, pcVisibleCards.length - 1)));
      if (!pcDockEl) return;
      pcDockEl.querySelectorAll(".apple-avatar-chip").forEach(function (chip, i) {
        var active = i === pcIdx;
        chip.classList.toggle("is-active", active);
        chip.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    function scrollToRailCard(idx) {
      var card = pcVisibleCards[idx];
      if (!card || !gbListEl) return;
      setActiveDockChip(idx);
      var left = Math.max(0, card.offsetLeft - 2);
      gbListEl.scrollTo({ left: left, behavior: "smooth" });
    }

    function attachExpandButtons() {
      pcVisibleCards.forEach(function (card) {
        var bodyEl = card.querySelector(".gb-card-body");
        if (!bodyEl || card.querySelector(".apple-card-more-btn")) return;
        if (bodyEl.scrollHeight > bodyEl.clientHeight + 4 || (bodyEl.textContent || "").length > 180) {
          var moreBtn = document.createElement("button");
          moreBtn.type = "button";
          moreBtn.className = "apple-card-more-btn";
          moreBtn.textContent = tStage("Đọc thêm", "Read more");
          moreBtn.addEventListener("click", function () {
            var expanded = card.classList.toggle("is-expanded");
            moreBtn.textContent = expanded ? tStage("Thu gọn", "Show less") : tStage("Đọc thêm", "Read more");
          });
          bodyEl.insertAdjacentElement("afterend", moreBtn);
        }
      });
    }

    function rebuildStoryRail(resetScroll) {
      if (!gbListEl) return;
      var allCards = Array.prototype.slice.call(gbListEl.querySelectorAll(".gb-card"));
      pcVisibleCards = [];
      allCards.forEach(function (card) {
        var m = card.getAttribute("data-mood-key") || "";
        var show = activeMood === "all" || m === activeMood;
        card.hidden = !show;
        if (show) pcVisibleCards.push(card);
      });

      if (pcBarEl) pcBarEl.hidden = pcVisibleCards.length < 2;
      if (pcOpenAllBtn) pcOpenAllBtn.hidden = pcVisibleCards.length < 3;

      if (pcDockEl) {
        pcDockEl.innerHTML = "";
        pcVisibleCards.forEach(function (card, i) {
          var info = readCardSummary(card);
          var chip = document.createElement("button");
          chip.type = "button";
          chip.className = "apple-avatar-chip" + (i === 0 ? " is-active" : "");
          chip.setAttribute("role", "tab");
          chip.setAttribute("data-pc-idx", String(i));
          chip.setAttribute("aria-selected", i === 0 ? "true" : "false");

          var av = document.createElement("span");
          av.className = "apple-avatar-chip-av";
          av.setAttribute("aria-hidden", "true");
          if (info.avatarSrc) {
            var im = document.createElement("img");
            im.src = info.avatarSrc;
            im.alt = "";
            av.appendChild(im);
          } else {
            av.textContent = info.initials;
          }
          chip.appendChild(av);

          var nm = document.createElement("span");
          nm.className = "apple-avatar-chip-name";
          nm.textContent = info.name;
          chip.appendChild(nm);

          if (info.moodKey && MOOD_LABELS[info.moodKey]) {
            var dot = document.createElement("i");
            dot.className = "mood-dot";
            dot.setAttribute("data-mood", info.moodKey);
            dot.setAttribute("aria-hidden", "true");
            chip.appendChild(dot);
          }
          pcDockEl.appendChild(chip);
        });
      }

      if (resetScroll) {
        gbListEl.scrollTo({ left: 0, behavior: "smooth" });
        pcIdx = 0;
      }
      requestAnimationFrame(function () {
        attachExpandButtons();
        syncRailArrows();
      });
    }

    function syncMoodFilterBar() {
      if (!gbListEl) return;
      var cards = Array.prototype.slice.call(gbListEl.querySelectorAll(".gb-card[data-mood-key]"));
      if (moodFilterEl) {
        var counts = {};
        cards.forEach(function (c) {
          var m = c.getAttribute("data-mood-key") || "";
          if (m && MOOD_LABELS[m]) counts[m] = (counts[m] || 0) + 1;
        });
        var keys = Object.keys(counts);
        if (keys.length < 2) {
          moodFilterEl.hidden = true;
        } else {
          moodFilterEl.hidden = false;
          var pillsHtml =
            '<button type="button" class="memory-mood-chip' + (activeMood === "all" ? " is-active" : "") + '" data-mood-filter="all">' +
            tStage("Tất cả", "All") + " (" + cards.length + ")</button>" +
            keys
              .map(function (k) {
                return (
                  '<button type="button" class="memory-mood-chip' + (activeMood === k ? " is-active" : "") + '" data-mood-filter="' + k + '">' +
                  '<i class="mood-dot" data-mood="' + k + '" aria-hidden="true"></i>' +
                  MOOD_LABELS[k] + " · " + counts[k] +
                  "</button>"
                );
              })
              .join("");
          moodFilterEl.innerHTML = pillsHtml;
        }
      }
      rebuildStoryRail(false);
    }

    if (gbListEl) {
      if ("MutationObserver" in window) {
        var gbMut = new MutationObserver(syncMoodFilterBar);
        gbMut.observe(gbListEl, { childList: true });
      }
      syncMoodFilterBar();
      window.addEventListener("resize", syncRailArrows, { passive: true });

      var railScrollTick = null;
      gbListEl.addEventListener(
        "scroll",
        function () {
          if (railScrollTick) return;
          railScrollTick = requestAnimationFrame(function () {
            railScrollTick = null;
            syncRailArrows();
            if (!pcVisibleCards.length) return;
            var curLeft = gbListEl.scrollLeft + 24;
            var bestIdx = 0;
            var bestDist = Infinity;
            pcVisibleCards.forEach(function (card, i) {
              var d = Math.abs(card.offsetLeft - curLeft);
              if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
              }
            });
            if (bestIdx !== pcIdx) setActiveDockChip(bestIdx);
          });
        },
        { passive: true }
      );

      // Smooth desktop mouse drag-to-scroll on the Story Rail
      var railDrag = false;
      var railStartX = 0;
      var railStartScroll = 0;
      gbListEl.addEventListener("mousedown", function (e) {
        if (e.button !== 0 || e.target.closest("button, a, input, textarea, [data-gb-stack]")) return;
        railDrag = true;
        railStartX = e.clientX;
        railStartScroll = gbListEl.scrollLeft;
        gbListEl.style.scrollSnapType = "none";
      });
      window.addEventListener("mousemove", function (e) {
        if (!railDrag) return;
        gbListEl.scrollLeft = railStartScroll - (e.clientX - railStartX);
      });
      window.addEventListener("mouseup", function () {
        if (!railDrag) return;
        railDrag = false;
        gbListEl.style.scrollSnapType = "";
      });

      if (moodFilterEl) {
        moodFilterEl.addEventListener("click", function (e) {
          var btn = e.target.closest("[data-mood-filter]");
          if (!btn) return;
          activeMood = btn.getAttribute("data-mood-filter") || "all";
          moodFilterEl.querySelectorAll("[data-mood-filter]").forEach(function (b) {
            b.classList.toggle("is-active", b === btn);
          });
          rebuildStoryRail(true);
        });
      }

      if (pcDockEl) {
        pcDockEl.addEventListener("click", function (e) {
          var chip = e.target.closest("[data-pc-idx]");
          if (!chip) return;
          var target = Number(chip.getAttribute("data-pc-idx"));
          if (Number.isFinite(target)) scrollToRailCard(target);
        });
      }
      if (pcPrevBtn) {
        pcPrevBtn.addEventListener("click", function () {
          gbListEl.scrollBy({ left: -402, behavior: "smooth" });
        });
      }
      if (pcNextBtn) {
        pcNextBtn.addEventListener("click", function () {
          gbListEl.scrollBy({ left: 402, behavior: "smooth" });
        });
      }

      // Light Apple Journal All-Reflections Sheet
      if (pcOpenAllBtn && refSheetDlg && refSheetList) {
        pcOpenAllBtn.addEventListener("click", function () {
          refSheetList.innerHTML = "";
          pcVisibleCards.forEach(function (card, i) {
            var info = readCardSummary(card);
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "apple-ref-sheet-item" + (i === pcIdx ? " is-active" : "");
            btn.setAttribute("data-sheet-pc-idx", String(i));
            if (info.quote) {
              var q = document.createElement("p");
              q.className = "apple-ref-sheet-quote";
              q.textContent = info.quote;
              btn.appendChild(q);
            }
            var ex = document.createElement("p");
            ex.className = "apple-ref-sheet-excerpt";
            ex.textContent = info.body;
            btn.appendChild(ex);

            var foot = document.createElement("div");
            foot.className = "apple-ref-sheet-author";
            var st = document.createElement("strong");
            st.textContent = info.name;
            foot.appendChild(st);
            if (info.sub) {
              var sp = document.createElement("span");
              sp.textContent = info.sub;
              foot.appendChild(sp);
            }
            btn.appendChild(foot);
            refSheetList.appendChild(btn);
          });
          if (!refSheetDlg.open) refSheetDlg.showModal();
        });

        refSheetList.addEventListener("click", function (e) {
          var item = e.target.closest("[data-sheet-pc-idx]");
          if (!item) return;
          var idx = Number(item.getAttribute("data-sheet-pc-idx"));
          if (refSheetDlg.open) refSheetDlg.close();
          if (Number.isFinite(idx)) scrollToRailCard(idx);
        });
      }
      if (refSheetClose && refSheetDlg) {
        refSheetClose.addEventListener("click", function () {
          if (refSheetDlg.open) refSheetDlg.close();
        });
      }
    }

    // Spring pop + floating "+1" spark particle when tapping reaction buttons
    document.addEventListener("click", function (e) {
      var rBtn = e.target.closest(".gb-react-btn");
      if (!rBtn) return;
      rBtn.classList.remove("is-popping");
      void rBtn.offsetWidth;
      rBtn.classList.add("is-popping");
      if (!reduced) {
        var spark = document.createElement("span");
        spark.className = "apple-react-spark";
        spark.setAttribute("aria-hidden", "true");
        spark.textContent = "+1";
        rBtn.appendChild(spark);
        setTimeout(function () {
          if (spark.parentNode) spark.remove();
        }, 680);
      }
    });

    // 7. Apple Photos Memories Ken Burns Reel Player + Warm Felt-Piano Ambient Soundtrack
    var reelDlg = document.getElementById("memory-reel-dialog");
    var reelProgress = document.getElementById("memory-reel-progress");
    var reelImg = document.getElementById("memory-reel-img");
    var reelVideo = document.getElementById("memory-reel-video");
    var reelCaption = document.getElementById("memory-reel-caption");
    var reelCounter = document.getElementById("memory-reel-counter");
    var reelAudioBtn = document.getElementById("memory-reel-audio");
    var reelToggleBtn = document.getElementById("memory-reel-toggle");
    var reelCloseBtn = document.getElementById("memory-reel-close");
    var reelPrevBtn = document.getElementById("memory-reel-prev");
    var reelNextBtn = document.getElementById("memory-reel-next");

    function createMemorySoundtrack(pillarKey, rawAudioUrl, rawAudioTitle) {
      var cleanUrl = String(rawAudioUrl || "").trim();
      if (/^__SSR_/.test(cleanUrl)) cleanUrl = "";
      var cleanTitle = String(rawAudioTitle || "").trim();
      if (/^__SSR_/.test(cleanTitle)) cleanTitle = "";

      var lowerUrl = cleanUrl.toLowerCase();
      var startMuted = lowerUrl === "preset:silent";
      var effectivePillar = pillarKey || "holaheart";
      if (lowerUrl === "preset:holaheart") effectivePillar = "holaheart";
      else if (lowerUrl === "preset:holagreen") effectivePillar = "holagreen";
      else if (lowerUrl === "preset:holaconnect") effectivePillar = "holaconnect";

      var isCustomTrack = Boolean(
        cleanUrl && !lowerUrl.startsWith("preset:") && (cleanUrl.startsWith("/") || cleanUrl.startsWith("https://"))
      );

      var PRESET_LABELS = {
        holaheart: tStage("Piano ấm · HolaHeart", "Warm Piano · HolaHeart"),
        holagreen: tStage("Rừng thông · HolaGreen", "Pine Breeze · HolaGreen"),
        holaconnect: tStage("Kết nối · HolaConnect", "Connection · HolaConnect"),
      };

      var AudioCtx = window.AudioContext || window.webkitAudioContext;

      // Warm nostalgic felt-piano + analog pad chord progressions (frequencies in Hz)
      var PROGRESSIONS = {
        holaheart: [
          [174.61, 220.0, 261.63, 329.63, 392.0], // Fmaj9
          [130.81, 196.0, 246.94, 293.66, 329.63], // Cmaj9
          [146.83, 220.0, 261.63, 329.63, 349.23], // Dm9
          [116.54, 174.61, 220.0, 261.63, 293.66], // Bbmaj9
        ],
        holagreen: [
          [196.0, 246.94, 293.66, 369.99, 440.0], // Gmaj9
          [146.83, 220.0, 293.66, 329.63, 369.99], // Dadd9
          [164.81, 246.94, 293.66, 369.99, 392.0], // Em9
          [130.81, 196.0, 246.94, 293.66, 329.63], // Cmaj9
        ],
        holaconnect: [
          [130.81, 196.0, 246.94, 293.66, 329.63], // Cmaj9
          [196.0, 246.94, 293.66, 329.63, 392.0], // G6
          [220.0, 261.63, 329.63, 392.0, 493.88], // Am9
          [174.61, 220.0, 261.63, 329.63, 392.0], // Fmaj9
        ],
      };

      var chords = PROGRESSIONS[effectivePillar] || PROGRESSIONS.holaheart;
      var ctx = null;
      var masterGain = null;
      var reverbNode = null;
      var warmFilter = null;
      var chordTimer = null;
      var chordStep = 0;
      var playing = false;
      var muted = startMuted;

      // Custom HTML5 <audio> track state with graceful fallback to Web Audio felt-piano
      var customAudio = null;
      var customFailed = false;
      var fadeTimer = null;

      function clearFadeTimer() {
        if (fadeTimer) {
          clearInterval(fadeTimer);
          fadeTimer = null;
        }
      }

      function fadeCustomAudio(targetVol, durationMs, onDone) {
        clearFadeTimer();
        if (!customAudio) {
          if (onDone) onDone();
          return;
        }
        var steps = Math.max(1, Math.round((durationMs || 400) / 30));
        var startVol = typeof customAudio.volume === "number" ? customAudio.volume : targetVol;
        var stepIdx = 0;
        fadeTimer = setInterval(function () {
          stepIdx += 1;
          var ratio = Math.min(1, stepIdx / steps);
          var nextVol = Math.max(0, Math.min(1, startVol + (targetVol - startVol) * ratio));
          try {
            customAudio.volume = nextVol;
          } catch (_e) {}
          if (ratio >= 1) {
            clearFadeTimer();
            if (onDone) onDone();
          }
        }, 30);
      }

      function ensureCustomAudio() {
        if (customAudio || customFailed || !isCustomTrack) return customAudio;
        var el = new Audio();
        el.loop = true;
        el.preload = "none";
        el.playsInline = true;
        el.src = cleanUrl;
        el.volume = 0;
        el.addEventListener("error", function () {
          customFailed = true;
          clearFadeTimer();
          if (playing && !muted) startSynth();
        });
        customAudio = el;
        return customAudio;
      }

      function createImpulse(audioCtx, durationSec) {
        var rate = audioCtx.sampleRate;
        var length = Math.floor(rate * durationSec);
        var buf = audioCtx.createBuffer(2, length, rate);
        for (var ch = 0; ch < 2; ch += 1) {
          var data = buf.getChannelData(ch);
          for (var i = 0; i < length; i += 1) {
            var decay = Math.pow(1 - i / length, 2.6);
            data[i] = (Math.random() * 2 - 1) * decay * 0.42;
          }
        }
        return buf;
      }

      function ensureContext() {
        if (!AudioCtx) return null;
        if (ctx) return ctx;
        ctx = new AudioCtx();
        masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);

        warmFilter = ctx.createBiquadFilter();
        warmFilter.type = "lowpass";
        warmFilter.frequency.setValueAtTime(1150, ctx.currentTime);
        warmFilter.Q.setValueAtTime(0.6, ctx.currentTime);

        reverbNode = ctx.createConvolver();
        reverbNode.buffer = createImpulse(ctx, 2.3);

        var wetGain = ctx.createGain();
        wetGain.gain.setValueAtTime(0.46, ctx.currentTime);
        var dryGain = ctx.createGain();
        dryGain.gain.setValueAtTime(0.68, ctx.currentTime);

        warmFilter.connect(dryGain);
        warmFilter.connect(reverbNode);
        reverbNode.connect(wetGain);
        dryGain.connect(masterGain);
        wetGain.connect(masterGain);
        masterGain.connect(ctx.destination);
        return ctx;
      }

      function playFeltNote(freq, startAt, durSec, peakGain, oscType) {
        if (!ctx || !warmFilter) return;
        var osc = ctx.createOscillator();
        var osc2 = ctx.createOscillator();
        var noteGain = ctx.createGain();

        osc.type = oscType || "triangle";
        osc2.type = "sine";
        osc.frequency.setValueAtTime(freq, startAt);
        osc2.frequency.setValueAtTime(freq * 1.0018, startAt);

        noteGain.gain.setValueAtTime(0.0001, startAt);
        noteGain.gain.linearRampToValueAtTime(peakGain, startAt + 0.045);
        noteGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain * 0.28), startAt + durSec * 0.45);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, startAt + durSec);

        osc.connect(noteGain);
        osc2.connect(noteGain);
        noteGain.connect(warmFilter);

        osc.start(startAt);
        osc2.start(startAt);
        osc.stop(startAt + durSec + 0.05);
        osc2.stop(startAt + durSec + 0.05);
      }

      function triggerBar() {
        if (!playing || !ctx) return;
        var now = ctx.currentTime + 0.05;
        var chord = chords[chordStep % chords.length];
        chordStep += 1;

        playFeltNote(chord[0], now, 5.1, 0.095, "sine");
        playFeltNote(chord[1], now + 0.08, 4.9, 0.055, "sine");

        var pattern = [1, 2, 3, 4, 2, 3];
        pattern.forEach(function (noteIdx, step) {
          var f = chord[noteIdx] || chord[2];
          var octaveBoost = step === 3 ? 2 : 1;
          var jitter = step % 2 === 0 ? 0.015 : 0.04;
          playFeltNote(f * octaveBoost, now + step * 0.72 + jitter, 2.6, step === 3 ? 0.045 : 0.062, "triangle");
        });
      }

      function applySynthVolume() {
        if (!ctx || !masterGain) return;
        var now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
        masterGain.gain.linearRampToValueAtTime(playing && !muted ? 0.55 : 0.0001, now + (playing && !muted ? 1.1 : 0.4));
      }

      function startSynth() {
        try {
          var audioCtx = ensureContext();
          if (!audioCtx) return;
          if (audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
          applySynthVolume();
          if (chordTimer) clearInterval(chordTimer);
          triggerBar();
          chordTimer = setInterval(triggerBar, 4600);
        } catch (_e) {}
      }

      function stopSynth(suspendCtx) {
        if (chordTimer) {
          clearInterval(chordTimer);
          chordTimer = null;
        }
        applySynthVolume();
        if (suspendCtx && ctx && ctx.state === "running") {
          setTimeout(function () {
            if (!playing && ctx && ctx.state === "running") {
              ctx.suspend().catch(function () {});
            }
          }, 450);
        }
      }

      function startCustom() {
        var el = ensureCustomAudio();
        if (!el) {
          startSynth();
          return;
        }
        el.muted = muted;
        if (muted) {
          try {
            el.pause();
          } catch (_e) {}
          return;
        }
        try {
          el.volume = Math.min(el.volume || 0, 0.85);
        } catch (_e) {}
        var p = el.play();
        if (p && typeof p.then === "function") {
          p.then(function () {
            if (playing && !muted) fadeCustomAudio(0.85, 850);
          }).catch(function (err) {
            // Fall back to felt-piano if the audio source fails to decode/load
            if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") {
              customFailed = true;
              if (playing && !muted) startSynth();
            }
          });
        } else {
          fadeCustomAudio(0.85, 850);
        }
      }

      function pauseCustom(resetTime) {
        if (!customAudio) return;
        var el = customAudio;
        fadeCustomAudio(0, 260, function () {
          if (!playing || muted) {
            try {
              el.pause();
              if (resetTime) el.currentTime = 0;
            } catch (_e) {}
          }
        });
      }

      return {
        start: function () {
          playing = true;
          if (isCustomTrack && !customFailed) {
            startCustom();
          } else if (!muted) {
            startSynth();
          }
        },
        pause: function () {
          playing = false;
          if (isCustomTrack && !customFailed) pauseCustom(false);
          stopSynth(false);
        },
        stop: function () {
          playing = false;
          if (isCustomTrack && !customFailed) pauseCustom(true);
          stopSynth(true);
        },
        setMuted: function (nextMuted) {
          muted = Boolean(nextMuted);
          if (isCustomTrack && !customFailed) {
            var el = ensureCustomAudio();
            if (el) {
              el.muted = muted;
              if (muted) {
                pauseCustom(false);
              } else if (playing) {
                startCustom();
              }
            }
          } else {
            if (!muted && playing && !chordTimer) {
              startSynth();
            } else {
              applySynthVolume();
            }
          }
        },
        isMuted: function () {
          return muted;
        },
        getTrackLabel: function () {
          if (isCustomTrack && !customFailed) {
            return cleanTitle || tStage("Nhạc sự kiện", "Event Score");
          }
          if (cleanTitle) return cleanTitle;
          if (lowerUrl.startsWith("preset:") && lowerUrl !== "preset:silent") {
            return PRESET_LABELS[effectivePillar] || tStage("Nhạc nền", "Sound");
          }
          return tStage("Nhạc nền", "Sound");
        },
      };
    }

    if (reelDlg && reelImg && thumbs.length > 0) {
      var REEL_DURATION_MS = 5200;
      var soundtrack = createMemorySoundtrack(
        stageRoot.getAttribute("data-pillar") || "holaheart",
        stageRoot.getAttribute("data-reel-audio-url") || "",
        stageRoot.getAttribute("data-reel-audio-title") || ""
      );
      var reelSlides = thumbs.map(function (el) {
        var src = el.getAttribute("data-lightbox-src") || "";
        return {
          src: src,
          type: el.getAttribute("data-lightbox-type") || "image",
          alt: el.getAttribute("data-lightbox-alt") || "",
          caption: el.getAttribute("data-lightbox-caption") || "",
        };
      });
      var reelIdx = 0;
      var reelPaused = false;
      var reelTimer = null;
      var kbClasses = ["kb-zoom-in", "kb-pan-right", "kb-pan-left"];

      var PAUSE_SVG =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
      var PLAY_SVG =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>';

      function syncAudioUi() {
        if (!reelAudioBtn) return;
        var isOff = soundtrack.isMuted() || reelPaused;
        reelAudioBtn.classList.toggle("is-muted", isOff);
        reelAudioBtn.setAttribute("aria-pressed", soundtrack.isMuted() ? "false" : "true");
        var trackLabel = typeof soundtrack.getTrackLabel === "function" ? soundtrack.getTrackLabel() : tStage("Nhạc nền", "Sound");
        reelAudioBtn.title = soundtrack.isMuted()
          ? tStage("Bật nhạc nền", "Unmute soundtrack")
          : trackLabel;
        var lbl = reelAudioBtn.querySelector(".memory-audio-label");
        if (lbl) {
          lbl.textContent = soundtrack.isMuted()
            ? tStage("Đang tắt nhạc", "Muted")
            : trackLabel;
        }
      }

      var reelScrubber = document.getElementById("memory-reel-scrubber");
      var reelScrubberFill = document.getElementById("memory-reel-scrubber-fill");
      var uiIdleTimer = null;

      function wakeReelChrome() {
        if (!reelDlg) return;
        reelDlg.classList.remove("is-ui-idle");
        if (uiIdleTimer) {
          clearTimeout(uiIdleTimer);
          uiIdleTimer = null;
        }
        if (reelDlg.open && !reelPaused) {
          uiIdleTimer = setTimeout(function () {
            if (reelDlg.open && !reelPaused) {
              reelDlg.classList.add("is-ui-idle");
            }
          }, 2600);
        }
      }

      function clearReelTimer() {
        if (reelTimer) {
          clearTimeout(reelTimer);
          reelTimer = null;
        }
      }

      function stopReelVideo() {
        if (!reelVideo) return;
        try {
          reelVideo.pause();
        } catch (_e) {}
        reelVideo.onended = null;
        reelVideo.removeAttribute("src");
        reelVideo.hidden = true;
      }

      function updateProgressBars(idx, durationMs) {
        var total = Math.max(1, reelSlides.length);
        var startRatio = idx / total;
        var endRatio = (idx + 1) / total;
        if (reelScrubber) {
          reelScrubber.setAttribute("aria-valuenow", String(Math.round(endRatio * 100)));
        }
        if (reelScrubberFill) {
          reelScrubberFill.style.transition = "none";
          reelScrubberFill.style.transform = "scaleX(" + startRatio.toFixed(4) + ")";
          if (!reelPaused) {
            void reelScrubberFill.offsetWidth;
            reelScrubberFill.style.transition = "transform " + durationMs + "ms linear";
            reelScrubberFill.style.transform = "scaleX(" + endRatio.toFixed(4) + ")";
          }
        }
      }

      if (reelScrubber) {
        reelScrubber.addEventListener("click", function (e) {
          var rect = reelScrubber.getBoundingClientRect();
          if (!rect.width) return;
          var pct = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
          var targetIdx = Math.floor(pct * reelSlides.length);
          wakeReelChrome();
          showReelSlide(targetIdx);
        });
      }

      function showReelSlide(idx) {
        clearReelTimer();
        stopReelVideo();
        var total = reelSlides.length;
        reelIdx = ((idx % total) + total) % total;
        var slide = reelSlides[reelIdx];
        var pad = function (n) {
          return n < 10 ? "0" + n : String(n);
        };

        if (reelCaption) reelCaption.textContent = slide.caption || slide.alt || "";
        if (reelCounter) reelCounter.textContent = pad(reelIdx + 1) + " / " + pad(total);

        if (slide.type === "video" && reelVideo) {
          reelImg.hidden = true;
          reelVideo.hidden = false;
          reelVideo.src = slide.src;
          reelVideo.currentTime = 0;
          updateProgressBars(reelIdx, 8000);
          if (!reelPaused) {
            reelVideo.play().catch(function () {});
          }
          reelVideo.onended = function () {
            if (!reelPaused && reelDlg.open) showReelSlide(reelIdx + 1);
          };
        } else {
          reelImg.hidden = false;
          reelImg.classList.remove("kb-zoom-in", "kb-pan-right", "kb-pan-left", "is-paused");
          reelImg.src = slide.src;
          reelImg.alt = slide.alt || "";
          if (!reduced) {
            void reelImg.offsetWidth;
            reelImg.classList.add(kbClasses[reelIdx % kbClasses.length]);
            if (reelPaused) reelImg.classList.add("is-paused");
          }
          updateProgressBars(reelIdx, REEL_DURATION_MS);
          if (!reelPaused) {
            reelTimer = setTimeout(function () {
              if (reelDlg.open && !reelPaused) showReelSlide(reelIdx + 1);
            }, REEL_DURATION_MS);
          }
        }
      }

      function setReelPaused(nextPaused) {
        reelPaused = Boolean(nextPaused);
        if (reelToggleBtn) {
          reelToggleBtn.innerHTML = reelPaused ? PLAY_SVG : PAUSE_SVG;
          reelToggleBtn.setAttribute(
            "aria-label",
            reelPaused ? tStage("Tiếp tục thước phim", "Resume memory reel") : tStage("Tạm dừng thước phim", "Pause memory reel")
          );
        }
        reelImg.classList.toggle("is-paused", reelPaused);
        if (reelVideo && !reelVideo.hidden) {
          if (reelPaused) reelVideo.pause();
          else reelVideo.play().catch(function () {});
        }
        if (reelPaused) {
          clearReelTimer();
          soundtrack.pause();
        } else {
          soundtrack.start();
          showReelSlide(reelIdx);
        }
        syncAudioUi();
        wakeReelChrome();
      }

      var reelExpandBtn = document.getElementById("memory-reel-expand");
      var reelViewport = document.getElementById("memory-reel-viewport");
      var reelRefTrack = document.getElementById("memory-reel-ref-track");
      var reelRefCount = document.getElementById("memory-reel-ref-count");
      var reelRefDots = document.getElementById("memory-reel-ref-dots");
      var reelWriteBtn = document.getElementById("memory-reel-write-btn");

      function setReelSplitMode(enabled) {
        var on = Boolean(enabled);
        reelDlg.classList.toggle("is-split-mode", on);
        if (reelExpandBtn) {
          reelExpandBtn.classList.toggle("is-active", on);
          reelExpandBtn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        if (on) {
          reelDlg.classList.remove("is-ui-idle");
        } else {
          wakeReelChrome();
        }
      }

      function populateReelReflections() {
        if (!reelRefTrack) return;
        var sourceCards = gbListEl
          ? Array.prototype.slice.call(gbListEl.querySelectorAll(".gb-card"))
          : [];
        reelRefTrack.innerHTML = "";
        if (reelRefDots) reelRefDots.innerHTML = "";

        if (reelRefCount) {
          reelRefCount.textContent = sourceCards.length
            ? isEnStage
              ? sourceCards.length + (sourceCards.length === 1 ? " note" : " notes")
              : sourceCards.length + " chia sẻ"
            : "";
        }

        if (!sourceCards.length) {
          var empty = document.createElement("div");
          empty.className = "apple-reel-ref-empty";
          empty.textContent = tStage(
            "Chưa có hương khí nào — hãy viết đôi dòng đọng lại sau buổi gặp nhé.",
            "No reflections yet — share the first note from this gathering."
          );
          reelRefTrack.appendChild(empty);
          return;
        }

        sourceCards.forEach(function (srcCard, idx) {
          var info = readCardSummary(srcCard);
          var refId = srcCard.getAttribute("data-reflection-id") || "";
          var card = document.createElement("article");
          card.className = "apple-reel-ref-card";
          card.setAttribute("data-reel-ref-idx", String(idx));

          if (info.quote) {
            var q = document.createElement("p");
            q.className = "apple-reel-ref-quote";
            q.textContent = info.quote;
            card.appendChild(q);
          }

          var body = document.createElement("p");
          body.className = "apple-reel-ref-body";
          body.textContent = info.body;
          card.appendChild(body);

          var foot = document.createElement("div");
          foot.className = "apple-reel-ref-foot";

          var authWrap = document.createElement("div");
          authWrap.className = "apple-reel-ref-author";

          var av = document.createElement("span");
          av.className = "apple-reel-ref-av";
          av.setAttribute("aria-hidden", "true");
          if (info.avatarSrc) {
            var im = document.createElement("img");
            im.src = info.avatarSrc;
            im.alt = "";
            av.appendChild(im);
          } else {
            av.textContent = info.initials;
          }
          authWrap.appendChild(av);

          var txt = document.createElement("div");
          txt.className = "apple-reel-ref-author-txt";
          var nm = document.createElement("strong");
          nm.textContent = info.name;
          txt.appendChild(nm);
          if (info.sub) {
            var sp = document.createElement("span");
            sp.textContent = info.sub;
            txt.appendChild(sp);
          }
          authWrap.appendChild(txt);
          foot.appendChild(authWrap);

          // Mirror live 3-emotion reactions so users can react while watching the reel
          var origReacts = srcCard.querySelectorAll(".gb-react-btn");
          if (origReacts.length) {
            var rWrap = document.createElement("div");
            rWrap.className = "apple-reel-ref-reacts";
            origReacts.forEach(function (origBtn) {
              var rType = origBtn.getAttribute("data-reaction-type") || "";
              var cntEl = origBtn.querySelector(".gb-react-count");
              var cntVal = cntEl && !cntEl.hidden ? cntEl.textContent.trim() : "";
              var iconEl = origBtn.querySelector(".gb-react-icon");
              var pill = document.createElement("button");
              pill.type = "button";
              pill.className = "apple-reel-react-pill" + (origBtn.classList.contains("is-active") ? " is-active" : "");
              pill.setAttribute("data-reel-react-id", refId);
              pill.setAttribute("data-reel-react-type", rType);
              pill.setAttribute("aria-label", origBtn.getAttribute("aria-label") || rType);
              pill.innerHTML = (iconEl ? iconEl.innerHTML : "") + (cntVal ? "<span>" + cntVal + "</span>" : "");
              pill.addEventListener("click", function () {
                origBtn.click();
                setTimeout(function () {
                  // Refresh mirrored reaction counts after toggle
                  var siblings = rWrap.querySelectorAll(".apple-reel-react-pill");
                  origReacts.forEach(function (ob, bi) {
                    var sb = siblings[bi];
                    if (!sb) return;
                    sb.classList.toggle("is-active", ob.classList.contains("is-active"));
                    var oc = ob.querySelector(".gb-react-count");
                    var cv = oc && !oc.hidden ? oc.textContent.trim() : "";
                    var oi = ob.querySelector(".gb-react-icon");
                    sb.innerHTML = (oi ? oi.innerHTML : "") + (cv ? "<span>" + cv + "</span>" : "");
                  });
                }, 80);
              });
              rWrap.appendChild(pill);
            });
            foot.appendChild(rWrap);
          }

          card.appendChild(foot);
          reelRefTrack.appendChild(card);

          if (reelRefDots && sourceCards.length > 1 && idx < 12) {
            var dot = document.createElement("span");
            dot.className = "apple-reel-ref-dot" + (idx === 0 ? " is-active" : "");
            reelRefDots.appendChild(dot);
          }
        });
      }

      if (reelRefTrack && reelRefDots) {
        var refScrollTick = null;
        reelRefTrack.addEventListener(
          "scroll",
          function () {
            if (refScrollTick) return;
            refScrollTick = requestAnimationFrame(function () {
              refScrollTick = null;
              var cards = reelRefTrack.querySelectorAll(".apple-reel-ref-card");
              var dots = reelRefDots.querySelectorAll(".apple-reel-ref-dot");
              if (!cards.length || !dots.length) return;
              var center = reelRefTrack.scrollLeft + reelRefTrack.clientWidth / 2;
              var bestIdx = 0;
              var bestDist = Infinity;
              cards.forEach(function (c, i) {
                var cMid = c.offsetLeft + c.offsetWidth / 2;
                var d = Math.abs(cMid - center);
                if (d < bestDist) {
                  bestDist = d;
                  bestIdx = i;
                }
              });
              var mapped = Math.min(dots.length - 1, bestIdx);
              dots.forEach(function (dot, i) {
                dot.classList.toggle("is-active", i === mapped);
              });
            });
          },
          { passive: true }
        );
      }

      if (reelExpandBtn) {
        reelExpandBtn.addEventListener("click", function () {
          setReelSplitMode(!reelDlg.classList.contains("is-split-mode"));
        });
      }

      if (reelWriteBtn) {
        reelWriteBtn.addEventListener("click", function () {
          closeReel();
          var targetSec = document.getElementById("huong-khi") || document.getElementById("reflections");
          if (targetSec) {
            targetSec.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          setTimeout(function () {
            var ta = document.getElementById("pr-content");
            if (ta && !ta.closest("[hidden]")) {
              try {
                ta.focus({ preventScroll: true });
              } catch (_e) {}
            }
          }, 420);
        });
      }

      function openReel(startIdx) {
        reelPaused = false;
        if (reelToggleBtn) reelToggleBtn.innerHTML = PAUSE_SVG;
        if (sheetDlg && sheetDlg.open) sheetDlg.close();
        populateReelReflections();
        if (!reelDlg.open) reelDlg.showModal();
        // On mobile, open in Split-Theater (movie top + swipeable Hương khí bottom); desktop starts full cinema
        setReelSplitMode(window.innerWidth <= 768);
        soundtrack.start();
        syncAudioUi();
        showReelSlide(startIdx || 0);
        wakeReelChrome();
      }

      function closeReel() {
        clearReelTimer();
        if (uiIdleTimer) {
          clearTimeout(uiIdleTimer);
          uiIdleTimer = null;
        }
        reelDlg.classList.remove("is-ui-idle");
        stopReelVideo();
        soundtrack.stop();
        if (reelDlg.open) reelDlg.close();
      }

      reelDlg.addEventListener("pointermove", wakeReelChrome, { passive: true });
      reelDlg.addEventListener("pointerdown", wakeReelChrome, { passive: true });

      reelBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          openReel(0);
        });
      });
      if (sheetPlayBtn) {
        sheetPlayBtn.addEventListener("click", function () {
          openReel(0);
        });
      }
      if (reelAudioBtn) {
        reelAudioBtn.addEventListener("click", function () {
          soundtrack.setMuted(!soundtrack.isMuted());
          syncAudioUi();
          wakeReelChrome();
        });
      }
      if (reelCloseBtn) reelCloseBtn.addEventListener("click", closeReel);
      if (reelToggleBtn) {
        reelToggleBtn.addEventListener("click", function () {
          setReelPaused(!reelPaused);
        });
      }
      if (reelPrevBtn) {
        reelPrevBtn.addEventListener("click", function () {
          wakeReelChrome();
          showReelSlide(reelIdx - 1);
        });
      }
      if (reelNextBtn) {
        reelNextBtn.addEventListener("click", function () {
          wakeReelChrome();
          showReelSlide(reelIdx + 1);
        });
      }
      reelDlg.addEventListener("close", function () {
        clearReelTimer();
        if (uiIdleTimer) {
          clearTimeout(uiIdleTimer);
          uiIdleTimer = null;
        }
        reelDlg.classList.remove("is-ui-idle");
        stopReelVideo();
        soundtrack.stop();
      });
      reelDlg.addEventListener("keydown", function (e) {
        if (!reelDlg.open) return;
        wakeReelChrome();
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          showReelSlide(reelIdx - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          showReelSlide(reelIdx + 1);
        } else if (e.key === " ") {
          e.preventDefault();
          setReelPaused(!reelPaused);
        } else if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          soundtrack.setMuted(!soundtrack.isMuted());
          syncAudioUi();
        }
      });

      // Scope slide-flip touch swipe strictly to upper theater viewport so bottom Hương khí sheet swipes independently!
      var rTouchX = 0;
      var swipeSurface = reelViewport || reelDlg;
      swipeSurface.addEventListener(
        "touchstart",
        function (e) {
          if (e.touches && e.touches.length) rTouchX = e.touches[0].clientX;
        },
        { passive: true }
      );
      swipeSurface.addEventListener(
        "touchend",
        function (e) {
          if (!e.changedTouches || !e.changedTouches.length) return;
          var dx = e.changedTouches[0].clientX - rTouchX;
          if (Math.abs(dx) > 48) {
            showReelSlide(dx < 0 ? reelIdx + 1 : reelIdx - 1);
          }
        },
        { passive: true }
      );
    }
  })();

  /* =========================================================================
     HERO "BÀN GỖ ĐANG SÁNG ĐÈN" — INTERACTIVE AVATAR-TO-VOICE & REAL HEART
     ========================================================================= */
  (function initHeroVoiceCard() {
    var card = document.querySelector("[data-hero-voice-card]");
    if (!card) return;
    var tabs = Array.prototype.slice.call(card.querySelectorAll("[data-hv-tab]"));
    if (!tabs.length) return;

    var avatarEl = card.querySelector("[data-hv-avatar]");
    var nameEl = card.querySelector("[data-hv-name]");
    var orgEl = card.querySelector("[data-hv-org]");
    var quoteEl = card.querySelector("[data-hv-quote]");
    var linkEl = card.querySelector("[data-hv-link]");
    var sourceEl = card.querySelector("[data-hv-source]");
    var heartBtn = card.querySelector("[data-hv-heart]");
    var heartCountEl = card.querySelector("[data-hv-heart-count]");

    var HEART_KEY = "holarise_hero_hearts_v1";
    var heartedMap = {};
    try {
      heartedMap = JSON.parse(localStorage.getItem(HEART_KEY) || "{}") || {};
    } catch (_e) {
      heartedMap = {};
    }
    var countOverrides = {};
    var currentIdx = 0;
    var timer = null;
    var userPaused = false;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function syncHeartUi(voiceId, baseCount) {
      if (!heartBtn) return;
      if (!voiceId) {
        heartBtn.hidden = true;
        return;
      }
      heartBtn.hidden = false;
      heartBtn.setAttribute("data-voice-id", voiceId);
      var cnt = Object.prototype.hasOwnProperty.call(countOverrides, voiceId)
        ? countOverrides[voiceId]
        : Number(baseCount || 0);
      if (heartCountEl) heartCountEl.textContent = String(Math.max(0, cnt));
      var hearted = Boolean(heartedMap[voiceId]);
      heartBtn.classList.toggle("is-hearted", hearted);
      heartBtn.setAttribute("aria-pressed", hearted ? "true" : "false");
    }

    function applyTab(idx, animate) {
      var safeIdx = ((idx % tabs.length) + tabs.length) % tabs.length;
      currentIdx = safeIdx;
      var btn = tabs[safeIdx];
      tabs.forEach(function (tBtn, i) {
        var active = i === safeIdx;
        tBtn.classList.toggle("is-active", active);
        tBtn.setAttribute("aria-selected", active ? "true" : "false");
      });

      var paint = function () {
        var vId = btn.getAttribute("data-voice-id") || "";
        var vName = btn.getAttribute("data-voice-name") || "";
        var vOrg = btn.getAttribute("data-voice-org") || "";
        var vQuote = btn.getAttribute("data-voice-quote") || "";
        var vAvatar = btn.getAttribute("data-voice-avatar") || "";
        var vInitials = btn.getAttribute("data-voice-initials") || "HR";
        var vHearts = btn.getAttribute("data-voice-hearts") || "0";
        var vHref = btn.getAttribute("data-voice-href") || "/hanh-trinh/";
        var vSource = btn.getAttribute("data-voice-source") || "";

        if (avatarEl) {
          avatarEl.textContent = "";
          if (vAvatar) {
            var img = document.createElement("img");
            img.src = vAvatar;
            img.alt = "";
            img.width = 36;
            img.height = 36;
            img.loading = "lazy";
            img.decoding = "async";
            avatarEl.classList.add("hero-voice-avatar--photo");
            avatarEl.appendChild(img);
          } else {
            avatarEl.classList.remove("hero-voice-avatar--photo");
            avatarEl.textContent = vInitials;
          }
        }
        if (nameEl) nameEl.textContent = vName;
        if (orgEl) orgEl.textContent = vOrg;
        if (quoteEl) quoteEl.textContent = "\u201c" + vQuote + "\u201d";
        if (linkEl) linkEl.setAttribute("href", vHref);
        if (sourceEl) sourceEl.textContent = vSource;
        syncHeartUi(vId, vHearts);
      };

      if (animate && !reduceMotion) {
        card.classList.add("is-switching");
        setTimeout(function () {
          paint();
          card.classList.remove("is-switching");
        }, 160);
      } else {
        paint();
      }
    }

    function stopAuto() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function startAuto() {
      stopAuto();
      if (tabs.length < 2 || reduceMotion || userPaused || document.hidden) return;
      timer = setInterval(function () {
        applyTab(currentIdx + 1, true);
      }, 8000);
    }

    tabs.forEach(function (tBtn, i) {
      tBtn.addEventListener("click", function () {
        userPaused = true;
        stopAuto();
        applyTab(i, true);
      });
    });

    card.addEventListener("mouseenter", stopAuto);
    card.addEventListener("mouseleave", startAuto);
    card.addEventListener("focusin", stopAuto);
    card.addEventListener("focusout", startAuto);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopAuto();
      else startAuto();
    });

    var touchStartX = 0;
    card.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches && e.touches.length) touchStartX = e.touches[0].clientX;
      },
      { passive: true }
    );
    card.addEventListener(
      "touchend",
      function (e) {
        if (tabs.length < 2 || !e.changedTouches || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 36) {
          userPaused = true;
          stopAuto();
          applyTab(dx < 0 ? currentIdx + 1 : currentIdx - 1, true);
        }
      },
      { passive: true }
    );

    if (heartBtn) {
      heartBtn.addEventListener("click", function () {
        var vId = heartBtn.getAttribute("data-voice-id") || "";
        if (!vId || heartBtn.disabled) return;
        userPaused = true;
        stopAuto();
        heartBtn.disabled = true;

        var prevCnt = Number(heartCountEl ? heartCountEl.textContent : 0) || 0;
        var wasHearted = Boolean(heartedMap[vId]);
        var optimistic = wasHearted ? Math.max(0, prevCnt - 1) : prevCnt + 1;
        heartedMap[vId] = !wasHearted;
        countOverrides[vId] = optimistic;
        syncHeartUi(vId, optimistic);

        fetch("/api/reflections/" + encodeURIComponent(vId) + "/heart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction: "heart" }),
        })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (data) {
            if (data && data.ok) {
              var finalCnt = Number(data.heartCount);
              if (!isNaN(finalCnt)) countOverrides[vId] = finalCnt;
              heartedMap[vId] = Boolean(data.hearted);
              try {
                localStorage.setItem(HEART_KEY, JSON.stringify(heartedMap));
              } catch (_e) {}
              syncHeartUi(vId, countOverrides[vId]);
            }
          })
          .catch(function () {})
          .finally(function () {
            heartBtn.disabled = false;
          });
      });
    }

    syncHeartUi(tabs[0].getAttribute("data-voice-id") || "", tabs[0].getAttribute("data-voice-hearts") || "0");
    startAuto();
  })();

  // Lazy-load Event Companion Chat Drawer ONLY when user clicks [data-open-event-chat]
  (function initLazyEventChatTrigger() {
    var loadingPromise = null;
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-open-event-chat]") : null;
      if (!btn) return;
      e.preventDefault();
      if (typeof window.__holariseOpenEventChat === "function") {
        window.__holariseOpenEventChat(btn);
        return;
      }
      if (!loadingPromise) {
        loadingPromise = new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = "/assets/js/event-chat.js";
          s.defer = true;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      loadingPromise
        .then(function () {
          if (typeof window.__holariseOpenEventChat === "function") {
            window.__holariseOpenEventChat(btn);
          }
        })
        .catch(function () {
          loadingPromise = null;
        });
    });
  })();
})();
