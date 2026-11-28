/**
 * HolaRise PWA Runtime
 * - Progressive install UX following modern-web-guidance (install-web-app):
 *   navigator.install() -> beforeinstallprompt -> maintained iOS Safari / Zalo-FB WebView guides
 * - Delayed non-blocking floating install banner (Chrome/Edge/Safari only; hidden in Zalo/FB WebViews & standalone)
 * - Standalone display-mode class sync (including iOS navigator.standalone)
 * - Legacy Service Worker cleanup (no heavy precache per AGENTS.md)
 */
(function () {
  "use strict";

  var BANNER_DISMISS_KEY = "holarise_pwa_banner_dismissed_at";
  var BANNER_DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
  var BANNER_DELAY_MS = 10000; // 10s for visitors who do not scroll
  var BANNER_SCROLL_RATIO = 0.2;
  var BANNER_SCROLL_MIN_PX = 260;

  var htmlEl = document.documentElement;
  var isEn = (htmlEl && (htmlEl.lang === "en" || htmlEl.getAttribute("data-lang") === "en"));
  function t(vi, en) { return isEn ? en : vi; }
  var installButtons = Array.prototype.slice.call(document.querySelectorAll("[data-pwa-install]"));
  var installStatus = document.getElementById("pwa-install-status");
  var installDialog = document.getElementById("pwa-install-dialog");
  var guideIos = installDialog ? installDialog.querySelector('[data-pwa-guide="ios"]') : null;
  var guideWebview = installDialog ? installDialog.querySelector('[data-pwa-guide="webview"]') : null;
  var copyUrlBtn = installDialog ? installDialog.querySelector("[data-pwa-copy-url]") : null;
  var copyFeedback = installDialog ? installDialog.querySelector("[data-pwa-copy-feedback]") : null;

  var installBanner = document.getElementById("pwa-install-banner");
  var bannerDismissBtn = installBanner ? installBanner.querySelector("[data-pwa-banner-dismiss]") : null;

  var ua = navigator.userAgent || "";
  var pathname = (window.location && window.location.pathname) || "/";
  var standaloneMq = window.matchMedia ? window.matchMedia("(display-mode: standalone)") : null;
  var isInAppBrowser = /Zalo|FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|MicroMessenger|BytedanceWebview|TikTok/i.test(ua);
  var isIos =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1);
  var isExcludedBannerRoute = /^\/(en|admin|media|offline)(\/|$)/i.test(pathname);
  var appName = (document.body && document.body.getAttribute("data-pwa-app-name")) || "HolaRise";
  var supportsWebInstall = typeof Navigator !== "undefined" && typeof Navigator.prototype.install === "function";

  var deferredInstallPrompt;
  var bannerTriggered = false;
  var bannerDismissedInSession = false;
  var bannerTimerId = null;
  var standaloneZoomLocked = false;

  function lockStandaloneZoom() {
    if (standaloneZoomLocked) return;
    standaloneZoomLocked = true;

    var vp = document.querySelector('meta[name="viewport"]');
    if (vp) {
      vp.setAttribute(
        "content",
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
      );
    }

    var preventZoom = function (event) {
      event.preventDefault();
    };
    document.addEventListener("gesturestart", preventZoom, { passive: false });
    document.addEventListener("gesturechange", preventZoom, { passive: false });
    document.addEventListener("gestureend", preventZoom, { passive: false });
    document.addEventListener(
      "touchmove",
      function (event) {
        if (event.touches && event.touches.length > 1) {
          event.preventDefault();
        }
      },
      { passive: false }
    );
  }

  function isStandaloneMode() {
    return Boolean((standaloneMq && standaloneMq.matches) || window.navigator.standalone === true);
  }

  function isBannerDismissed() {
    if (bannerDismissedInSession) return true;
    try {
      var raw = window.localStorage.getItem(BANNER_DISMISS_KEY);
      if (!raw) return false;
      var ts = parseInt(raw, 10);
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts < BANNER_DISMISS_TTL_MS;
    } catch (_e) {
      return false;
    }
  }

  function markBannerDismissed() {
    bannerDismissedInSession = true;
    try {
      window.localStorage.setItem(BANNER_DISMISS_KEY, String(Date.now()));
    } catch (_e) {}
  }

  function setStatus(message) {
    if (installStatus) {
      installStatus.textContent = message;
    }
  }

  function canOfferInstall() {
    if (isStandaloneMode()) return false;
    return supportsWebInstall || Boolean(deferredInstallPrompt) || isInAppBrowser || isIos;
  }

  function canShowFloatingBanner() {
    if (!installBanner) return false;
    if (!bannerTriggered) return false;
    if (isStandaloneMode() || isInAppBrowser || isExcludedBannerRoute) return false;
    if (isBannerDismissed()) return false;
    return supportsWebInstall || Boolean(deferredInstallPrompt) || isIos;
  }

  function hideFloatingBanner() {
    if (!installBanner) return;
    installBanner.classList.remove("is-visible");
    installBanner.hidden = true;
  }

  function syncInstallBanner() {
    if (!installBanner) return;
    if (!canShowFloatingBanner()) {
      hideFloatingBanner();
      return;
    }
    if (installBanner.hidden) {
      installBanner.hidden = false;
      window.requestAnimationFrame(function () {
        installBanner.classList.add("is-visible");
      });
    }
  }

  function syncInstallButtons() {
    var show = canOfferInstall();
    installButtons.forEach(function (btn) {
      if (btn.classList.contains("pwa-banner-install-btn")) return;
      btn.hidden = !show;
      if (btn.classList.contains("pwa-install-footer-btn")) {
        var li = btn.closest("li");
        if (li) li.hidden = !show;
      }
    });
    syncInstallBanner();
  }

  function syncStandaloneClass() {
    var standalone = isStandaloneMode();
    htmlEl.classList.toggle("is-standalone", standalone);
    if (standalone) {
      lockStandaloneZoom();
    }
    syncInstallButtons();
  }

  function openInstallGuide(mode) {
    if (!installDialog) return;
    if (guideIos) guideIos.hidden = mode !== "ios";
    if (guideWebview) guideWebview.hidden = mode !== "webview";
    installDialog.setAttribute(
      "aria-labelledby",
      mode === "webview" ? "pwa-dialog-title-webview" : "pwa-dialog-title-ios"
    );
    if (copyFeedback) copyFeedback.textContent = "";
    if (typeof window.__holaRiseOpenDialog === "function") {
      window.__holaRiseOpenDialog(installDialog);
    } else if (typeof installDialog.showModal === "function" && !installDialog.open) {
      installDialog.showModal();
    }
  }

  /* 1. Standalone detection sync */
  syncStandaloneClass();
  if (standaloneMq) {
    if (typeof standaloneMq.addEventListener === "function") {
      standaloneMq.addEventListener("change", syncStandaloneClass);
    } else if (typeof standaloneMq.addListener === "function") {
      standaloneMq.addListener(syncStandaloneClass);
    }
  }

  /* 2. Capture beforeinstallprompt fallback */
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!supportsWebInstall) {
      syncInstallButtons();
    }
  });

  window.addEventListener("appinstalled", function () {
    deferredInstallPrompt = undefined;
    hideFloatingBanner();
    setStatus(t("Ứng dụng " + appName + " đã được cài đặt về thiết bị.", appName + " has been installed on your device."));
    syncInstallButtons();
  });

  /* 3. Delayed floating banner trigger (10s timer OR 20% scroll) */
  function triggerBannerEligibility() {
    if (bannerTriggered) return;
    bannerTriggered = true;
    if (bannerTimerId) {
      window.clearTimeout(bannerTimerId);
      bannerTimerId = null;
    }
    window.removeEventListener("scroll", onBannerScroll);
    syncInstallBanner();
  }

  function onBannerScroll() {
    var docEl = document.documentElement;
    var scrollTop = window.scrollY || docEl.scrollTop || 0;
    var maxScroll = Math.max(0, (docEl.scrollHeight || 0) - window.innerHeight);
    if (scrollTop >= BANNER_SCROLL_MIN_PX || (maxScroll > 0 && scrollTop / maxScroll >= BANNER_SCROLL_RATIO)) {
      triggerBannerEligibility();
    }
  }

  if (installBanner && !isStandaloneMode() && !isInAppBrowser && !isExcludedBannerRoute && !isBannerDismissed()) {
    bannerTimerId = window.setTimeout(triggerBannerEligibility, BANNER_DELAY_MS);
    window.addEventListener("scroll", onBannerScroll, { passive: true });
  }

  if (bannerDismissBtn) {
    bannerDismissBtn.addEventListener("click", function () {
      markBannerDismissed();
      hideFloatingBanner();
      setStatus(t("Đã ẩn gợi ý cài đặt ứng dụng.", "Install prompt dismissed."));
    });
  }

  /* 4. Install button click handler (strict transient user activation + aria-disabled) */
  installButtons.forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (btn.getAttribute("aria-disabled") === "true") return;

      if (typeof window.__holaRiseCloseDrawer === "function") {
        window.__holaRiseCloseDrawer();
      }
      var parentDetails = btn.closest("details");
      if (parentDetails) {
        parentDetails.removeAttribute("open");
      }

      if (isInAppBrowser) {
        openInstallGuide("webview");
        return;
      }

      // Use aria-disabled instead of disabled so activating the button does not drop focus.
      btn.setAttribute("aria-disabled", "true");
      try {
        if (supportsWebInstall) {
          // Call directly during the click handler to preserve transient user activation.
          await navigator.install();
          hideFloatingBanner();
          setStatus(t("Ứng dụng " + appName + " đã được cài đặt hoặc mở.", appName + " was installed or opened."));
          installButtons.forEach(function (b) {
            if (!b.classList.contains("pwa-banner-install-btn")) {
              b.hidden = true;
            }
          });
        } else if (deferredInstallPrompt) {
          // Save and clear the single-use event before awaiting the user's choice.
          var promptEvent = deferredInstallPrompt;
          deferredInstallPrompt = undefined;
          await promptEvent.prompt();
          var choice = await promptEvent.userChoice;
          if (choice && choice.outcome === "accepted") {
            hideFloatingBanner();
            setStatus(t("Ứng dụng " + appName + " đang được cài đặt.", "Installing " + appName + "..."));
          } else {
            setStatus(t("Bạn đã hủy cài đặt ứng dụng.", "App installation cancelled."));
          }
          if (!deferredInstallPrompt) {
            syncInstallButtons();
          }
        } else if (isIos) {
          openInstallGuide("ios");
        }
      } catch (error) {
        if (error && error.name === "AbortError") {
          setStatus(t("Việc cài đặt đã bị hủy hoặc chưa thể hoàn tất.", "Installation was cancelled or could not be completed."));
        } else {
          setStatus(t("Không thể khởi chạy cài đặt tự động lúc này.", "Could not launch automatic installation right now."));
          console.error(error);
          if (isIos) {
            openInstallGuide("ios");
          }
        }
        if (!supportsWebInstall) {
          syncInstallButtons();
        }
      } finally {
        btn.removeAttribute("aria-disabled");
      }
    });
  });

  /* 5. Copy URL helper inside Zalo/FB WebView guidance modal */
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener("click", function () {
      var host = ((window.location && window.location.hostname) || "").toLowerCase();
      var urlToCopy =
        host === "holarise.pages.dev" || host === "www.holarise.org"
          ? "https://holarise.org" +
            ((window.location && window.location.pathname) || "/") +
            ((window.location && window.location.search) || "") +
            ((window.location && window.location.hash) || "")
          : window.location.href;
      var onCopied = function () {
        if (copyFeedback) {
          copyFeedback.textContent = t(
            "Đã sao chép đường dẫn — bạn hãy dán vào Safari hoặc Chrome.",
            "Link copied — paste it into Safari or Chrome."
          );
        }
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(urlToCopy).then(onCopied, function () {
          fallbackCopy(urlToCopy, onCopied);
        });
      } else {
        fallbackCopy(urlToCopy, onCopied);
      }
    });
  }

  function fallbackCopy(text, onDone) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      onDone();
    } catch (_e) {
      if (copyFeedback) {
        copyFeedback.textContent = t("Hãy sao chép địa chỉ từ thanh trình duyệt: ", "Please copy this address from your browser bar: ") + text;
      }
    }
  }

  /* 6. Offline page recovery */
  function syncOnlineState() {
    var offline = typeof navigator.onLine === "boolean" && !navigator.onLine;
    htmlEl.classList.toggle("is-offline", offline);
  }

  window.addEventListener("online", function () {
    syncOnlineState();
    if (document.body && document.body.classList.contains("is-offline-page")) {
      if (window.location.pathname === "/offline/" || window.location.pathname === "/offline/index.html") {
        window.location.replace("/");
      } else {
        window.location.reload();
      }
    }
  });
  window.addEventListener("offline", syncOnlineState);
  syncOnlineState();

  document.querySelectorAll("[data-offline-retry]").forEach(function (retryBtn) {
    retryBtn.addEventListener("click", function () {
      if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
        retryBtn.textContent = t("Vẫn chưa có mạng — thử lại", "Still offline — try again");
        setTimeout(function () {
          retryBtn.textContent = t("Thử kết nối lại", "Try reconnecting");
        }, 2000);
        return;
      }
      window.location.reload();
    });
  });

  /* 7. Unregister legacy Service Workers & clear stale caches to prevent stuck outdated pages */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .getRegistrations()
        .then(function (registrations) {
          registrations.forEach(function (reg) {
            reg.unregister().catch(function () {});
          });
        })
        .catch(function () {});
      if ("caches" in window) {
        window.caches
          .keys()
          .then(function (keys) {
            keys.forEach(function (key) {
              window.caches.delete(key).catch(function () {});
            });
          })
          .catch(function () {});
      }
    });
  }
})();
