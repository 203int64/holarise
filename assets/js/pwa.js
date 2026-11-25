/**
 * HolaRise PWA Runtime
 * - Progressive install UX following modern-web-guidance (install-web-app):
 *   navigator.install() -> beforeinstallprompt -> maintained iOS Safari / Zalo-FB WebView guides
 * - Service Worker lifecycle & non-disruptive Update Toast (SKIP_WAITING)
 * - Offline status indicator & /offline/ recovery
 * - Standalone display-mode class sync (including iOS navigator.standalone)
 */
(function () {
  "use strict";

  var htmlEl = document.documentElement;
  var installButtons = Array.prototype.slice.call(document.querySelectorAll("[data-pwa-install]"));
  var installStatus = document.getElementById("pwa-install-status");
  var installDialog = document.getElementById("pwa-install-dialog");
  var guideIos = installDialog ? installDialog.querySelector('[data-pwa-guide="ios"]') : null;
  var guideWebview = installDialog ? installDialog.querySelector('[data-pwa-guide="webview"]') : null;
  var copyUrlBtn = installDialog ? installDialog.querySelector("[data-pwa-copy-url]") : null;
  var copyFeedback = installDialog ? installDialog.querySelector("[data-pwa-copy-feedback]") : null;

  var updateToast = document.getElementById("pwa-update-toast");
  var updateApplyBtn = document.querySelector("[data-pwa-update-apply]");
  var updateDismissBtn = document.querySelector("[data-pwa-update-dismiss]");
  var offlineBar = document.getElementById("pwa-offline-bar");

  var ua = navigator.userAgent || "";
  var standaloneMq = window.matchMedia ? window.matchMedia("(display-mode: standalone)") : null;
  var isInAppBrowser = /Zalo|FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|MicroMessenger|BytedanceWebview|TikTok/i.test(ua);
  var isIos =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1);
  var supportsWebInstall = typeof Navigator !== "undefined" && typeof Navigator.prototype.install === "function";

  var deferredInstallPrompt;
  var waitingWorker = null;
  var isReloadingForSw = false;
  var lastSwUpdateCheck = 0;

  function isStandaloneMode() {
    return Boolean((standaloneMq && standaloneMq.matches) || window.navigator.standalone === true);
  }

  function setStatus(message) {
    if (installStatus) {
      installStatus.textContent = message;
    }
  }

  function syncStandaloneClass() {
    var standalone = isStandaloneMode();
    htmlEl.classList.toggle("is-standalone", standalone);
    syncInstallButtons();
  }

  function canOfferInstall() {
    if (isStandaloneMode()) return false;
    return supportsWebInstall || Boolean(deferredInstallPrompt) || isInAppBrowser || isIos;
  }

  function syncInstallButtons() {
    var show = canOfferInstall();
    installButtons.forEach(function (btn) {
      btn.hidden = !show;
      if (btn.classList.contains("pwa-install-footer-btn")) {
        var li = btn.closest("li");
        if (li) li.hidden = !show;
      }
    });
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
    setStatus("Ứng dụng HolaRise đã được cài đặt về thiết bị.");
    syncInstallButtons();
  });

  /* 3. Install button click handler (strict transient user activation + aria-disabled) */
  installButtons.forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (btn.getAttribute("aria-disabled") === "true") return;

      if (typeof window.__holaRiseCloseDrawer === "function") {
        window.__holaRiseCloseDrawer();
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
          setStatus("Ứng dụng HolaRise đã được cài đặt hoặc mở.");
          installButtons.forEach(function (b) {
            b.hidden = true;
          });
        } else if (deferredInstallPrompt) {
          // Save and clear the single-use event before awaiting the user's choice.
          var promptEvent = deferredInstallPrompt;
          deferredInstallPrompt = undefined;
          await promptEvent.prompt();
          var choice = await promptEvent.userChoice;
          setStatus(
            choice && choice.outcome === "accepted"
              ? "Ứng dụng HolaRise đang được cài đặt."
              : "Bạn đã hủy cài đặt ứng dụng."
          );
          if (!deferredInstallPrompt) {
            syncInstallButtons();
          }
        } else if (isIos) {
          openInstallGuide("ios");
        }
      } catch (error) {
        if (error && error.name === "AbortError") {
          setStatus("Việc cài đặt đã bị hủy hoặc chưa thể hoàn tất.");
        } else {
          setStatus("Không thể khởi chạy cài đặt tự động lúc này.");
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

  /* 4. Copy URL helper inside Zalo/FB WebView guidance modal */
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener("click", function () {
      var urlToCopy = window.location.href;
      var onCopied = function () {
        if (copyFeedback) {
          copyFeedback.textContent = "Đã sao chép đường dẫn — bạn hãy dán vào Safari hoặc Chrome nhé.";
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
        copyFeedback.textContent = "Hãy sao chép địa chỉ từ thanh trình duyệt: " + text;
      }
    }
  }

  /* 5. Offline status bar & /offline/ retry recovery */
  function syncOnlineState() {
    var offline = typeof navigator.onLine === "boolean" && !navigator.onLine;
    if (offlineBar) {
      offlineBar.hidden = !offline;
    }
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
        retryBtn.textContent = "Vẫn chưa có mạng — thử lại";
        setTimeout(function () {
          retryBtn.textContent = "Thử kết nối lại";
        }, 2000);
        return;
      }
      window.location.reload();
    });
  });

  /* 6. Service Worker registration & polite Update Toast */
  function showUpdateToast(worker) {
    if (!worker || !updateToast) return;
    waitingWorker = worker;
    updateToast.hidden = false;
  }

  if (updateApplyBtn) {
    updateApplyBtn.addEventListener("click", function () {
      if (!waitingWorker) return;
      updateApplyBtn.setAttribute("aria-disabled", "true");
      updateApplyBtn.textContent = "Đang cập nhật...";
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    });
  }

  if (updateDismissBtn && updateToast) {
    updateDismissBtn.addEventListener("click", function () {
      updateToast.hidden = true;
    });
  }

  // Unregister legacy Service Workers & clear stale caches to prevent stuck outdated pages
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
