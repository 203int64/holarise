/**
 * HolaRise Privacy-First Telemetry & Core Web Vitals RUM (< 3KB, zero cookies, zero PII).
 * Measures pageviews, active dwell time, scroll depth, LCP/INP/CLS/TTFB, and CTA micro-conversions.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const path = window.location.pathname || "/";
  if (/^\/(admin|media|api|_templates)(\/|$)/i.test(path)) return;

  const ENDPOINT = "/api/telemetry";
  const randId = (p) =>
    p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const visitId = randId("v");
  let sessionId = "";
  let returning = false;
  try {
    sessionId = sessionStorage.getItem("hr_sid") || "";
    if (!sessionId) {
      sessionId = randId("s");
      sessionStorage.setItem("hr_sid", sessionId);
    }
    const today = new Date().toISOString().slice(0, 10);
    const prevDay = localStorage.getItem("hr_seen_d");
    if (prevDay && prevDay !== today) returning = true;
    localStorage.setItem("hr_seen_d", today);
  } catch {
    sessionId = randId("s");
  }

  const params = new URLSearchParams(window.location.search || "");
  const utmSource = (params.get("utm_source") || "").slice(0, 60);
  const utmCampaign = (params.get("utm_campaign") || "").slice(0, 80);
  const lang = (document.documentElement.getAttribute("lang") || "vi").slice(0, 10).toLowerCase();

  function send(payload) {
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
        if (ok) return;
      }
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {});
    } catch {
      // swallow silently
    }
  }

  // 1. Fire initial pageview
  send({
    type: "pageview",
    visitId,
    sessionId,
    path,
    referrer: (document.referrer || "").slice(0, 300),
    utmSource,
    utmCampaign,
    lang,
    returning,
  });

  // 2. Active Dwell Time (counts only when tab is visible)
  let visibleStart = document.visibilityState === "visible" ? Date.now() : 0;
  let activeDwellMs = 0;
  function syncDwell() {
    if (visibleStart > 0) {
      activeDwellMs += Math.max(0, Date.now() - visibleStart);
      visibleStart = document.visibilityState === "visible" ? Date.now() : 0;
    }
  }

  // 3. Max Scroll Depth (0-100%)
  let maxScrollPct = 0;
  let scrollTick = false;
  function updateScroll() {
    scrollTick = false;
    const doc = document.documentElement;
    const body = document.body;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const viewH = window.innerHeight || doc.clientHeight || 1;
    const fullH = Math.max(doc.scrollHeight || 0, body ? body.scrollHeight : 0, viewH);
    const pct = Math.min(100, Math.max(0, Math.round(((scrollTop + viewH) / fullH) * 100)));
    if (pct > maxScrollPct) maxScrollPct = pct;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!scrollTick) {
        scrollTick = true;
        window.requestAnimationFrame(updateScroll);
      }
    },
    { passive: true }
  );
  updateScroll();

  // 4. Native Core Web Vitals (LCP, CLS, INP, TTFB)
  let lcpMs = 0;
  let inpMs = 0;
  let clsVal = 0;
  let ttfbMs = 0;

  try {
    const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (nav && nav.responseStart > 0) {
      ttfbMs = Math.round(nav.responseStart);
    }
  } catch {
    // ignore
  }

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) lcpMs = Math.round(last.renderTime || last.loadTime || last.startTime || 0);
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // unsupported
    }
    try {
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) clsVal += entry.value || 0;
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
    } catch {
      // unsupported
    }
    try {
      const inpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const d = Math.round(entry.duration || 0);
          if (d > inpMs) inpMs = d;
        }
      });
      inpObs.observe({ type: "event", buffered: true, durationThreshold: 40 });
    } catch {
      // unsupported
    }
  }

  // 5. Micro-conversion Goals (Zero PII)
  const goals = new Set();
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target && e.target.closest ? e.target.closest("a, button") : null;
      if (!target) return;
      const href = String(target.getAttribute("href") || "");
      if (target.matches("[data-open-rsvp], [data-open-modal='register'], [data-rsvp-btn]") || href.includes("#giu-cho")) {
        goals.add("open_rsvp");
      } else if (href.includes("zalo.me/g/")) {
        goals.add("join_zalo_group");
      } else if (target.matches("[data-ics-download]") || href.endsWith(".ics") || href.includes("calendar.google.com")) {
        goals.add("save_calendar");
      } else if (target.matches("[data-share-page], [data-copy-link], [data-share-event]")) {
        goals.add("share_page");
      } else if (target.matches("[data-header-member-btn], [data-drawer-member-btn]")) {
        goals.add("open_member_pass");
      } else if (target.matches(".lang-switch")) {
        goals.add("lang_switch");
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (form && form.matches && form.matches("form[data-rsvp-form], #rsvp-form, #join-form, #modal-rsvp-form")) {
        goals.add("submit_rsvp");
        flushEngage();
      }
    },
    { passive: true }
  );

  let lastFlushAt = 0;
  function flushEngage() {
    syncDwell();
    updateScroll();
    const now = Date.now();
    if (now - lastFlushAt < 800) return;
    lastFlushAt = now;
    send({
      type: "engage",
      visitId,
      sessionId,
      path,
      dwellMs: activeDwellMs,
      scrollPct: maxScrollPct,
      lcpMs,
      inpMs,
      clsX1000: Math.round(clsVal * 1000),
      ttfbMs,
      goals: Array.from(goals),
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushEngage();
      visibleStart = 0;
    } else {
      visibleStart = Date.now();
    }
  });
  window.addEventListener("pagehide", flushEngage);

  // Early snapshot at 12s so abrupt WebView closes still record CWV & engagement
  window.setTimeout(() => {
    if (document.visibilityState === "visible") flushEngage();
  }, 12000);
})();
