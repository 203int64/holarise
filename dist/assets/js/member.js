/**
 * HolaRise v8 — Unified Member Account, Member Pass Studio, 1-Tap RSVP & Editorial Guestbook
 * Vanilla ES6+, zero dependencies, strictly isolated from Admin CMS (/api/auth/*).
 */
(function () {
  "use strict";

  const isEn =
    (document.documentElement &&
      (document.documentElement.lang === "en" ||
        document.documentElement.dataset.lang === "en")) ||
    /^\/en(\/|$)/i.test((window.location && window.location.pathname) || "");
  const t = (vi, en) => (isEn ? en : vi);

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
      badge: t("HolaHeart · Nội lực", "HolaHeart · Stillness"),
      label: "HolaHeart",
      greeting: t(
        "Hẹn gặp bạn trong những buổi đối thoại giá trị sống và âm nhạc sâu lắng tại Hòa Lạc.",
        "See you at our peer-listening circles and acoustic evenings in Hoa Lac."
      ),
    },
    holagreen: {
      theme: "emerald",
      badge: t("HolaGreen · Sinh thái", "HolaGreen · Ecology"),
      label: "HolaGreen",
      greeting: t(
        "Cùng nhau giữ xanh cảnh quan Hòa Lạc bằng những hành động bền bỉ và thiết thực.",
        "Keeping Hoa Lac green together through quiet, consistent ecological action."
      ),
    },
    holaconnect: {
      theme: "slate",
      badge: t("HolaConnect · Phụng sự", "HolaConnect · Service"),
      label: "HolaConnect",
      greeting: t(
        "Đưa tri thức và lòng trắc ẩn hòa vào đời sống cộng đồng địa phương tại Hòa Lạc.",
        "Sharing knowledge, outdoor treks, and children's bookshelves across our community."
      ),
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
        headerBtn.setAttribute("aria-label", t(`Thẻ Thành Viên ${m.name} (${m.memberCode})`, `Member Pass ${m.name} (${m.memberCode})`));
      } else {
        headerBtn.classList.remove("is-member-signed-in");
        headerLabel.textContent = t("Đăng nhập", "Sign in");
        headerBtn.removeAttribute("aria-label");
      }
    }

    if (drawerLabel) {
      if (m) {
        drawerLabel.textContent = t(`Thẻ Thành Viên · ${m.name}`, `Member Pass · ${m.name}`);
      } else {
        drawerLabel.textContent = t("Tham gia & Thẻ Thành Viên", "Join & Member Pass");
      }
    }

    const mPhone = String(m?.phoneDisplay || m?.phone || "").trim();
    const hasValidPhone = mPhone.replace(/\D/g, "").length >= 8;

    // Toggle guest login prompts vs hiding redundant identity fields when signed in
    $$("[data-rsvp-guest-prompt]").forEach((el) => {
      el.hidden = Boolean(m);
    });
    $$("[data-guest-identity-fields]").forEach((group) => {
      const nameWrap = group.querySelector("[data-guest-name-field]");
      const phoneWrap = group.querySelector("[data-guest-phone-field]");
      const row = group.querySelector("[data-guest-identity-row]");
      const nameInp = group.querySelector("input[name='fullName']");
      const phoneInp = group.querySelector("input[name='phone']");

      if (m && hasValidPhone) {
        group.hidden = true;
        if (nameWrap) nameWrap.hidden = true;
        if (phoneWrap) phoneWrap.hidden = true;
        if (row) row.classList.remove("is-single-col");
        if (nameInp) nameInp.removeAttribute("required");
        if (phoneInp) phoneInp.removeAttribute("required");
      } else if (m && !hasValidPhone && phoneWrap) {
        // Signed in via Google/Email without phone yet: hide Name, keep Phone visible
        group.hidden = false;
        if (nameWrap) nameWrap.hidden = true;
        phoneWrap.hidden = false;
        if (row) row.classList.add("is-single-col");
        if (nameInp) nameInp.removeAttribute("required");
        if (phoneInp) phoneInp.setAttribute("required", "");
      } else {
        group.hidden = Boolean(m);
        if (nameWrap) nameWrap.hidden = Boolean(m);
        if (phoneWrap) phoneWrap.hidden = Boolean(m);
        if (row) row.classList.remove("is-single-col");
        group.querySelectorAll("input[name='fullName'], input[name='phone']").forEach((inp) => {
          if (m) {
            inp.removeAttribute("required");
          } else {
            inp.setAttribute("required", "");
          }
        });
      }
    });

    // Expose live signed-in member state globally for all page scripts
    window.HolaMember = {
      get member() {
        return state.member;
      },
      getMember: () => state.member,
    };

    // Auto-fill & hide "Người mời (tên bạn)" in #event-share-modal when signed in
    const shareInviterWrap = $("#share-inviter-field-wrap");
    const shareInviterInput = $("#share-inviter-name");
    const shareInviterGrid = $("#share-inviter-grid");
    const shareSignedBar = $("#share-inviter-signed-bar");
    const shareSignedName = $("#share-inviter-signed-name");
    if (shareInviterWrap && shareInviterInput) {
      if (m) {
        shareInviterWrap.hidden = true;
        shareInviterInput.value = m.name || "";
        if (shareInviterGrid) shareInviterGrid.classList.add("is-single-col");
        if (shareSignedBar) shareSignedBar.hidden = false;
        if (shareSignedName) shareSignedName.textContent = m.name || "Thành viên HolaRise";
      } else {
        shareInviterWrap.hidden = false;
        if (shareInviterGrid) shareInviterGrid.classList.remove("is-single-col");
        if (shareSignedBar) shareSignedBar.hidden = true;
      }
    }

    // Auto-fill & hide redundant identity inputs in #feedback-modal when signed in
    const fbMemberBar = $("#fb-member-bar");
    const fbGuestRow = $("#fb-guest-contact-row");
    const fbNameInput = $("#fb-name");
    const fbContactInput = $("#fb-contact");
    if (fbMemberBar && fbGuestRow) {
      if (m) {
        fbMemberBar.hidden = false;
        fbGuestRow.hidden = true;
        const fbAv = $("#fb-member-avatar");
        const fbNm = $("#fb-member-name");
        const fbSub = $("#fb-member-sub");
        if (fbAv) {
          fbAv.innerHTML = m.avatarUrl
            ? `<img src="${esc(m.avatarUrl)}" alt="${esc(m.name)}">`
            : esc((m.name || "H").trim().charAt(0).toUpperCase());
        }
        if (fbNm) fbNm.textContent = m.name || "Thành viên HolaRise";
        if (fbSub) fbSub.textContent = m.email || m.phoneDisplay || "Đang gửi bằng tài khoản của bạn";
        if (fbNameInput) fbNameInput.value = m.name || "";
        if (fbContactInput) fbContactInput.value = m.email || m.phoneDisplay || "";
      } else {
        fbMemberBar.hidden = true;
        fbGuestRow.hidden = false;
      }
    }

    // Member-only Guestbook Composer Identity Sync
    const prAuthGate = $("#pr-auth-gate");
    const prFormEl = $("#public-reflection-form");
    const prMemberBar = $("#pr-member-bar");
    const prOrgInput = $("#pr-org");
    if (prAuthGate && prFormEl) {
      if (m) {
        prAuthGate.hidden = true;
        prFormEl.hidden = false;
        if (prMemberBar) prMemberBar.hidden = false;
        const avEl = $("#pr-member-avatar");
        const nmEl = $("#pr-member-name");
        const subEl = $("#pr-member-sub");
        if (avEl) {
          avEl.innerHTML = m.avatarUrl
            ? `<img src="${esc(m.avatarUrl)}" alt="${esc(m.name)}">`
            : esc((m.name || "H").trim().charAt(0).toUpperCase());
        }
        if (nmEl) nmEl.textContent = m.name || "Thành viên HolaRise";
        if (subEl) {
          subEl.textContent = m.organization
            ? `${m.organization} · Thành viên HolaRise`
            : "Đang viết với tài khoản của bạn";
        }
        if (prOrgInput) prOrgInput.value = m.organization || "";
      } else {
        prAuthGate.hidden = false;
        prFormEl.hidden = true;
      }
    }

    // 1-Tap RSVP Bar in #event-register-modal
    const modalBar = $("#modal-member-rsvp-bar");
    const modalBarTitle = $("#modal-member-bar-title");
    const modalBarSub = $("#modal-member-bar-sub");
    const modalOneTapBtn = $("#modal-member-onetap-btn");
    const modalForm = $("#event-register-modal form[data-club-form]");
    if (modalBar && modalForm) {
      if (m) {
        modalBar.hidden = false;
        if (modalBarTitle) modalBarTitle.textContent = `${m.name} · ${m.memberCode}`;
        if (modalBarSub) {
          modalBarSub.textContent = hasValidPhone
            ? t(
                `${mPhone} — chỉ cần bấm xác nhận để giữ chỗ.`,
                `${mPhone} — click below to reserve in one tap.`
              )
            : t(
                "Bổ sung SĐT / Zalo 1 lần bên dưới để nhận nhắc lịch và mở khóa giữ chỗ 1 chạm.",
                "Add your phone, Zalo, or email once below to receive updates and enable 1-tap RSVP."
              );
        }
        if (modalOneTapBtn) modalOneTapBtn.hidden = !hasValidPhone;
        const fName = modalForm.querySelector('[name="fullName"]');
        const fPhone = modalForm.querySelector('[name="phone"]');
        const fEmail = modalForm.querySelector('[name="email"]');
        const fOrg = modalForm.querySelector('[name="organization"]');
        if (fName) fName.value = m.name || "";
        if (fPhone) fPhone.value = hasValidPhone ? mPhone : "";
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
          wsBarSub.textContent = `${mPhone || m.email || "Tài khoản HolaRise"} — chỉ cần chọn số chỗ và bấm Xác nhận.`;
        }
        const fName = wsForm.querySelector('[name="fullName"]');
        const fPhone = wsForm.querySelector('[name="phone"]');
        const fEmail = wsForm.querySelector('[name="email"]');
        const fOrg = wsForm.querySelector('[name="organization"]');
        if (fName) {
          fName.value = m.name || "";
          fName.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (fPhone) fPhone.value = hasValidPhone ? mPhone : "";
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
      oneTapBtn.textContent = t("Đang giữ chỗ...", "Reserving...");
      try {
        const res = await api("/api/registrations", {
          method: "POST",
          body: {
            source: "event_modal",
            lang: isEn ? "en" : "vi",
            eventId,
            activity: activity || t("Hoạt động HolaRise", "HolaRise Gathering"),
            fullName: state.member.name,
            phone: state.member.phoneDisplay || "",
            email: state.member.email || "",
            organization: state.member.organization || "",
            note: `[${seatsLabel}] ${t("Đăng ký 1 chạm bằng Thẻ", "1-tap RSVP with Member Pass")} ${state.member.memberCode}`,
          },
        });
        document.dispatchEvent(
          new CustomEvent("holarise:registration-success", {
            detail: {
              snapshot: {
                id: res.id || state.member.memberCode,
                source: "event_modal",
                fullName: state.member.name,
                organization: state.member.organization || t("Hòa Lạc", "Hoa Lac"),
                eventId,
                eventTitle: activity || t("Hoạt động HolaRise", "HolaRise Gathering"),
                vibe: seatsLabel,
              },
            },
          })
        );
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      } finally {
        oneTapBtn.disabled = false;
        oneTapBtn.textContent = t("Giữ chỗ 1 chạm", "1-Tap RSVP");
      }
    });

    // Re-hydrate member fields after form.reset() and sync auto-saved phone into live member state
    document.addEventListener("holarise:registration-success", (ev) => {
      if (!state.member) return;
      const savedPhone = ev?.detail?.response?.savedMemberPhone;
      if (savedPhone) {
        state.member.phoneDisplay = savedPhone;
      }
      syncHeaderAndRsvp();
      renderMemberDashboardCard();
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
        google_not_configured: t(
          "Đăng nhập Google chưa được gắn khóa GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET trên Cloudflare Pages. Bạn có thể tiếp tục ngay bằng Email hoặc SĐT bên dưới.",
          "Google sign-in is not yet configured on this deployment. You can continue immediately with your email below."
        ),
        google_cancelled: t(
          "Bạn đã hủy đăng nhập Google. Bạn có thể thử lại hoặc dùng Email / SĐT.",
          "Google sign-in was cancelled. You can try again or continue with your email."
        ),
        google_state_invalid: t(
          "Phiên xác thực Google đã hết hạn. Vui lòng thử lại.",
          "Your Google sign-in session expired. Please try again."
        ),
        account_disabled: t(
          "Tài khoản này đang tạm khóa. Vui lòng liên hệ Ban Điều Phối.",
          "This account is currently paused. Please contact our coordinating team."
        ),
      };
      setStatus(oauthAlert, msgMap[authErr] || t("Không thể đăng nhập bằng Google lúc này. Vui lòng thử lại.", "Could not sign in with Google right now. Please try again."), "error");
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

      // Privacy-safe mode toggle (no server-side account enumeration oracle)
      let modeSwitchBtn = form.querySelector("[data-auth-mode-switch]");
      if (!modeSwitchBtn && stepPassword) {
        modeSwitchBtn = document.createElement("button");
        modeSwitchBtn.type = "button";
        modeSwitchBtn.className = "auth-change-btn";
        modeSwitchBtn.setAttribute("data-auth-mode-switch", "");
        modeSwitchBtn.style.cssText = "margin-top:8px;display:inline-block;padding:0;font-size:0.84rem;";
        stepPassword.appendChild(modeSwitchBtn);
      }

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
          if (submitBtn) submitBtn.textContent = t("Tiếp tục", "Continue");
          idInput?.focus();
        } else if (mode === "login") {
          if (idPill) idPill.hidden = false;
          if (idPillText) idPillText.textContent = lockedIdentifier;
          if (stepIdentify) stepIdentify.hidden = true;
          if (stepNewOnly) stepNewOnly.hidden = true;
          if (stepPassword) stepPassword.hidden = false;
          if (pwLabel) pwLabel.textContent = t("Nhập mật khẩu để đăng nhập", "Enter your password to sign in");
          if (pwInput) {
            pwInput.setAttribute("autocomplete", "current-password");
            pwInput.placeholder = "••••••••";
            pwInput.required = true;
          }
          if (nameInput) nameInput.required = false;
          if (submitBtn) submitBtn.textContent = t("Đăng nhập", "Sign in");
          if (modeSwitchBtn) {
            modeSwitchBtn.textContent = t("Chưa có Thẻ Thành Viên? Tạo thẻ mới →", "New to HolaRise? Create member pass →");
          }
          pwInput?.focus();
        } else if (mode === "register") {
          if (idPill) idPill.hidden = false;
          if (idPillText) idPillText.textContent = `${lockedIdentifier} · ${t("Tài khoản mới", "New account")}`;
          if (stepIdentify) stepIdentify.hidden = true;
          if (stepNewOnly) stepNewOnly.hidden = true;
          if (stepPassword) stepPassword.hidden = false;
          if (pwLabel) pwLabel.innerHTML = t('Tạo mật khẩu <span class="auth-hint-inline">(tối thiểu 6 ký tự)</span>', 'Create a password <span class="auth-hint-inline">(at least 6 characters)</span>');
          if (pwInput) {
            pwInput.setAttribute("autocomplete", "new-password");
            pwInput.placeholder = t("Tạo mật khẩu dễ nhớ", "Choose a password");
            pwInput.required = true;
          }
          if (submitBtn) submitBtn.textContent = t("Tạo thẻ thành viên", "Create member pass");
          if (modeSwitchBtn) {
            modeSwitchBtn.textContent = t("← Đã có thẻ? Quay lại đăng nhập", "← Already have a pass? Sign in");
          }
          pwInput?.focus();
        }
      }

      modeSwitchBtn?.addEventListener("click", () => {
        setMode(mode === "login" ? "register" : "login");
      });

      resetBtn?.addEventListener("click", () => setMode("identify"));

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus(statusEl, "");

        if (mode === "identify") {
          const val = (idInput?.value || "").trim();
          if (!val) {
            setStatus(statusEl, t("Vui lòng nhập Email hoặc Số điện thoại.", "Please enter your email address."), "error");
            idInput?.focus();
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = t("Đang kiểm tra...", "Checking...");
          try {
            const res = await api("/api/member/auth/lookup", {
              method: "POST",
              body: { identifier: val },
            });
            lockedIdentifier = res.normalized || val;
            setMode("login");
          } catch (err) {
            setStatus(statusEl, err.message, "error");
            submitBtn.textContent = t("Tiếp tục", "Continue");
          } finally {
            submitBtn.disabled = false;
          }
          return;
        }

        if (mode === "login") {
          const pw = pwInput?.value || "";
          if (!pw) {
            setStatus(statusEl, t("Vui lòng nhập mật khẩu.", "Please enter your password."), "error");
            pwInput?.focus();
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = t("Đang đăng nhập...", "Signing in...");
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
            const joinPath = isEn ? "/en/join/" : "/tham-gia/";
            if (window.location.pathname !== joinPath) {
              window.location.href = `${joinPath}?onboarding=1`;
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

    // Luma-style 3-Tab Account Hub switcher + Quick Org Chips inside dashboard
    function switchDashTab(tab) {
      $$("[data-dash-tab]", dashView).forEach((btn) => {
        const active = btn.getAttribute("data-dash-tab") === tab;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", String(active));
      });
      $$("[data-dash-pane]", dashView).forEach((pane) => {
        pane.hidden = pane.getAttribute("data-dash-pane") !== tab;
      });
    }

    $$("[data-dash-tab]", dashView).forEach((btn) => {
      btn.addEventListener("click", () => switchDashTab(btn.getAttribute("data-dash-tab")));
    });

    $$("[data-org-chip]", dashView).forEach((chip) => {
      chip.addEventListener("click", () => {
        const targetId = chip.getAttribute("data-org-target") || "prof-org";
        const input = document.getElementById(targetId);
        if (input) {
          input.value = chip.getAttribute("data-org-chip") || "";
          input.focus();
        }
      });
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
        if ($("#dash-pass-contact")) {
          const typedPhone = ($("#prof-phone")?.value || "").trim();
          $("#dash-pass-contact").textContent = typedPhone || state.member.email || "—";
        }
        if ($("#dash-pass-bio")) {
          $("#dash-pass-bio").textContent =
            ($("#prof-bio")?.value || "").trim() ||
            "Sống sâu hơn, xanh hơn và bền bỉ sẻ chia cùng HolaRise.";
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
            phone: state.member.phoneDisplay || "",
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

    // Dashboard controls: Avatar upload, Profile popup, PNG export, Logout
    $("#btn-open-profile-modal")?.addEventListener("click", () => {
      const dlg = $("#member-profile-modal");
      const st = $("#prof-status");
      setStatus(st, "");
      if (dlg && typeof dlg.showModal === "function" && !dlg.open) {
        dlg.showModal();
      }
    });

    $("#btn-download-member-pass")?.addEventListener("click", async () => {
      const btn = $("#btn-download-member-pass");
      const st = $("#dash-avatar-status");
      if (!state.member || !window.HolaPass || typeof window.HolaPass.downloadMemberPassPng !== "function") {
        setStatus(st, "Trình tạo thẻ chưa sẵn sàng, vui lòng tải lại trang.", "error");
        return;
      }
      const prevText = btn ? btn.textContent : "Tải Thẻ (PNG)";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Đang xuất thẻ...";
      }
      setStatus(st, "");
      try {
        const expData = computeMemberExp(state.member, state.dashboard);
        const result = await window.HolaPass.downloadMemberPassPng(state.member, expData);
        if (result === "shared") {
          setStatus(st, "Đã mở bảng lưu / chia sẻ Thẻ Thành Viên.", "success");
        } else if (result === "preview") {
          setStatus(st, "Nhấn giữ vào ảnh thẻ để lưu về máy.", "success");
        } else {
          setStatus(st, "Đã tải Thẻ Thành Viên (PNG) về máy.", "success");
        }
      } catch (err) {
        setStatus(st, err?.message || "Chưa xuất được ảnh thẻ lúc này. Vui lòng thử lại.", "error");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevText;
        }
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

    $("#btn-change-avatar")?.addEventListener("click", () => {
      const inp = $("#dash-avatar-input");
      if (inp) {
        inp.value = "";
        inp.click();
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
            phone: ($("#prof-phone")?.value || "").trim(),
            organization: $("#prof-org").value.trim(),
            primaryPillar: $("#prof-pillar").value,
            bio: $("#prof-bio").value.trim(),
          },
        });
        state.member = res.member;
        renderMemberDashboardCard();
        syncHeaderAndRsvp();
        setStatus(st, "Đã lưu thay đổi hồ sơ thành viên.", "success");
        const dlg = $("#member-profile-modal");
        if (dlg && dlg.open) {
          setTimeout(() => {
            if (dlg.open) dlg.close();
          }, 550);
        }
      } catch (err) {
        setStatus(st, err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Lưu thay đổi";
      }
    });
  }

  function computeMemberExp(m, dashboard) {
    let profileExp = 20;
    if (m?.avatarUrl) profileExp += 10;
    if (m?.organization) profileExp += 10;
    if (m?.bio) profileExp += 10;

    const regs = Array.isArray(dashboard?.registrations)
      ? dashboard.registrations.filter((r) => String(r?.status || "") !== "cancelled")
      : [];
    const refs = Array.isArray(dashboard?.reflections) ? dashboard.reflections : [];

    const eventsCount = regs.length;
    const reflectionsCount = refs.length;
    const totalExp = profileExp + eventsCount * 100 + reflectionsCount * 40;

    const tiers = [
      { level: 1, name: t("Khởi hành", "First Step"), min: 0, next: 150 },
      { level: 2, name: t("Đồng hành", "Companion"), min: 150, next: 400 },
      { level: 3, name: t("Gắn bó", "Dedicated"), min: 400, next: 800 },
      { level: 4, name: t("Lan tỏa", "Steward"), min: 800, next: 800 },
    ];
    let current = tiers[0];
    for (let i = tiers.length - 1; i >= 0; i -= 1) {
      if (totalExp >= tiers[i].min) {
        current = tiers[i];
        break;
      }
    }
    const isMax = current.level === 4;
    const progressPct = isMax
      ? 100
      : Math.max(8, Math.min(100, Math.round(((totalExp - current.min) / (current.next - current.min)) * 100)));

    return {
      level: current.level,
      tierName: current.name,
      tierBadge: `LV.${current.level} · ${current.name.toUpperCase()}`,
      totalExp,
      nextExp: current.next,
      isMax,
      progressPct,
      eventsCount,
      reflectionsCount,
      expText: isMax ? `${totalExp} EXP · ${t("Tối đa", "Max")}` : `${totalExp} / ${current.next} EXP`,
      breakdownText: isEn
        ? `${eventsCount} gatherings · ${reflectionsCount} reflections`
        : `${eventsCount} hoạt động · ${reflectionsCount} lưu bút`,
    };
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
    if ($("#dash-pass-org")) $("#dash-pass-org").textContent = m.organization || t("Cộng đồng Hòa Lạc", "HolaRise Community");
    if ($("#dash-pass-bio")) {
      $("#dash-pass-bio").textContent =
        m.bio || t("Sống sâu hơn, xanh hơn và bền bỉ sẻ chia cùng HolaRise.", "Living grounded, greener, and serving with consistency at HolaRise.");
    }
    if ($("#dash-pass-code")) $("#dash-pass-code").textContent = m.memberCode;
    if ($("#dash-pass-pillar")) $("#dash-pass-pillar").textContent = pillar.label;
    const mPhone = String(m.phoneDisplay || m.phone || "").trim();
    if ($("#dash-pass-contact")) $("#dash-pass-contact").textContent = mPhone || m.email || "—";

    if ($("#prof-name")) $("#prof-name").value = m.name || "";
    if ($("#prof-phone")) $("#prof-phone").value = mPhone;
    if ($("#prof-org")) $("#prof-org").value = m.organization || "";
    if ($("#prof-pillar")) $("#prof-pillar").value = m.primaryPillar || "holaheart";
    if ($("#prof-bio")) $("#prof-bio").value = m.bio || "";

    // Update Step 2 Pass Completion Progress
    let pct = 40;
    const missing = [];
    if (m.avatarUrl) pct += 20;
    else missing.push(t("ảnh đại diện", "avatar"));
    if (m.organization) pct += 20;
    else missing.push(t("trường/đơn vị", "organization"));
    if (m.bio) pct += 20;
    else missing.push(t("châm ngôn", "motto"));
    if ($("#dash-completion-pct")) $("#dash-completion-pct").textContent = `${pct}%`;
    if ($("#dash-completion-fill")) $("#dash-completion-fill").style.width = `${pct}%`;
    if ($("#dash-completion-hint")) {
      $("#dash-completion-hint").textContent =
        pct >= 100
          ? t(
              "Thẻ Thành Viên của bạn đã hoàn thiện 100% — sẵn sàng tải PNG và check-in.",
              "Your Member Pass is 100% complete — ready to save as PNG and check in."
            )
          : t(
              `Bổ sung ${missing.join(", ")} để hoàn thiện 100% Thẻ Thành Viên.`,
              `Add your ${missing.join(", ")} to complete your Member Pass.`
            );
    }

    if ($("#member-completion-box")) {
      $("#member-completion-box").hidden = pct >= 100;
    }

    // Public Editorial Passport link (/tv/[code])
    const pubLink = $("#btn-open-public-passport");
    if (pubLink && m.memberCode) {
      const targetHref = `/tv/${encodeURIComponent(m.memberCode)}${IS_EN ? "?lang=en" : ""}`;
      pubLink.setAttribute("href", targetHref);
      pubLink.dataset.passportUrl = targetHref;
      if (!pubLink.dataset.boundPassportClick) {
        pubLink.dataset.boundPassportClick = "1";
        pubLink.addEventListener("click", (e) => {
          const url = pubLink.dataset.passportUrl || pubLink.getAttribute("href") || "";
          if (url && url.startsWith("/tv/")) {
            e.preventDefault();
            window.open(url, "_blank", "noopener");
          }
        });
      }
    }

    // Editorial welcome heading
    if ($("#dash-welcome-heading")) {
      const firstName = String(m.name || "").trim().split(/\s+/).slice(-1)[0] || m.name || "";
      $("#dash-welcome-heading").textContent = firstName
        ? t(`Chào mừng trở lại, ${firstName}`, `Welcome back, ${firstName}`)
        : t("Hành trình của bạn", "Your Journey");
    }

    // Update Editorial Milestone Badge (no gamey LV.1 / EXP wording)
    const exp = computeMemberExp(m, state.dashboard);
    const cleanTier = String(exp.tierName || t("Khởi hành", "Starter")).toUpperCase();
    if ($("#dash-pass-tier")) $("#dash-pass-tier").textContent = cleanTier;
    if ($("#dash-exp-rank")) $("#dash-exp-rank").textContent = t("Dấu ấn hành trình", "Journey Milestones");
    if ($("#dash-exp-val")) $("#dash-exp-val").textContent = exp.expText;
    if ($("#dash-exp-fill")) $("#dash-exp-fill").style.width = `${exp.progressPct}%`;
    const stats = state.dashboard?.journeyStats || null;
    if ($("#dash-exp-breakdown")) {
      if (stats) {
        const parts = [
          `${stats.activeEvents} ${t("hoạt động", "events")}`,
          `${stats.reflectionsCount} ${t("lưu bút", "reflections")}`,
        ];
        if (stats.contributedPhotosCount > 0) {
          parts.push(`${stats.contributedPhotosCount} ${t("ảnh góp", "photos")}`);
        }
        $("#dash-exp-breakdown").textContent = parts.join(" · ");
      } else {
        $("#dash-exp-breakdown").textContent = exp.breakdownText;
      }
    }

    // Update 4 Editorial Journey Metrics & 3 Pillar Stamps
    if (stats) {
      if ($("#dash-stat-events")) $("#dash-stat-events").textContent = String(stats.activeEvents || 0);
      if ($("#dash-stat-pillars")) $("#dash-stat-pillars").textContent = `${(stats.pillarsTouched || []).length || 1}/3`;
      if ($("#dash-stat-refs")) $("#dash-stat-refs").textContent = String(stats.reflectionsCount || 0);
      if ($("#dash-stat-photos")) $("#dash-stat-photos").textContent = String(stats.contributedPhotosCount || 0);
      const touched = new Set(stats.pillarsTouched || [m.pillarChoice || "holaheart"]);
      $$("[data-pillar-stamp]").forEach((el) => {
        el.classList.toggle("is-active", touched.has(el.getAttribute("data-pillar-stamp")));
      });
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

      // Render Contributed Photos Mosaic if member has contributed photos
      const contribSec = $("#member-contributed-photos-section");
      const contribGrid = $("#member-contributed-photos-grid");
      const contribPhotos = Array.isArray(data.contributedPhotos) ? data.contributedPhotos : [];
      if (contribSec && contribGrid) {
        if (contribPhotos.length > 0) {
          contribSec.hidden = false;
          contribGrid.innerHTML = contribPhotos
            .map((p) => {
              const badge =
                p.approvalStatus === "pending"
                  ? `<span class="member-contrib-status is-pending">${t("Chờ duyệt", "Pending")}</span>`
                  : "";
              const cap = p.caption || p.albumTitle || t("Khoảnh khắc đóng góp", "Contributed photo");
              return `<figure class="member-contrib-card">
                <div class="member-contrib-thumb">
                  <img src="${escHtml(p.url)}" alt="${escHtml(cap)}" loading="lazy">
                  ${badge}
                </div>
                <figcaption>${escHtml(p.albumTitle || cap)}</figcaption>
              </figure>`;
            })
            .join("");
        } else {
          contribSec.hidden = true;
        }
      }

      const bookingsBox = $("#member-bookings-list");
      const walletSummary = $("#member-wallet-summary");
      const regs = data.registrations || [];

      const PILLAR_META = {
        holaheart: { label: "HolaHeart", sub: t("Tĩnh tại & Lắng nghe", "Stillness & Listening") },
        holagreen: { label: "HolaGreen", sub: t("Sinh thái & Cảnh quan", "Ecology & Landscapes") },
        holaconnect: { label: "HolaConnect", sub: t("Tri thức & Phụng sự", "Knowledge & Service") },
      };

      function getStatusLabel(st) {
        if (st === "attended") return t("Đã tham dự", "Attended");
        if (st === "contacted") return t("Đã xác nhận", "Confirmed");
        if (st === "cancelled") return t("Đã hủy", "Cancelled");
        return t("Đã giữ chỗ", "Reserved");
      }

      function getScheduleText(r) {
        const parts = [r.eventTime, r.eventDateDisplay || r.eventDate].filter(Boolean);
        return parts.length ? parts.join(" · ") : formatDateVi(r.createdAt || r.created_at);
      }

      function buildWalletSnapshot(r) {
        const m = state.member || {};
        const pillarKey = PILLAR_META[r.eventPillar] ? r.eventPillar : "holaheart";
        const pm = PILLAR_META[pillarKey];
        return {
          id: r.id,
          eventId: r.eventId || r.event_id || "",
          eventTitle: r.activityTitle || r.activity_title || t("Hoạt động HolaRise", "HolaRise Gathering"),
          eventType: r.eventType || `${pm.label} · ${pm.sub}`,
          badge: r.eventType || `${pm.label} · ${pm.sub}`,
          pillar: pillarKey,
          eventDate: r.eventDateDisplay || r.eventDate || "",
          eventTime: r.eventTime || "",
          eventLocation: r.eventLocation || t("Hòa Lạc, Hà Nội", "Hoa Lac, Hanoi"),
          eventSummary: r.eventSummary || "",
          fullName: r.fullName || m.name || t("Thành viên Hola", "Hola Member"),
          organization: r.organization || m.organization || t("Cộng đồng HolaRise", "HolaRise Community"),
          status: r.status || "new",
        };
      }

      const walletDlg = $("#member-wallet-dialog");
      const walletDlgBody = $("#wallet-dlg-body");
      const walletDlgKicker = $("#wallet-dlg-kicker");
      const walletDlgLink = $("#wallet-dlg-link");
      const walletDlgClose = $("#wallet-dlg-close");
      const walletDlgDownload = $("#wallet-dlg-download");

      function openWalletDialog(reg) {
        if (!walletDlg || !walletDlgBody || !reg) return;
        state.activeWalletReg = reg;
        const pillarKey = PILLAR_META[reg.eventPillar] ? reg.eventPillar : "holaheart";
        const pm = PILLAR_META[pillarKey];
        const title = reg.activityTitle || reg.activity_title || t("Hoạt động HolaRise", "HolaRise Gathering");
        const schedule = getScheduleText(reg);
        const location = reg.eventLocation || t("Hòa Lạc, Hà Nội", "Hoa Lac, Hanoi");
        const statusText = getStatusLabel(reg.status);
        const holderName = reg.fullName || state.member?.name || t("Thành viên Hola", "Hola Member");
        const holderOrg = reg.organization || state.member?.organization || t("Cộng đồng HolaRise", "HolaRise Community");

        if (walletDlgKicker) {
          walletDlgKicker.textContent = `${pm.label} · ${t("Thẻ sự kiện", "Event Pass")}`;
        }

        walletDlgBody.innerHTML = `<article class="wallet-full-pass wallet-full-pass--${esc(pillarKey)}">
          <div class="wallet-full-head">
            <span class="wallet-full-brand">${t("HOLARISE · HÒA LẠC", "HOLARISE · HOA LAC")}</span>
            <span class="wallet-status-chip wallet-status-chip--${esc(reg.status || "new")}">${esc(statusText)}</span>
          </div>
          <span class="wallet-pillar-pill">${esc(reg.eventType || `${pm.label} · ${pm.sub}`)}</span>
          <h3 id="wallet-dlg-title" class="wallet-full-title">${esc(title)}</h3>
          <p class="wallet-full-holder">${esc(holderName)} · ${esc(holderOrg)}</p>
          <div class="wallet-full-divider" aria-hidden="true"></div>
          <dl class="wallet-full-grid">
            <div>
              <dt>${t("Thời gian", "When")}</dt>
              <dd>${esc(schedule)}</dd>
            </div>
            <div>
              <dt>${t("Địa điểm", "Where")}</dt>
              <dd>${esc(location)}</dd>
            </div>
            <div>
              <dt>${t("Mã giữ chỗ", "Booking Ref")}</dt>
              <dd class="wallet-code">${esc(reg.id)}</dd>
            </div>
            <div>
              <dt>${t("Ngày đăng ký", "Reserved on")}</dt>
              <dd>${esc(formatDateVi(reg.createdAt || reg.created_at))}</dd>
            </div>
          </dl>
          ${reg.note ? `<p class="wallet-full-note">${t("Ghi chú:", "Note:")} ${esc(reg.note)}</p>` : ""}
          <div class="wallet-full-foot">
            <span>HOLARISE.ORG</span>
            <span>${reg.status === "attended" ? t("ĐÃ ĐÓNG DẤU THAM DỰ", "ATTENDANCE VERIFIED") : t("THẺ GIỮ CHỖ ĐIỆN TỬ", "DIGITAL EVENT PASS")}</span>
          </div>
        </article>`;

        if (walletDlgLink) {
          if (reg.eventHref) {
            walletDlgLink.href = isEn && reg.eventHref.startsWith("/su-kien/")
              ? reg.eventHref.replace(/^\/su-kien\//, "/en/events/")
              : reg.eventHref;
            walletDlgLink.hidden = false;
          } else {
            walletDlgLink.hidden = true;
          }
        }

        if (typeof walletDlg.showModal === "function") {
          if (!walletDlg.open) walletDlg.showModal();
        } else {
          walletDlg.setAttribute("open", "");
        }
      }

      if (walletDlg && !walletDlg.dataset.bound) {
        walletDlg.dataset.bound = "1";
        walletDlgClose?.addEventListener("click", () => {
          if (typeof walletDlg.close === "function") walletDlg.close();
          else walletDlg.removeAttribute("open");
        });
        walletDlg.addEventListener("click", (e) => {
          if (e.target === walletDlg) {
            if (typeof walletDlg.close === "function") walletDlg.close();
            else walletDlg.removeAttribute("open");
          }
        });
        walletDlgDownload?.addEventListener("click", () => {
          if (!state.activeWalletReg) return;
          if (window.HolaPass && typeof window.HolaPass.downloadPassPng === "function") {
            window.HolaPass.downloadPassPng(buildWalletSnapshot(state.activeWalletReg));
          }
        });
      }

      if (bookingsBox) {
        if (!regs.length) {
          if (walletSummary) walletSummary.hidden = true;
          bookingsBox.innerHTML = isEn
            ? '<p class="member-empty-hint">Your journey wallet has no event passes yet. Visit the <a href="/en/schedule/" style="color:var(--accent);font-weight:500;">Schedule</a> to reserve your first seat in one tap.</p>'
            : '<p class="member-empty-hint">Ví hành trình của bạn chưa có thẻ sự kiện nào. Ghé <a href="/lich-hoat-dong/" style="color:var(--accent);font-weight:500;">Lịch hoạt động</a> để giữ chỗ 1 chạm và nhận thẻ đầu tiên.</p>';
        } else {
          const attendedCount = regs.filter((r) => r.status === "attended").length;
          const activeCount = regs.filter((r) => r.status !== "cancelled" && r.status !== "attended").length;
          if (walletSummary) {
            walletSummary.hidden = false;
            walletSummary.innerHTML = isEn
              ? `
              <span class="wallet-stat-chip"><strong>${regs.length}</strong> ${regs.length === 1 ? "pass" : "passes"} in wallet</span>
              ${activeCount ? `<span class="wallet-stat-chip"><strong>${activeCount}</strong> upcoming</span>` : ""}
              ${attendedCount ? `<span class="wallet-stat-chip wallet-stat-chip--attended"><strong>${attendedCount}</strong> attended</span>` : ""}
              <span class="wallet-stat-hint">Tap a pass to view details &amp; download PNG</span>
            `
              : `
              <span class="wallet-stat-chip"><strong>${regs.length}</strong> thẻ trong ví</span>
              ${activeCount ? `<span class="wallet-stat-chip"><strong>${activeCount}</strong> sắp tham dự</span>` : ""}
              ${attendedCount ? `<span class="wallet-stat-chip wallet-stat-chip--attended"><strong>${attendedCount}</strong> đã hoàn thành</span>` : ""}
              <span class="wallet-stat-hint">Chạm vào thẻ để mở chi tiết &amp; tải PNG</span>
            `;
          }

          bookingsBox.innerHTML = regs
            .map((r, idx) => {
              const pillarKey = PILLAR_META[r.eventPillar] ? r.eventPillar : "holaheart";
              const pm = PILLAR_META[pillarKey];
              const title = r.activityTitle || r.activity_title || t("Hoạt động HolaRise", "HolaRise Gathering");
              const schedule = getScheduleText(r);
              const location = r.eventLocation || t("Hòa Lạc, Hà Nội", "Hoa Lac, Hanoi");
              const statusText = getStatusLabel(r.status);
              const isFront = idx === regs.length - 1;
              return `<button type="button" class="wallet-card wallet-card--${esc(pillarKey)}${isFront ? " is-front" : ""}" data-wallet-idx="${idx}" style="--card-index:${idx};">
                <div class="wallet-card-top">
                  <span class="wallet-card-pillar">${esc(pm.label)}</span>
                  <span class="wallet-status-chip wallet-status-chip--${esc(r.status || "new")}">${esc(statusText)}</span>
                </div>
                <div class="wallet-card-title">${esc(title)}</div>
                <div class="wallet-card-meta">
                  <span>${esc(schedule)}</span>
                  <span>${esc(location)}</span>
                </div>
                <div class="wallet-card-foot">
                  <code class="wallet-code">${esc(r.id)}</code>
                  <span class="wallet-card-cta">${t("Mở thẻ →", "Open pass →")}</span>
                </div>
              </button>`;
            })
            .join("");

          bookingsBox.querySelectorAll("[data-wallet-idx]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const i = Number(btn.getAttribute("data-wallet-idx"));
              if (Number.isInteger(i) && regs[i]) {
                openWalletDialog(regs[i]);
              }
            });
          });
        }
      }

      const refsBox = $("#member-reflections-list");
      const refs = data.reflections || [];
      if (refsBox) {
        if (!refs.length) {
          refsBox.innerHTML = isEn
            ? '<p class="member-empty-hint">You have not posted any reflections yet. Open a gathering in <a href="/en/journey/" style="color:var(--accent);font-weight:500;">Journey</a> to share what stayed with you.</p>'
            : '<p class="member-empty-hint">Bạn chưa gửi lưu bút nào. Mở một bài trong <a href="/hanh-trinh/" style="color:var(--accent);font-weight:500;">Hành trình</a> để chia sẻ cảm nhận.</p>';
        } else {
          const refBase = isEn ? "/en/journey/" : "/hanh-trinh/";
          refsBox.innerHTML = refs
            .map(
              (rf) => `<div class="member-list-item">
                <div>
                  <a href="${refBase}${esc(rf.activitySlug)}/#activity-guestbook"><strong>${esc(rf.pullQuote || rf.content.slice(0, 72))}</strong></a>
                  <span class="member-list-meta">${esc(rf.participantRole)} · ${esc(formatDateVi(rf.createdAt))} · ${Number(rf.heartCount ?? rf.heartsCount ?? 0)} lượt đồng cảm</span>
                </div>
                <span class="member-status-pill member-status-pill--${esc(rf.status)}">${
                  rf.status === "approved"
                    ? t("Đã xuất bản", "Published")
                    : rf.status === "rejected"
                      ? t("Đang ẩn", "Hidden")
                      : t("Chờ duyệt", "Pending")
                }</span>
              </div>`
            )
            .join("");
        }
      }
    } catch (_err) {}
  }

  let pendingContributeCtx = null;

  function initAlbumContributeDialog() {
    const dialog = $("#member-contribute-dialog");
    if (!dialog) return;

    const eventLabelEl = $("#contribute-dlg-event-label");
    const tabBtns = $$("[data-contrib-tab-btn]", dialog);
    const panelFeedback = $("#panel-contrib-feedback");
    const panelPhotos = $("#panel-contrib-photos");

    // Tab 1: Event Feedback (open to guests & members, supports strict anonymization)
    const efForm = $("#event-feedback-form");
    const efEventId = $("#ef-event-id");
    const efEventSlug = $("#ef-event-slug");
    const efEventTitle = $("#ef-event-title");
    const efMemberBar = $("#ef-member-identity-bar");
    const efMemberAvatar = $("#ef-member-avatar");
    const efMemberName = $("#ef-member-name");
    const efMemberSub = $("#ef-member-sub");
    const efAnonCheck = $("#ef-anon-check");
    const efGuestWrap = $("#ef-guest-identity-wrap");
    const efGuestAnonCheck = $("#ef-guest-anon-check");
    const efIdentityRow = $("#ef-identity-row");
    const efName = $("#ef-name");
    const efContact = $("#ef-contact");
    const efContent = $("#ef-content");
    const efStatus = $("#ef-status");
    const efSubmitBtn = $("#ef-submit-btn");

    // Tab 2: Member-only Original Photo & Video Upload to Standardized Drive Folder
    const photoAuthGate = $("#contribute-photo-auth-gate");
    const photoMemberBody = $("#contribute-photo-member-body");
    const photoSignInBtn = $("#contribute-photo-signin-btn");
    const form = $("#member-contribute-form");
    const albumSelect = $("#contribute-album-select");
    const creditInput = $("#contribute-credit");
    const fileInput = $("#contribute-files");
    const pickBtn = $("#contribute-pick-btn");
    const queueBox = $("#contribute-queue");
    const queueSummary = $("#contribute-queue-summary");
    const fileListEl = $("#contribute-file-list");
    const clearBtn = $("#contribute-clear-btn");
    const progressWrap = $("#contribute-progress");
    const progressBar = $("#contribute-progress-bar");
    const statusEl = $("#contribute-status");
    const submitBtn = $("#contribute-submit-btn");
    const stopBtn = $("#contribute-stop-btn");

    let activeTab = "feedback";
    let currentCtx = { eventId: "", eventSlug: "", eventTitle: "", albumId: "" };
    let queue = [];
    let uploading = false;
    let stopRequested = false;
    let maxUploadBytes = 25 * 1024 * 1024;
    let maxVideoUploadBytes = 50 * 1024 * 1024;
    let albumsLoadedForMember = "";

    function isContribVideoFile(file) {
      if (!file) return false;
      const mime = String(file.type || "").toLowerCase();
      if (/^video\/(mp4|quicktime|webm)$/i.test(mime)) return true;
      return /\.(mp4|mov|webm)$/i.test(String(file.name || ""));
    }

    function isContribImageFile(file) {
      if (!file) return false;
      const mime = String(file.type || "").toLowerCase();
      if (/^image\/(jpeg|jpg|png|webp)$/i.test(mime)) return true;
      return /\.(jpe?g|png|webp)$/i.test(String(file.name || ""));
    }

    function syncFeedbackIdentity() {
      const m = state.member;
      if (m) {
        if (efMemberBar) efMemberBar.hidden = false;
        if (efGuestWrap) efGuestWrap.hidden = true;
        const isAnon = Boolean(efAnonCheck?.checked);
        if (efMemberAvatar) {
          efMemberAvatar.innerHTML = m.avatarUrl
            ? `<img src="${esc(m.avatarUrl)}" alt="${esc(m.name)}">`
            : esc((m.name || "H").trim().charAt(0).toUpperCase());
        }
        if (efMemberName) efMemberName.textContent = m.name || t("Thành viên HolaRise", "HolaRise Member");
        if (efMemberSub) {
          const contact = m.phoneDisplay || m.email || m.memberCode || "";
          efMemberSub.textContent = isAnon
            ? t(
                "Đang gửi ẩn danh hoàn toàn — không lưu tên hay liên hệ",
                "Sending fully anonymously — no name or contact stored"
              )
            : contact
              ? t(`Gửi kèm thông tin · ${contact}`, `Sending with details · ${contact}`)
              : t("Gửi kèm thông tin tài khoản của bạn", "Sending with your member account");
        }
      } else {
        if (efMemberBar) efMemberBar.hidden = true;
        if (efGuestWrap) efGuestWrap.hidden = false;
        const isGuestAnon = Boolean(efGuestAnonCheck?.checked);
        if (efIdentityRow) efIdentityRow.hidden = isGuestAnon;
      }
    }

    function syncContributeIdentity() {
      const m = state.member;
      if (photoAuthGate && photoMemberBody) {
        photoAuthGate.hidden = Boolean(m);
        photoMemberBody.hidden = !m;
      }
      if (!m) return;
      const av = $("#contribute-member-avatar");
      const nm = $("#contribute-member-name");
      const sub = $("#contribute-member-sub");
      if (av) {
        av.innerHTML = m.avatarUrl
          ? `<img src="${esc(m.avatarUrl)}" alt="${esc(m.name)}">`
          : esc((m.name || "H").trim().charAt(0).toUpperCase());
      }
      if (nm) nm.textContent = m.name || t("Thành viên HolaRise", "HolaRise Member");
      if (sub) {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        sub.textContent = t(
          `Thư mục chuẩn hóa: dong-gop/${stamp}_${m.memberCode || ""}_...`,
          `Standardized folder: dong-gop/${stamp}_${m.memberCode || ""}_...`
        );
      }
      if (creditInput && !creditInput.value.trim()) {
        creditInput.value = m.name || "";
      }
    }

    function setActiveTab(nextTab) {
      activeTab = nextTab === "photos" ? "photos" : "feedback";
      tabBtns.forEach((btn) => {
        const isOn = btn.getAttribute("data-contrib-tab-btn") === activeTab;
        btn.classList.toggle("is-active", isOn);
        btn.setAttribute("aria-selected", isOn ? "true" : "false");
      });
      if (panelFeedback) panelFeedback.hidden = activeTab !== "feedback";
      if (panelPhotos) panelPhotos.hidden = activeTab !== "photos";
      syncContributeIdentity();
      if (activeTab === "photos" && state.member && albumsLoadedForMember !== state.member.id) {
        loadAlbumsIntoSelect(currentCtx.albumId || "");
      }
    }

    function formatSizeMb(bytes) {
      const mb = bytes / (1024 * 1024);
      return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    function renderQueue() {
      const total = queue.length;
      const done = queue.filter((q) => q.status === "done").length;
      const pending = queue.filter((q) => q.status === "pending" || q.status === "error").length;

      if (queueBox) queueBox.hidden = total === 0;
      if (queueSummary) {
        queueSummary.textContent =
          done > 0
            ? t(`Đã gửi ${done} / ${total} tệp`, `Uploaded ${done} / ${total} files`)
            : t(`${total} tệp đã chọn`, `${total} ${total === 1 ? "file" : "files"} selected`);
      }
      if (progressWrap && progressBar) {
        progressWrap.hidden = !uploading && done === 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        progressBar.style.width = `${pct}%`;
      }
      if (clearBtn) clearBtn.disabled = uploading;
      if (pickBtn) pickBtn.disabled = uploading;
      if (albumSelect) albumSelect.disabled = uploading;
      if (stopBtn) stopBtn.hidden = !uploading;
      if (submitBtn) {
        submitBtn.disabled = uploading || pending === 0 || !albumSelect?.value;
        submitBtn.textContent = uploading
          ? t(`Đang gửi (${done + 1}/${total})...`, `Uploading (${done + 1}/${total})...`)
          : done > 0 && pending > 0
            ? t(`Gửi tiếp ${pending} tệp chưa hoàn tất`, `Retry ${pending} remaining file(s)`)
            : t(
                `Gửi ${pending || total} tệp vào thư mục sự kiện`,
                `Upload ${pending || total} file(s) to event folder`
              );
      }
      if (fileListEl) {
        fileListEl.innerHTML = queue
          .map((item, idx) => {
            const isVid = item.mediaType === "video";
            const stateLabel =
              item.status === "done"
                ? item.savedName
                  ? `✓ ${item.savedName}`
                  : t("✓ Đã vào thư mục chờ duyệt", "✓ Saved and pending review")
                : item.status === "uploading"
                  ? t("Đang tải lên...", "Uploading...")
                  : item.status === "error"
                    ? item.message || t("Lỗi tải lên", "Upload error")
                    : `${isVid ? "Video · " : ""}${formatSizeMb(item.file.size)}`;
            const removeHtml =
              !uploading && item.status !== "done"
                ? `<button type="button" class="contribute-item-remove" data-remove-contrib-idx="${idx}" aria-label="${esc(t("Gỡ ", "Remove ") + item.file.name)}">×</button>`
                : "";
            return `<li class="contribute-file-item is-${item.status}">
              <span class="contribute-file-name">${isVid ? '<span class="contribute-kind-tag">Video</span>' : ""}${esc(item.file.name)}</span>
              <span class="contribute-file-state">${esc(stateLabel)}</span>
              ${removeHtml}
            </li>`;
          })
          .join("");
      }
    }

    async function loadAlbumsIntoSelect(preferredAlbumId = "") {
      if (!albumSelect || !state.member) return;
      albumSelect.innerHTML = `<option value="">${t("Đang tải danh sách bộ ảnh...", "Loading event albums...")}</option>`;
      try {
        const res = await api("/api/member/albums");
        albumsLoadedForMember = state.member.id;
        const items = res.items || [];
        if (res.maxUploadBytes) maxUploadBytes = Number(res.maxUploadBytes);
        if (res.maxVideoUploadBytes) maxVideoUploadBytes = Number(res.maxVideoUploadBytes);
        if (!items.length) {
          albumSelect.innerHTML = `<option value="">${t("Chưa có bộ ảnh sự kiện nào đang mở", "No open event albums yet")}</option>`;
          renderQueue();
          return;
        }
        albumSelect.innerHTML = items
          .map((a) => {
            const datePart = a.dateDisplay ? ` (${a.dateDisplay})` : "";
            const myPart =
              a.myPendingCount > 0
                ? t(
                    ` · ${a.myPendingCount} ảnh của bạn chờ duyệt`,
                    ` · ${a.myPendingCount} of yours pending`
                  )
                : "";
            return `<option value="${esc(a.id)}">${esc(a.title + datePart + myPart)}</option>`;
          })
          .join("");
        const matchByAlbum = preferredAlbumId && items.find((a) => a.id === preferredAlbumId);
        const matchByEvent = !matchByAlbum && currentCtx.eventId && items.find((a) => a.eventId === currentCtx.eventId);
        if (matchByAlbum) {
          albumSelect.value = matchByAlbum.id;
        } else if (matchByEvent) {
          albumSelect.value = matchByEvent.id;
        }
      } catch (err) {
        albumSelect.innerHTML = `<option value="">${t("Không tải được danh sách bộ ảnh", "Could not load albums")}</option>`;
        if (statusEl) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = err?.message || t("Chưa thể tải danh sách bộ ảnh lúc này.", "Could not load event albums right now.");
        }
      }
      renderQueue();
    }

    async function openContributeDialog(opts = {}) {
      const tab = opts.tab === "photos" ? "photos" : "feedback";
      currentCtx = {
        eventId: opts.eventId || "",
        eventSlug: opts.eventSlug || "",
        eventTitle: opts.eventTitle || "",
        albumId: opts.albumId || "",
      };

      if (efEventId) efEventId.value = currentCtx.eventId;
      if (efEventSlug) efEventSlug.value = currentCtx.eventSlug;
      if (efEventTitle) efEventTitle.value = currentCtx.eventTitle;
      if (eventLabelEl) {
        if (currentCtx.eventTitle) {
          eventLabelEl.textContent = t(`Buổi gặp: ${currentCtx.eventTitle}`, `Gathering: ${currentCtx.eventTitle}`);
          eventLabelEl.hidden = false;
        } else {
          eventLabelEl.textContent = "";
          eventLabelEl.hidden = true;
        }
      }

      if (efStatus) {
        efStatus.className = "form-status";
        efStatus.textContent = "";
      }
      if (statusEl) {
        statusEl.className = "form-status";
        statusEl.textContent = "";
      }

      syncFeedbackIdentity();
      setActiveTab(tab);

      if (typeof dialog.showModal === "function" && !dialog.open) {
        dialog.showModal();
      }
      if (tab === "photos" && state.member) {
        await loadAlbumsIntoSelect(currentCtx.albumId || "");
      }
    }

    window.__openMemberContributeDialog = openContributeDialog;

    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (uploading) return;
        setActiveTab(btn.getAttribute("data-contrib-tab-btn") || "feedback");
      });
    });

    if (photoSignInBtn) {
      photoSignInBtn.addEventListener("click", () => {
        pendingContributeCtx = { ...currentCtx, tab: "photos" };
        if (dialog.open) dialog.close();
        const authDlg = $("#member-auth-modal");
        if (authDlg && typeof authDlg.showModal === "function") {
          authDlg.showModal();
        } else {
          window.location.href = isEn ? "/en/join/" : "/tham-gia/";
        }
      });
    }

    if (efAnonCheck) {
      efAnonCheck.addEventListener("change", syncFeedbackIdentity);
    }
    if (efGuestAnonCheck) {
      efGuestAnonCheck.addEventListener("change", syncFeedbackIdentity);
    }

    if (efForm) {
      efForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (efStatus) {
          efStatus.className = "form-status";
          efStatus.textContent = "";
        }
        const fd = new FormData(efForm);
        const content = String(fd.get("content") || "").trim();
        if (content.length < 8) {
          if (efStatus) {
            efStatus.className = "form-status is-error";
            efStatus.textContent = t(
              "Nội dung đóng góp cần ít nhất 8 ký tự.",
              "Please write at least 8 characters."
            );
          }
          return;
        }
        if (efSubmitBtn) {
          efSubmitBtn.disabled = true;
          efSubmitBtn.textContent = t("Đang gửi...", "Sending...");
        }
        try {
          const m = state.member;
          const isAnonymous = m ? Boolean(efAnonCheck?.checked) : Boolean(efGuestAnonCheck?.checked);
          const payload = {
            eventId: String(fd.get("eventId") || "").trim(),
            eventSlug: String(fd.get("eventSlug") || "").trim(),
            eventTitle: String(fd.get("eventTitle") || "").trim(),
            category: String(fd.get("category") || "cai-thien").trim(),
            content,
            isAnonymous,
            authorName: isAnonymous ? "" : m ? (m.name || "") : String(fd.get("authorName") || "").trim(),
            authorContact: isAnonymous
              ? ""
              : m
                ? (m.phoneDisplay || m.email || "")
                : String(fd.get("authorContact") || "").trim(),
            website: String(fd.get("website") || "").trim(),
            lang: isEn ? "en" : "vi",
          };
          const res = await fetch("/api/event-feedback", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(
              data?.error?.message ||
                data?.message ||
                t("Chưa gửi được đóng góp lúc này.", "Could not send feedback right now.")
            );
          }
          if (efContent) efContent.value = "";
          if (efStatus) {
            efStatus.className = "form-status is-success";
            efStatus.textContent =
              data.message ||
              t(
                "Cảm ơn lời đóng góp chân thành của bạn.",
                "Thank you for your thoughtful feedback."
              );
          }
        } catch (err) {
          if (efStatus) {
            efStatus.className = "form-status is-error";
            efStatus.textContent =
              err?.message || t("Chưa gửi được đóng góp lúc này.", "Could not send feedback right now.");
          }
        } finally {
          if (efSubmitBtn) {
            efSubmitBtn.disabled = false;
            efSubmitBtn.textContent = t(
              "Gửi kín tới Ban Điều Phối",
              "Send privately to Coordinators"
            );
          }
        }
      });
    }

    document.addEventListener("click", (e) => {
      const eventTrigger = e.target.closest("[data-open-event-contribute]");
      if (eventTrigger) {
        const requestedTab = eventTrigger.getAttribute("data-contribute-tab") || "feedback";
        const ctx = {
          tab: requestedTab,
          eventId: eventTrigger.getAttribute("data-event-id") || "",
          eventSlug: eventTrigger.getAttribute("data-event-slug") || "",
          eventTitle: eventTrigger.getAttribute("data-event-title") || "",
          albumId: eventTrigger.getAttribute("data-album-id") || "",
        };
        openContributeDialog(ctx);
        return;
      }

      const albumTrigger = e.target.closest("[data-open-album-contribute]");
      if (!albumTrigger) return;
      const albumId = albumTrigger.getAttribute("data-open-album-contribute") || "";
      const albumTitle = albumTrigger.getAttribute("data-album-title") || "";
      openContributeDialog({ tab: "photos", albumId, eventTitle: albumTitle });
    });

    // Safari fallback for declarative closedby="any" light dismiss
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const isOutside = (ev) => {
        const r = dialog.getBoundingClientRect();
        return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
      };
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (ev) => {
        pressedOutside = !uploading && isOutside(ev);
      });
      dialog.addEventListener("pointerup", (ev) => {
        if (pressedOutside && !uploading && isOutside(ev)) dialog.close();
      });
    }

    dialog.addEventListener("cancel", (e) => {
      if (uploading) {
        e.preventDefault();
        if (statusEl) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = t(
            "Đang tải ảnh lên thư mục sự kiện. Vui lòng đợi hoàn tất hoặc bấm Dừng tải tiếp.",
            "Upload in progress. Please wait until it finishes or click Stop upload."
          );
        }
        if (stopBtn) {
          stopBtn.setAttribute("aria-describedby", "contribute-status");
          stopBtn.focus();
        }
      }
    });

    dialog.addEventListener("close", () => {
      dialog.returnValue = "";
    });

    function enqueueContributeFiles(files, fromPaste = false) {
      if (!files || !files.length || uploading) return;
      let firstError = "";
      let addedCount = 0;
      for (const file of files) {
        const isVid = isContribVideoFile(file);
        const isImg = !isVid && isContribImageFile(file);
        if (!isImg && !isVid) {
          if (!firstError) {
            firstError = `${file.name || t("Tệp", "File")}: ${t("chỉ hỗ trợ ảnh JPEG/PNG/WebP hoặc video MP4/MOV/WebM.", "only JPEG/PNG/WebP images or MP4/MOV/WebM videos are supported.")}`;
          }
          continue;
        }
        const limit = isVid ? maxVideoUploadBytes : maxUploadBytes;
        if (file.size > limit) {
          const maxMb = Math.round(limit / (1024 * 1024));
          if (!firstError) {
            firstError = isEn
              ? `${file.name || "File"}: exceeds the ${maxMb} MB limit per ${isVid ? "video" : "photo"}.`
              : `${file.name || "Tệp"}: vượt quá giới hạn ${maxMb} MB mỗi ${isVid ? "video" : "ảnh"}.`;
          }
          continue;
        }
        queue.push({ file, mediaType: isVid ? "video" : "image", status: "pending", message: "", savedName: "" });
        addedCount += 1;
      }
      if (statusEl) {
        if (firstError) {
          statusEl.className = "form-status is-error";
          statusEl.textContent = firstError;
        } else if (fromPaste && addedCount > 0) {
          statusEl.className = "form-status is-success";
          statusEl.textContent = t(
            `Đã dán ${addedCount} tệp vào danh sách tải lên.`,
            `Pasted ${addedCount} file(s) into the upload queue.`
          );
        } else {
          statusEl.className = "form-status";
          statusEl.textContent = "";
        }
      }
      renderQueue();
    }

    if (pickBtn && fileInput) {
      pickBtn.addEventListener("click", () => {
        if (!uploading) fileInput.click();
      });
      fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = "";
        enqueueContributeFiles(files, false);
      });
    }

    dialog.addEventListener("paste", (e) => {
      if (activeTab !== "photos" || !state.member || uploading) return;
      const cb = e.clipboardData;
      if (!cb) return;
      const pasted = [];
      for (const item of Array.from(cb.items || [])) {
        if (item.kind === "file" && /^image\//i.test(item.type || "")) {
          const f = item.getAsFile();
          if (f) pasted.push(f);
        }
      }
      if (!pasted.length) {
        for (const f of Array.from(cb.files || [])) {
          if (/^image\//i.test(f.type || "")) pasted.push(f);
        }
      }
      if (!pasted.length) return;
      e.preventDefault();
      enqueueContributeFiles(pasted, true);
    });

    if (fileListEl) {
      fileListEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove-contrib-idx]");
        if (!btn || uploading) return;
        const idx = Number(btn.getAttribute("data-remove-contrib-idx"));
        if (Number.isInteger(idx) && idx >= 0 && idx < queue.length) {
          queue.splice(idx, 1);
          renderQueue();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (uploading) return;
        queue = [];
        if (statusEl) {
          statusEl.className = "form-status";
          statusEl.textContent = "";
        }
        renderQueue();
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        stopRequested = true;
        if (statusEl) {
          statusEl.className = "form-status";
          statusEl.textContent = "Đang dừng sau khi hoàn tất ảnh hiện tại...";
        }
      });
    }

    if (albumSelect) {
      albumSelect.addEventListener("change", renderQueue);
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (uploading) return;
        const albumId = String(albumSelect?.value || "").trim();
        if (!albumId) {
          if (statusEl) {
            statusEl.className = "form-status is-error";
            statusEl.textContent = "Vui lòng chọn bộ ảnh sự kiện.";
          }
          return;
        }
        const toSend = queue.filter((q) => q.status === "pending" || q.status === "error");
        if (!toSend.length) return;

        uploading = true;
        stopRequested = false;
        dialog.setAttribute("closedby", "none");
        if (statusEl) {
          statusEl.className = "form-status";
          statusEl.textContent = "";
        }
        renderQueue();

        const credit = String(creditInput?.value || "").trim();
        let okCount = 0;
        let failCount = 0;

        for (const item of toSend) {
          if (stopRequested) break;
          item.status = "uploading";
          item.message = "";
          renderQueue();

          try {
            const fd = new FormData();
            fd.append("file", item.file, item.file.name || "photo.jpg");
            if (credit) fd.append("photographer", credit);
            const res = await fetch(`/api/member/albums/${encodeURIComponent(albumId)}/photos`, {
              method: "POST",
              credentials: "same-origin",
              body: fd,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data?.error?.message || data?.message || `Lỗi HTTP ${res.status}`);
            }
            item.status = "done";
            item.savedName = data.standardizedFilename || "";
            okCount += 1;
          } catch (err) {
            item.status = "error";
            item.message = err?.message || "Tải ảnh thất bại";
            failCount += 1;
          }
          renderQueue();
        }

        uploading = false;
        dialog.setAttribute("closedby", "any");
        renderQueue();

        if (statusEl) {
          if (stopRequested) {
            statusEl.className = "form-status";
            statusEl.textContent = t(
              `Đã dừng tải. ${okCount} ảnh đã lưu vào thư mục chuẩn hóa và chờ Ban Điều Phối duyệt tại /media/.`,
              `Upload paused. ${okCount} file(s) saved and pending review by our Media Team.`
            );
          } else if (failCount === 0 && okCount > 0) {
            statusEl.className = "form-status is-success";
            statusEl.textContent = t(
              `Đã gửi thành công ${okCount} ảnh gốc vào thư mục chuẩn hóa. Ảnh đang chờ kiểm duyệt tại /media/.`,
              `Successfully uploaded ${okCount} original file(s). They will appear once reviewed by our Media Team.`
            );
          } else {
            statusEl.className = "form-status is-error";
            statusEl.textContent = t(
              `Đã lưu ${okCount} ảnh, còn ${failCount} ảnh chưa tải được. Bạn có thể bấm Gửi tiếp để thử lại.`,
              `Uploaded ${okCount} file(s), ${failCount} failed. You can click Retry to upload the remaining files.`
            );
          }
        }
      });
    }
  }

  function onAuthChanged() {
    syncHeaderAndRsvp();
    refreshJoinDashboard();
    window.dispatchEvent(new CustomEvent("hola:member-changed", { detail: { member: state.member } }));
    if (state.member && pendingContributeCtx && typeof window.__openMemberContributeDialog === "function") {
      const ctx = pendingContributeCtx;
      pendingContributeCtx = null;
      window.__openMemberContributeDialog(ctx);
    }
  }

  async function boot() {
    initPasswordToggles();
    initUnifiedAuthForms();
    initPasskeyAuth();
    initMemberAuthModal();
    initAlbumContributeDialog();
    initOnboardingWizard();
    initOneTapModalButton();
    initJoinHub();

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
