import { autoProvisionFinishedEventAlbums } from "../_lib/albums.js";
import { ensureMediaApprovalSchema } from "../_lib/media-approval-schema.js";
import {
  absUrl,
  BRAND_SHORT_NAME,
  buildEventIsoTimes,
  buildEventsJsonLd,
  escHtml,
  fullImageUrl,
  getTodayVnIso,
  imageAttrs,
  renderSeatBarHtml,
  replaceMarker,
  resolveEventSlug,
  serializeEventRow,
} from "../_lib/render.js";
import { ensureReflectionsSchema } from "../_lib/security.js";

const DEFAULT_ZALO_GROUP = "https://zalo.me/g/7fock88aizzrdkmr9ggf";

function isEventFinished(ev) {
  if (!ev) return false;
  if (ev.kind === "past") return true;
  const dateStr = String(ev.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  return dateStr < getTodayVnIso(new Date());
}

function renderMemoryGalleryHtml(photos, ev, albumId) {
  const safeEventId = escHtml(ev.id || "");
  const safeSlug = escHtml(resolveEventSlug(ev) || "");
  const safeTitle = escHtml(ev.title || "Buổi gặp HolaRise");
  const safeAlbumId = escHtml(albumId || "");

  if (!photos || photos.length === 0) {
    return `<div class="memory-gallery-empty">
      <p>Những khung hình đầu tiên của buổi gặp đang được chọn lọc từ Ban Hình Ảnh và các thành viên tham dự.</p>
      <button class="btn btn--primary btn--sm" type="button" data-open-event-contribute data-contribute-tab="photos" data-event-id="${safeEventId}" data-event-slug="${safeSlug}" data-event-title="${safeTitle}" data-album-id="${safeAlbumId}">Góp những khung hình đầu tiên</button>
    </div>`;
  }

  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  const tiles = photos
    .map((p, idx) => {
      const caption = p.caption || ev.title || "Khoảnh khắc HolaRise";
      const alt = p.alt || caption;
      const credit = p.photographer ? ` · Ảnh: ${p.photographer}` : "";
      const fullCap = `${caption}${credit}`;
      return `<button class="archive-thumb memory-stage-thumb" type="button" aria-label="Xem ảnh ${pad2(idx + 1)}: ${escHtml(alt)}" data-lightbox-src="${escHtml(fullImageUrl(p.url))}" data-lightbox-alt="${escHtml(alt)}" data-lightbox-caption="${escHtml(fullCap)}">
        <img ${imageAttrs(p.url, "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 280px")} alt="${escHtml(alt)}" width="480" height="360" loading="lazy" decoding="async">
        <span class="archive-thumb-idx" aria-hidden="true">${pad2(idx + 1)}</span>
        <span class="archive-thumb-cap" aria-hidden="true">${escHtml(p.photographer ? `Ảnh: ${p.photographer}` : caption)}</span>
      </button>`;
    })
    .join("\n        ");

  return `<div class="archive-contact-sheet memory-contact-sheet">
        ${tiles}
      </div>`;
}

async function renderMemoryStageResponse({ request, env, matched, slug }) {
  const shellRes = await env.ASSETS.fetch(
    new Request(new URL("/_templates/event-memory-shell.tpl", request.url))
  );
  if (!shellRes || !shellRes.ok) {
    return null;
  }

  await Promise.all([
    ensureMediaApprovalSchema(env.DB),
    ensureReflectionsSchema(env.DB),
  ]);
  await autoProvisionFinishedEventAlbums(env);

  // Locate album linked to this finished event (by event_id first, then matching event_date)
  let album = await env.DB.prepare(
    `SELECT id, slug, title, cover_url
     FROM media_albums
     WHERE status = 'published' AND event_id = ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(matched.id)
    .first()
    .catch(() => null);

  if (!album && matched.date) {
    album = await env.DB.prepare(
      `SELECT id, slug, title, cover_url
       FROM media_albums
       WHERE status = 'published' AND event_date = ?
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(matched.date)
      .first()
      .catch(() => null);
  }

  const albumId = album?.id || "";
  const [photosRes, refCountRow] = await Promise.all([
    albumId
      ? env.DB.prepare(
          `SELECT id, COALESCE(NULLIF(web_url, ''), url) AS url, caption, alt, photographer
           FROM media_photos
           WHERE album_id = ? AND COALESCE(approval_status, 'approved') = 'approved'
           ORDER BY sort_order ASC, created_at DESC
           LIMIT 120`
        )
          .bind(albumId)
          .all()
          .catch(() => ({ results: [] }))
      : Promise.resolve({ results: [] }),
    env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM activity_reflections WHERE activity_slug = ? AND status = 'approved'"
    )
      .bind(slug)
      .first()
      .catch(() => null),
  ]);

  const approvedPhotos = photosRes?.results || [];
  const approvedRefCount = Number(refCountRow?.cnt || 0);
  const pillarMeta = derivePillarMeta(matched);
  const canonicalUrl = absUrl(`/su-kien/${slug}/`);
  const ogImage = approvedPhotos[0]?.url || album?.cover_url || matched.image;
  const pageTitle = `Kỷ niệm · ${matched.title} | ${BRAND_SHORT_NAME}`;
  const statsParts = [];
  if (approvedPhotos.length > 0) statsParts.push(`${approvedPhotos.length} khoảnh khắc`);
  if (approvedRefCount > 0) statsParts.push(`${approvedRefCount} dòng kỷ niệm`);
  const statsText = statsParts.length ? statsParts.join(" · ") : "Đang lưu giữ kỷ niệm";

  const replacements = {
    __SSR_PAGE_TITLE__: escHtml(pageTitle),
    __SSR_PAGE_DESCRIPTION__: escHtml(
      matched.summary || `Sân khấu kỷ niệm, hình ảnh và lưu bút sau buổi gặp ${matched.title} tại Hòa Lạc.`
    ),
    __SSR_CANONICAL_URL__: escHtml(canonicalUrl),
    __SSR_OG_IMAGE_URL__: escHtml(absUrl(ogImage)),
    __SSR_EXTRA_JSON_LD__: buildEventsJsonLd([matched]),
    __SSR_EVENT_ID__: escHtml(matched.id),
    __SSR_EVENT_SLUG__: escHtml(slug),
    __SSR_EVENT_PILLAR__: escHtml(pillarMeta.key),
    __SSR_EVENT_PILLAR_LABEL__: escHtml(pillarMeta.label),
    __SSR_EVENT_TITLE__: escHtml(matched.title),
    __SSR_EVENT_DATE__: escHtml(matched.date || ""),
    __SSR_EVENT_DATE_DISPLAY__: escHtml(matched.dateDisplay || matched.date || "Hòa Lạc"),
    __SSR_EVENT_LOCATION__: escHtml(matched.location || "Hòa Lạc, Hà Nội"),
    __SSR_EVENT_SUMMARY__: escHtml(
      matched.summary ||
        "Những khoảnh khắc, lời chia sẻ và góc nhìn của những người đã đồng hành trong buổi gặp này."
    ),
    __SSR_MEMORY_ALBUM_ID__: escHtml(albumId),
    __SSR_MEMORY_STATS_TEXT__: escHtml(statsText),
    __SSR_MEMORY_GALLERY_HTML__: renderMemoryGalleryHtml(approvedPhotos, matched, albumId),
  };

  const html = (await shellRes.text()).replace(/__SSR_[A-Z0-9_]+__/g, (token) =>
    Object.prototype.hasOwnProperty.call(replacements, token) ? replacements[token] : token
  );

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

function derivePillarMeta(ev) {
  const key = String(ev?.pillar || "").toLowerCase();
  if (key === "holagreen") return { key: "holagreen", label: "HolaGreen" };
  if (key === "holaconnect") return { key: "holaconnect", label: "HolaConnect" };
  return { key: "holaheart", label: "HolaHeart" };
}

function formatEventShareTitle(ev, recipientName = "") {
  const { label } = derivePillarMeta(ev);
  const rawTitle = String(ev?.shortTitle || ev?.title || "").trim();
  const cleanTitle = (
    rawTitle
      .replace(new RegExp(`^${label}\\s*[·\\-–—:]\\s*`, "i"), "")
      .replace(/^Workshop\s+["“](.+?)["”]$/i, "$1")
      .trim() || rawTitle
  );
  const m = String(ev?.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const shortDate = m ? ` | ${m[3]}/${m[2]}` : "";
  const rec = String(recipientName || "").trim().slice(0, 60);
  const recPart = rec ? ` | ${rec}` : "";
  return `${label} · ${cleanTitle}${shortDate}${recPart}`;
}

function injectPersonalizedTitleTags(html, recipientName) {
  const rec = String(recipientName || "").trim().slice(0, 60);
  if (!rec) return html;
  const safeRec = escHtml(rec);
  const appendRec = (val) => (val.includes(`| ${safeRec}`) ? val : `${val} | ${safeRec}`);
  let out = html.replace(/<title>([^<]+)<\/title>/i, (_, t) => `<title>${appendRec(t)}</title>`);
  out = out.replace(
    /(<meta\s+property="og:title"\s+content=")([^"]+)(")/i,
    (_, a, t, c) => `${a}${appendRec(t)}${c}`
  );
  out = out.replace(
    /(<meta\s+name="twitter:title"\s+content=")([^"]+)(")/i,
    (_, a, t, c) => `${a}${appendRec(t)}${c}`
  );
  return out;
}

async function countWebRegistrations(db, eventId) {
  if (!db || !eventId) return 0;
  const row = await db
    .prepare("SELECT COUNT(*) AS cnt FROM registrations WHERE event_id = ? AND status != 'cancelled'")
    .bind(eventId)
    .first()
    .catch(() => null);
  return Number(row?.cnt || 0);
}

export async function onRequestGet({ request, env, params }) {
  const slug = String(params?.slug || "").trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return new Response("Not Found", { status: 404 });
  }

  const reqUrl = new URL(request.url);
  const recipientParam = (reqUrl.searchParams.get("gui") || reqUrl.searchParams.get("to") || "").trim().slice(0, 60);

  // Query live D1 event first so finished events automatically transform into the Post-Event Memory Stage
  // on the exact same /su-kien/<slug>/ URL (even if a pre-rendered static invitation exists in dist/).
  let matchedEvent = null;
  if (env?.DB) {
    const eventsRes = await env.DB.prepare(
      "SELECT * FROM events WHERE status = 'published' ORDER BY sort_order ASC, date ASC LIMIT 100"
    )
      .all()
      .catch(() => ({ results: [] }));
    matchedEvent =
      (eventsRes.results || [])
        .map(serializeEventRow)
        .find((ev) => ev && (resolveEventSlug(ev) === slug || ev.id.toLowerCase() === slug)) || null;

    if (matchedEvent && isEventFinished(matchedEvent) && env?.ASSETS) {
      const memoryRes = await renderMemoryStageResponse({
        request,
        env,
        matched: matchedEvent,
        slug,
      });
      if (memoryRes) return memoryRes;
    }
  }

  // Serve pre-rendered static invitation if it exists, enriched with live D1 seat bar, fee & personalized title
  if (env?.ASSETS) {
    const staticRes = await env.ASSETS.fetch(new Request(new URL(`/su-kien/${slug}/index.html`, request.url)));
    if (staticRes && staticRes.ok) {
      let html = await staticRes.text();
      if (recipientParam) {
        html = injectPersonalizedTitleTags(html, recipientParam);
      }
      if (matchedEvent && env?.DB) {
        const webBooked = matchedEvent.showSeatBar ? await countWebRegistrations(env.DB, matchedEvent.id) : 0;
        html = replaceMarker(html, "EVENT_SEAT_BAR", renderSeatBarHtml(matchedEvent, webBooked));
        if (matchedEvent.fee) {
          html = replaceMarker(html, "EVENT_FEE", escHtml(matchedEvent.fee));
        }
        if (matchedEvent.zaloGroupUrl) {
          html = html.replaceAll(DEFAULT_ZALO_GROUP, escHtml(matchedEvent.zaloGroupUrl));
        }
      }
      const headers = new Headers(staticRes.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", recipientParam ? "private, max-age=0, must-revalidate" : "public, max-age=0, must-revalidate");
      headers.delete("Content-Length");
      headers.delete("ETag");
      return new Response(html, { status: 200, headers });
    }
  }

  if (!env?.DB || !env?.ASSETS) {
    return new Response("Not Found", { status: 404 });
  }

  const shellRes = await env.ASSETS.fetch(
    new Request(new URL("/_templates/event-invitation-shell.tpl", request.url))
  );
  if (!shellRes || !shellRes.ok) {
    return new Response("Not Found", { status: 404 });
  }

  const matched = matchedEvent;

  if (!matched) {
    const notFound = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url)));
    return notFound && notFound.ok
      ? new Response(await notFound.text(), {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        })
      : new Response("Not Found", { status: 404 });
  }

  const canonicalUrl = absUrl(`/su-kien/${slug}/`);
  const times = buildEventIsoTimes(matched.date, matched.time);
  const timeLabel = [matched.time, matched.dateDisplay].filter(Boolean).join(", ");
  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: matched.title,
    dates: times.icsStart && times.icsEnd ? `${times.icsStart}/${times.icsEnd}` : "",
    details: `${matched.summary}\n\nChi tiết: ${canonicalUrl}`,
    location: matched.location || "Hòa Lạc, Hà Nội",
  });
  const gcalUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;

  const letterParts = [];
  if (matched.summary) letterParts.push(`<p>${escHtml(matched.summary)}</p>`);
  if (matched.highlights && matched.highlights.length > 0) {
    letterParts.push(
      `<p>Điểm nhấn buổi gặp: ${matched.highlights.map((h) => escHtml(h)).join(" · ")}.</p>`
    );
  }
  letterParts.push(
    `<p class="invite-closing">Mời bạn giữ chỗ trước để chúng mình sắp xếp chu đáo và gửi định vị chi tiết trong Nhóm Zalo buổi gặp.</p>`
  );

  const webBooked = matched.showSeatBar ? await countWebRegistrations(env.DB, matched.id) : 0;
  const seatBarHtml = renderSeatBarHtml(matched, webBooked);
  const pillarMeta = derivePillarMeta(matched);
  const shareTitle = formatEventShareTitle(matched, recipientParam);

  const replacements = {
    __SSR_PAGE_TITLE__: escHtml(shareTitle),
    __SSR_PAGE_DESCRIPTION__: escHtml(matched.summary || matched.title),
    __SSR_CANONICAL_URL__: escHtml(canonicalUrl),
    __SSR_OG_IMAGE_URL__: escHtml(absUrl(matched.image)),
    __SSR_EXTRA_JSON_LD__: buildEventsJsonLd([matched]),
    __SSR_EVENT_ID__: escHtml(matched.id),
    __SSR_EVENT_SLUG__: escHtml(slug),
    __SSR_EVENT_PILLAR__: escHtml(pillarMeta.key),
    __SSR_EVENT_PILLAR_LABEL__: escHtml(pillarMeta.label),
    __SSR_EVENT_SHARE_TITLE__: escHtml(shareTitle),
    __SSR_EVENT_KICKER__: escHtml(matched.type || "HolaRise · Thư mời tham dự"),
    __SSR_EVENT_TITLE__: escHtml(matched.title),
    __SSR_EVENT_DATE_DISPLAY__: escHtml(matched.dateDisplay || matched.date),
    __SSR_EVENT_LOCATION__: escHtml(matched.location || "Hòa Lạc, Hà Nội"),
    __SSR_EVENT_FEE__: escHtml(matched.fee || "Miễn phí tham dự · Tự túc đồ uống"),
    __SSR_EVENT_SEATS__: escHtml(matched.seats || ""),
    __SSR_EVENT_SEAT_BAR_HTML__: seatBarHtml,
    __SSR_EVENT_IMAGE__: escHtml(matched.image),
    __SSR_EVENT_IMAGE_ALT__: escHtml(matched.imageAlt || matched.title),
    __SSR_EVENT_ZALO_GROUP__: escHtml(matched.zaloGroupUrl || DEFAULT_ZALO_GROUP),
    __SSR_EVENT_HOST_SIGNATURE__: escHtml(`${(matched.type || "HolaRise").split("·")[0].trim()} · ${BRAND_SHORT_NAME}`),
    __SSR_EVENT_RSVP_HEADING__: escHtml(`Giữ chỗ cho ${matched.dateDisplay || matched.date}`),
    __SSR_INVITE_HEADLINE__: escHtml(matched.title),
    __SSR_INVITE_START_ISO__: escHtml(times.startIso || matched.date),
    __SSR_INVITE_END_ISO__: escHtml(times.endIso || matched.date),
    __SSR_INVITE_ICS_START__: escHtml(times.icsStart),
    __SSR_INVITE_ICS_END__: escHtml(times.icsEnd),
    __SSR_INVITE_TIME_LABEL__: escHtml(timeLabel),
    __SSR_INVITE_VENUE_NAME__: escHtml(matched.location || "Hòa Lạc"),
    __SSR_LETTER_BODY_HTML__: letterParts.join("\n      "),
    __SSR_GOOGLE_CAL_URL__: escHtml(gcalUrl),
  };

  const html = (await shellRes.text()).replace(/__SSR_[A-Z0-9_]+__/g, (token) =>
    Object.prototype.hasOwnProperty.call(replacements, token) ? replacements[token] : token
  );

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
