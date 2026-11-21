/**
 * HolaRise – Hòa Lạc | Core UI Interactions
 * Follows modern-web-guidance for native <dialog closedby="any">,
 * top-layer exit animation fallback, Safari backdrop click fallback, and forms.
 */
(function () {
  "use strict";

  /* 1. Sticky / Adaptive Header State */
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 36);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* 2. Mobile Navigation Drawer */
  var navToggle = document.querySelector("[data-nav-toggle]");
  var mainNav = document.querySelector("[data-main-nav]");
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", function () {
      var expanded = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!expanded));
      mainNav.classList.toggle("is-open", !expanded);
    });

    mainNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navToggle.setAttribute("aria-expanded", "false");
        mainNav.classList.remove("is-open");
      });
    });
  }

  /* 3. Category Filters (Activities & News) */
  document.querySelectorAll("[data-filter-group]").forEach(function (group) {
    var buttons = group.querySelectorAll("[data-filter]");
    var targetSelector = group.getAttribute("data-filter-group");
    var cards = document.querySelectorAll(targetSelector);

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var filter = btn.getAttribute("data-filter");
        buttons.forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
          b.setAttribute("aria-pressed", String(b === btn));
        });
        cards.forEach(function (card) {
          var cat = card.getAttribute("data-category");
          var match = filter === "all" || cat === filter;
          card.style.display = match ? "" : "none";
        });
        if (window.ScrollTrigger) {
          window.ScrollTrigger.refresh();
        }
      });
    });
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

  if (eventModal) {
    document.querySelectorAll("[data-register-event]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var title = btn.getAttribute("data-register-event") || "Hoạt động cộng đồng HolaRise";
        if (eventTitleDisplay) eventTitleDisplay.textContent = title;
        if (eventInputHidden) eventInputHidden.value = title;
        var statusEl = eventModal.querySelector(".form-status");
        if (statusEl) {
          statusEl.className = "form-status";
          statusEl.textContent = "";
        }
        openDialog(eventModal);
      });
    });
  }

  /* 7. Registration & Contact Form Submission */
  document.querySelectorAll("[data-club-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = form.querySelector(".form-status");
      var submitBtn = form.querySelector('button[type="submit"]');
      var endpoint = form.getAttribute("data-endpoint") || "";

      var nameVal = (form.querySelector('[name="fullName"]') || {}).value || "";
      var phoneVal = (form.querySelector('[name="contact"]') || {}).value || "";

      if (nameVal.trim().length < 2 || phoneVal.trim().length < 5) {
        if (statusEl) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = "Vui lòng nhập đầy đủ họ tên và số điện thoại/email để Ban Điều Phối liên hệ xác nhận.";
        }
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

      var onSuccess = function (isDemo) {
        if (statusEl) {
          statusEl.className = "form-status is-success";
          statusEl.textContent = isDemo
            ? "Cảm ơn " +
              nameVal.trim() +
              "! Đăng ký đã được ghi nhận ở chế độ chạy thử. Để nhận dữ liệu thực tế về Google Sheets hoặc Email, hãy điền đường dẫn formEndpoint trong data/site.json."
            : "Cảm ơn " +
              nameVal.trim() +
              "! Ban Điều Phối HolaRise đã nhận được đăng ký và sẽ liên hệ với bạn trong vòng 24 giờ.";
        }
        form.reset();
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || "Gửi đăng ký";
        }
      };

      if (!endpoint) {
        setTimeout(function () {
          onSuccess(true);
        }, 320);
        return;
      }

      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Request failed");
          onSuccess(false);
        })
        .catch(function () {
          if (statusEl) {
            statusEl.className = "form-status is-error";
            statusEl.textContent =
              "Không thể kết nối máy chủ gửi biểu mẫu lúc này. Bạn vui lòng liên hệ trực tiếp qua Email hoặc Fanpage của dự án HolaRise nhé.";
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtn.dataset.originalText || "Gửi đăng ký";
          }
        });
    });
  });
})();
