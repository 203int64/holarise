/**
 * Shared WebAuthn Passkey (Face ID / Touch ID / Windows Hello) client helper
 * for HolaRise Media Portal (/media/) and Admin CMS (/admin/).
 */
(() => {
  "use strict";

  function bytesToBase64Url(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(str) {
    const clean = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = clean.length % 4 === 0 ? "" : "=".repeat(4 - (clean.length % 4));
    const bin = atob(clean + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isSupported() {
    return (
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined" &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.credentials)
    );
  }

  async function postJson(url, payload = {}) {
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `Lỗi xác thực sinh trắc học (HTTP ${res.status}).`);
    }
    return data;
  }

  async function registerPasskey(deviceLabel = "") {
    if (!isSupported()) {
      throw new Error("Trình duyệt hoặc thiết bị này chưa hỗ trợ sinh trắc học (WebAuthn Passkey).");
    }
    const { options } = await postJson("/api/auth/passkey/register-options", {});
    const publicKey = {
      ...options,
      challenge: base64UrlToBytes(options.challenge),
      user: {
        ...options.user,
        id: base64UrlToBytes(options.user.id),
      },
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({
        ...c,
        id: base64UrlToBytes(c.id),
      })),
    };

    const cred = await navigator.credentials.create({ publicKey });
    if (!cred || !cred.response) {
      throw new Error("Đã hủy kích hoạt sinh trắc học.");
    }
    if (typeof cred.response.getPublicKey !== "function") {
      throw new Error("Trình duyệt không hỗ trợ xuất khóa công khai chuẩn WebAuthn Level 2.");
    }

    const spkiBuf = cred.response.getPublicKey();
    const alg = typeof cred.response.getPublicKeyAlgorithm === "function"
      ? cred.response.getPublicKeyAlgorithm()
      : -7;
    const authDataBuf = cred.response.getAuthenticatorData();

    return postJson("/api/auth/passkey/register-verify", {
      credentialId: cred.id,
      publicKeySpki: bytesToBase64Url(spkiBuf),
      algorithm: alg,
      clientDataJSON: bytesToBase64Url(cred.response.clientDataJSON),
      authenticatorData: bytesToBase64Url(authDataBuf),
      challenge: options.challenge,
      deviceLabel: deviceLabel || navigator.platform || "Thiết bị sinh trắc học",
    });
  }

  async function loginWithPasskey(email = "") {
    if (!isSupported()) {
      throw new Error("Trình duyệt hoặc thiết bị này chưa hỗ trợ sinh trắc học (WebAuthn Passkey).");
    }
    const { options } = await postJson("/api/auth/passkey/login-options", email ? { email } : {});
    const publicKey = {
      ...options,
      challenge: base64UrlToBytes(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => ({
        ...c,
        id: base64UrlToBytes(c.id),
      })),
    };

    const assertion = await navigator.credentials.get({ publicKey });
    if (!assertion || !assertion.response) {
      throw new Error("Đã hủy đăng nhập sinh trắc học.");
    }

    return postJson("/api/auth/passkey/login-verify", {
      credentialId: assertion.id,
      clientDataJSON: bytesToBase64Url(assertion.response.clientDataJSON),
      authenticatorData: bytesToBase64Url(assertion.response.authenticatorData),
      signature: bytesToBase64Url(assertion.response.signature),
      challenge: options.challenge,
    });
  }

  window.HolaPasskey = { isSupported, registerPasskey, loginWithPasskey };
})();
