/**
 * Server-side HTML & JSON-LD rendering helpers for Cloudflare Pages Functions SSR.
 * Mirrors build.py markup pixel-for-pixel while preventing XSS via strict escaping.
 */

import { isSafeExternalHttpsUrl, isSafeMediaUrl } from "./validation.js";

export const SITE_URL = "https://holarise.org";
export const BRAND_SHORT_NAME = "Cộng đồng HolaRise";
export const BRAND_FULL_NAME = "Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên";
export const LOGO_MARK_URL = `${SITE_URL}/assets/images/logo-mark.png`;

const ICON_CALENDAR =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
const ICON_PIN =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
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
  return {
    id: row.id,
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
    title: row.title,
    summary: row.summary,
    highlights: safeJsonParse(row.highlights_json, []),
    participants: row.participants,
    image: row.image,
    imageAlt: row.image_alt,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function splitEventsByDate(rows, now = new Date()) {
  const todayVn = getTodayVnIso(now);
  const upcoming = [];
  const past = [];

  for (const row of rows || []) {
    const ev = row && row.pillar ? row : serializeEventRow(row);
    if (!ev) continue;
    const isPastByDate = ISO_DATE_RE.test(String(ev.date || "")) && ev.date < todayVn;
    if (ev.kind === "past" || isPastByDate) {
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
  return `<div class="upcoming-bar" aria-label="Sự kiện sắp diễn ra">
  <div class="container upcoming-bar-inner">
    <div class="upcoming-bar-info">
      <span class="upcoming-dot" aria-hidden="true"></span>
      <span class="upcoming-label">Sắp diễn ra</span>
      <span class="upcoming-title">${escHtml(ws.title)}</span>
      <span class="upcoming-date">· ${escHtml(ws.dateDisplay)} (${escHtml(ws.time)}) · ${escHtml(ws.fee)}</span>
    </div>
    <button class="btn btn--outline btn--sm" type="button" data-register-event="${escHtml(ws.title)}" data-event-id="${escHtml(ws.id)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-fee="${escHtml(ws.fee)}" data-event-type="${escHtml(ws.type)}">Đăng ký tham gia</button>
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
      const catAttr = ` data-workshop-card data-category="${escHtml(Array.from(tokenSet).join(" "))}"`;
      return `<article class="event-card" data-stagger-item${catAttr}>
        <div class="event-card-media" data-curtain>
          <img src="${escHtml(ws.image)}" alt="${escHtml(ws.imageAlt || ws.title)}" width="640" height="420" loading="lazy" decoding="async">
          <div class="event-card-badges">
            <span class="glass-badge">${escHtml(ws.dateDisplay)}</span>
            <span class="glass-badge glass-badge--accent">${escHtml(ws.fee)}</span>
          </div>
        </div>
        <div class="event-card-body">
          <div class="card-meta">
            <span class="cat">${escHtml(ws.type)}</span>
            <span>·</span>
            <span>${escHtml(ws.seats)}</span>
          </div>
          <h3 class="card-title">${escHtml(ws.title)}</h3>
          <p class="card-text">${escHtml(ws.summary)}</p>
          <div class="event-info-inline">
            <span>${ICON_CALENDAR} ${escHtml(ws.time)}</span>
            <span>${ICON_PIN} ${escHtml(ws.location)}</span>
          </div>
          <div class="card-footer">
            <button class="btn btn--primary btn--sm" type="button" style="width: 100%; justify-content: space-between;" data-register-event="${escHtml(ws.title)}" data-event-id="${escHtml(ws.id)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-fee="${escHtml(ws.fee)}" data-event-type="${escHtml(ws.type)}">
              <span>Đăng ký tham gia</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </article>`;
    })
    .join("\n      ");
}

export function renderHomeUpcomingSectionHtml(upcoming) {
  if (!upcoming || upcoming.length === 0) return "";
  return `<section class="section" id="lich-hen">
  <div class="container">
    <div class="section-header--split" style="margin-bottom: 28px;" data-reveal>
      <div>
        <div class="kicker">Lịch tuần này</div>
        <h2 class="section-title" style="margin-bottom: 6px;">Hoạt động sắp diễn ra tại Hòa Lạc – Thạch Thất</h2>
        <p class="section-lead">Đăng ký tham gia trực tiếp ngay trên từng buổi gặp mặt.</p>
      </div>
      <a class="arrow-link" href="/lich-hoat-dong/">
        <span>Xem toàn bộ lịch</span>
        <span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span>
      </a>
    </div>

    <div class="events-rail" data-stagger-group>
      ${renderWorkshopsHtml(upcoming)}
    </div>
  </div>
</section>`;
}

export function renderScheduleUpcomingContentHtml(upcoming) {
  if (!upcoming || upcoming.length === 0) {
    return `<div class="schedule-empty-flagship" role="status">
      <div class="schedule-empty-copy">
        <span class="kicker">Nhịp hoạt động định kỳ</span>
        <h3>Ban Điều Phối đang chuẩn bị cho những cuộc gặp tiếp theo tại Hòa Lạc – Thạch Thất</h3>
        <p>Các buổi HolaHeart, HolaGreen và HolaConnect được tổ chức luân phiên 1–2 buổi mỗi tuần theo tinh thần phi lợi nhuận. Để lại liên hệ để nhận lịch mới nhất ngay khi mở đăng ký.</p>
      </div>
      <div class="schedule-empty-actions">
        <a class="btn btn--primary" href="/tham-gia/">Nhận thông báo lịch tuần mới →</a>
        <a class="btn btn--outline" href="/gioi-thieu/#chuong-trinh">Tìm hiểu 3 trụ cột</a>
      </div>
    </div>`;
  }

  return `<div class="grid-3" data-stagger-group>
      ${renderWorkshopsHtml(upcoming)}
    </div>
    <div class="filter-empty" data-filter-empty="[data-workshop-card]" hidden>
      <p>Hiện chưa có buổi sắp tới nào thuộc nhóm này trong tuần.</p>
      <button class="btn btn--outline btn--sm" type="button" data-filter-reset="[data-workshop-card]">Xem tất cả lịch hoạt động</button>
    </div>`;
}

export function renderJoinEventOptionsHtml(upcoming) {
  const cards = [];
  for (const ws of upcoming || []) {
    const safeId = escHtml(ws.id);
    cards.push(`<div class="join-event-option">
        <input class="visually-hidden" type="radio" name="eventChoice" id="join-ev-${safeId}" value="${safeId}" data-event-title="${escHtml(ws.title)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-type="${escHtml(ws.type)}" data-event-seats="${escHtml(ws.seats)}">
        <label class="join-event-card" for="join-ev-${safeId}">
          <span class="join-event-top">
            <span class="join-event-date">${escHtml(ws.dateDisplay)}</span>
            <span class="join-event-seats">${escHtml(ws.seats)}</span>
          </span>
          <span class="join-event-title">${escHtml(ws.title)}</span>
          <span class="join-event-meta">${escHtml(ws.time)} · ${escHtml(ws.location)}</span>
        </label>
      </div>`);
  }
  if (cards.length === 0) return "";
  return `<div class="join-event-grid">\n      ${cards.join("\n      ")}\n    </div>`;
}

export function renderJoinEventsSectionHtml(upcoming) {
  const inner = renderJoinEventOptionsHtml(upcoming);
  if (!inner) return "";
  return `<fieldset class="join-fieldset" data-join-events-step>
          <legend class="join-legend">02 · Chọn hoạt động bạn muốn tham gia</legend>
          ${inner}
        </fieldset>`;
}

const PAST_FALLBACK_IMAGES = [
  "/assets/images/editorial-holagreen.jpg",
  "/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg",
  "/assets/images/editorial-holaconnect.jpg",
];

export function renderPastWorkshopsHtml(pastList) {
  if (!pastList || pastList.length === 0) return "";
  return pastList
    .map((item, idx) => {
      const photo = item.image || PAST_FALLBACK_IMAGES[idx % PAST_FALLBACK_IMAGES.length];
      const alt = item.imageAlt || item.title;
      const href =
        item.href && String(item.href).startsWith("/")
          ? item.href
          : item.id === "holaheart-first-event-2026"
            ? "/hanh-trinh/tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart/"
            : "";
      const meta = [item.time, item.location, item.participants]
        .filter(Boolean)
        .map(escHtml)
        .join(" · ");
      return `<div class="past-item" data-stagger-item data-hover-photo="${escHtml(photo)}" data-hover-alt="${escHtml(alt)}">
        <span class="past-item-date">${escHtml(item.dateDisplay || item.date)}</span>
        <h3 class="past-item-title">${href ? `<a class="past-item-title-link" href="${escHtml(href)}">${escHtml(item.title)}</a>` : escHtml(item.title)}</h3>
        <span class="past-item-meta">${meta}</span>
        <span class="past-item-arrow" aria-hidden="true">↗</span>
      </div>`;
    })
    .join("\n      ");
}

export function renderNewsCardsHtml(articles, filterable = false) {
  if (!articles || articles.length === 0) {
    return `<div style="grid-column: 1 / -1; padding: 36px 24px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); text-align: center;">
      <p style="margin: 0; color: var(--ink-secondary);">Các câu chuyện tiếp theo đang được Ban Điều Phối hoàn thiện.</p>
    </div>`;
  }
  return articles
    .map((a) => {
      const pillar = a.pillar || derivePillarFilter(a.category, a.filters, a.categorySlug);
      const tokenSet = new Set([pillar, ...(a.filters || [])]);
      if (a.categorySlug) tokenSet.add(a.categorySlug);
      const attr = filterable ? ` data-news-card data-category="${escHtml(Array.from(tokenSet).join(" "))}"` : "";
      const href = `/hanh-trinh/${escHtml(a.slug)}/`;
      return `<article class="editorial-card" data-stagger-item${attr}>
        <a class="plate-media" data-curtain href="${href}" aria-label="${escHtml(a.title)}">
          <img src="${escHtml(a.image)}" alt="${escHtml(a.imageAlt || a.title)}" width="640" height="420" loading="lazy" decoding="async">
        </a>
        <div class="card-meta">
          <span class="cat">${escHtml(a.category)}</span>
          <span>·</span>
          <time datetime="${escHtml(a.date)}">${escHtml(a.dateDisplay)}</time>
        </div>
        <h3 class="card-title"><a href="${href}">${escHtml(a.title)}</a></h3>
        <p class="card-text">${escHtml(a.excerpt)}</p>
        <div class="card-footer">
          <a class="arrow-link" href="${href}">Xem tường thuật &amp; hình ảnh →</a>
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

export function buildArticleSchemas(article) {
  const slugPath = `/hanh-trinh/${article.slug}/`;
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    image: [absUrl(article.image)],
    datePublished: article.date,
    dateModified: (article.updatedAt || article.date || "").slice(0, 10),
    author: { "@type": "Organization", name: article.author },
    publisher: {
      "@type": "Organization",
      name: BRAND_FULL_NAME,
      logo: { "@type": "ImageObject", url: LOGO_MARK_URL },
    },
    mainEntityOfPage: absUrl(slugPath),
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: absUrl("/") },
      { "@type": "ListItem", position: 2, name: "Hành trình", item: absUrl("/hanh-trinh/") },
      { "@type": "ListItem", position: 3, name: article.title, item: absUrl(slugPath) },
    ],
  };
  return `${safeJsonLdScript(articleSchema)}\n  ${safeJsonLdScript(breadcrumb)}`;
}

export function buildEventsJsonLd(upcoming) {
  return (upcoming || [])
    .map((ws) =>
      safeJsonLdScript({
        "@context": "https://schema.org",
        "@type": "Event",
        name: ws.title,
        startDate: ws.date,
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
        isAccessibleForFree: true,
        image: [absUrl(ws.image)],
        description: ws.summary,
        location: {
          "@type": "Place",
          name: ws.location,
          address: {
            "@type": "PostalAddress",
            addressLocality: "Hòa Lạc – Thạch Thất",
            addressRegion: "Hà Nội",
            addressCountry: "VN",
          },
        },
        organizer: {
          "@type": "NGO",
          name: BRAND_FULL_NAME,
          url: SITE_URL,
        },
      })
    )
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

export function renderHorizontalGalleryHtml(photos) {
  if (!photos || photos.length === 0) return "";
  const total = photos.length;
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  return photos
    .map((p, idx) => {
      const caption = p.caption || p.albumTitle || "Khoảnh khắc HolaRise tại Hòa Lạc – Thạch Thất";
      const alt = p.alt || caption;
      const photographer = p.photographer ? ` · Ảnh: ${p.photographer}` : "";
      return `<button class="horizontal-card" type="button" data-lightbox-src="${escHtml(p.url)}" data-lightbox-alt="${escHtml(alt)}" data-lightbox-caption="${escHtml(caption + photographer)}">
        <div class="horizontal-frame">
          <img src="${escHtml(p.url)}" alt="${escHtml(alt)}" width="960" height="600" loading="lazy" decoding="async">
        </div>
        <div class="horizontal-caption">
          <span>${escHtml(caption)}</span>
          <span class="horizontal-index">${pad2(idx + 1)} / ${pad2(total)}</span>
        </div>
      </button>`;
    })
    .join("\n      ");
}

export function renderPublicAlbumsHtml(albumsWithPhotos) {
  if (!albumsWithPhotos || albumsWithPhotos.length === 0) return "";

  const cardsHtml = albumsWithPhotos
    .map((album) => {
      const photos = Array.isArray(album.photos) ? album.photos : [];
      const filters = Array.isArray(album.filters) ? album.filters : [];
      const pillar = derivePillarFilter(album.title, filters);
      const tokenSet = new Set([pillar, ...filters]);
      const filtersAttr = Array.from(tokenSet).join(" ");
      const cover = album.coverUrl || photos[0]?.url || "/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg";
      const safeDrive = isSafeHttpsLink(album.driveUrl) ? album.driveUrl : "";

      const payloadJson = JSON.stringify({
        title: album.title || "",
        driveUrl: safeDrive,
        photos: photos.map((p) => ({
          src: p.url,
          alt: p.alt || p.caption || album.title,
          caption: p.caption || album.title,
          photographer: p.photographer || "",
        })),
      })
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026");

      const filterTags = filters
        .map((f) => `<span class="public-album-tag">${escHtml(FILTER_LABELS_VI[f] || f)}</span>`)
        .join("");

      return `<article class="public-album-card" data-album-card data-category="${escHtml(filtersAttr)}" data-stagger-item>
        <button class="public-album-cover" type="button" data-album-open aria-label="Xem ${photos.length} ảnh trong album ${escHtml(album.title)}">
          <img src="${escHtml(cover)}" alt="${escHtml(album.title)}" width="720" height="480" loading="lazy" decoding="async">
          <span class="public-album-count">${photos.length} ảnh</span>
        </button>
        <div class="public-album-body">
          ${filterTags ? `<div class="public-album-tags">${filterTags}</div>` : ""}
          <h3 class="public-album-title">${escHtml(album.title)}</h3>
          <div class="public-album-meta">${escHtml(album.dateDisplay || album.eventDate || "")}${album.location ? ` · ${escHtml(album.location)}` : ""}</div>
          ${album.description ? `<p class="public-album-desc">${escHtml(album.description)}</p>` : ""}
          <div class="public-album-actions">
            <button class="btn btn--primary btn--sm" type="button" data-album-open>Xem ${photos.length} ảnh</button>
            ${safeDrive ? `<a class="btn btn--outline btn--sm" href="${escHtml(safeDrive)}" target="_blank" rel="noopener noreferrer">Ảnh gốc (Drive) ↗</a>` : ""}
          </div>
        </div>
        <script type="application/json" class="album-photos-data">${payloadJson}</script>
      </article>`;
    })
    .join("\n      ");

  return `<div class="d1-albums-block">
      <div class="public-albums-grid" data-stagger-group>
        ${cardsHtml}
      </div>
    </div>`;
}

export function parsePartnersJson(raw) {
  const list = safeJsonParse(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === "object" && String(item.name || "").trim())
    .map((item, idx) => ({
      id: String(item.id || `partner-${idx + 1}`).trim(),
      name: String(item.name || "").trim().slice(0, 120),
      role: String(item.role || "Đơn vị Đồng hành").trim().slice(0, 80),
      logoUrl: isSafeMediaUrl(item.logoUrl) ? String(item.logoUrl).trim() : "",
      websiteUrl: isSafeExternalHttpsUrl(item.websiteUrl) ? String(item.websiteUrl).trim() : "",
      isActive: item.isActive !== false && item.isActive !== 0,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Math.trunc(Number(item.sortOrder)) : idx,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function renderPartnersStripHtml(partners) {
  const active = (Array.isArray(partners) ? partners : []).filter((p) => p && p.isActive !== false && p.name);
  if (active.length === 0) return "";

  const cards = active
    .map((p) => {
      const logo = p.logoUrl
        ? `<img class="partner-card-logo" src="${escHtml(p.logoUrl)}" alt="${escHtml(p.name)}" width="140" height="44" loading="lazy" decoding="async">`
        : `<span class="partner-card-monogram" aria-hidden="true">${escHtml(p.name.slice(0, 2).toUpperCase())}</span>`;
      const inner = `<div class="partner-card-head">${logo}<span class="partner-card-role">${escHtml(p.role || "Đơn vị Đồng hành")}</span></div>
        <strong class="partner-card-name">${escHtml(p.name)}</strong>`;
      if (p.websiteUrl && isSafeExternalHttpsUrl(p.websiteUrl)) {
        return `<a class="partner-card" href="${escHtml(p.websiteUrl)}" target="_blank" rel="noopener noreferrer" data-stagger-item>${inner}</a>`;
      }
      return `<div class="partner-card" data-stagger-item>${inner}</div>`;
    })
    .join("\n      ");

  return `<section class="section section--mist partners-section" id="doi-tac" aria-label="Đơn vị &amp; Không gian đồng hành">
  <div class="container">
    <div class="section-header--split" style="margin-bottom: 28px;" data-reveal>
      <div>
        <div class="kicker">Mạng lưới tin cậy</div>
        <h2 class="section-title" style="margin-bottom: 6px;">Đơn vị &amp; Không gian đồng hành</h2>
        <p class="section-lead">Những tổ chức, nhà trường và không gian tại Hòa Lạc – Thạch Thất cùng HolaRise tạo nên các chương trình minh bạch và bền vững.</p>
      </div>
      <a class="arrow-link" href="/tham-gia/?chuong-trinh=hoptac">
        <span>Đề xuất đồng hành</span>
        <span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span>
      </a>
    </div>
    <div class="partners-grid" data-stagger-group>
      ${cards}
    </div>
  </div>
</section>`;
}
