/**
 * Server-side HTML & JSON-LD rendering helpers for Cloudflare Pages Functions SSR.
 * Mirrors build.py markup pixel-for-pixel while preventing XSS via strict escaping.
 */

export const SITE_URL = "https://holarise.pages.dev";
export const BRAND_SHORT_NAME = "Cộng đồng HolaRise";
export const BRAND_FULL_NAME = "Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên";
export const LOGO_MARK_URL = `${SITE_URL}/assets/images/logo-mark.png`;

const ICON_CALENDAR =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
const ICON_PIN =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

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

export function serializePostRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    categorySlug: row.category_slug,
    filters: safeJsonParse(row.filters_json, []),
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
  return {
    id: row.id,
    kind: row.kind,
    type: row.type,
    filters: safeJsonParse(row.filters_json, []),
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
    <button class="btn btn--outline btn--sm" type="button" data-register-event="${escHtml(ws.title)}" data-event-id="${escHtml(ws.id)}" data-event-date="${escHtml(ws.dateDisplay)}" data-event-time="${escHtml(ws.time)}" data-event-location="${escHtml(ws.location)}" data-event-fee="${escHtml(ws.fee)}" data-event-type="${escHtml(ws.type)}">Giữ chỗ miễn phí</button>
  </div>
</div>`;
}

export function renderWorkshopsHtml(upcoming) {
  if (!upcoming || upcoming.length === 0) {
    return `<div style="grid-column: 1 / -1; padding: 36px 24px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); text-align: center;">
      <p style="margin: 0 0 14px; color: var(--ink-secondary);">Lịch sự kiện cuối tuần mới đang được Ban Điều Phối cập nhật.</p>
      <a class="btn btn--primary btn--sm" href="/tham-gia/">Đăng ký nhận lịch sớm nhất</a>
    </div>`;
  }
  return upcoming
    .map((ws) => {
      const filtersAttr = (ws.filters || []).join(" ");
      const catAttr = filtersAttr
        ? ` data-workshop-card data-category="${escHtml(filtersAttr)}"`
        : " data-workshop-card";
      return `<article class="event-card" data-stagger-item${catAttr}>
        <div class="event-card-media" data-curtain data-cursor-label="Đăng ký">
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
              <span>Đăng ký giữ chỗ</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </article>`;
    })
    .join("\n      ");
}

export function renderJoinEventOptionsHtml(upcoming) {
  const cards = [
    `<div class="join-event-option">
        <input class="visually-hidden" type="radio" name="eventChoice" id="join-ev-flexible" value="" data-event-title="" data-event-date="Ngày đầu của tuần - Chủ nhật" data-event-time="Nhận lịch chi tiết qua Zalo" data-event-location="Hòa Lạc, Hà Nội" data-event-type="Lịch mở hàng tuần" checked>
        <label class="join-event-card" for="join-ev-flexible">
          <span class="join-event-top">
            <span class="join-event-date">Chủ nhật gần nhất</span>
            <span class="join-event-seats">Linh hoạt</span>
          </span>
          <span class="join-event-title">Chủ nhật gần nhất (nhận lịch qua Zalo)</span>
          <span class="join-event-meta">Chưa chốt ngày cụ thể — Ban Điều Phối gửi lịch Chủ nhật tới cho bạn.</span>
        </label>
      </div>`,
  ];
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
  return `<div class="join-event-grid">\n      ${cards.join("\n      ")}\n    </div>`;
}

const PAST_FALLBACK_IMAGES = [
  "/assets/images/activity-environment.jpg",
  "/assets/images/activity-workshop.jpg",
  "/assets/images/activity-community.jpg",
];

export function renderPastWorkshopsHtml(pastList) {
  if (!pastList || pastList.length === 0) return "";
  return pastList
    .map((item, idx) => {
      const photo = item.image || PAST_FALLBACK_IMAGES[idx % PAST_FALLBACK_IMAGES.length];
      const alt = item.imageAlt || item.title;
      return `<div class="past-item" data-stagger-item data-hover-photo="${escHtml(photo)}" data-hover-alt="${escHtml(alt)}">
        <span class="past-item-date">${escHtml(item.dateDisplay || item.date)}</span>
        <h3 class="past-item-title">${escHtml(item.title)}</h3>
        <span class="past-item-meta">${escHtml(item.participants)}</span>
        <span class="past-item-arrow" aria-hidden="true">↗</span>
      </div>`;
    })
    .join("\n      ");
}

export function renderNewsCardsHtml(articles, filterable = false) {
  if (!articles || articles.length === 0) {
    return `<div style="grid-column: 1 / -1; padding: 36px 24px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); text-align: center;">
      <p style="margin: 0; color: var(--ink-secondary);">Chưa có bài viết nào được xuất bản.</p>
    </div>`;
  }
  return articles
    .map((a) => {
      const filterTokens = (a.filters || []).join(" ") || a.categorySlug || "cong-dong";
      const attr = filterable ? ` data-news-card data-category="${escHtml(filterTokens)}"` : "";
      const href = `/tin-tuc/${escHtml(a.slug)}/`;
      return `<article class="editorial-card" data-stagger-item${attr}>
        <a class="plate-media" data-curtain data-cursor-label="Đọc" href="${href}" aria-label="${escHtml(a.title)}">
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
          <a class="arrow-link" href="${href}">Xem hình &amp; nhật ký →</a>
        </div>
      </article>`;
    })
    .join("\n      ");
}

function formatInlineSafe(escapedLine) {
  return escapedLine
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
  const slugPath = `/tin-tuc/${article.slug}/`;
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
      { "@type": "ListItem", position: 2, name: "Tin tức", item: absUrl("/tin-tuc/") },
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
            addressLocality: "Hòa Lạc, Thạch Thất",
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
