/**
 * HolaRise v8 — Unified Member Account, Member Pass Studio, 1-Tap RSVP & Editorial Guestbook
 * Vanilla ES6+, zero dependencies, strictly isolated from Admin CMS (/api/auth/*).
 */
(function () {
  "use strict";

  const state = {
    member: null,
    googleEnabled: false,
    needsOnboarding: false,
    dashboard: null,
    guestbook: {
      slug: "",
      items: [],
      myReflection: null,
      editingId: null,
    },
  };

  const PILLAR_META = {
    holaheart: {
      theme: "sunrise",
      badge: "HolaHeart · Nội lực",
      label: "HolaHeart",
      greeting: "Hẹn gặp bạn trong những buổi đối thoại giá trị sống và âm nhạc sâu lắng tại Hòa Lạc.",
    },
    holagreen: {
      theme: "emerald",
      badge: "HolaGreen · Sinh thái",
      label: "HolaGreen",
      greeting: "Cùng nhau giữ xanh cảnh quan Hòa Lạc bằng những hành động bền bỉ và thiết thực.",
    },
    holaconnect: {
      theme: "slate",
      badge: "HolaConnect · Phụng sự",
      label: "HolaConnect",
      greeting: "Đưa tri thức và lòng trắc ẩn hòa vào đời sống cộng đồng địa phương tại Hòa Lạc.",
    },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  function getInitials(name) {
    return (
      String(name || "HR")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(-2)
        .map((w) => w[0].toUpperCase())
        .join("") || "HR"
    );
  }

  function getShortName(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "Thành viên";
    return parts[parts.length - 1];
  }

  function formatDateVi(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(iso));
    } catch {
      return String(iso).slice(0, 10);
    }
  }

  function setStatus(el, msg, kind = "") {
    if (!el) return;
    el.className = "form-status" + (kind ? ` is-${kind}` : "");
    el.textContent = msg || "";
  }

  async function api(url, opts = {}) {
    const headers = { Accept: "application/json", ...(opts.headers || {}) };
    let body = opts.body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const msg = (data && data.error && data.error.message) || `Lỗi kết nối (HTTP ${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.code = data?.error?.code || "";
      err.fields = data?.error?.fields || null;
      throw err;
    }
    return data;
  }

  async function compressImage(file, maxDim = 1280, quality = 0.82, squareCrop = false) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      const url = URL.createObjectURL(file);
      i.onload = () => {
        URL.revokeObjectURL(url);
        resolve(i);
      };
      i.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Không thể đọc tệp ảnh. Vui lòng chọn ảnh JPG/PNG/WebP."));
      };
      i.src = url;
    });

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (squareCrop) {
      const side = Math.min(sw, sh);
      const sx = Math.floor((sw - side) / 2);
      const sy = Math.floor((sh - side) / 2);
      const out = Math.min(maxDim, side);
      canvas.width = out;
      canvas.height = out;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, out, out);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    } else {
      let w = sw;
      let h = sh;
      if (w > maxDim || h > maxDim) {
        if (w >= h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
    }

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Không thể nén ảnh trên trình duyệt."))),
        "image/jpeg",
        quality
      );
    });
    return blob;
  }

  /* =========================================================================
     1. Header Member Pill & 1-Tap RSVP Sync across all pages
     ========================================================================= */
  function syncHeaderAndRsvp() {
    const m = state.member;
    const headerBtn = $("[data-header-member-btn]");
    const headerLabel = $("[data-header-member-label]");
    const drawerLabel = $("[data-drawer-member-label]");

    if (headerBtn && headerLabel) {
      if (m) {
        headerBtn.classList.add("is-member-signed-in");
        headerLabel.textContent = `${getShortName(m.name)} · ${m.memberCode.slice(-4)}`;
        headerBtn.setAttribute("aria-label", `Thẻ Thành Viên ${m.name} (${m.memberCode})`);
      } else {
        headerBtn.classList.remove("is-member-signed-in");
        headerLabel.textContent =
          document.documentElement.dataset.lang === "en" ? "Sign in" : "Đăng nhập";
        headerBtn.removeAttribute("aria-label");
      }
    }

    if (drawerLabel) {
      if (m) {
        drawerLabel.textContent = `Thẻ Thành Viên · ${m.name}`;
      } else {
        drawerLabel.textContent =
          document.documentElement.dataset.lang === "en"
            ? "Join & Member Pass"
            : "Tham gia & Thẻ Thành Viên";
      }
    }

    // Toggle guest login prompts vs hiding redundant identity fields when signed in
    $$("[data-rsvp-guest-prompt]").forEach((el) => {
      el.hidden = Boolean(m);
    });
    $$("[data-guest-identity-fields]").forEach((group) => {
      group.hidden = Boolean(m);
      group.querySelectorAll("input[name='fullName'], input[name='phone']").forEach((inp) => {
        if (m) {
          inp.removeAttribute("required");
        } else {
          inp.setAttribute("required", "");
        }
      });
    });

    // 1-Tap Guestbook Composer Identity Sync (hide redundant Name input for signed-in members)
    const prMemberBar = $("#pr-member-bar");
    const prGuestRow = $("#pr-guest-row");
    const prNameInput = $("#pr-name");
    const prOrgInput = $("#pr-org");
    if (prMemberBar && prGuestRow) {
      if (m) {
        prMemberBar.hidden = false;
        prGuestRow.hidden = true;
        const avEl = $("#pr-member-avatar");
        const nmEl = $("#pr-member-name");
        const subEl = $("#pr-member-sub");
        if (avEl) {
          avEl.innerHTML = m.avatarUrl
            ? `<img src="${esc(m.avatarUrl)}" alt="${esc(m.name)}">`
            : esc((m.name || "H").trim().charAt(0).toUpperCase());
        }
        if (nmEl) nmEl.textContent = m.name || "Thành viên HolaRise";
        if (subEl) subEl.textContent = m.organization ? `${m.organization} · Thành viên HolaRise` : "Đang viết với tài khoản của bạn";
        if (prNameInput) {
          prNameInput.value = m.name || "";
          prNameInput.removeAttribute("required");
        }
        if (prOrgInput) prOrgInput.value = m.organization || "";
      } else {
        prMemberBar.hidden = true;
        prGuestRow.hidden = false;
        if (prNameInput) prNameInput.setAttribute("required", "");
      }
    }

    // 1-Tap RSVP Bar in #event-register-modal
    const modalBar = $("#modal-member-rsvp-bar");
    const modalBarTitle = $("#modal-member-bar-title");
    const modalBarSub = $("#modal-member-bar-sub");
    const modalForm = $("#event-register-modal form[data-club-form]");
    if (modalBar && modalForm) {
      if (m) {
        modalBar.hidden = false;
        if (modalBarTitle) modalBarTitle.textContent = `${m.name} · ${m.memberCode}`;
        if (modalBarSub) {
          modalBarSub.textContent = `${m.email || m.phone || "Tài khoản HolaRise"} — chọn số chỗ và bấm xác nhận.`;
        }
        const fName = modalForm.querySelector('[name="fullName"]');
        const fPhone = modalForm.querySelector('[name="phone"]');
        const fEmail = modalForm.querySelector('[name="email"]');
        const fOrg = modalForm.querySelector('[name="organization"]');
        if (fName) fName.value = m.name || "";
        if (fPhone) fPhone.value = m.phone || m.email || "";
        if (fEmail) fEmail.value = m.email || "";
        if (fOrg) fOrg.value = m.organization || "";
      } else {
        modalBar.hidden = true;
      }
    }

    // 1-Tap RSVP Bar on /su-kien/cuoc-doi-cua-cha/
    const wsBar = $("#ws-member-rsvp-bar");
    const wsBarTitle = $("#ws-member-bar-title");
    const wsBarSub = $("#ws-member-bar-sub");
    const wsForm = $("form[data-father-studio]");
    if (wsBar && wsForm) {
      if (m) {
        wsBar.hidden = false;
        if (wsBarTitle) wsBarTitle.textContent = `${m.name} · ${m.memberCode}`;
        if (wsBarSub) {
          wsBarSub.textContent = `${m.email || m.phone || "Tài khoản HolaRise"} — chỉ cần chọn số chỗ và bấm Xác nhận.`;
        }
        const fName = wsForm.querySelector('[name="fullName"]');
        const fPhone = wsForm.querySelector('[name="phone"]');
        const fEmail = wsForm.querySelector('[name="email"]');
        const fOrg = wsForm.querySelector('[name="organization"]');
        if (fName) {
          fName.value = m.name || "";
          fName.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (fPhone) fPhone.value = m.phone || m.email || "";
        if (fEmail) fEmail.value = m.email || "";
        if (fOrg) {
          fOrg.value = m.organization || "";
          fOrg.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } else {
        wsBar.hidden = true;
      }
    }
  }

  function initOneTapModalButton() {
    const oneTapBtn = $("#modal-member-onetap-btn");
    const modal = $("#event-register-modal");
    if (!oneTapBtn || !modal) return;

    oneTapBtn.addEventListener("click", async () => {
      if (!state.member) return;
      const modalForm = modal.querySelector("form[data-club-form]");
      if (!modalForm) return;

      const activity = ($("#modal-event-input")?.value || "").trim();
      const eventId = ($("#modal-event-id")?.value || "").trim();
      const activeVibe = modalForm.querySelector('[data-vibe-chip][aria-pressed="true"]');
      const seatsLabel = activeVibe ? activeVibe.getAttribute("data-vibe-chip") : "Đi 1 mình (1 chỗ)";
      const statusEl = modalForm.querySelector(".form-status");

      oneTapBtn.disabled = true;
      oneTapBtn.textContent = "Đang giữ chỗ...";
      try {
        const res = await api("/api/registrations", {
          method: "POST",
          body: {
            source: "event_modal",
            eventId,
            activity: activity || "Hoạt động HolaRise",
            fullName: state.member.name,
            phone: state.member.phone || "",
            email: state.member.email || "",
            organization: state.member.organization || "",
            note: `[${seatsLabel}] Đăng ký 1 chạm bằng Thẻ ${state.member.memberCode}`,
          },
        });
        document.dispatchEvent(
          new CustomEvent("holarise:registration-success", {
            detail: {
              snapshot: {
                id: res.id || state.member.memberCode,
                source: "event_modal",
                fullName: state.member.name,
                organization: state.member.organization || "Hòa Lạc",
                eventId,
                eventTitle: activity || "Hoạt động HolaRise",
                vibe: seatsLabel,
              },
            },
          })
        );
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      } finally {
        oneTapBtn.disabled = false;
        oneTapBtn.textContent = "Giữ chỗ 1 chạm";
      }
    });
  }

  /* =========================================================================
     2. Password Toggles & Auth Modal (#member-auth-modal)
     ========================================================================= */
  function initPasswordToggles() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-member-pw-toggle]");
      if (!btn) return;
      const input = document.getElementById(btn.getAttribute("data-member-pw-toggle"));
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.setAttribute("aria-pressed", String(!showing));
      btn.setAttribute("aria-label", showing ? "Hiện mật khẩu" : "Ẩn mật khẩu");
      btn.classList.toggle("is-showing", !showing);
    });
  }

  function initUnifiedAuthForms() {
    // Keep Google OAuth returnTo synced to current page
    $$("[data-google-auth-link]").forEach((a) => {
      const path = window.location.pathname || "/tham-gia/";
      a.setAttribute("href", `/api/member/auth/google?returnTo=${encodeURIComponent(path)}`);
    });

    // Show friendly OAuth error if redirected back with ?auth_error=
    const params = new URLSearchParams(window.location.search);
    const authErr = params.get("auth_error");
    if (authErr) {
      const oauthAlert = $("#join-oauth-alert");
      const msgMap = {
        google_not_configured:
          "Đăng nhập Google chưa được gắn khóa GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET trên Cloudflare Pages. Bạn có thể tiếp tục ngay bằng Email hoặc SĐT bên dưới.",
        google_cancelled: "Bạn đã hủy đăng nhập Google. Bạn có thể thử lại hoặc dùng Email / SĐT.",
        google_state_invalid: "Phiên xác thực Google đã hết hạn. Vui lòng thử lại.",
        account_disabled: "Tài khoản này đang tạm khóa. Vui lòng liên hệ Ban Điều Phối.",
      };
      setStatus(oauthAlert, msgMap[authErr] || "Không thể đăng nhập bằng Google lúc này. Vui lòng thử lại.", "error");
    }

    if (params.get("onboarding") === "1") {
      state.needsOnboarding = true;
    }

    $$("[data-unified-auth]").forEach((form) => {
      let mode = "identify"; // 'identify' | 'login' | 'register'
      let lockedIdentifier = "";

      const idPill = form.querySelector("[data-auth-id-pill]");
      const idPillText = form.querySelector("[data-auth-id-text]");
      const resetBtn = form.querySelector("[data-auth-reset]");
      const stepIdentify = form.querySelector('[data-auth-step="identify"]');
      const stepNewOnly = form.querySelector('[data-auth-step="new-only"]');
      const stepPassword = form.querySelector('[data-auth-step="password"]');
      const pwLabel = form.querySelector("[data-auth-pw-label]");
      const idInput = form.querySelector('input[name="identifier"]');
      const nameInput = form.querySelector('input[name="name"]');
      const pwInput = form.querySelector('input[name="password"]');
      const submitBtn = form.querySelector("[data-auth-submit]");
      const statusEl = form.querySelector("[data-auth-status]");

      function setMode(nextMode) {
        mode = nextMode;
        setStatus(statusEl, "");
        if (mode === "identify") {
          lockedIdentifier = "";
          if (idPill) idPill.hidden = true;
          if (stepIdentify) stepIdentify.hidden = false;
          if (stepNewOnly) stepNewOnly.hidden = true;
          if (stepPassword) stepPassword.hidden = true;
          if (pwInput) {
            pwInput.value = "";
            pwInput.required = false;
          }
          if (nameInput) nameInput.required = false;
          if (submitBtn) submitBtn.textContent = "Tiếp tục";
          idInput?.focus();
        } else if (mode === "login") {
          if (idPill) idPill.hidden = false;
          if (idPillText) idPillText.textContent = lockedIdentifier;
          if (stepIdentify) stepIdentify.hidden = true;
          if (stepNewOnly) stepNewOnly.hidden = true;
          if (stepPassword) stepPassword.hidden = false;
          if (pwLabel) pwLabel.textContent = "Nhập mật khẩu để đăng nhập";
          if (pwInput) {
            pwInput.setAttribute("autocomplete", "current-password");
            pwInput.placeholder = "••••••••";
            pwInput.required = true;
          }
          if (nameInput) nameInput.required = false;
          if (submitBtn) submitBtn.textContent = "Đăng nhập";
          pwInput?.focus();
        } else if (mode === "register") {
          if (idPill) idPill.hidden = false;
          if (idPillText) idPillText.textContent = `${lockedIdentifier} · Tài khoản mới`;
          if (stepIdentify) stepIdentify.hidden = true;
          if (stepNewOnly) stepNewOnly.hidden = true;
          if (stepPassword) stepPassword.hidden = false;
          if (pwLabel) pwLabel.innerHTML = 'Tạo mật khẩu <span class="auth-hint-inline">(tối thiểu 6 ký tự)</span>';
          if (pwInput) {
            pwInput.setAttribute("autocomplete", "new-password");
            pwInput.placeholder = "Tạo mật khẩu dễ nhớ";
            pwInput.required = true;
          }
          if (submitBtn) submitBtn.textContent = "Tiếp tục";
          pwInput?.focus();
        }
      }

      resetBtn?.addEventListener("click", () => setMode("identify"));

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus(statusEl, "");

        if (mode === "identify") {
          const val = (idInput?.value || "").trim();
          if (!val) {
            setStatus(statusEl, "Vui lòng nhập Email hoặc Số điện thoại.", "error");
            idInput?.focus();
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = "Đang kiểm tra...";
          try {
            const res = await api("/api/member/auth/lookup", {
              method: "POST",
              body: { identifier: val },
            });
            lockedIdentifier = res.normalized || val;
            setMode(res.exists ? "login" : "register");
          } catch (err) {
            setStatus(statusEl, err.message, "error");
            submitBtn.textContent = "Tiếp tục";
          } finally {
            submitBtn.disabled = false;
          }
          return;
        }

        if (mode === "login") {
          const pw = pwInput?.value || "";
          if (!pw) {
            setStatus(statusEl, "Vui lòng nhập mật khẩu.", "error");
            pwInput?.focus();
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = "Đang đăng nhập...";
          try {
            const res = await api("/api/member/auth/login", {
              method: "POST",
              body: { identifier: lockedIdentifier, password: pw },
            });
            state.member = res.member;
            state.needsOnboarding = false;
            setMode("identify");
            form.reset();
            const dlg = form.closest("dialog");
            if (dlg && dlg.open) dlg.close();
            onAuthChanged();
          } catch (err) {
            setStatus(statusEl, err.message, "error");
            submitBtn.textContent = "Đăng nhập";
          } finally {
            submitBtn.disabled = false;
          }
          return;
        }

        if (mode === "register") {
          const pw = pwInput?.value || "";
          if (pw.length < 6) {
            setStatus(statusEl, "Mật khẩu cần tối thiểu 6 ký tự.", "error");
            pwInput?.focus();
            return;
          }
          const fallbackName = lockedIdentifier.includes("@")
            ? lockedIdentifier.split("@")[0].slice(0, 60)
            : "Thành viên Hola";
          submitBtn.disabled = true;
          submitBtn.textContent = "Đang khởi tạo...";
          try {
            const res = await api("/api/member/auth/register", {
              method: "POST",
              body: {
                name: fallbackName.length >= 2 ? fallbackName : "Thành viên Hola",
                identifier: lockedIdentifier,
                password: pw,
                primaryPillar: "holaheart",
              },
            });
            state.member = res.member;
            state.needsOnboarding = true;
            setMode("identify");
            form.reset();
            const dlg = form.closest("dialog");
            if (dlg && dlg.open) dlg.close();
            if (window.location.pathname !== "/tham-gia/") {
              window.location.href = "/tham-gia/?onboarding=1";
              return;
            }
            onAuthChanged();
          } catch (err) {
            setStatus(statusEl, err.message, "error");
            submitBtn.textContent = "Tiếp tục";
          } finally {
            submitBtn.disabled = false;
          }
        }
      });
    });
  }

  function b64uEncode(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function b64uDecode(str) {
    const clean = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = clean.length % 4 === 0 ? "" : "=".repeat(4 - (clean.length % 4));
    const bin = atob(clean + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function detectDeviceLabel() {
    const ua = navigator.userAgent || "";
    if (/iPhone/i.test(ua)) return "iPhone · Face ID / Touch ID";
    if (/iPad/i.test(ua)) return "iPad · Passkey";
    if (/Macintosh|Mac OS/i.test(ua)) return "Mac · Touch ID";
    if (/Android/i.test(ua)) return "Android · Passkey";
    if (/Windows/i.test(ua)) return "Windows Hello";
    return "Passkey thiết bị";
  }

  function initPasskeyAuth() {
    const supported = Boolean(window.PublicKeyCredential && navigator.credentials);
    if (!supported) {
      $$("[data-passkey-login]").forEach((btn) => {
        btn.hidden = true;
      });
      return;
    }

    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-passkey-login]");
      if (!btn) return;
      const container = btn.closest(".auth-card-surface, .auth-dialog-inner") || document;
      const statusEl =
        container.querySelector("[data-auth-status]") ||
        container.querySelector("#join-oauth-alert");
      setStatus(statusEl, "");

      const origHtml = btn.innerHTML;
      btn.disabled = true;
      try {
        const optRes = await api("/api/member/auth/passkey/login-options", { method: "POST" });
        const opts = optRes.options;
        const cred = await navigator.credentials.get({
          publicKey: {
            challenge: b64uDecode(opts.challenge),
            rpId: opts.rpId,
            timeout: opts.timeout || 60000,
            userVerification: opts.userVerification || "preferred",
          },
        });
        if (!cred || !cred.response) throw new Error("Đã hủy xác thực Passkey.");

        const verifyRes = await api("/api/member/auth/passkey/login-verify", {
          method: "POST",
          body: {
            id: cred.id,
            challenge: opts.challenge,
            clientDataJSON: b64uEncode(cred.response.clientDataJSON),
            authenticatorData: b64uEncode(cred.response.authenticatorData),
            signature: b64uEncode(cred.response.signature),
          },
        });
        state.member = verifyRes.member;
        state.needsOnboarding = false;
        const dlg = btn.closest("dialog");
        if (dlg && dlg.open) dlg.close();
        onAuthChanged();
      } catch (err) {
        if (err && err.name === "NotAllowedError") {
          setStatus(statusEl, "Bạn đã hủy đăng nhập bằng Passkey.", "error");
        } else {
          setStatus(statusEl, err.message || "Không thể đăng nhập bằng Passkey lúc này.", "error");
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    });

    $("#btn-add-passkey")?.addEventListener("click", async () => {
      const btn = $("#btn-add-passkey");
      const st = $("#passkey-dash-status");
      setStatus(st, "");
      btn.disabled = true;
      btn.textContent = "Đang xác thực...";
      try {
        const optRes = await api("/api/member/auth/passkey/register-options", { method: "POST" });
        const opts = optRes.options;
        const cred = await navigator.credentials.create({
          publicKey: {
            challenge: b64uDecode(opts.challenge),
            rp: opts.rp,
            user: {
              id: b64uDecode(opts.user.id),
              name: opts.user.name,
              displayName: opts.user.displayName,
            },
            pubKeyCredParams: opts.pubKeyCredParams,
            timeout: opts.timeout || 60000,
            attestation: opts.attestation || "none",
            excludeCredentials: (opts.excludeCredentials || []).map((c) => ({
              type: c.type,
              id: b64uDecode(c.id),
            })),
            authenticatorSelection: opts.authenticatorSelection,
          },
        });
        if (!cred || !cred.response) throw new Error("Không tạo được Passkey.");
        if (typeof cred.response.getPublicKey !== "function" || typeof cred.response.getAuthenticatorData !== "function") {
          throw new Error("Trình duyệt này chưa hỗ trợ chuẩn WebAuthn Level 2.");
        }
        const pubKeyBuf = cred.response.getPublicKey();
        const authDataBuf = cred.response.getAuthenticatorData();
        const alg = typeof cred.response.getPublicKeyAlgorithm === "function"
          ? cred.response.getPublicKeyAlgorithm()
          : -7;

        await api("/api/member/auth/passkey/register-verify", {
          method: "POST",
          body: {
            id: cred.id,
            challenge: opts.challenge,
            clientDataJSON: b64uEncode(cred.response.clientDataJSON),
            authenticatorData: b64uEncode(authDataBuf),
            publicKey: b64uEncode(pubKeyBuf),
            algorithm: alg,
            deviceLabel: detectDeviceLabel(),
          },
        });
        setStatus(st, "Đã thêm Passkey thành công! Lần sau bạn có thể đăng nhập trong 1 chạm.", "success");
        loadMemberPasskeys();
      } catch (err) {
        if (err && err.name === "NotAllowedError") {
          setStatus(st, "Bạn đã hủy thêm Passkey.", "error");
        } else {
          setStatus(st, err.message || "Không thể thêm Passkey trên thiết bị này.", "error");
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "+ Thêm Passkey";
      }
    });

    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-delete-passkey]");
      if (!btn) return;
      const id = btn.getAttribute("data-delete-passkey");
      if (!id || !window.confirm("Gỡ Passkey này khỏi tài khoản?")) return;
      try {
        await api(`/api/member/auth/passkey?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        loadMemberPasskeys();
      } catch (err) {
        setStatus($("#passkey-dash-status"), err.message, "error");
      }
    });
  }

  async function loadMemberPasskeys() {
    const box = $("#member-passkeys-list");
    if (!box || !state.member) return;
    try {
      const res = await api("/api/member/auth/passkey");
      const items = res.items || [];
      if (!items.length) {
        box.innerHTML =
          '<p class="member-empty-hint">Chưa có Passkey nào. Bấm <strong>+ Thêm Passkey</strong> để bật đăng nhập 1 chạm bằng Face ID / vân tay.</p>';
        return;
      }
      box.innerHTML = items
        .map(
          (pk) => `<div class="member-list-item">
            <div>
              <strong>${esc(pk.deviceLabel)}</strong>
              <span class="member-list-meta">Tạo ngày ${esc(formatDateVi(pk.createdAt))}${pk.lastUsedAt ? ` · Dùng gần nhất ${esc(formatDateVi(pk.lastUsedAt))}` : ""}</span>
            </div>
            <button type="button" class="auth-change-btn" data-delete-passkey="${esc(pk.id)}">Gỡ</button>
          </div>`
        )
        .join("");
    } catch (_err) {}
  }

  function initMemberAuthModal() {
    const dialog = $("#member-auth-modal");
    if (!dialog) return;
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-open-member-auth]");
      if (!trigger) return;
      if (typeof dialog.showModal === "function") dialog.showModal();
    });
  }

  function initOnboardingWizard() {
    const wizard = $("#member-onboarding-wizard");
    const form = $("#onboarding-form");
    if (!wizard || !form) return;

    const finishBtn = $("#ob-finish-btn");
    const skipBtn = $("#ob-skip-btn");
    const statusEl = $("#ob-status");

    function finishOnboardingUi() {
      state.needsOnboarding = false;
      const url = new URL(window.location.href);
      if (url.searchParams.has("onboarding")) {
        url.searchParams.delete("onboarding");
        history.replaceState(null, "", url.pathname + url.search);
      }
      refreshJoinDashboard();
    }

    skipBtn?.addEventListener("click", finishOnboardingUi);

    $$("[data-org-chip]", wizard).forEach((chip) => {
      chip.addEventListener("click", () => {
        const targetId = chip.getAttribute("data-org-target") || "ob-org";
        const input = document.getElementById(targetId);
        if (input) {
          input.value = chip.getAttribute("data-org-chip") || "";
          input.focus();
        }
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pillar = form.querySelector('input[name="obPillar"]:checked')?.value || "holaheart";
      const name = ($("#ob-name")?.value || state.member?.name || "").trim();
      const organization = ($("#ob-org")?.value || "").trim();
      const bio = ($("#ob-bio")?.value || "").trim();

      if (name.length < 2) {
        setStatus(statusEl, "Vui lòng nhập tên hiển thị (tối thiểu 2 ký tự).", "error");
        $("#ob-name")?.focus();
        return;
      }

      if (finishBtn) {
        finishBtn.disabled = true;
        finishBtn.textContent = "Đang hoàn tất...";
      }
      try {
        const res = await api("/api/member/profile", {
          method: "PATCH",
          body: { name, organization, primaryPillar: pillar, bio },
        });
        state.member = res.member;
        syncHeaderAndRsvp();
        finishOnboardingUi();
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      } finally {
        if (finishBtn) {
          finishBtn.disabled = false;
          finishBtn.textContent = "Hoàn tất & Mở Thẻ Thành Viên";
        }
      }
    });
  }

  /* =========================================================================
     3. /tham-gia/ Unified Member Hub & Authenticated Dashboard
     ========================================================================= */
  function initJoinHub() {
    const guestView = $("#member-guest-view");
    const dashView = $("#member-dashboard-view");
    if (!guestView || !dashView) return;

    function switchJoinTab(tab) {
      $$("[data-join-tab]", guestView).forEach((btn) => {
        if (btn.getAttribute("role") === "tab") {
          const active = btn.getAttribute("data-join-tab") === tab;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-selected", String(active));
        }
      });
      $$("[data-join-pane]", guestView).forEach((pane) => {
        pane.hidden = pane.getAttribute("data-join-pane") !== tab;
      });
    }

    $$("[data-join-tab]", guestView).forEach((btn) => {
      btn.addEventListener("click", () => switchJoinTab(btn.getAttribute("data-join-tab")));
    });

    // Step 1 minimal 3-field register form on /tham-gia/
    const regForm = $("#member-register-form");
    if (regForm) {
      regForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = $("#m-reg-submit-btn");
        const st = $("#m-reg-status");
        setStatus(st, "");

        const body = {
          name: ($("#m-reg-name")?.value || "").trim(),
          identifier: ($("#m-reg-id")?.value || "").trim(),
          password: $("#m-reg-pw")?.value || "",
          primaryPillar: "holaheart",
        };

        btn.disabled = true;
        btn.textContent = "Đang tạo tài khoản...";
        try {
          const res = await api("/api/member/auth/register", { method: "POST", body });
          state.member = res.member;
          regForm.reset();
          onAuthChanged();
        } catch (err) {
          setStatus(st, err.message, "error");
        } finally {
          btn.disabled = false;
          btn.textContent = "Tiếp tục";
        }
      });
    }

    // Live-sync Member Pass preview while editing Step 2 profile form
    const profForm = $("#member-profile-form");
    if (profForm) {
      const livePreview = () => {
        if (!state.member) return;
        const pKey = ($("#prof-pillar")?.value || state.member.primaryPillar || "holaheart");
        const pillar = PILLAR_META[pKey] || PILLAR_META.holaheart;
        const card = $("#member-live-pass");
        if (card) card.setAttribute("data-pass-theme", pillar.theme);
        if ($("#dash-pass-badge")) $("#dash-pass-badge").textContent = pillar.badge;
        if ($("#dash-pass-pillar")) $("#dash-pass-pillar").textContent = pillar.label;
        if ($("#dash-pass-name")) $("#dash-pass-name").textContent = ($("#prof-name")?.value || "").trim() || state.member.name;
        if ($("#dash-pass-org")) $("#dash-pass-org").textContent = ($("#prof-org")?.value || "").trim() || "Cộng đồng Hòa Lạc";
        if ($("#dash-pass-bio")) {
          $("#dash-pass-bio").textContent =
            ($("#prof-bio")?.value || "").trim() ||
            "Cùng nhau kiến tạo những cuối tuần tử tế, sâu sắc và kết nối tại Hòa Lạc.";
        }
      };
      profForm.addEventListener("input", livePreview);
      profForm.addEventListener("change", livePreview);
    }

    // Step 2: 1-Tap booking for selected event inside dashboard
    $("#btn-dash-book-event")?.addEventListener("click", async () => {
      if (!state.member) return;
      const box = $("#member-quick-events-box");
      const checked = box?.querySelector('input[type="radio"][name="eventChoice"]:checked');
      const st = $("#dash-event-book-status");
      if (!checked) {
        setStatus(st, "Vui lòng chọn một hoạt động ở trên trước khi bấm giữ chỗ.", "error");
        return;
      }
      const btn = $("#btn-dash-book-event");
      btn.disabled = true;
      btn.textContent = "Đang giữ chỗ...";
      setStatus(st, "");
      try {
        const title = checked.getAttribute("data-event-title") || "Hoạt động HolaRise";
        await api("/api/registrations", {
          method: "POST",
          body: {
            source: "event_modal",
            eventId: checked.value,
            activity: title,
            fullName: state.member.name,
            phone: state.member.phone || "",
            email: state.member.email || "",
            organization: state.member.organization || "",
            note: `Đăng ký 1 chạm bằng Thẻ ${state.member.memberCode}`,
          },
        });
        setStatus(st, `Đã giữ chỗ thành công cho “${title}”!`, "success");
        refreshJoinDashboard();
      } catch (err) {
        setStatus(st, err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Giữ chỗ 1 chạm cho hoạt động đã chọn";
      }
    });

    // Login form on /tham-gia/
    $("#member-login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#m-login-submit-btn");
      const st = $("#m-login-status");
      setStatus(st, "");
      btn.disabled = true;
      btn.textContent = "Đang đăng nhập...";
      try {
        const res = await api("/api/member/auth/login", {
          method: "POST",
          body: {
            identifier: $("#m-login-id").value.trim(),
            password: $("#m-login-pw").value,
          },
        });
        state.member = res.member;
        e.currentTarget.reset();
        onAuthChanged();
      } catch (err) {
        setStatus(st, err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Đăng nhập";
      }
    });

    // Dashboard controls: Avatar upload, Profile save, PNG export, Logout
    $("#btn-download-member-pass")?.addEventListener("click", () => {
      if (state.member && window.HolaPass && typeof window.HolaPass.downloadMemberPassPng === "function") {
        window.HolaPass.downloadMemberPassPng(state.member);
      }
    });

    $("#btn-member-logout")?.addEventListener("click", async () => {
      try {
        await api("/api/member/auth/logout", { method: "POST" });
      } finally {
        state.member = null;
        state.dashboard = null;
        onAuthChanged();
      }
    });

    $("#dash-avatar-input")?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const st = $("#dash-avatar-status");
      setStatus(st, "Đang xử lý và tải ảnh đại diện...", "");
      try {
        const blob = await compressImage(file, 256, 0.85, true);
        const fd = new FormData();
        fd.append("file", blob, "avatar.jpg");
        const up = await api("/api/member/media", { method: "POST", body: fd });
        const prof = await api("/api/member/profile", {
          method: "PATCH",
          body: { avatarUrl: up.url },
        });
        state.member = prof.member;
        renderMemberDashboardCard();
        syncHeaderAndRsvp();
        setStatus(st, "Đã cập nhật ảnh đại diện trên Thẻ Thành Viên!", "success");
      } catch (err) {
        setStatus(st, err.message, "error");
      } finally {
        e.target.value = "";
      }
    });

    $("#member-profile-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#prof-submit-btn");
      const st = $("#prof-status");
      setStatus(st, "");
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
      try {
        const res = await api("/api/member/profile", {
          method: "PATCH",
          body: {
            name: $("#prof-name").value.trim(),
            organization: $("#prof-org").value.trim(),
            primaryPillar: $("#prof-pillar").value,
            bio: $("#prof-bio").value.trim(),
          },
        });
        state.member = res.member;
        renderMemberDashboardCard();
        syncHeaderAndRsvp();
        setStatus(st, "Đã lưu thay đổi hồ sơ thành viên.", "success");
      } catch (err) {
        setStatus(st, err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu thay đổi hồ sơ";
      }
    });
  }

  function renderMemberDashboardCard() {
    const m = state.member;
    if (!m) return;
    const pillar = PILLAR_META[m.primaryPillar] || PILLAR_META.holaheart;
    const card = $("#member-live-pass");
    if (card) card.setAttribute("data-pass-theme", pillar.theme);

    const avImg = $("#dash-avatar-img");
    const avInit = $("#dash-avatar-initials");
    if (avImg && avInit) {
      if (m.avatarUrl) {
        avImg.src = m.avatarUrl;
        avImg.hidden = false;
        avInit.hidden = true;
      } else {
        avImg.hidden = true;
        avInit.hidden = false;
        avInit.textContent = getInitials(m.name);
      }
    }

    if ($("#dash-pass-badge")) $("#dash-pass-badge").textContent = pillar.badge;
    if ($("#dash-pass-name")) $("#dash-pass-name").textContent = m.name;
    if ($("#dash-pass-org")) $("#dash-pass-org").textContent = m.organization || "Cộng đồng Hòa Lạc";
    if ($("#dash-pass-bio")) {
      $("#dash-pass-bio").textContent =
        m.bio || "Cùng nhau kiến tạo những cuối tuần tử tế, sâu sắc và kết nối tại Hòa Lạc.";
    }
    if ($("#dash-pass-code")) $("#dash-pass-code").textContent = m.memberCode;
    if ($("#dash-pass-pillar")) $("#dash-pass-pillar").textContent = pillar.label;
    if ($("#dash-pass-contact")) $("#dash-pass-contact").textContent = m.phone || m.email || "—";

    if ($("#prof-name")) $("#prof-name").value = m.name || "";
    if ($("#prof-org")) $("#prof-org").value = m.organization || "";
    if ($("#prof-pillar")) $("#prof-pillar").value = m.primaryPillar || "holaheart";
    if ($("#prof-bio")) $("#prof-bio").value = m.bio || "";

    // Update Step 2 Pass Completion Progress
    let pct = 40;
    const missing = [];
    if (m.avatarUrl) pct += 20;
    else missing.push("ảnh đại diện");
    if (m.organization) pct += 20;
    else missing.push("trường/đơn vị");
    if (m.bio) pct += 20;
    else missing.push("châm ngôn");
    if ($("#dash-completion-pct")) $("#dash-completion-pct").textContent = `${pct}%`;
    if ($("#dash-completion-fill")) $("#dash-completion-fill").style.width = `${pct}%`;
    if ($("#dash-completion-hint")) {
      $("#dash-completion-hint").textContent =
        pct >= 100
          ? "Thẻ Thành Viên của bạn đã hoàn thiện 100% — sẵn sàng tải PNG và check-in."
          : `Bổ sung ${missing.join(", ")} để hoàn thiện 100% Thẻ Thành Viên.`;
    }
  }

  async function refreshJoinDashboard() {
    const guestView = $("#member-guest-view");
    const onboardingView = $("#member-onboarding-wizard");
    const dashView = $("#member-dashboard-view");
    if (!guestView || !dashView) return;

    if (!state.member) {
      dashView.hidden = true;
      if (onboardingView) onboardingView.hidden = true;
      guestView.hidden = false;
      return;
    }

    if (state.needsOnboarding && onboardingView) {
      guestView.hidden = true;
      dashView.hidden = true;
      onboardingView.hidden = false;
      if ($("#ob-name") && !$("#ob-name").value) $("#ob-name").value = state.member.name || "";
      if ($("#ob-org") && !$("#ob-org").value) $("#ob-org").value = state.member.organization || "";
      if ($("#ob-bio") && !$("#ob-bio").value) $("#ob-bio").value = state.member.bio || "";
      return;
    }

    guestView.hidden = true;
    if (onboardingView) onboardingView.hidden = true;
    dashView.hidden = false;
    renderMemberDashboardCard();
    loadMemberPasskeys();

    try {
      const data = await api("/api/member/dashboard");
      state.dashboard = data;
      if (data.member) {
        state.member = data.member;
        renderMemberDashboardCard();
      }

      const bookingsBox = $("#member-bookings-list");
      const regs = data.registrations || [];
      if (bookingsBox) {
        if (!regs.length) {
          bookingsBox.innerHTML =
            '<p class="member-empty-hint">Bạn chưa giữ chỗ hoạt động nào. Ghé <a href="/lich-hoat-dong/" style="color:var(--accent);font-weight:500;">Lịch hoạt động</a> để đặt chỗ 1 chạm.</p>';
        } else {
          bookingsBox.innerHTML = regs
            .map(
              (r) => `<div class="member-list-item">
                <div>
                  <strong>${esc(r.activity_title)}</strong>
                  <span class="member-list-meta">Mã ${esc(r.id)} · ${esc(formatDateVi(r.created_at))}</span>
                </div>
                <span class="member-status-pill member-status-pill--${esc(r.status)}">${
                  r.status === "attended"
                    ? "Đã tham gia"
                    : r.status === "contacted"
                      ? "Đã xác nhận"
                      : r.status === "cancelled"
                        ? "Đã hủy"
                        : "Đã ghi nhận"
                }</span>
              </div>`
            )
            .join("");
        }
      }

      const refsBox = $("#member-reflections-list");
      const refs = data.reflections || [];
      if (refsBox) {
        if (!refs.length) {
          refsBox.innerHTML =
            '<p class="member-empty-hint">Bạn chưa gửi lưu bút nào. Mở một bài trong <a href="/hanh-trinh/" style="color:var(--accent);font-weight:500;">Hành trình</a> để chia sẻ cảm nhận.</p>';
        } else {
          refsBox.innerHTML = refs
            .map(
              (rf) => `<div class="member-list-item">
                <div>
                  <a href="/hanh-trinh/${esc(rf.activitySlug)}/#activity-guestbook"><strong>${esc(rf.pullQuote || rf.content.slice(0, 72))}</strong></a>
                  <span class="member-list-meta">${esc(rf.participantRole)} · ${esc(formatDateVi(rf.createdAt))} · ♥ ${Number(rf.heartsCount || 0)}</span>
                </div>
                <span class="member-status-pill member-status-pill--${esc(rf.status)}">${
                  rf.status === "approved"
                    ? "Đã xuất bản"
                    : rf.status === "rejected"
                      ? "Đang ẩn"
                      : "Chờ duyệt"
                }</span>
              </div>`
            )
            .join("");
        }
      }
    } catch (_err) {}
  }

  /* =========================================================================
     4. Editorial Activity Guestbook (/hanh-trinh/<slug>/#activity-guestbook)
     ========================================================================= */
  function renderGuestbookList() {
    const listEl = $("#guestbook-list");
    const countEl = $("#guestbook-count-pill");
    if (!listEl) return;

    const items = state.guestbook.items || [];
    if (countEl) {
      countEl.textContent = items.length ? `${items.length} lưu bút đã xuất bản` : "Chưa có lưu bút công khai";
    }

    if (!items.length) {
      listEl.innerHTML = `<div class="guestbook-empty">
        <p>Hãy là người đầu tiên lưu lại cảm nhận và khoảnh khắc đáng nhớ của hoạt động này.</p>
      </div>`;
      return;
    }

    listEl.innerHTML = items
      .map((item) => {
        const avHtml = item.authorAvatar
          ? `<img class="gb-avatar-img" src="${esc(item.authorAvatar)}" alt="Ảnh đại diện ${esc(item.authorName)}" width="40" height="40" loading="lazy">`
          : `<span class="gb-avatar-initials" aria-hidden="true">${esc(getInitials(item.authorName))}</span>`;
        const quoteHtml = item.pullQuote
          ? `<blockquote class="gb-pull-quote">“${esc(item.pullQuote)}”</blockquote>`
          : "";
        const photoHtml = item.photoUrl
          ? `<figure class="gb-card-photo">
              <button type="button" class="gb-photo-btn" data-lightbox-src="${esc(item.photoUrl)}" data-lightbox-alt="Khoảnh khắc của ${esc(item.authorName)}" data-lightbox-caption="${esc(item.authorName)} · ${esc(item.participantRole)}">
                <img src="${esc(item.photoUrl)}" alt="Khoảnh khắc kỷ niệm của ${esc(item.authorName)}" loading="lazy" decoding="async">
              </button>
            </figure>`
          : "";

        return `<article class="gb-card" data-reflection-id="${esc(item.id)}">
          ${quoteHtml}
          <p class="gb-card-body">${esc(item.content)}</p>
          ${photoHtml}
          <footer class="gb-card-foot">
            <div class="gb-author">
              ${avHtml}
              <div class="gb-author-meta">
                <strong>${esc(item.authorName)}</strong>
                <span>${esc(item.participantRole)} · <code>${esc(item.authorCode)}</code> · ${esc(formatDateVi(item.createdAt))}</span>
              </div>
            </div>
            <button type="button" class="gb-heart-btn${item.viewerHasHearted ? " is-hearted" : ""}" data-heart-reflection="${esc(item.id)}" aria-pressed="${item.viewerHasHearted ? "true" : "false"}" aria-label="Thả tim cảm nhận này">
              <span class="gb-heart-icon" aria-hidden="true">${item.viewerHasHearted ? "♥" : "♡"}</span>
              <span class="gb-heart-count">${Number(item.heartsCount || 0)}</span>
            </button>
          </footer>
        </article>`;
      })
      .join("");
  }

  function syncGuestbookComposer() {
    const authBar = $("#guestbook-auth-bar");
    const composerWrap = $("#guestbook-composer-wrap");
    if (!authBar || !composerWrap) return;

    const m = state.member;
    if (!m) {
      authBar.hidden = false;
      composerWrap.hidden = true;
      return;
    }

    authBar.hidden = true;
    composerWrap.hidden = false;

    const authorEl = $("#guestbook-composer-author");
    if (authorEl) {
      authorEl.innerHTML = `<strong>${esc(m.name)}</strong><span><code>${esc(m.memberCode)}</code></span>`;
    }

    const mine = state.guestbook.myReflection;
    const statusBanner = $("#guestbook-mine-status");
    const submitBtn = $("#gb-submit-btn");
    const deleteBtn = $("#gb-delete-btn");

    if (mine) {
      state.guestbook.editingId = mine.id;
      if ($("#gb-role")) $("#gb-role").value = mine.participantRole || "Thành viên";
      if ($("#gb-quote")) $("#gb-quote").value = mine.pullQuote || "";
      if ($("#gb-content")) $("#gb-content").value = mine.content || "";
      if ($("#gb-photo-url")) $("#gb-photo-url").value = mine.photoUrl || "";
      const prev = $("#gb-photo-preview");
      const clearBtn = $("#gb-photo-clear");
      if (prev && clearBtn) {
        if (mine.photoUrl) {
          prev.src = mine.photoUrl;
          prev.hidden = false;
          clearBtn.hidden = false;
        } else {
          prev.hidden = true;
          clearBtn.hidden = true;
        }
      }
      if (statusBanner) {
        statusBanner.hidden = false;
        statusBanner.className = `guestbook-mine-status is-${mine.status}`;
        statusBanner.textContent =
          mine.status === "approved"
            ? "Lưu bút của bạn đã được xuất bản công khai. Nếu chỉnh sửa, bài sẽ chuyển lại trạng thái chờ Ban Điều Phối duyệt."
            : mine.status === "rejected"
              ? "Lưu bút của bạn hiện đang được ẩn bởi Ban Điều Phối. Bạn có thể chỉnh sửa và gửi lại."
              : "Lưu bút của bạn đang chờ Ban Điều Phối duyệt trước khi hiển thị công khai.";
      }
      if (submitBtn) submitBtn.textContent = "Cập nhật lưu bút";
      if (deleteBtn) deleteBtn.hidden = false;
    } else {
      state.guestbook.editingId = null;
      if (statusBanner) statusBanner.hidden = true;
      if (submitBtn) submitBtn.textContent = "Gửi lưu bút chờ duyệt";
      if (deleteBtn) deleteBtn.hidden = true;
    }
  }

  async function loadGuestbook() {
    const section = $("#activity-guestbook");
    if (!section) return;
    const slug = (section.getAttribute("data-guestbook-slug") || "").trim();
    if (!slug) return;
    state.guestbook.slug = slug;

    try {
      const data = await api(`/api/reflections?slug=${encodeURIComponent(slug)}`);
      state.guestbook.items = data.items || [];
      state.guestbook.myReflection = data.myReflection || null;
      renderGuestbookList();
      syncGuestbookComposer();
    } catch (_err) {
      const countEl = $("#guestbook-count-pill");
      if (countEl) countEl.textContent = "Lưu bút cộng đồng";
    }
  }

  function initGuestbookEvents() {
    const section = $("#activity-guestbook");
    if (!section) return;

    const photoInput = $("#gb-photo-file");
    const photoPreview = $("#gb-photo-preview");
    const photoUrlInput = $("#gb-photo-url");
    const photoMeta = $("#gb-photo-meta");
    const photoClear = $("#gb-photo-clear");

    photoInput?.addEventListener("change", async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      if (photoMeta) photoMeta.textContent = "Đang nén & tải ảnh kỷ niệm lên...";
      photoInput.disabled = true;
      try {
        const blob = await compressImage(file, 1280, 0.82, false);
        const fd = new FormData();
        fd.append("file", blob, "reflection.jpg");
        const up = await api("/api/member/media", { method: "POST", body: fd });
        if (photoUrlInput) photoUrlInput.value = up.url;
        if (photoPreview) {
          photoPreview.src = up.url;
          photoPreview.hidden = false;
        }
        if (photoClear) photoClear.hidden = false;
        if (photoMeta) photoMeta.textContent = "Đã tải ảnh kỷ niệm thành công.";
      } catch (err) {
        if (photoMeta) photoMeta.textContent = `Lỗi tải ảnh: ${err.message}`;
      } finally {
        photoInput.disabled = false;
        photoInput.value = "";
      }
    });

    photoClear?.addEventListener("click", () => {
      if (photoUrlInput) photoUrlInput.value = "";
      if (photoPreview) photoPreview.hidden = true;
      photoClear.hidden = true;
      if (photoMeta) photoMeta.textContent = "Đã gỡ ảnh đính kèm.";
    });

    $("#guestbook-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#gb-submit-btn");
      const st = $("#gb-form-status");
      setStatus(st, "");

      const body = {
        activitySlug: state.guestbook.slug,
        participantRole: $("#gb-role").value,
        pullQuote: $("#gb-quote").value.trim(),
        content: $("#gb-content").value.trim(),
        photoUrl: $("#gb-photo-url").value.trim(),
      };

      btn.disabled = true;
      btn.textContent = "Đang gửi...";
      try {
        if (state.guestbook.editingId) {
          await api(`/api/reflections/${encodeURIComponent(state.guestbook.editingId)}`, {
            method: "PATCH",
            body,
          });
          setStatus(st, "Đã cập nhật lưu bút — đang chờ Ban Điều Phối duyệt lại.", "success");
        } else {
          await api("/api/reflections", { method: "POST", body });
          setStatus(st, "Cảm ơn bạn! Lưu bút đã được gửi và đang chờ Ban Điều Phối duyệt.", "success");
        }
        await loadGuestbook();
      } catch (err) {
        setStatus(st, err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = state.guestbook.editingId ? "Cập nhật lưu bút" : "Gửi lưu bút chờ duyệt";
      }
    });

    $("#gb-delete-btn")?.addEventListener("click", async () => {
      if (!state.guestbook.editingId) return;
      if (!window.confirm("Bạn chắc chắn muốn xóa lưu bút này?")) return;
      const st = $("#gb-form-status");
      try {
        await api(`/api/reflections/${encodeURIComponent(state.guestbook.editingId)}`, {
          method: "DELETE",
        });
        $("#guestbook-form")?.reset();
        if (photoUrlInput) photoUrlInput.value = "";
        if (photoPreview) photoPreview.hidden = true;
        if (photoClear) photoClear.hidden = true;
        setStatus(st, "Đã xóa lưu bút của bạn.", "success");
        await loadGuestbook();
      } catch (err) {
        setStatus(st, err.message, "error");
      }
    });

    // Heart reaction button delegation
    section.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-heart-reflection]");
      if (!btn) return;
      const id = btn.getAttribute("data-heart-reflection");
      btn.disabled = true;
      try {
        const res = await api(`/api/reflections/${encodeURIComponent(id)}/heart`, { method: "POST" });
        btn.classList.toggle("is-hearted", Boolean(res.hearted));
        btn.setAttribute("aria-pressed", res.hearted ? "true" : "false");
        const icon = btn.querySelector(".gb-heart-icon");
        const cnt = btn.querySelector(".gb-heart-count");
        if (icon) icon.textContent = res.hearted ? "♥" : "♡";
        if (cnt) cnt.textContent = String(res.heartsCount || 0);
        if (res.hearted) {
          btn.classList.remove("is-pop");
          void btn.offsetWidth;
          btn.classList.add("is-pop");
        }
      } catch (_err) {
      } finally {
        btn.disabled = false;
      }
    });
  }

  function onAuthChanged() {
    syncHeaderAndRsvp();
    refreshJoinDashboard();
    loadGuestbook();
  }

  async function boot() {
    initPasswordToggles();
    initUnifiedAuthForms();
    initPasskeyAuth();
    initMemberAuthModal();
    initOnboardingWizard();
    initOneTapModalButton();
    initJoinHub();
    initGuestbookEvents();

    try {
      const status = await api("/api/member/auth/status");
      state.googleEnabled = Boolean(status.googleEnabled);
      state.member = status.authenticated && status.member ? status.member : null;
    } catch (_err) {
      state.member = null;
    }

    onAuthChanged();
  }

  boot();
})();
