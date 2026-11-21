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
    window.addEventListener("scroll", onScroll, { passive: true });
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

    var applyFilter = function (activeBtn) {
      var filter = activeBtn.getAttribute("data-filter");
      buttons.forEach(function (b) {
        b.classList.toggle("is-active", b === activeBtn);
        b.setAttribute("aria-pressed", String(b === activeBtn));
      });
      cards.forEach(function (card) {
        var tokens = (card.getAttribute("data-category") || "").trim().split(/\s+/);
        var match = filter === "all" || tokens.indexOf(filter) !== -1;
        card.style.display = match ? "" : "none";
      });
      if (window.ScrollTrigger) {
        window.ScrollTrigger.refresh();
      }
    };

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyFilter(btn);
      });
    });

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

  function pauseSmoothScroll() {
    if (window.__lacXanhLenis) window.__lacXanhLenis.stop();
  }

  function resumeSmoothScroll() {
    if (window.__lacXanhLenis) window.__lacXanhLenis.start();
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    dialog.removeAttribute("data-closing");
    dialog.showModal();
    pauseSmoothScroll();
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
      resumeSmoothScroll();
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

  /* 5. Lightbox Trigger */
  var lightbox = document.getElementById("gallery-lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxCaption = document.getElementById("lightbox-caption");

  if (lightbox && lightboxImg && lightboxCaption) {
    document.querySelectorAll("[data-lightbox-src]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        lightboxImg.src = btn.getAttribute("data-lightbox-src");
        lightboxImg.alt = btn.getAttribute("data-lightbox-alt") || "";
        lightboxCaption.textContent = btn.getAttribute("data-lightbox-caption") || "";
        openDialog(lightbox);
      });
    });
  }

  /* 6. Quick Event Registration Dialog Trigger */
  var eventModal = document.getElementById("event-register-modal");
  var eventTitleDisplay = document.getElementById("modal-event-title");
  var eventInputHidden = document.getElementById("modal-event-input");
  var eventIdHidden = document.getElementById("modal-event-id");

  if (eventModal) {
    document.querySelectorAll("[data-register-event]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var title = btn.getAttribute("data-register-event") || "Hoạt động cộng đồng HolaRise";
        var eventId = btn.getAttribute("data-event-id") || "";
        if (eventTitleDisplay) eventTitleDisplay.textContent = title;
        if (eventInputHidden) eventInputHidden.value = title;
        if (eventIdHidden) eventIdHidden.value = eventId;
        var statusEl = eventModal.querySelector(".form-status");
        if (statusEl) {
          statusEl.className = "form-status";
          statusEl.textContent = "";
        }
        openDialog(eventModal);
      });
    });
  }

  /* 7. Registration & Contact Form Submission + Local Offline Drafts */
  var DRAFT_FIELDS = ["fullName", "phone", "email", "role", "organization", "note"];

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
        var el = form.querySelector('[name="' + name + '"]');
        if (!el) return;
        var val = (el.value || "").trim();
        data[name] = el.value || "";
        if (val && name !== "role") hasValue = true;
      });
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
        var el = form.querySelector('[name="' + name + '"]');
        if (el && typeof existingDraft[name] === "string" && existingDraft[name]) {
          el.value = existingDraft[name];
          if (name !== "role") restoredAny = true;
        }
      });
      if (restoredAny && statusEl && !statusEl.textContent) {
        statusEl.className = "form-status is-draft";
        statusEl.textContent = "Đã khôi phục bản nháp bạn nhập gần đây.";
      }
    }

    var scheduleDraftSave = function () {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveDraft(draftKey, form);
      }, 250);
    };
    form.addEventListener("input", scheduleDraftSave);
    form.addEventListener("change", scheduleDraftSave);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var submitBtn = form.querySelector('button[type="submit"]');
      var endpoint = form.getAttribute("data-endpoint") || "/api/registrations";

      var nameEl = form.querySelector('[name="fullName"]');
      var phoneEl = form.querySelector('[name="phone"]') || form.querySelector('[name="contact"]');
      var emailEl = form.querySelector('[name="email"]');

      var nameVal = ((nameEl || {}).value || "").trim();
      var phoneVal = ((phoneEl || {}).value || "").trim();
      var emailVal = ((emailEl || {}).value || "").trim();

      [nameEl, phoneEl, emailEl].forEach(function (el) {
        if (el) el.setAttribute("aria-invalid", "false");
      });

      if (nameVal.length < 2) {
        if (nameEl) {
          nameEl.setAttribute("aria-invalid", "true");
          nameEl.focus();
        }
        if (statusEl) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = "Vui lòng nhập họ và tên đầy đủ (tối thiểu 2 ký tự).";
        }
        return;
      }

      var phoneDigits = phoneVal.replace(/\D/g, "").length;
      if (phoneDigits < 8) {
        if (phoneEl) {
          phoneEl.setAttribute("aria-invalid", "true");
          phoneEl.focus();
        }
        if (statusEl) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = "Vui lòng nhập số điện thoại / Zalo hợp lệ (ít nhất 8 chữ số) để Ban Điều Phối liên hệ.";
        }
        return;
      }

      if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal)) {
        if (emailEl) {
          emailEl.setAttribute("aria-invalid", "true");
          emailEl.focus();
        }
        if (statusEl) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = "Email chưa đúng định dạng (ví dụ: tenban@gmail.com). Bạn có thể sửa lại hoặc để trống.";
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
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = "Đang gửi thông tin...";
      }

      var payload = {};
      new FormData(form).forEach(function (value, key) {
        payload[key] = value;
      });
      payload.submittedAt = new Date().toISOString();

      var resetBtn = function () {
        if (submitBtn) {
          submitBtn.disabled = false;
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
                "! Ban Điều Phối HolaRise đã nhận được đăng ký và sẽ liên hệ với bạn trong vòng 24 giờ.";
          }
          var preservedActivity = (form.querySelector('[name="activity"]') || {}).value || "";
          var preservedEventId = (form.querySelector('[name="eventId"]') || {}).value || "";
          form.reset();
          var actInput = form.querySelector('[name="activity"]');
          var evIdInput = form.querySelector('[name="eventId"]');
          if (actInput && preservedActivity) actInput.value = preservedActivity;
          if (evIdInput && preservedEventId) evIdInput.value = preservedEventId;
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
