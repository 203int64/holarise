import assert from "node:assert/strict";
import test from "node:test";

import { verifyTurnstileToken } from "../functions/_lib/turnstile.js";

function makeReq(url = "https://holarise.org/api/registrations") {
  return new Request(url, {
    method: "POST",
    headers: {
      Origin: new URL(url).origin,
      "CF-Connecting-IP": "203.0.113.42",
    },
  });
}

test("Turnstile helper skips transparently when TURNSTILE_SECRET is unset", async () => {
  const res = await verifyTurnstileToken(makeReq(), {}, "", "rsvp");
  assert.deepEqual(res, { ok: true, skipped: true });
});

test("Turnstile helper validates success, action, and hostname (and fails closed on errors)", async () => {
  const env = {
    TURNSTILE_SECRET: "secret-test-key",
    TURNSTILE_HOSTNAMES: "holarise.org,localhost",
  };

  // 1. Missing token -> fail closed
  const missing = await verifyTurnstileToken(makeReq(), env, "", "rsvp");
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "TURNSTILE_REQUIRED");

  // 2. Valid siteverify response -> ok
  const okFetch = async (_url, opts) => {
    const params = new URLSearchParams(opts.body.toString());
    assert.equal(params.get("secret"), "secret-test-key");
    assert.equal(params.get("response"), "valid-token-123");
    assert.equal(params.get("remoteip"), "203.0.113.42");
    return new Response(
      JSON.stringify({ success: true, action: "rsvp", hostname: "holarise.org" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const okRes = await verifyTurnstileToken(makeReq(), env, "valid-token-123", "rsvp", okFetch);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.skipped, false);

  // 3. Action mismatch -> fail closed
  const badActionFetch = async () =>
    new Response(
      JSON.stringify({ success: true, action: "other_action", hostname: "holarise.org" }),
      { status: 200 }
    );
  const badAction = await verifyTurnstileToken(makeReq(), env, "tok", "rsvp", badActionFetch);
  assert.equal(badAction.ok, false);

  // 4. Localhost hostname rejected when request serves production host holarise.org
  const localHostInProdFetch = async () =>
    new Response(
      JSON.stringify({ success: true, action: "rsvp", hostname: "localhost" }),
      { status: 200 }
    );
  const localInProd = await verifyTurnstileToken(makeReq(), env, "tok", "rsvp", localHostInProdFetch);
  assert.equal(localInProd.ok, false);

  // 5. Upstream HTTP 500 or network error -> fail closed
  const errFetch = async () => new Response("Internal error", { status: 500 });
  const errRes = await verifyTurnstileToken(makeReq(), env, "tok", "rsvp", errFetch);
  assert.equal(errRes.ok, false);
  assert.equal(errRes.code, "TURNSTILE_UPSTREAM_ERROR");

  const netErrFetch = async () => {
    throw new Error("ECONNRESET");
  };
  const netErrRes = await verifyTurnstileToken(makeReq(), env, "tok", "rsvp", netErrFetch);
  assert.equal(netErrRes.ok, false);
  assert.equal(netErrRes.code, "TURNSTILE_NETWORK_ERROR");
});
