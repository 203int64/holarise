/**
 * Stateless HMAC-SHA256 Gate Token helper for the 2-step team vault flow
 * (Step 1: Verify PIN -> Step 2: Login / Register).
 * Key is derived from env.MEDIA_ACCESS_PIN (Cloudflare Secret) — zero DB overhead.
 */

const GATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function constantTimeStringEqual(a, b) {
  const s1 = String(a || "");
  const s2 = String(b || "");
  const len = Math.max(s1.length, s2.length);
  let diff = s1.length ^ s2.length;
  for (let i = 0; i < len; i++) {
    diff |= (s1.charCodeAt(i) || 0) ^ (s2.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`holarise-gate-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createGateToken(secret) {
  const exp = Date.now() + GATE_TTL_MS;
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const payload = `${exp}.${nonce}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyGateToken(token, secret) {
  if (!token || !secret) return false;
  const parts = String(token).trim().split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now() || !nonce || !sig) return false;
  const expectedSig = await hmacHex(secret, `${expStr}.${nonce}`);
  return constantTimeStringEqual(sig, expectedSig);
}
