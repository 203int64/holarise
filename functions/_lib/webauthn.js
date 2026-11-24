/**
 * Pure Web Crypto WebAuthn Level 2 verifier for Cloudflare Workers / Pages Functions.
 * Zero external dependencies. Supports ES256 (-7, P-256) and RS256 (-257, RSA-PSS/PKCS1).
 */

export function bytesToBase64Url(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(str) {
  const clean = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4 === 0 ? "" : "=".repeat(4 - (clean.length % 4));
  const binary = atob(clean + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function generateChallengeBase64Url(byteLen = 32) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function resolveRpId(request) {
  const host = new URL(request.url).hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return host;
  return host;
}

async function sha256(data) {
  const buf = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Convert ASN.1 DER ECDSA signature (from WebAuthn authenticators) to raw IEEE P1363 (r || s, 64 bytes)
 * required by Web Crypto `crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ...)`.
 */
export function derToP1363(derSig, componentLen = 32) {
  const sig = derSig instanceof Uint8Array ? derSig : new Uint8Array(derSig);
  if (sig.length === componentLen * 2 && sig[0] !== 0x30) {
    return sig; // Already raw P1363
  }
  if (sig.length < 8 || sig[0] !== 0x30) {
    throw new Error("Invalid DER ECDSA signature header");
  }
  let offset = 2;
  if (sig[1] & 0x80) {
    offset = 2 + (sig[1] & 0x7f);
  }
  if (sig[offset] !== 0x02) throw new Error("Invalid DER R marker");
  const rLen = sig[offset + 1];
  const rBytes = sig.slice(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;

  if (sig[offset] !== 0x02) throw new Error("Invalid DER S marker");
  const sLen = sig[offset + 1];
  const sBytes = sig.slice(offset + 2, offset + 2 + sLen);

  const out = new Uint8Array(componentLen * 2);
  const rTrim = rBytes.length > componentLen ? rBytes.slice(rBytes.length - componentLen) : rBytes;
  const sTrim = sBytes.length > componentLen ? sBytes.slice(sBytes.length - componentLen) : sBytes;
  out.set(rTrim, componentLen - rTrim.length);
  out.set(sTrim, componentLen * 2 - sTrim.length);
  return out;
}

export async function importSpkiPublicKey(spkiBase64Url, algorithm) {
  const spkiBytes = base64UrlToBytes(spkiBase64Url);
  if (Number(algorithm) === -7) {
    return crypto.subtle.importKey(
      "spki",
      spkiBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  }
  if (Number(algorithm) === -257) {
    return crypto.subtle.importKey(
      "spki",
      spkiBytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  }
  throw new Error(`Unsupported WebAuthn algorithm: ${algorithm}`);
}

export async function verifyClientData(clientDataB64, expectedType, expectedChallenge, expectedOrigin) {
  const rawBytes = base64UrlToBytes(clientDataB64);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBytes));
  } catch {
    return { ok: false, error: "clientDataJSON không hợp lệ." };
  }
  if (parsed.type !== expectedType) {
    return { ok: false, error: "Loại xác thực WebAuthn không khớp." };
  }
  if (parsed.challenge !== expectedChallenge) {
    return { ok: false, error: "Phiên thử thách Passkey không khớp hoặc đã hết hạn." };
  }
  if (parsed.origin !== expectedOrigin) {
    return { ok: false, error: "Nguồn gốc trang (origin) không hợp lệ." };
  }
  return { ok: true, rawBytes, parsed };
}

export async function verifyAuthenticatorData(authDataB64, rpId) {
  const authData = base64UrlToBytes(authDataB64);
  if (authData.length < 37) {
    return { ok: false, error: "authenticatorData không hợp lệ." };
  }
  const rpIdHash = authData.slice(0, 32);
  const expectedRpHash = await sha256(rpId);
  if (!constantTimeEqual(rpIdHash, expectedRpHash)) {
    return { ok: false, error: "RP ID Passkey không khớp tên miền." };
  }
  const flags = authData[32];
  const userPresent = (flags & 0x01) !== 0;
  if (!userPresent) {
    return { ok: false, error: "Thiếu xác nhận hiện diện người dùng (UP)." };
  }
  const signCount =
    ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0;
  return { ok: true, authData, signCount };
}

export async function verifyAssertionSignature({
  publicKeySpki,
  algorithm,
  authenticatorDataBytes,
  clientDataRawBytes,
  signatureB64,
}) {
  const key = await importSpkiPublicKey(publicKeySpki, algorithm);
  const clientDataHash = await sha256(clientDataRawBytes);
  const signedPayload = new Uint8Array(authenticatorDataBytes.length + clientDataHash.length);
  signedPayload.set(authenticatorDataBytes, 0);
  signedPayload.set(clientDataHash, authenticatorDataBytes.length);

  const rawSig = base64UrlToBytes(signatureB64);
  if (Number(algorithm) === -7) {
    const p1363Sig = derToP1363(rawSig, 32);
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      p1363Sig,
      signedPayload
    );
  }
  if (Number(algorithm) === -257) {
    return crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      rawSig,
      signedPayload
    );
  }
  return false;
}
