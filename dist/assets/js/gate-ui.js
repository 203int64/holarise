/**
 * Shared 2-step Team Vault Gate UI controller for /media/ and /admin/:
 *   Step 1: 4-digit PIN entry (auto-advance, paste, backspace, auto-submit) -> POST /api/auth/verify-gate
 *   Step 2: Progressive unlock -> Single Login button (Passkey) -> Fallback Register / Email only on failure
 */
(() => {
  "use strict";

  let currentGateToken = "";
  let initialized = false;

  function showAlert(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
    } else {
      el.textContent = msg;
      el.hidden = false;
    }
  }

  function clearStep2Alerts() {
    ["vault-login-alert", "ar-alert", "mg-alert", "login-alert"].forEach((id) => {
      showAlert(document.getElementById(id), "");
    });
  }

  function hideFallback() {
    const fallback = document.getElementById("vault-fallback-box");
    if (fallback) fallback.hidden = true;
  }

  function revealFallback() {
    const fallback = document.getElementById("vault-fallback-box");
    if (fallback) fallback.hidden = false;
  }

  function setAuthView(viewName) {
    const views = document.querySelectorAll("[data-auth-view]");
    views.forEach((panel) => {
      const active = panel.getAttribute("data-auth-view") === viewName;
      panel.hidden = !active;
    });
    if (viewName === "login") {
      const loginBtn = document.getElementById("btn-vault-login");
      if (loginBtn) loginBtn.focus();
    } else {
      const activeInput = document.querySelector(
        `[data-auth-view="${viewName}"] input:not([type="hidden"])`
      );
      if (activeInput) activeInput.focus();
    }
  }

  function setStep(step) {
    const pinEl = document.getElementById("vault-step-pin");
    const authEl = document.getElementById("vault-step-auth");
    if (!pinEl || !authEl) return;
    if (step === "auth") {
      pinEl.hidden = true;
      authEl.hidden = false;
      clearStep2Alerts();
      hideFallback();
      setAuthView("login");
    } else {
      authEl.hidden = true;
      pinEl.hidden = false;
      clearStep2Alerts();
      hideFallback();
      const firstBox = pinEl.querySelector(".pin-box");
      if (firstBox) firstBox.focus();
    }
  }

  function initVault() {
    if (initialized) return;
    initialized = true;

    const form = document.getElementById("pin-gate-form");
    const boxes = Array.from(document.querySelectorAll(".pin-box"));
    const group = document.querySelector(".pin-group");
    const alertEl = document.getElementById("pin-gate-alert");
    const submitBtn = document.getElementById("pin-gate-submit");
    const backBtn = document.getElementById("btn-vault-back");

    function getPin() {
      return boxes.map((b) => (b.value || "").replace(/\D/g, "")).join("");
    }

    function clearPin(focusFirst = true) {
      boxes.forEach((b) => {
        b.value = "";
        b.classList.remove("is-filled");
      });
      if (focusFirst && boxes[0]) boxes[0].focus();
    }

    async function verifyPin() {
      const pin = getPin();
      showAlert(alertEl, "");
      if (pin.length < boxes.length) {
        showAlert(alertEl, "Vui lòng nhập đủ 4 chữ số mã cổng nội bộ.");
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Đang kiểm tra mã...";
      }
      boxes.forEach((b) => (b.disabled = true));

      try {
        const res = await fetch("/api/auth/verify-gate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ pin }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.gateToken) {
          throw new Error(data?.error?.message || "Mã cổng nội bộ chưa chính xác.");
        }
        currentGateToken = data.gateToken;
        setStep("auth");
      } catch (err) {
        showAlert(alertEl, err.message || "Mã cổng nội bộ chưa chính xác.");
        if (group) {
          group.classList.remove("is-shake");
          void group.offsetWidth;
          group.classList.add("is-shake");
        }
        clearPin(true);
      } finally {
        boxes.forEach((b) => (b.disabled = false));
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Tiếp tục";
        }
      }
    }

    boxes.forEach((box, idx) => {
      box.addEventListener("input", () => {
        const digits = (box.value || "").replace(/\D/g, "");
        if (!digits) {
          box.value = "";
          box.classList.remove("is-filled");
          return;
        }
        if (digits.length > 1) {
          for (let i = 0; i < digits.length && idx + i < boxes.length; i++) {
            boxes[idx + i].value = digits[i];
            boxes[idx + i].classList.add("is-filled");
          }
          const nextIdx = Math.min(boxes.length - 1, idx + digits.length);
          boxes[nextIdx].focus();
        } else {
          box.value = digits;
          box.classList.add("is-filled");
          if (idx < boxes.length - 1) boxes[idx + 1].focus();
        }
        if (getPin().length === boxes.length) {
          verifyPin();
        }
      });

      box.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !box.value && idx > 0) {
          boxes[idx - 1].value = "";
          boxes[idx - 1].classList.remove("is-filled");
          boxes[idx - 1].focus();
          e.preventDefault();
        } else if (e.key === "ArrowLeft" && idx > 0) {
          boxes[idx - 1].focus();
        } else if (e.key === "ArrowRight" && idx < boxes.length - 1) {
          boxes[idx + 1].focus();
        }
      });

      box.addEventListener("paste", (e) => {
        const text = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
        if (!text) return;
        e.preventDefault();
        for (let i = 0; i < boxes.length; i++) {
          boxes[i].value = text[i] || "";
          boxes[i].classList.toggle("is-filled", Boolean(text[i]));
        }
        if (getPin().length === boxes.length) {
          verifyPin();
        }
      });
    });

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      verifyPin();
    });

    backBtn?.addEventListener("click", () => {
      currentGateToken = "";
      clearPin(true);
      setStep("pin");
    });

    document.querySelectorAll("[data-vault-go]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetView = btn.getAttribute("data-vault-go");
        if (targetView) {
          clearStep2Alerts();
          setAuthView(targetView);
        }
      });
    });
  }

  window.HolaVault = {
    init: initVault,
    setStep,
    setAuthView,
    revealFallback,
    hideFallback,
    getGateToken: () => currentGateToken,
    reset: () => {
      currentGateToken = "";
      document.querySelectorAll(".pin-box").forEach((b) => {
        b.value = "";
        b.classList.remove("is-filled");
      });
      setStep("pin");
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVault);
  } else {
    initVault();
  }
})();
