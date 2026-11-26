/**
 * Server-side HTML & JSON-LD rendering helpers for Cloudflare Pages Functions SSR.
 * Mirrors build.py markup pixel-for-pixel while preventing XSS via strict escaping.
 */

import imageWidths from "../../data/image-widths.js";
import { isSafeExternalHttpsUrl, isSafeMediaUrl } from "./validation.js";

export const SITE_URL = "https://holarise.org";
export const BRAND_SHORT_NAME = "Cộng đồng HolaRise";
export const BRAND_FULL_NAME = "HolaRise – Cộng đồng Thanh niên Hòa Lạc";
export const LOGO_MARK_URL = `${SITE_URL}/assets/images/pwa/icon-512.png`;

const ICON_CALENDAR =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
const ICON_PIN =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveEventSlug(ws) {
  if (!ws) return "";
  const rawHref = String(ws.href || "").trim();
  if (rawHref.startsWith("/su-kien/")) {
    return rawHref.slice("/su-kien/".length).replace(/^\/+|\/+$/g, "");
  }
  const explicitSlug = String(ws.slug || "").trim().replace(/^\/+|\/+$/g, "");
  if (explicitSlug) return explicitSlug;
  const id = String(ws.id || "").trim().toLowerCase();
  if (id === "holaheart-cuoc-doi-cua-cha-2026-11-29") return "cuoc-doi-cua-cha";
  if (id === "holaconnect-leo-nui-lam-nghiep-2026-11-26") return "leo-nui-luot";
  return id.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function resolveEventHref(ws) {
  if (!ws) return "";
  const raw = String(ws.href || "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  const slug = resolveEventSlug(ws);
  return slug ? `/su-kien/${slug}/` : "";
}

export function buildEventIsoTimes(dateStr, timeStr) {
  const date = ISO_DATE_RE.test(String(dateStr || "").trim()) ? String(dateStr).trim() : "";
  if (!date) return { startIso: "", endIso: "", icsStart: "", icsEnd: "" };
  const m = String(timeStr || "").match(/(\d{1,2})[:h](\d{2})/);
  if (!m) return { startIso: date, endIso: "", icsStart: "", icsEnd: "" };
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  const endMatch = String(timeStr || "").match(/[–—-]\s*(\d{1,2})[:h](\d{2})/);
  const endHh = endMatch ? Math.min(23, Math.max(hh, Number(endMatch[1]))) : Math.min(23, hh + 2);
  const endMm = endMatch ? Math.min(59, Math.max(0, Number(endMatch[2]))) : mm;
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = date.replace(/-/g, "");
  return {
    startIso: `${date}T${pad(hh)}:${pad(mm)}:00+07:00`,
    endIso: `${date}T${pad(endHh)}:${pad(endMm)}:00+07:00`,
    icsStart: `${ymd}T${pad(Math.max(0, hh - 7))}${pad(mm)}00Z`,
    icsEnd: `${ymd}T${pad(Math.max(0, endHh - 7))}${pad(endMm)}00Z`,
  };
}

export function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function imageVariant(src, width) {
  const stem = src.slice("/assets/images/".length, src.lastIndexOf("."));
  return `/assets/images/web/${stem}-${width}.webp`;
}

export function fullImageUrl(src) {
  const widths = Object.hasOwn(imageWidths, src) && imageWidths[src];
  return widths ? imageVariant(src, widths.at(-1)) : src;
}

export function imageAttrs(src, sizes) {
  const attrs = `src="${escHtml(src)}"`;
  const widths = Object.hasOwn(imageWidths, src) && imageWidths[src];
  if (!widths) return attrs;
  const srcset = widths.map((width) => `${imageVariant(src, width)} ${width}w`).join(", ");
  return `${attrs} srcset="${escHtml(srcset)}" sizes="${escHtml(sizes)}"`;
}

export function absUrl(path) {
  const s = String(path || "").trim();
  if (!s) return `${SITE_URL}/`;
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  return SITE_URL + (s.startsWith("/") ? s : "/" + s);
}

export function safeJsonParse(raw, fallback) {
  if (Array.isArray(raw) || (raw && typeof raw === "object")) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function getTodayVnIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

export function derivePillarFilter(label = "", filters = [], categorySlug = "") {
  const tokens = Array.isArray(filters) ? filters.map((x) => String(x || "").toLowerCase()) : [];
  for (const t of tokens) {
    if (t === "holaheart" || t === "holagreen" || t === "holaconnect") {
      return t;
    }
  }
  const lower = `${String(label || "").toLowerCase()} ${String(categorySlug || "").toLowerCase()}`;
  if (lower.includes("holagreen") || lower.includes("moi-truong") || tokens.includes("sach")) {
    return "holagreen";
  }
  if (lower.includes("holaconnect") || lower.includes("cong-dong") || tokens.includes("se-chia")) {
    return "holaconnect";
  }
  if (lower.includes("holaheart") || lower.includes("workshop") || tokens.includes("biet-on")) {
    return "holaheart";
  }
  return "holaheart";
}

export function serializePostRow(row) {
  if (!row) return null;
  const filters = safeJsonParse(row.filters_json, []);
  const pillar = derivePillarFilter(row.category, filters, row.category_slug);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    categorySlug: row.category_slug,
    filters,
    pillar,
    date: row.date,
    dateDisplay: row.date_display,
    readTime: row.read_time,
    author: row.author,
    image: row.image,
    imageAlt: row.image_alt,
    excerpt: row.excerpt,
    content: safeJsonParse(row.content_json, []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeEventRow(row) {
  if (!row) return null;
  const filters = safeJsonParse(row.filters_json, []);
  const pillar = derivePillarFilter(row.type, filters);
  const slug = resolveEventSlug({ id: row.id, slug: row.slug, href: row.href });
  return {
    id: row.id,
    slug,
    kind: row.kind,
    type: row.type,
    filters,
    pillar,
    date: row.date,
    dateDisplay: row.date_display,
    time: row.time,
    location: row.location,
    fee: row.fee,
    seats: row.seats,
    seatCapacity: Number(row.seat_capacity || 0),
    externalBooked: Number(row.external_booked || 0),
    showSeatBar: Boolean(row.show_seat_bar),
    title: row.title,
    titleEn: row.title_en || "",
    summary: row.summary,
    summaryEn: row.summary_en || "",
    highlights: safeJsonParse(row.highlights_json, []),
    participants: row.participants,
    image: row.image,
    imageAlt: row.image_alt,
    zaloGroupUrl: row.zalo_group_url || "",
    rsvpClosed: Number(row.rsvp_closed || 0) === 1,
    stageOverride: row.stage_override || "auto",
    reelAudioUrl: row.reel_audio_url || "",
    reelAudioTitle: row.reel_audio_title || "",
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isEventFinished(ev, now = new Date()) {
  if (!ev) return false;
  const override = String(ev.stageOverride || ev.stage_override || "auto").toLowerCase();
  if (override === "memory") return true;
  if (override === "invite") return false;
  if (ev.kind === "past") return true;
  const dateStr = String(ev.date || "").trim();
  if (!ISO_DATE_RE.test(dateStr)) return false;
  const todayVn = getTodayVnIso(now);
  if (dateStr < todayVn) return true;
  if (dateStr > todayVn) return false;
  const times = buildEventIsoTimes(dateStr, ev.time);
  if (times.endIso) {
    const endMs = Date.parse(times.endIso);
    if (Number.isFinite(endMs)) {
      return now.getTime() >= endMs;
    }
  }
  return false;
}

export function splitEventsByDate(rows, now = new Date()) {
  const upcoming = [];
  const past = [];

  for (const row of rows || []) {
    const ev = row && row.pillar ? row : serializeEventRow(row);
    if (!ev) continue;
    if (isEventFinished(ev, now)) {
      past.push(ev);
    } else {
      upcoming.push(ev);
    }
  }

  upcoming.sort(
    (a, b) =>
      (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
      String(a.date || "").localeCompare(String(b.date || "")) ||
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  past.sort(
    (a, b) =>
      (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
      String(b.date || "").localeCompare(String(a.date || "")) ||
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );

  return { upcoming, past };
}

export function renderHeroUpcomingBar(upcoming) {
  if (!upcoming || upcoming.length === 0) return "";
  const ws = upcoming[0];
  const eventHref = resolveEventHref(ws);
  const titleHtml = eventHref
    ? `<a class="upcoming-title upcoming-title--link" href="${escHtml(eventHref)}">${escHtml(ws.title)}</a>`
    : `<span class="upcoming-title">${escHtml(ws.title)}</span>`;
  const actionsHtml = eventHref
    ? `<div class="upcoming-bar-actions">
      <a class="btn btn--primary btn--sm" href="${escHtml(eventHref)}">Xem thư mời &amp; Giữ chỗ →</a>
      <button class="btn btn--outline btn--sm" type="button" data-register-event="${escHtml(ws.title)}" data-event-id="${escHtml(ws.id)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-fee="${escHtml(ws.fee)}" data-event-type="${escHtml(ws.type)}" data-event-href="${escHtml(eventHref)}">Giữ chỗ nhanh</button>
    </div>`
    : `<button class="btn btn--outline btn--sm" type="button" data-register-event="${escHtml(ws.title)}" data-event-id="${escHtml(ws.id)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-fee="${escHtml(ws.fee)}" data-event-type="${escHtml(ws.type)}">Giữ chỗ tham gia</button>`;

  return `<div class="upcoming-bar" aria-label="Sự kiện sắp diễn ra">
  <div class="container upcoming-bar-inner">
    <div class="upcoming-bar-info">
      <span class="upcoming-bar-badge"><span class="upcoming-dot" aria-hidden="true"></span><span class="upcoming-label">Sắp diễn ra</span></span>
      ${titleHtml}
      <span class="upcoming-sep" aria-hidden="true">·</span>
      <span class="upcoming-date">${escHtml(ws.dateDisplay)} (${escHtml(ws.time)})</span>
      <span class="upcoming-sep" aria-hidden="true">·</span>
      <span class="upcoming-fee">${escHtml(ws.fee)}</span>
    </div>
    ${actionsHtml}
  </div>
</div>`;
}

export function resolveEventHrefEn(ev) {
  const slug = resolveEventSlug(ev);
  return slug ? `/en/events/${slug}/` : "";
}

function compactDatePill(dateDisplay, lang = "vi") {
  const raw = String(dateDisplay || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lang === "en") {
    const dayMapEn = [
      ["sunday", "Sun"], ["monday", "Mon"], ["tuesday", "Tue"],
      ["wednesday", "Wed"], ["thursday", "Thu"], ["friday", "Fri"], ["saturday", "Sat"],
      ["chủ nhật", "Sun"], ["thứ hai", "Mon"], ["thứ ba", "Tue"],
      ["thứ tư", "Wed"], ["thứ năm", "Thu"], ["thứ sáu", "Fri"], ["thứ bảy", "Sat"],
    ];
    const matchEn = raw.match(/(\d{1,2}\s+[A-Za-z]{3})/);
    const matchNum = raw.match(/(\d{1,2}\/\d{1,2})(?:\/\d{2,4})?/);
    const shortDate = matchEn ? matchEn[1] : matchNum ? matchNum[1] : raw;
    for (const [fullDay, shortDay] of dayMapEn) {
      if (lower.includes(fullDay)) return `${shortDay} · ${shortDate}`;
    }
    return shortDate;
  }
  const dayMap = [
    ["chủ nhật", "CN"],
    ["thứ hai", "T2"],
    ["thứ ba", "T3"],
    ["thứ tư", "T4"],
    ["thứ năm", "T5"],
    ["thứ sáu", "T6"],
    ["thứ bảy", "T7"],
  ];
  const match = raw.match(/(\d{1,2}\/\d{1,2})(?:\/\d{2,4})?/);
  const shortDate = match ? match[1] : raw;
  for (const [fullDay, shortDay] of dayMap) {
    if (lower.includes(fullDay)) {
      return `${shortDay} · ${shortDate}`;
    }
  }
  return shortDate;
}

function compactPillarLabel(typeStr) {
  const raw = String(typeStr || "").trim();
  if (!raw) return "HolaRise";
  return raw.split("·")[0].trim() || raw;
}

function compactFeeLabel(feeStr, lang = "vi") {
  const raw = String(feeStr || "").trim();
  if (!raw) return lang === "en" ? "Free" : "Miễn phí";
  const head = raw.split("·")[0].trim();
  const lower = head.toLowerCase();
  if (lower.includes("miễn phí") || lower.includes("0đ") || lower.includes("free")) {
    return lang === "en" ? "Free" : "Miễn phí";
  }
  return head.slice(0, 20);
}

function compactSeatsLabel(seatsStr, lang = "vi") {
  const raw = String(seatsStr || "").trim();
  const m = raw.match(/(\d+)/);
  if (m) return lang === "en" ? `${m[1]} seats` : `${m[1]} chỗ`;
  return raw.slice(0, 16);
}

export function renderSeatBarHtml(ev, webBookedCount = 0, lang = "vi") {
  if (!ev || !ev.showSeatBar) return "";
  const isEn = lang === "en";
  const cap = Math.max(0, Number(ev.seatCapacity || 0));
  if (cap <= 0) return "";
  const ext = Math.max(0, Number(ev.externalBooked || 0));
  const web = Math.max(0, Number(webBookedCount || 0));
  const booked = Math.min(cap, web + ext);
  const remaining = Math.max(0, cap - booked);
  const pct = Math.min(100, Math.round((booked / cap) * 100));
  const statusText = isEn
    ? remaining === 0
      ? "All seats filled"
      : `${remaining} / ${cap} seats left`
    : remaining === 0
      ? "Đã đủ chỗ tham dự"
      : `Còn ${remaining} / ${cap} chỗ`;
  const pctText = isEn ? `${pct}% reserved` : `${pct}% đã giữ chỗ`;
  const urgentClass = remaining <= Math.max(3, Math.round(cap * 0.15)) ? " is-urgent" : "";
  return `<div class="invite-seat-meter${urgentClass}" aria-label="${escHtml(statusText)}">
        <div class="invite-seat-meter-row">
          <span class="invite-seat-meter-label">${escHtml(statusText)}</span>
          <span class="invite-seat-meter-pct">${pctText}</span>
        </div>
        <div class="invite-seat-meter-track" role="progressbar" aria-valuenow="${booked}" aria-valuemin="0" aria-valuemax="${cap}">
          <span class="invite-seat-meter-fill" style="width: ${pct}%;"></span>
        </div>
      </div>`;
}

export function renderWorkshopsHtml(upcoming) {
  if (!upcoming || upcoming.length === 0) {
    return "";
  }
  return upcoming
    .map((ws) => {
      const pillar = ws.pillar || derivePillarFilter(ws.type, ws.filters);
      const tokenSet = new Set([pillar, ...(ws.filters || [])]);
      const eventHref = resolveEventHref(ws);
      const eventIdAttr = ws.id ? ` data-event-id="${escHtml(ws.id)}"` : "";
      const eventHrefAttr = eventHref ? ` data-event-href="${escHtml(eventHref)}"` : "";
      const catAttr = ` data-workshop-card data-pillar="${escHtml(pillar)}" data-category="${escHtml(Array.from(tokenSet).join(" "))}"${eventIdAttr}${eventHrefAttr}`;
      const titleEnAttr = ws.titleEn ? ` data-title-en="${escHtml(ws.titleEn)}"` : "";
      const summaryEnAttr = ws.summaryEn ? ` data-summary-en="${escHtml(ws.summaryEn)}"` : "";
      const datePill = compactDatePill(ws.dateDisplay);
      const pillarLabel = compactPillarLabel(ws.type);
      const feeLabel = compactFeeLabel(ws.fee);
      const seatsLabel = compactSeatsLabel(ws.seats);
      const metaRight = [feeLabel, seatsLabel].filter(Boolean).join(" · ");

      const mediaInner = `<img ${imageAttrs(ws.image, "(max-width: 820px) 84vw, 420px")} alt="${escHtml(ws.imageAlt || ws.title)}" width="640" height="420" loading="lazy" decoding="async">
          <div class="event-card-badges">
            <span class="glass-badge">${escHtml(datePill)}</span>
          </div>`;
      const mediaHtml = eventHref
        ? `<a class="event-card-media event-card-media--link" data-curtain href="${escHtml(eventHref)}" aria-label="${escHtml(ws.title)}">
          ${mediaInner}
        </a>`
        : `<div class="event-card-media" data-curtain>
          ${mediaInner}
        </div>`;
      const titleHtml = eventHref
        ? `<h3 class="card-title"><a href="${escHtml(eventHref)}"${titleEnAttr}>${escHtml(ws.title)}</a></h3>`
        : `<h3 class="card-title"${titleEnAttr}>${escHtml(ws.title)}</h3>`;
      const footerHtml = eventHref
        ? `<div class="card-footer">
            <a class="btn btn--primary btn--sm event-card-cta" href="${escHtml(eventHref)}">
              <span data-i18n="cta.viewInvite">Xem thư mời &amp; Giữ chỗ</span>
              <span aria-hidden="true">→</span>
            </a>
          </div>`
        : `<div class="card-footer">
            <button class="btn btn--primary btn--sm event-card-cta" type="button" data-register-event="${escHtml(ws.title)}" data-event-id="${escHtml(ws.id)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-fee="${escHtml(ws.fee)}" data-event-type="${escHtml(ws.type)}">
              <span data-i18n="cta.reserveSeat">Giữ chỗ tham dự</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>`;

      return `<article class="event-card" data-stagger-item${catAttr}>
        ${mediaHtml}
        <div class="event-card-body">
          <div class="event-card-eyebrow">
            <span class="cat">${escHtml(pillarLabel)}</span>
            <span class="event-card-meta-pill">${escHtml(metaRight)}</span>
          </div>
          ${titleHtml}
          <p class="card-text"${summaryEnAttr}>${escHtml(ws.summary)}</p>
          <div class="event-info-inline">
            <span class="event-info-row">${ICON_CALENDAR} <span>${escHtml(ws.time)}</span></span>
            <span class="event-info-row">${ICON_PIN} <span>${escHtml(ws.location)}</span></span>
          </div>
          ${footerHtml}
        </div>
      </article>`;
    })
    .join("\n      ");
}

function compactLocation(raw) {
  const loc = String(raw || "").trim();
  if (!loc) return "";
  return loc.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function renderHomeUpcomingCardsHtml(upcoming, keepFullLocation = false, lang = "vi") {
  if (!upcoming || upcoming.length === 0) return "";
  const isEn = lang === "en";
  return upcoming
    .map((ws) => {
      const pillar = ws.pillar || derivePillarFilter(ws.type, ws.filters);
      const tokenSet = new Set([pillar, ...(ws.filters || [])]);
      const eventHref = isEn ? resolveEventHrefEn(ws) : resolveEventHref(ws);
      const eventIdAttr = ws.id ? ` data-event-id="${escHtml(ws.id)}"` : "";
      const eventHrefAttr = eventHref ? ` data-event-href="${escHtml(eventHref)}"` : "";
      const catAttr = ` data-workshop-card data-pillar="${escHtml(pillar)}" data-category="${escHtml(Array.from(tokenSet).join(" "))}"${eventIdAttr}${eventHrefAttr}`;
      const displayTitle = (isEn && ws.titleEn) ? ws.titleEn : ws.title;
      const datePill = compactDatePill(ws.dateDisplay, lang);
      const pillarLabel = compactPillarLabel(ws.type);
      const feeLabel = compactFeeLabel(ws.fee, lang);
      const seatsLabel = compactSeatsLabel(ws.seats, lang);
      const langTag = isEn && !ws.titleEn ? "VI Session" : "";
      const metaRight = [feeLabel, seatsLabel, langTag].filter(Boolean).join(" · ");
      const locText = keepFullLocation ? String(ws.location || "").trim() : compactLocation(ws.location);
      const infoLine = [ws.time || "", locText].filter(Boolean).join(" · ");

      const titleHtml = eventHref
        ? `<h3 class="card-title"><a class="card-link" href="${escHtml(eventHref)}">${escHtml(displayTitle)}</a></h3>`
        : `<h3 class="card-title"><button class="card-link card-link--btn" type="button" data-register-event="${escHtml(displayTitle)}" data-event-id="${escHtml(ws.id)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-fee="${escHtml(ws.fee)}" data-event-type="${escHtml(ws.type)}">${escHtml(displayTitle)}</button></h3>`;

      return `<article class="event-card event-card--editorial" data-stagger-item${catAttr}>
        <div class="event-card-media" data-curtain>
          <img ${imageAttrs(ws.image, "(max-width: 820px) 84vw, 560px")} alt="${escHtml(ws.imageAlt || displayTitle)}" width="640" height="420" loading="lazy" decoding="async">
          <div class="event-card-badges">
            <span class="glass-badge">${escHtml(datePill)}</span>
          </div>
        </div>
        <div class="event-card-body">
          <div class="event-card-eyebrow">
            <span class="cat">${escHtml(pillarLabel)}</span>
            <span class="event-card-meta-pill">${escHtml(metaRight)}</span>
          </div>
          ${titleHtml}
          <div class="event-card-foot">
            <span class="event-card-loc">${escHtml(infoLine)}</span>
            <span class="circle-go" aria-hidden="true">→</span>
          </div>
        </div>
      </article>`;
    })
    .join("\n      ");
}

export function renderHomeUpcomingSectionHtml(upcoming, lang = "vi") {
  if (!upcoming || upcoming.length === 0) return "";
  const isEn = lang === "en";
  const railMod = upcoming.length === 2 ? " events-rail--duo" : upcoming.length === 1 ? " events-rail--solo" : "";
  return `<section class="section section--editorial-upcoming" id="${isEn ? "upcoming" : "lich-hen"}">
  <div class="container">
    <div class="section-header--split section-header--editorial" data-reveal>
      <div>
        <div class="kicker">${isEn ? "This Week" : "Lịch tuần này"}</div>
        <h2 class="section-title">${isEn ? "Upcoming in Hoa Lac" : "Sắp diễn ra tại Hòa Lạc"}</h2>
      </div>
      <a class="arrow-link" href="${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}">
        <span>${isEn ? "Full schedule" : "Tất cả lịch"}</span>
        <span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span>
      </a>
    </div>

    <div class="events-rail${railMod}" data-stagger-group>
      ${renderHomeUpcomingCardsHtml(upcoming, false, lang)}
    </div>
  </div>
</section>`;
}

export function renderScheduleUpcomingContentHtml(upcoming, lang = "vi") {
  const isEn = lang === "en";
  if (!upcoming || upcoming.length === 0) {
    if (isEn) {
      return `<div class="schedule-empty-flagship" role="status">
      <div class="schedule-empty-copy">
        <span class="kicker">Weekly Rhythm</span>
        <h3>Our coordinating team is preparing the next gatherings in Hoa Lac</h3>
        <p>HolaHeart, HolaGreen, and HolaConnect sessions rotate 1–2 times per week on a non-profit basis.</p>
      </div>
      <div class="schedule-empty-actions">
        <a class="btn btn--primary" href="/en/join/">Get your Member Pass for updates →</a>
        <a class="btn btn--outline" href="/en/about/#pillars">Explore 3 Pillars</a>
      </div>
    </div>`;
    }
    return `<div class="schedule-empty-flagship" role="status">
      <div class="schedule-empty-copy">
        <span class="kicker">Nhịp hoạt động định kỳ</span>
        <h3>Ban Điều Phối đang chuẩn bị cho những cuộc gặp tiếp theo tại Hòa Lạc</h3>
        <p>Các buổi HolaHeart, HolaGreen và HolaConnect diễn ra luân phiên 1–2 buổi mỗi tuần theo tinh thần phi lợi nhuận.</p>
      </div>
      <div class="schedule-empty-actions">
        <a class="btn btn--primary" href="/tham-gia/">Tạo Thẻ Thành Viên nhận lịch mới →</a>
        <a class="btn btn--outline" href="/gioi-thieu/#chuong-trinh">Tìm hiểu 3 trụ cột</a>
      </div>
    </div>`;
  }

  const railMod = upcoming.length === 2 ? " events-rail--duo" : upcoming.length === 1 ? " events-rail--solo" : "";
  return `<div class="events-rail${railMod}" data-stagger-group>
      ${renderHomeUpcomingCardsHtml(upcoming, true, lang)}
    </div>
    <div class="filter-empty" data-filter-empty="[data-workshop-card]" hidden>
      <p>${isEn ? "No upcoming gathering in this pillar this week." : "Hiện chưa có buổi sắp tới nào thuộc nhóm này trong tuần."}</p>
      <button class="btn btn--outline btn--sm" type="button" data-filter-reset="[data-workshop-card]">${isEn ? "View all gatherings" : "Xem tất cả lịch hoạt động"}</button>
    </div>`;
}

export function renderJoinEventOptionsHtml(upcoming, lang = "vi") {
  const isEn = lang === "en";
  const cards = [];
  for (const ws of upcoming || []) {
    const safeId = escHtml(ws.id);
    const title = (isEn && ws.titleEn) ? ws.titleEn : ws.title;
    cards.push(`<div class="join-event-option">
        <input class="visually-hidden" type="radio" name="eventChoice" id="join-ev-${safeId}" value="${safeId}" data-event-title="${escHtml(title)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-type="${escHtml(ws.type)}" data-event-seats="${escHtml(ws.seats)}">
        <label class="join-event-card" for="join-ev-${safeId}">
          <span class="join-event-top">
            <span class="join-event-date">${escHtml(ws.dateDisplay)}</span>
            <span class="join-event-seats">${escHtml(ws.seats)}</span>
          </span>
          <span class="join-event-title">${escHtml(title)}</span>
          <span class="join-event-meta">${escHtml(ws.time)} · ${escHtml(ws.location)}</span>
        </label>
      </div>`);
  }
  if (cards.length === 0) return "";
  return `<div class="join-event-grid">\n      ${cards.join("\n      ")}\n    </div>`;
}

export function renderJoinEventsSectionHtml(upcoming, lang = "vi") {
  const inner = renderJoinEventOptionsHtml(upcoming, lang);
  if (!inner) return "";
  return `<fieldset class="join-fieldset" data-join-events-step>
          <legend class="join-legend">${lang === "en" ? "Select a gathering to attend" : "02 · Chọn hoạt động bạn muốn tham gia"}</legend>
          ${inner}
        </fieldset>`;
}

const PAST_FALLBACK_IMAGES = [
  "/assets/images/editorial-holagreen.jpg",
  "/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg",
  "/assets/images/editorial-holaconnect.jpg",
];

export function renderPastWorkshopsHtml(pastList, lang = "vi") {
  if (!pastList || pastList.length === 0) return "";
  const isEn = lang === "en";
  return pastList
    .map((item, idx) => {
      const photo = item.image || PAST_FALLBACK_IMAGES[idx % PAST_FALLBACK_IMAGES.length];
      const title = (isEn && item.titleEn) ? item.titleEn : item.title;
      const alt = item.imageAlt || title;
      const fallbackEventHref = isEn ? resolveEventHrefEn(item) : resolveEventHref(item);
      const baseHref =
        item.href && String(item.href).startsWith("/")
          ? item.href
          : fallbackEventHref ||
            (item.id === "holaheart-first-event-2026" ? "/hanh-trinh/tinh-yeu-thuong-cua-me/" : "");
      let href = baseHref;
      if (isEn) {
        if (baseHref.startsWith("/hanh-trinh/")) {
          href = baseHref.replace(/^\/hanh-trinh\//, "/en/journey/");
        } else if (baseHref.startsWith("/su-kien/")) {
          href = baseHref.replace(/^\/su-kien\//, "/en/events/");
        }
      }
      const dateText = isEn
        ? compactDatePill(item.dateDisplay || item.date, "en")
        : item.dateDisplay || item.date;
      const actionHint = isEn
        ? href.startsWith("/en/events/")
          ? "View memories"
          : "Read recap"
        : item.participants;
      const meta = [item.time, item.location, actionHint]
        .filter(Boolean)
        .map(escHtml)
        .join(" · ");
      return `<div class="past-item" data-stagger-item data-hover-photo="${escHtml(fullImageUrl(photo))}" data-hover-alt="${escHtml(alt)}">
        <span class="past-item-date">${escHtml(dateText)}</span>
        <h3 class="past-item-title">${href ? `<a class="past-item-title-link" href="${escHtml(href)}">${escHtml(title)}</a>` : escHtml(title)}</h3>
        <span class="past-item-meta">${meta}</span>
        <span class="past-item-arrow" aria-hidden="true">↗</span>
      </div>`;
    })
    .join("\n      ");
}

export function renderNewsCardsHtml(articles, filterable = false, lang = "vi") {
  const isEn = lang === "en";
  if (!articles || articles.length === 0) {
    return `<div style="grid-column: 1 / -1; padding: 36px 24px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); text-align: center;">
      <p style="margin: 0; color: var(--ink-secondary);">${isEn ? "Upcoming community stories are being prepared." : "Các câu chuyện tiếp theo đang được Ban Điều Phối hoàn thiện."}</p>
    </div>`;
  }
  return articles
    .map((a) => {
      const pillar = a.pillar || derivePillarFilter(a.category, a.filters, a.categorySlug);
      const tokenSet = new Set([pillar, ...(a.filters || [])]);
      if (a.categorySlug) tokenSet.add(a.categorySlug);
      const attr = filterable ? ` data-news-card data-category="${escHtml(Array.from(tokenSet).join(" "))}"` : "";
      const href = isEn ? `/en/journey/${escHtml(a.slug)}/` : `/hanh-trinh/${escHtml(a.slug)}/`;
      return `<article class="editorial-card editorial-card--clean" data-stagger-item${attr}>
        <div class="plate-media" data-curtain>
          <img ${imageAttrs(a.image, "(max-width: 640px) calc(100vw - 40px), 560px")} alt="${escHtml(a.imageAlt || a.title)}" width="640" height="420" loading="lazy" decoding="async">
        </div>
        <div class="editorial-card-body">
          <div class="card-meta">
            <span class="cat">${escHtml(a.category)}</span>
            <span aria-hidden="true">·</span>
            <time datetime="${escHtml(a.date)}">${escHtml(a.dateDisplay)}</time>
          </div>
          <h3 class="card-title"><a class="card-link" href="${href}">${escHtml(a.title)}</a></h3>
          <p class="card-text">${escHtml(a.excerpt)}</p>
          <div class="event-card-foot">
            <span class="pillar-editorial-more">${isEn ? "Read story" : "Đọc tường thuật"}</span>
            <span class="circle-go" aria-hidden="true">→</span>
          </div>
        </div>
      </article>`;
    })
    .join("\n      ");
}

function formatInlineSafe(escapedLine) {
  const normalizedGallery = escapedLine.replace(
    /\/hoat-dong\/#thu-vien-anh/g,
    "/hanh-trinh/#thu-vien-anh"
  );
  const withMusicSpaceLinks = normalizedGallery.replace(
    /\[([^\[\]]+)\]\((https:\/\/musicspace\.edu\.vn(?:\/[^\s)]*)?)\)/gi,
    '<a href="$2" rel="noopener noreferrer">$1</a>'
  );
  return withMusicSpaceLinks
    .replace(
      /\[([^\[\]]+)\]\((\/(?:[a-z0-9_-][a-z0-9/_-]*)?(?:#[a-z0-9_-]+)?)\)/g,
      '<a href="$2">$1</a>'
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * XSS-safe renderer for CMS article paragraphs (supports ## heading, ### subheading, > quote, - list, **bold**).
 */
export function renderSafeArticleBody(paragraphs) {
  const items = Array.isArray(paragraphs) ? paragraphs : [];
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of items) {
    const line = String(raw || "").trim();
    if (!line) continue;

    if (line.startsWith("- ")) {
      if (!inList) {
        out.push('<ul class="clean-list">');
        inList = true;
      }
      out.push(`<li>${formatInlineSafe(escHtml(line.slice(2).trim()))}</li>`);
      continue;
    }

    closeList();

    if (line.startsWith("### ")) {
      out.push(`<h3>${formatInlineSafe(escHtml(line.slice(4).trim()))}</h3>`);
    } else if (line.startsWith("## ")) {
      out.push(`<h2>${formatInlineSafe(escHtml(line.slice(3).trim()))}</h2>`);
    } else if (line.startsWith("> ")) {
      out.push(`<blockquote>${formatInlineSafe(escHtml(line.slice(2).trim()))}</blockquote>`);
    } else {
      out.push(`<p>${formatInlineSafe(escHtml(line))}</p>`);
    }
  }
  closeList();
  return out.join("\n      ");
}

export function safeJsonLdScript(obj) {
  const payload = JSON.stringify(obj, null, 2).replace(/<\//g, "<\\/");
  return `<script type="application/ld+json">\n${payload}\n</script>`;
}

export function buildArticleSchemas(article, lang = "vi") {
  const isEn = lang === "en";
  const slugPath = isEn ? `/en/journey/${article.slug}/` : `/hanh-trinh/${article.slug}/`;
  const orgId = `${SITE_URL}/#organization`;
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    image: [absUrl(article.image)],
    datePublished: article.date,
    dateModified: (article.updatedAt || article.date || "").slice(0, 10),
    inLanguage: isEn ? "en" : "vi-VN",
    author: { "@type": "Organization", "@id": orgId, name: isEn ? "HolaRise Coordinating Team" : article.author },
    publisher: {
      "@type": "Organization",
      "@id": orgId,
      name: isEn ? "HolaRise – Youth Community & Social Impact Initiative" : BRAND_FULL_NAME,
      logo: { "@type": "ImageObject", url: LOGO_MARK_URL, width: 512, height: 512 },
    },
    mainEntityOfPage: absUrl(slugPath),
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: isEn
      ? [
          { "@type": "ListItem", position: 1, name: "Home", item: absUrl("/en/") },
          { "@type": "ListItem", position: 2, name: "Journey", item: absUrl("/en/journey/") },
          { "@type": "ListItem", position: 3, name: article.title, item: absUrl(slugPath) },
        ]
      : [
          { "@type": "ListItem", position: 1, name: "Trang chủ", item: absUrl("/") },
          { "@type": "ListItem", position: 2, name: "Hành trình", item: absUrl("/hanh-trinh/") },
          { "@type": "ListItem", position: 3, name: article.title, item: absUrl(slugPath) },
        ],
  };
  return `${safeJsonLdScript(articleSchema)}\n  ${safeJsonLdScript(breadcrumb)}`;
}

export function buildEventsJsonLd(upcoming, lang = "vi") {
  const isEn = lang === "en";
  const orgId = `${SITE_URL}/#organization`;
  return (upcoming || [])
    .map((ws) => {
      const eventHref = isEn ? resolveEventHrefEn(ws) : resolveEventHref(ws);
      const eventUrl = eventHref ? absUrl(eventHref) : absUrl(isEn ? "/en/schedule/" : "/lich-hoat-dong/");
      const times = buildEventIsoTimes(ws.date, ws.time);
      const schemaObj = {
        "@context": "https://schema.org",
        "@type": "Event",
        name: (isEn && ws.titleEn) ? ws.titleEn : ws.title,
        startDate: times.startIso || ws.date,
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
        isAccessibleForFree: true,
        image: [absUrl(ws.image)],
        description: (isEn && ws.summaryEn) ? ws.summaryEn : ws.summary,
        location: {
          "@type": "Place",
          name: ws.location,
          address: {
            "@type": "PostalAddress",
            addressLocality: isEn ? "Hoa Lac, Thach That" : "Hòa Lạc – Thạch Thất",
            addressRegion: isEn ? "Hanoi" : "Hà Nội",
            addressCountry: "VN",
          },
        },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "VND",
          availability: "https://schema.org/InStock",
          url: eventUrl,
        },
        organizer: {
          "@type": "NGO",
          "@id": orgId,
          name: isEn ? "HolaRise – Youth Community & Social Impact Initiative" : BRAND_FULL_NAME,
          url: SITE_URL,
        },
      };
      if (times.endIso) {
        schemaObj.endDate = times.endIso;
      }
      if (eventHref) {
        schemaObj.url = eventUrl;
      }
      return safeJsonLdScript(schemaObj);
    })
    .join("\n  ");
}

export function replaceMarker(html, name, content) {
  const start = `<!-- CMS:${name}:START -->`;
  const end = `<!-- CMS:${name}:END -->`;
  const sIdx = html.indexOf(start);
  const eIdx = html.indexOf(end);
  if (sIdx === -1 || eIdx === -1 || eIdx < sIdx) return html;
  return html.slice(0, sIdx + start.length) + "\n" + content + "\n" + html.slice(eIdx);
}

const FILTER_LABELS_VI = {
  holaheart: "HolaHeart",
  holagreen: "HolaGreen",
  holaconnect: "HolaConnect",
  sach: "Sạch",
  "biet-on": "Biết ơn",
  "tu-te": "Tử tế",
  "se-chia": "Sẻ chia",
};

function isSafeHttpsLink(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  try {
    const parsed = new URL(s);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function renderHorizontalGalleryHtml(photos, lang = "vi") {
  if (!photos || photos.length === 0) return "";
  const isEn = lang === "en";
  const total = photos.length;
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  return photos
    .map((p, idx) => {
      const caption = p.caption || p.albumTitle || (isEn ? "HolaRise Moment in Hoa Lac" : "Khoảnh khắc Hola tại Hòa Lạc");
      const alt = p.alt || caption;
      const photographer = p.photographer ? (isEn ? ` · Photo: ${p.photographer}` : ` · Ảnh: ${p.photographer}`) : "";
      return `<button class="horizontal-card" type="button" data-lightbox-src="${escHtml(fullImageUrl(p.url))}" data-lightbox-alt="${escHtml(alt)}" data-lightbox-caption="${escHtml(caption + photographer)}">
        <div class="horizontal-frame">
          <img ${imageAttrs(p.url, "(max-width: 640px) 82vw, 620px")} alt="${escHtml(alt)}" width="960" height="600" loading="lazy" decoding="async">
          <div class="horizontal-caption">
            <span>${escHtml(caption)}</span>
            <span class="horizontal-index">${pad2(idx + 1)} / ${pad2(total)}</span>
          </div>
        </div>
      </button>`;
    })
    .join("\n      ");
}

export function renderPublicAlbumsHtml(albumsWithPhotos, lang = "vi") {
  if (!albumsWithPhotos || albumsWithPhotos.length === 0) return "";
  const isEn = lang === "en";

  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  const stackClasses = ["is-front", "is-mid", "is-back"];

  return albumsWithPhotos
    .map((album) => {
      const photos = Array.isArray(album.photos) ? album.photos : [];
      if (photos.length === 0) return "";
      const filters = Array.isArray(album.filters) ? album.filters : [];
      const pillar = derivePillarFilter(album.title, filters);
      const tokenSet = new Set([pillar, ...filters]);
      const filtersAttr = Array.from(tokenSet).join(" ");

      const previewList = [];
      if (album.coverUrl) {
        previewList.push({ url: album.coverUrl, alt: album.title || (isEn ? "HolaRise album cover" : "Ảnh bìa bộ ảnh HolaRise") });
      }
      for (const p of photos) {
        if (previewList.length >= 3) break;
        if (p.url && !previewList.some((item) => item.url === p.url)) {
          previewList.push({ url: p.url, alt: p.alt || p.caption || album.title || (isEn ? "HolaRise moment" : "Khoảnh khắc HolaRise") });
        }
      }
      const stackHtml = previewList
        .slice(0, 3)
        .map(
          (item, idx) =>
            `<img class="archive-stack-img ${stackClasses[idx]}" ${imageAttrs(item.url, "120px")} alt="${escHtml(item.alt)}" width="160" height="120" loading="lazy" decoding="async">`
        )
        .reverse()
        .join("\n          ");

      const metaParts = [album.dateDisplay || album.eventDate || "", album.location || ""].filter(Boolean);
      const metaText = metaParts.join(" · ");

      const thumbsHtml = photos
        .map((p, idx) => {
          const caption = p.caption || album.title || (isEn ? "HolaRise moment" : "Khoảnh khắc HolaRise");
          const alt = p.alt || caption;
          const photographer = p.photographer ? (isEn ? ` · Photo: ${p.photographer}` : ` · Ảnh: ${p.photographer}`) : "";
          const fullCaption = `${caption}${photographer}`;
          return `<button class="archive-thumb" type="button" aria-label="${isEn ? "View photo" : "Xem ảnh"} ${pad2(idx + 1)}: ${escHtml(alt)}" data-lightbox-src="${escHtml(fullImageUrl(p.url))}" data-lightbox-alt="${escHtml(alt)}" data-lightbox-caption="${escHtml(fullCaption)}">
            <img ${imageAttrs(p.url, "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 280px")} alt="${escHtml(alt)}" width="480" height="360" loading="lazy" decoding="async">
            <span class="archive-thumb-idx" aria-hidden="true">${pad2(idx + 1)}</span>
            <span class="archive-thumb-cap" aria-hidden="true">${escHtml(caption)}</span>
          </button>`;
        })
        .join("\n          ");

      const descHtml = album.description ? `\n          <p class="archive-drawer-desc">${escHtml(album.description)}</p>` : "";

      return `<details class="archive-drawer" name="journey-gallery" data-album-card data-album-id="${escHtml(album.id)}" data-pillar="${escHtml(pillar)}" data-category="${escHtml(filtersAttr)}" data-lightbox-group>
      <summary class="archive-drawer-head">
        <div class="archive-drawer-stack" aria-hidden="true">
          ${stackHtml}
        </div>
        <div class="archive-drawer-info">
          <div class="archive-drawer-meta">
            ${metaText ? `<span class="archive-drawer-date">${escHtml(metaText)}</span>` : ""}
            <span class="archive-drawer-count">${photos.length} ${isEn ? "photos" : "ảnh"}</span>
          </div>
          <h3 class="archive-drawer-title">${escHtml(album.title)}</h3>${descHtml}
        </div>
        <span class="archive-drawer-toggle" aria-hidden="true">
          <span class="archive-toggle-closed">${isEn ? "Open album" : "Mở bộ ảnh"}</span>
          <span class="archive-toggle-open">${isEn ? "Collapse" : "Thu gọn"}</span>
          <svg class="archive-toggle-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </summary>
      <div class="archive-drawer-body">
        <div class="archive-contact-sheet">
          ${thumbsHtml}
        </div>
        <div class="archive-drawer-foot">
          <button class="btn btn--primary btn--sm" type="button" data-open-album-contribute="${escHtml(album.id)}" data-album-title="${escHtml(album.title)}">${isEn ? "Contribute photos" : "Góp ảnh vào bộ ảnh này"}</button>
          <button class="btn btn--outline btn--sm" type="button" data-drawer-close>${isEn ? "Collapse album ↑" : "Thu gọn bộ ảnh ↑"}</button>
        </div>
      </div>
    </details>`;
    })
    .filter(Boolean)
    .join("\n      ");
}

export function parsePartnersJson(raw) {
  const list = safeJsonParse(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === "object" && String(item.name || "").trim())
    .map((item, idx) => ({
      id: String(item.id || `partner-${idx + 1}`).trim(),
      name: String(item.name || "").trim().slice(0, 120),
      role: String(item.role || "Đồng hành không gian").trim().slice(0, 80),
      logoUrl: isSafeMediaUrl(item.logoUrl) ? String(item.logoUrl).trim() : "",
      websiteUrl: isSafeExternalHttpsUrl(item.websiteUrl) ? String(item.websiteUrl).trim() : "",
      isActive: item.isActive !== false && item.isActive !== 0,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Math.trunc(Number(item.sortOrder)) : idx,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function renderPartnersStripHtml(partners, lang = "vi") {
  const isEn = lang === "en";
  const active = (Array.isArray(partners) ? partners : []).filter((p) => p && p.isActive !== false && p.name);
  if (active.length === 0) return "";

  const partnerSuffix = isEn ? "Community Partner" : "Đơn vị đồng hành";
  const items = active
    .map((p) => {
      const logo = p.logoUrl
        ? `<img class="partner-colophon-logo" src="${escHtml(p.logoUrl)}" alt="${escHtml(p.name)} logo" width="20" height="20" loading="lazy" decoding="async">`
        : "";
      const label = `<span class="partner-colophon-name">${escHtml(p.name)}</span>`;
      if (p.websiteUrl && isSafeExternalHttpsUrl(p.websiteUrl)) {
        return `<a class="partner-colophon-link" href="${escHtml(p.websiteUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(p.name)} — ${partnerSuffix}">${logo}${label}<span class="partner-colophon-arrow" aria-hidden="true">↗</span></a>`;
      }
      return `<span class="partner-colophon-link">${logo}${label}</span>`;
    })
    .join('<span class="partner-colophon-dot" aria-hidden="true">·</span>');

  return `<div class="partner-colophon" id="${isEn ? "partners" : "doi-tac"}" aria-label="${isEn ? "Community partners" : "Đơn vị đồng hành"}">
  <div class="container partner-colophon-inner">
    <span class="partner-colophon-label">${isEn ? "Space & Venue Partner" : "Đồng hành không gian"}</span>
    <span class="partner-colophon-dot" aria-hidden="true">·</span>
    <div class="partner-colophon-list">${items}</div>
  </div>
</div>`;
}

export function applySiteVisualsSsr(html, rawVisualsJson, lang = "vi") {
  if (!rawVisualsJson) return html;
  const parsed = safeJsonParse(rawVisualsJson, null);
  if (!parsed || typeof parsed !== "object") return html;
  const isEn = lang === "en";
  const orientLabel = isEn ? "Concept Visual" : "Ảnh định hướng";

  let out = html;
  if (parsed.heroImage && isSafeMediaUrl(parsed.heroImage)) {
    const heroAlt = escHtml(parsed.heroImageAlt || (isEn ? "HolaRise in Hoa Lac" : "HolaRise tại Hòa Lạc"));
    const badgeHtml = parsed.heroIsIllustration
      ? `<span class="visual-orientation-chip">${orientLabel}</span>`
      : "";
    out = replaceMarker(
      out,
      "HERO_MEDIA",
      `<img class="hero-card-img" src="${escHtml(parsed.heroImage)}" alt="${heroAlt}" width="1376" height="768" fetchpriority="high" decoding="async" data-cinema-img>${badgeHtml}`
    );
  }

  if (parsed.aboutImage && isSafeMediaUrl(parsed.aboutImage)) {
    const aboutAlt = escHtml(parsed.aboutImageAlt || (isEn ? "Sunrise over Hoa Lac" : "Bình minh tại Hòa Lạc"));
    const badgeHtml = parsed.aboutIsIllustration
      ? `<span class="visual-orientation-chip">${orientLabel}</span>`
      : "";
    out = replaceMarker(
      out,
      "ABOUT_MEDIA",
      `<img src="${escHtml(parsed.aboutImage)}" alt="${aboutAlt}" width="1280" height="714" fetchpriority="high" decoding="async">${badgeHtml}`
    );
  }

  const pillars = parsed.pillars && typeof parsed.pillars === "object" ? parsed.pillars : {};
  const pillarIndices = { holaheart: 0, holagreen: 1, holaconnect: 2 };
  for (const [key, idx] of Object.entries(pillarIndices)) {
    const p = pillars[key];
    if (!p || !p.image || !isSafeMediaUrl(p.image)) continue;
    const alt = escHtml(p.imageAlt || `${key} visual`);
    const orientChip = p.isIllustration
      ? `<span class="visual-orientation-chip">${orientLabel}</span>`
      : "";
    out = replaceMarker(
      out,
      `PILLAR_SLIDE_${idx}`,
      `<img src="${escHtml(p.image)}" alt="${alt}" width="960" height="720" loading="lazy" decoding="async">${orientChip}`
    );
    out = replaceMarker(
      out,
      `PILLAR_MAIN_${key.toUpperCase()}`,
      `<img src="${escHtml(p.image)}" alt="${alt}" width="960" height="600" loading="lazy" decoding="async">${orientChip}`
    );
  }
  return out;
}

export function renderPublicTestimonialsHtml(rows, lang = "vi") {
  const list = (rows || []).filter((r) => r && r.content);
  if (list.length === 0) return "";
  const isEn = lang === "en";
  const cards = list
    .map((r) => {
      const quote = r.pull_quote || r.content;
      const meta = [r.author_role, r.author_org].filter(Boolean).join(" · ");
      const photoHtml =
        r.photo_url && isSafeMediaUrl(r.photo_url)
          ? `<figure style="margin:0 0 14px;border-radius:10px;overflow:hidden;"><img src="${escHtml(r.photo_url)}" alt="${isEn ? "Memory from" : "Kỷ niệm từ"} ${escHtml(r.author_name)}" loading="lazy" style="width:100%;height:180px;object-fit:cover;display:block;"></figure>`
          : "";
      return `<article class="testimonial-card">
        ${photoHtml}
        <p class="testimonial-quote">“${escHtml(quote)}”</p>
        <div class="testimonial-author">
          <strong>${escHtml(r.author_name)}</strong>
          ${meta ? `<span>${escHtml(meta)}</span>` : ""}
        </div>
      </article>`;
    })
    .join("\n      ");

  return `<section class="section section--mist" aria-label="${isEn ? "Participant voices" : "Cảm nhận người tham dự"}">
  <div class="container">
    <div class="section-header" style="margin-bottom: 28px;">
      <div class="kicker">${isEn ? "Voices from Gatherings" : "Tiếng nói từ các buổi gặp"}</div>
      <h2 class="section-title">${isEn ? "Reflections from Participants" : "Cảm nhận của người đồng hành"}</h2>
    </div>
    <div class="grid-3">
      ${cards}
    </div>
  </div>
</section>`;
}

export function renderPublicTeamHtml(rows, lang = "vi") {
  const list = (rows || []).filter((m) => m && m.name);
  if (list.length === 0) return "";
  const isEn = lang === "en";
  const cards = list
    .map((m) => {
      const avatarHtml =
        m.avatar_url && isSafeMediaUrl(m.avatar_url)
          ? `<img src="${escHtml(m.avatar_url)}" alt="${isEn ? "Portrait of" : "Chân dung"} ${escHtml(m.name)}" width="72" height="72" loading="lazy" style="width:68px;height:68px;border-radius:50%;object-fit:cover;">`
          : `<span style="width:68px;height:68px;border-radius:50%;background:var(--accent-soft, #eef2ef);color:var(--ink);display:grid;place-items:center;font-weight:600;font-size:1.1rem;">${escHtml(String(m.name).trim().slice(0, 2).toUpperCase())}</span>`;
      const meta = [m.role_title, m.organization].filter(Boolean).join(" · ");
      return `<article class="value-col" style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;gap:14px;">
          ${avatarHtml}
          <div>
            <h3 style="margin:0 0 2px;font-size:1.02rem;">${escHtml(m.name)}</h3>
            ${meta ? `<div style="font-size:0.84rem;color:var(--accent);font-weight:500;">${escHtml(meta)}</div>` : ""}
          </div>
        </div>
        ${m.bio ? `<p style="margin:0;color:var(--ink-secondary);font-size:0.9rem;line-height:1.6;">${escHtml(m.bio)}</p>` : ""}
      </article>`;
    })
    .join("\n      ");

  return `<section class="section" id="${isEn ? "team" : "doi-ngu"}" aria-label="${isEn ? "HolaRise Coordinating Team" : "Đội ngũ điều phối HolaRise"}">
  <div class="container">
    <div class="section-header" style="margin-bottom: 28px;">
      <div class="kicker">${isEn ? "People Behind HolaRise" : "Con người đứng sau"}</div>
      <h2 class="section-title">${isEn ? "Coordinators &amp; Hosts" : "Đội ngũ Điều phối &amp; Người dẫn dắt"}</h2>
    </div>
    <div class="grid-3">
      ${cards}
    </div>
  </div>
</section>`;
}
