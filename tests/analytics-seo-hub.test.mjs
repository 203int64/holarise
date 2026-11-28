import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { onRequest as middlewareOnRequest } from "../functions/_middleware.js";
import { onRequestPost as authBootstrap } from "../functions/api/auth/bootstrap.js";
import { onRequestPost as adminUsersPost } from "../functions/api/admin/users/index.js";
import { onRequestPost as authLogin } from "../functions/api/auth/login.js";
import { onRequestPost as memberRegister } from "../functions/api/member/auth/register.js";
import { onRequestPost as telemetryPost } from "../functions/api/telemetry.js";
import { onRequestGet as analyticsGet } from "../functions/api/admin/analytics/index.js";
import { onRequestGet as configGet, onRequestPut as configPut } from "../functions/api/admin/analytics/config.js";
import { onRequestPost as pagespeedPost } from "../functions/api/admin/analytics/pagespeed.js";
import { onRequestPost as indexnowPost } from "../functions/api/admin/analytics/indexnow.js";
import { onRequestGet as gscGet } from "../functions/api/admin/analytics/gsc.js";
import { onRequestGet as cloudflareGet } from "../functions/api/admin/analytics/cloudflare.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function createMockD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "migrations/0001_init.sql",
    "migrations/0002_seed.sql",
    "migrations/0003_media_portal.sql",
    "migrations/0004_holaheart_first_event.sql",
    "migrations/0005_cuoc_doi_cua_cha_event.sql",
    "migrations/0006_member_auth_and_reflections.sql",
    "migrations/0008_cms_members_and_reflections.sql",
    "migrations/0010_admin_passkeys_and_profile.sql",
    "migrations/0011_event_seats_and_slugs.sql",
    "migrations/0012_fix_media_role_and_tables.sql",
    "migrations/0016_media_approval_workflow.sql",
    "migrations/0017_member_photo_contributions.sql",
    "migrations/0018_event_zalo_url.sql",
    "migrations/0019_event_memory_stage.sql",
    "migrations/0020_deep_member_media_event_control.sql",
    "migrations/0021_video_media_support.sql",
    "migrations/0025_companion_chat_and_capabilities.sql",
    "migrations/0026_holarise_manager_rbac_tasks_audit.sql",
    "migrations/0027_manager_pro_invites_review_resources.sql",
    "migrations/0028_unified_feedback_inbox.sql",
    "migrations/0029_analytics_seo_hub.sql",
  ]) {
    db.exec(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }

  class Stmt {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Stmt(this.sql, params);
    }
    async first() {
      return db.prepare(this.sql).get(...this.params) ?? null;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.params) };
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.params);
      return { success: true, meta: { changes: Number(r.changes || 0) } };
    }
  }

  return {
    rawDb: db,
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

function makeReq(urlPath, { method = "GET", body, cookie = "", ip = "14.231.10.22", ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", cf = null } = {}) {
  const headers = new Headers({
    Origin: "https://holarise.org",
    "CF-Connecting-IP": ip,
    "User-Agent": ua,
  });
  if (cookie) headers.set("Cookie", cookie);
  let payload;
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  const req = new Request(`https://holarise.org${urlPath}`, { method, headers, body: payload });
  if (cf) {
    Object.defineProperty(req, "cf", { value: cf, configurable: true });
  }
  return req;
}

function extractCookie(res, name) {
  const raw = res.headers.get("Set-Cookie") || "";
  const m = raw.match(new RegExp(`${name}=([^;]+)`));
  return m ? `${name}=${m[1]}` : "";
}

test("Analytics, Audience Intelligence, Check-in Funnel, Speed & SEO Hub (Super Admin Only)", async () => {
  const d1 = createMockD1();
  const env = { DB: d1 };

  // 1. Bootstrap Sole Super Admin (203int64) and create a delegated event_ops staff account
  const boot = await authBootstrap({
    request: makeReq("/api/auth/bootstrap", {
      method: "POST",
      body: { email: "203int64@holarise.org", name: "Chủ nhiệm Hola", password: "SuperPassword123!" },
    }),
    env,
  });
  assert.equal(boot.status, 201);
  const superCookie = extractCookie(boot, "holarise_session");

  const createStaff = await adminUsersPost({
    request: makeReq("/api/admin/users", {
      method: "POST",
      cookie: superCookie,
      body: {
        email: "ops@holarise.org",
        name: "Điều phối Sự kiện",
        role: "event_ops",
        department: "Ban Sự Kiện",
        password: "StaffPassword123!",
      },
    }),
    env,
  });
  assert.equal(createStaff.status, 201);

  const staffLogin = await authLogin({
    request: makeReq("/api/auth/login", {
      method: "POST",
      body: { email: "ops@holarise.org", password: "StaffPassword123!" },
    }),
    env,
  });
  assert.equal(staffLogin.status, 200);
  const staffCookie = extractCookie(staffLogin, "holarise_session");

  // 2. Strict RBAC Enforcement: Unauthenticated (401) & Delegated Staff (403) MUST be blocked
  const unauthRes = await analyticsGet({ request: makeReq("/api/admin/analytics"), env });
  assert.equal(unauthRes.status, 401);

  for (const [fn, pathStr, method, body] of [
    [analyticsGet, "/api/admin/analytics", "GET", undefined],
    [configGet, "/api/admin/analytics/config", "GET", undefined],
    [configPut, "/api/admin/analytics/config", "PUT", { google_site_verification: "hack" }],
    [pagespeedPost, "/api/admin/analytics/pagespeed", "POST", { url: "/", strategy: "mobile" }],
    [indexnowPost, "/api/admin/analytics/indexnow", "POST", {}],
    [gscGet, "/api/admin/analytics/gsc", "GET", undefined],
    [cloudflareGet, "/api/admin/analytics/cloudflare", "GET", undefined],
  ]) {
    const denied = await fn({ request: makeReq(pathStr, { method, cookie: staffCookie, body }), env });
    assert.equal(denied.status, 403, `Expected 403 for delegated staff on ${pathStr}`);
  }

  // 3. Register a Member to test authenticated Member audience tagging (zero PII leak)
  const memReg = await memberRegister({
    request: makeReq("/api/member/auth/register", {
      method: "POST",
      body: { name: "Minh Anh", phone: "0987654321", email: "minhanh@fpt.edu.vn", password: "MemberPassword123!" },
    }),
    env,
  });
  assert.equal(memReg.status, 201);
  const memberCookie = extractCookie(memReg, "holarise_member_session");

  // 4. Send public telemetry beacons: Zalo WebView guest, 2nd page (clears bounce), Member visit, Bot, Admin (ignored)
  const zaloUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Zalo/240501";
  const cfHanoi = { country: "VN", city: "Hanoi", region: "Hanoi", asOrganization: "FPT Telecom" };

  const pv1 = await telemetryPost({
    request: makeReq("/api/telemetry", {
      method: "POST",
      ip: "118.70.12.99",
      ua: zaloUa,
      cf: cfHanoi,
      body: {
        type: "pageview",
        visitId: "v_zalo_1",
        sessionId: "s_zalo_1",
        path: "/su-kien/tinh-yeu-thuong-cua-me/",
        utmSource: "zalo_fpt",
        utmCampaign: "holaheart_01",
        lang: "vi",
        returning: false,
      },
    }),
    env,
  });
  assert.equal(pv1.status, 204);

  // Engagement flush (active dwell + scroll + CWV + CTA goals)
  const eng1 = await telemetryPost({
    request: makeReq("/api/telemetry", {
      method: "POST",
      ip: "118.70.12.99",
      ua: zaloUa,
      body: {
        type: "engage",
        visitId: "v_zalo_1",
        sessionId: "s_zalo_1",
        path: "/su-kien/tinh-yeu-thuong-cua-me/",
        dwellMs: 65000,
        scrollPct: 85,
        lcpMs: 1850,
        inpMs: 90,
        clsX1000: 35,
        ttfbMs: 240,
        goals: ["open_rsvp", "join_zalo_group"],
      },
    }),
    env,
  });
  assert.equal(eng1.status, 204);

  // Second page in the same session should clear bounce on entry page
  await telemetryPost({
    request: makeReq("/api/telemetry", {
      method: "POST",
      ip: "118.70.12.99",
      ua: zaloUa,
      cf: cfHanoi,
      body: {
        type: "pageview",
        visitId: "v_zalo_2",
        sessionId: "s_zalo_1",
        path: "/en/",
        lang: "en",
        returning: false,
      },
    }),
    env,
  });

  // Logged-in member visit from desktop
  await telemetryPost({
    request: makeReq("/api/telemetry", {
      method: "POST",
      ip: "27.72.100.5",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36",
      cookie: memberCookie,
      cf: { country: "VN", city: "Hanoi", asOrganization: "Viettel Group" },
      body: {
        type: "pageview",
        visitId: "v_mem_1",
        sessionId: "s_mem_1",
        path: "/",
        referrer: "https://www.google.com/",
        lang: "vi",
        returning: true,
      },
    }),
    env,
  });

  // Bot hit (should go ONLY to bots dimension, NOT human pageviews)
  await telemetryPost({
    request: makeReq("/api/telemetry", {
      method: "POST",
      ip: "66.249.66.1",
      ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      body: { type: "pageview", path: "/" },
    }),
    env,
  });

  // Admin path must be completely ignored
  await telemetryPost({
    request: makeReq("/api/telemetry", {
      method: "POST",
      ip: "14.231.10.22",
      body: { type: "pageview", path: "/admin/" },
    }),
    env,
  });

  // Verify raw IP and member PII are NEVER persisted in analytics_recent_visits
  const rawVisits = d1.rawDb.prepare("SELECT * FROM analytics_recent_visits").all();
  const rawDump = JSON.stringify(rawVisits);
  assert.equal(rawDump.includes("118.70.12.99"), false, "Raw IP must never be stored");
  assert.equal(rawDump.includes("0987654321"), false, "Member phone must never be stored in telemetry");
  assert.equal(rawDump.includes("minhanh@fpt.edu.vn"), false, "Member email must never be stored in telemetry");

  // 5. Fetch unified Super-Admin Analytics Dashboard
  const dashRes = await analyticsGet({
    request: makeReq("/api/admin/analytics?days=30", { cookie: superCookie }),
    env,
  });
  assert.equal(dashRes.status, 200);
  const dash = await dashRes.json();
  assert.equal(dash.ok, true);
  assert.equal(dash.summary.views, 3);
  assert.equal(dash.summary.sessions, 2);
  assert.equal(dash.summary.memberViews, 1);
  assert.equal(dash.summary.avgDwellSec, 65);
  assert.equal(dash.summary.avgScrollPct, 85);
  assert.equal(dash.summary.ctaClicks, 2);
  assert.ok(dash.summary.onlineNow >= 2);
  assert.equal(dash.vitals.avgLcpMs, 1850);
  assert.equal(dash.vitals.zaloAvgLcpMs, 1850);

  // Verify audience breakdowns & bot separation
  assert.ok(dash.audience.cities.some((c) => c.label === "Hanoi"));
  assert.ok(dash.audience.isps.some((c) => c.label === "FPT Telecom"));
  assert.ok(dash.audience.browsers.some((c) => c.label === "Zalo In-App"));
  assert.ok(dash.audience.bots.some((b) => b.label === "Googlebot" && b.views === 1));
  assert.ok(dash.liveVisits.some((v) => v.isMember === true && v.sourceLabel === "Google Search"));
  assert.ok(dash.recommendations.length >= 1);

  // 6. Save unified SEO & API config — verify secrets are masked and NEVER returned raw
  const putCfg = await configPut({
    request: makeReq("/api/admin/analytics/config", {
      method: "PUT",
      cookie: superCookie,
      body: {
        telemetry_enabled: true,
        google_site_verification: "gsc-verify-token-abc",
        bing_site_verification: "bing-verify-xyz",
        indexnow_key: "abcdef1234567890abcdef1234567890",
        cf_web_analytics_token: "cf_tok_1234567890",
        cf_zone_id: "0123456789abcdef0123456789abcdef",
        cf_api_token: "cf_secret_graphql_token_xyz999",
        pagespeed_api_key: "AIzaSySecretPageSpeedKey9999",
        gsc_site_url: "sc-domain:holarise.org",
      },
    }),
    env,
  });
  assert.equal(putCfg.status, 200);
  const cfgData = await putCfg.json();
  assert.equal(cfgData.config.has_pagespeed_key, true);
  assert.equal(cfgData.config.has_cf_api_token, true);
  assert.equal(JSON.stringify(cfgData).includes("AIzaSySecretPageSpeedKey9999"), false, "Raw API key must never leak");
  assert.equal(JSON.stringify(cfgData).includes("cf_secret_graphql_token_xyz999"), false, "Raw CF API token must never leak");

  // 7. Verify Edge Middleware dynamic IndexNow key route, SEO meta injection, and passive Bot recording
  const keyFileRes = await middlewareOnRequest({
    request: makeReq("/abcdef1234567890abcdef1234567890.txt"),
    env,
    next: async () => new Response("Not Found", { status: 404 }),
  });
  assert.equal(keyFileRes.status, 200);
  assert.equal((await keyFileRes.text()).trim(), "abcdef1234567890abcdef1234567890");

  const injectedHtmlRes = await middlewareOnRequest({
    request: makeReq("/", { ua: "Mozilla/5.0 (compatible; PerplexityBot/1.0)" }),
    env,
    next: async () =>
      new Response("<!doctype html><html><head><title>HolaRise</title></head><body><h1>Hi</h1></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
  });
  const injectedHtml = await injectedHtmlRes.text();
  assert.ok(injectedHtml.includes('name="google-site-verification" content="gsc-verify-token-abc"'));
  assert.ok(injectedHtml.includes('name="msvalidate.01" content="bing-verify-xyz"'));
  assert.ok(injectedHtml.includes("cloudflareinsights.com/beacon.min.js"));
  assert.ok(injectedHtml.includes("cf_tok_1234567890"));

  // Admin HTML must NOT receive public verification/CF beacons
  const adminHtmlRes = await middlewareOnRequest({
    request: makeReq("/admin/"),
    env,
    next: async () =>
      new Response("<!doctype html><html><head><title>Admin</title></head><body></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
  });
  const adminHtml = await adminHtmlRes.text();
  assert.equal(adminHtml.includes("google-site-verification"), false);

  // 8. SSRF protection on PageSpeed + mocked PSI & IndexNow API execution
  const ssrfRes = await pagespeedPost({
    request: makeReq("/api/admin/analytics/pagespeed", {
      method: "POST",
      cookie: superCookie,
      body: { url: "https://evil.example/secret", strategy: "mobile" },
    }),
    env,
  });
  assert.equal(ssrfRes.status, 400);

  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (targetUrl) => {
      const s = String(targetUrl);
      if (s.includes("pagespeedonline/v5/runPagespeed")) {
        return new Response(
          JSON.stringify({
            lighthouseResult: {
              categories: {
                performance: { score: 0.94 },
                seo: { score: 1.0 },
                accessibility: { score: 0.97 },
                "best-practices": { score: 0.96 },
              },
              audits: {
                "first-contentful-paint": { numericValue: 920 },
                "largest-contentful-paint": { numericValue: 1640 },
                "total-blocking-time": { numericValue: 45 },
                "cumulative-layout-shift": { numericValue: 0.012 },
                "server-response-time": { numericValue: 180 },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (s.includes("api.indexnow.org/indexnow")) {
        return new Response("", { status: 200 });
      }
      if (s.includes("api.cloudflare.com/client/v4/graphql")) {
        return new Response(
          JSON.stringify({
            data: {
              viewer: {
                zones: [
                  {
                    httpRequests1dGroups: [
                      {
                        dimensions: { date: "2026-11-28" },
                        uniq: { uniques: 420 },
                        sum: {
                          requests: 3200,
                          cachedRequests: 2400,
                          bytes: 52428800,
                          cachedBytes: 41943040,
                          pageViews: 980,
                          threats: 14,
                          encryptedRequests: 3190,
                          countryMap: [{ clientCountryName: "VN", requests: 2950, threats: 4, bytes: 48000000 }],
                          responseStatusMap: [
                            { edgeResponseStatus: 200, requests: 3050 },
                            { edgeResponseStatus: 301, requests: 120 },
                            { edgeResponseStatus: 404, requests: 30 },
                          ],
                          contentTypeMap: [{ edgeResponseContentTypeName: "html", requests: 980, bytes: 8000000 }],
                        },
                      },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return origFetch(targetUrl);
    };

    const cfRes = await cloudflareGet({
      request: makeReq("/api/admin/analytics/cloudflare?days=30", { cookie: superCookie }),
      env,
    });
    assert.equal(cfRes.status, 200);
    const cfBody = await cfRes.json();
    assert.equal(cfBody.configured, true);
    assert.equal(cfBody.totals.requests, 3200);
    assert.equal(cfBody.totals.cacheHitRatePct, 75);
    assert.equal(cfBody.totals.threats, 14);
    assert.equal(cfBody.statusBuckets.s4xx, 30);
    assert.equal(cfBody.countries[0].country, "VN");

    const psiRes = await pagespeedPost({
      request: makeReq("/api/admin/analytics/pagespeed", {
        method: "POST",
        cookie: superCookie,
        body: { url: "/", strategy: "mobile" },
      }),
      env,
    });
    assert.equal(psiRes.status, 200);
    const psiData = await psiRes.json();
    assert.equal(psiData.snapshot.perfScore, 94);
    assert.equal(psiData.snapshot.seoScore, 100);

    const idxRes = await indexnowPost({
      request: makeReq("/api/admin/analytics/indexnow", { method: "POST", cookie: superCookie }),
      env,
    });
    assert.equal(idxRes.status, 200);
    const idxData = await idxRes.json();
    assert.ok(idxData.submittedCount >= 12);
    assert.ok(idxData.keyLocation.endsWith("/abcdef1234567890abcdef1234567890.txt"));
  } finally {
    globalThis.fetch = origFetch;
  }

  // 9. GSC endpoint returns configured:false cleanly before Service Account is attached
  const gscRes = await gscGet({
    request: makeReq("/api/admin/analytics/gsc", { cookie: superCookie }),
    env,
  });
  assert.equal(gscRes.status, 200);
  const gscBody = await gscRes.json();
  assert.equal(gscBody.configured, false);
});
