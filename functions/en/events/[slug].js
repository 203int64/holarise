import { autoProvisionFinishedEventAlbums } from "../../_lib/albums.js";
import { canActorViewAlbum, ensureDeepControlSchema, resolveActorContext } from "../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../_lib/media-approval-schema.js";
import {
  absUrl,
  buildEventIsoTimes,
  buildEventsJsonLd,
  escHtml,
  fullImageUrl,
  imageAttrs,
  isEventFinished,
  renderSeatBarHtml,
  replaceMarker,
  resolveEventSlug,
  serializeEventRow,
} from "../../_lib/render.js";
import { ensureReflectionsSchema } from "../../_lib/security.js";

const DEFAULT_ZALO_GROUP = "https://zalo.me/g/7fock88aizzrdkmr9ggf";

function isVideoRow(p) {
  return (
    p?.media_type === "video" ||
    /[?&]kind=video\b|\.(mp4|mov|webm)(?:[?#]|$)/i.test(String(p?.url || ""))
  );
}

function formatDateEn(isoDate, fallback = "Hoa Lac") {
  const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return fallback;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return fallback;
  return dt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function renderMemoryGalleryHtmlEn(photos, ev) {
  const safeTitle = ev.titleEn || ev.title || "HolaRise Gathering";

  if (!photos || photos.length === 0) {
    return `<p class="memory-gallery-quiet">The first moments from this gathering are being curated by our Media Team.</p>`;
  }

  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  const tiles = photos
    .map((p, idx) => {
      const caption = p.caption || safeTitle || "HolaRise Moment";
      const alt = p.alt || caption;
      const credit = p.photographer ? ` · Photo: ${p.photographer}` : "";
      const fullCap = `${caption}${credit}`;
      const isVideo = isVideoRow(p);
      const isLead = idx === 0 && photos.length >= 3;
      const isWide = !isLead && idx % 6 === 3 && photos.length >= 6;
      const mediaInner = isVideo
        ? `<video src="${escHtml(p.url)}" muted playsinline preload="metadata" aria-hidden="true"></video>
           <span class="memory-video-badge" aria-hidden="true">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
             <span>Video</span>
           </span>`
        : `<img ${imageAttrs(p.url, isLead || isWide ? "(max-width: 820px) 94vw, 680px" : "(max-width: 640px) 46vw, 340px")} alt="${escHtml(alt)}" width="480" height="360" loading="lazy" decoding="async">`;
      return `<button class="archive-thumb memory-stage-thumb${isLead ? " is-lead" : ""}${isWide ? " is-wide" : ""}${isVideo ? " is-video" : ""}" type="button" data-media-kind="${isVideo ? "video" : "image"}" aria-label="View ${isVideo ? "video" : "photo"} ${pad2(idx + 1)}: ${escHtml(alt)}" data-lightbox-src="${escHtml(isVideo ? p.url : fullImageUrl(p.url))}" data-lightbox-type="${isVideo ? "video" : "image"}" data-lightbox-alt="${escHtml(alt)}" data-lightbox-caption="${escHtml(fullCap)}">
        ${mediaInner}
        <span class="archive-thumb-idx" aria-hidden="true">${pad2(idx + 1)}</span>
        <span class="archive-thumb-cap" aria-hidden="true">${escHtml(p.photographer || caption)}</span>
      </button>`;
    })
    .join("\n        ");

  return `<div class="memory-exhibition-grid">
        ${tiles}
      </div>`;
}

async function renderMemoryStageResponseEn({ request, env, matched, slug }) {
  const shellRes = await env.ASSETS.fetch(
    new Request(new URL("/_templates/en-event-memory-shell.tpl", request.url))
  );
  if (!shellRes || !shellRes.ok) {
    return null;
  }

  await Promise.all([
    ensureMediaApprovalSchema(env.DB),
    ensureReflectionsSchema(env.DB),
    ensureDeepControlSchema(env.DB),
  ]);
  await autoProvisionFinishedEventAlbums(env);

  let album = await env.DB.prepare(
    `SELECT id, slug, title, cover_url, event_id, COALESCE(visibility, 'public') AS visibility
     FROM media_albums
     WHERE status = 'published' AND event_id = ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(matched.id)
    .first()
    .catch(() => null);

  if (!album && matched.date) {
    album = await env.DB.prepare(
      `SELECT id, slug, title, cover_url, event_id, COALESCE(visibility, 'public') AS visibility
       FROM media_albums
       WHERE status = 'published' AND event_date = ?
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(matched.date)
      .first()
      .catch(() => null);
  }

  const albumId = album?.id || "";
  const isRestrictedAlbum = Boolean(album && String(album.visibility || "public") !== "public");
  let canViewGallery = true;
  if (isRestrictedAlbum) {
    const actor = await resolveActorContext(env, request);
    canViewGallery = await canActorViewAlbum(env.DB, album, actor);
  }

  const [photosRes, refCountRow] = await Promise.all([
    albumId && canViewGallery
      ? env.DB.prepare(
          `SELECT id, COALESCE(NULLIF(web_url, ''), url) AS url, caption, alt, photographer,
                  COALESCE(NULLIF(media_type, ''), 'image') AS media_type
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
  const canonicalUrl = absUrl(`/en/events/${slug}/`);
  const firstApprovedImg = !isRestrictedAlbum
    ? approvedPhotos.find((p) => !isVideoRow(p))
    : null;
  const coverImage =
    firstApprovedImg?.url ||
    (!isRestrictedAlbum && album?.cover_url) ||
    matched.image ||
    "/assets/images/og-cover.jpg";

  const rawTitleEn = String(matched.titleEn || matched.title || "").trim();
  const cleanDisplayTitle =
    rawTitleEn
      .replace(new RegExp(`^${pillarMeta.label}\\s*[·\\-–—:]\\s*`, "i"), "")
      .trim() || rawTitleEn;
  const pageTitle = `Memories · ${cleanDisplayTitle} | HolaRise`;
  const summaryEn =
    matched.summaryEn ||
    `Curated photos, videos, and reflections from ${cleanDisplayTitle} with the HolaRise community in Hoa Lac.`;
  const dateDisplayEn = formatDateEn(matched.date, matched.dateDisplay || "Hoa Lac");

  const statsParts = [];
  if (canViewGallery && approvedPhotos.length > 0) {
    statsParts.push(`${approvedPhotos.length} ${approvedPhotos.length === 1 ? "moment" : "moments"}`);
  }
  if (approvedRefCount > 0) {
    statsParts.push(`${approvedRefCount} ${approvedRefCount === 1 ? "reflection" : "reflections"}`);
  }
  const statsInlineHtml = statsParts.length
    ? `<span aria-hidden="true">·</span><span>${escHtml(statsParts.join(" · "))}</span>`
    : "";

  const galleryHtml = !canViewGallery
    ? `<div class="memory-gallery-empty">
        <p>This photo archive is private to attending Members or guests granted access by our Coordinating Team.</p>
        <a class="btn btn--primary btn--sm" href="/en/join/?next=${encodeURIComponent(`/en/events/${slug}/`)}">Sign in as a Member to unlock photos</a>
      </div>`
    : renderMemoryGalleryHtmlEn(approvedPhotos, matched);

  const replacements = {
    __SSR_PAGE_TITLE__: escHtml(pageTitle),
    __SSR_PAGE_DESCRIPTION__: escHtml(summaryEn),
    __SSR_CANONICAL_URL__: escHtml(canonicalUrl),
    __SSR_OG_IMAGE_URL__: escHtml(absUrl(coverImage)),
    __SSR_EXTRA_JSON_LD__: buildEventsJsonLd([matched], "en"),
    __SSR_EVENT_ID__: escHtml(matched.id),
    __SSR_EVENT_SLUG__: escHtml(slug),
    __SSR_EVENT_PILLAR__: escHtml(pillarMeta.key),
    __SSR_EVENT_PILLAR_LABEL__: escHtml(pillarMeta.label),
    __SSR_EVENT_TITLE__: escHtml(cleanDisplayTitle),
    __SSR_EVENT_DATE__: escHtml(matched.date || ""),
    __SSR_EVENT_DATE_DISPLAY__: escHtml(dateDisplayEn),
    __SSR_EVENT_LOCATION__: escHtml(matched.location || "Hoa Lac, Hanoi"),
    __SSR_EVENT_SUMMARY__: escHtml(summaryEn),
    __SSR_MEMORY_ALBUM_ID__: escHtml(albumId),
    __SSR_MEMORY_COVER_IMAGE__: escHtml(coverImage),
    __SSR_MEMORY_STATS_INLINE_HTML__: statsInlineHtml,
    __SSR_MEMORY_GALLERY_HTML__: galleryHtml,
  };

  const html = (await shellRes.text()).replace(/__SSR_[A-Z0-9_]+__/g, (token) =>
    Object.prototype.hasOwnProperty.call(replacements, token) ? replacements[token] : token
  );

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": isRestrictedAlbum ? "private, no-store" : "public, max-age=0, must-revalidate",
      ...(isRestrictedAlbum ? { Vary: "Cookie" } : {}),
    },
  });
}

function derivePillarMeta(ev) {
  const key = String(ev?.pillar || "").toLowerCase();
  if (key === "holagreen") return { key: "holagreen", label: "HolaGreen" };
  if (key === "holaconnect") return { key: "holaconnect", label: "HolaConnect" };
  return { key: "holaheart", label: "HolaHeart" };
}

function formatEventShareTitleEn(ev, recipientName = "") {
  const { label } = derivePillarMeta(ev);
  const rawTitle = String(ev?.titleEn || ev?.shortTitle || ev?.title || "").trim();
  const cleanTitle =
    rawTitle
      .replace(new RegExp(`^${label}\\s*[·\\-–—:]\\s*`, "i"), "")
      .replace(/^Workshop[:\s]+["“](.+?)["”]$/i, "$1")
      .trim() || rawTitle;
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

  // Query live D1 event first so finished events automatically transform into the English Post-Event Memory Stage
  // on the exact same /en/events/<slug>/ URL (even if a pre-rendered static invitation exists in dist/).
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
      const memoryRes = await renderMemoryStageResponseEn({
        request,
        env,
        matched: matchedEvent,
        slug,
      });
      if (memoryRes) return memoryRes;
    }
  }

  // Serve pre-rendered static EN invitation if it exists, enriched with live D1 seat bar & personalized title
  if (env?.ASSETS) {
    const staticRes = await env.ASSETS.fetch(new Request(new URL(`/en/events/${slug}/index.html`, request.url)));
    if (staticRes && staticRes.ok) {
      let html = await staticRes.text();
      if (recipientParam) {
        html = injectPersonalizedTitleTags(html, recipientParam);
      }
      if (matchedEvent && env?.DB) {
        const webBooked = matchedEvent.showSeatBar ? await countWebRegistrations(env.DB, matchedEvent.id) : 0;
        html = replaceMarker(html, "EVENT_SEAT_BAR", renderSeatBarHtml(matchedEvent, webBooked, "en"));
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
    new Request(new URL("/_templates/en-event-invitation-shell.tpl", request.url))
  );
  if (!shellRes || !shellRes.ok) {
    return new Response("Not Found", { status: 404 });
  }

  const matched = matchedEvent;
  if (!matched) {
    return new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Event Not Found | HolaRise</title><link rel="stylesheet" href="/assets/css/styles.css"></head><body style="display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center;"><div><h1 style="margin:0 0 12px;font-size:1.6rem;">Event not found</h1><p style="margin:0 0 24px;color:#4c5853;">This gathering may have already ended or moved.</p><a class="btn btn--primary" href="/en/schedule/">Back to HolaRise Schedule</a></div></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
    );
  }

  const canonicalUrl = absUrl(`/en/events/${slug}/`);
  const times = buildEventIsoTimes(matched.date, matched.time);
  const titleEn = matched.titleEn || matched.title;
  const summaryEn = matched.summaryEn || matched.summary;
  const dateDisplayEn = formatDateEn(matched.date, matched.dateDisplay || matched.date);
  const timeLabel = [matched.time, dateDisplayEn].filter(Boolean).join(", ");
  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: titleEn,
    dates: times.icsStart && times.icsEnd ? `${times.icsStart}/${times.icsEnd}` : "",
    details: `${summaryEn}\n\nInvitation & RSVP: ${canonicalUrl}`,
    location: matched.location || "Hoa Lac, Hanoi",
  });
  const gcalUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;

  const letterParts = [];
  if (summaryEn) letterParts.push(`<p>${escHtml(summaryEn)}</p>`);
  if (matched.highlights && matched.highlights.length > 0) {
    letterParts.push(
      `<p>Highlights: ${matched.highlights.map((h) => escHtml(h)).join(" · ")}.</p>`
    );
  }
  letterParts.push(
    `<p class="invite-closing">Reserve your seat below so our coordinators can prepare seating and share location pins in the session group. Note: regular gatherings in Hoa Lac are primarily conducted in Vietnamese, and English-speaking coordinators warmly welcome international guests.</p>`
  );

  const webBooked = matched.showSeatBar ? await countWebRegistrations(env.DB, matched.id) : 0;
  const seatBarHtml = renderSeatBarHtml(matched, webBooked, "en");
  const pillarMeta = derivePillarMeta(matched);
  const shareTitle = formatEventShareTitleEn(matched, recipientParam);

  const replacements = {
    __SSR_PAGE_TITLE__: escHtml(shareTitle),
    __SSR_PAGE_DESCRIPTION__: escHtml(summaryEn || titleEn),
    __SSR_CANONICAL_URL__: escHtml(canonicalUrl),
    __SSR_OG_IMAGE_URL__: escHtml(absUrl(matched.image)),
    __SSR_EXTRA_JSON_LD__: buildEventsJsonLd([matched], "en"),
    __SSR_EVENT_ID__: escHtml(matched.id),
    __SSR_EVENT_SLUG__: escHtml(slug),
    __SSR_EVENT_PILLAR__: escHtml(pillarMeta.key),
    __SSR_EVENT_PILLAR_LABEL__: escHtml(pillarMeta.label),
    __SSR_EVENT_SHARE_TITLE__: escHtml(shareTitle),
    __SSR_EVENT_KICKER__: escHtml(`${pillarMeta.label} · Invitation`),
    __SSR_EVENT_LANG_BADGE__: escHtml("Vietnamese Gathering · International Guests Welcome"),
    __SSR_EVENT_TITLE__: escHtml(titleEn),
    __SSR_EVENT_DATE_DISPLAY__: escHtml(dateDisplayEn),
    __SSR_EVENT_LOCATION__: escHtml(matched.location || "Hoa Lac, Hanoi"),
    __SSR_EVENT_FEE__: escHtml("Free admission · Cover your own drink/supplies if any"),
    __SSR_EVENT_SEATS__: escHtml(matched.seats || ""),
    __SSR_EVENT_SEAT_BAR_HTML__: seatBarHtml,
    __SSR_EVENT_IMAGE__: escHtml(matched.image),
    __SSR_EVENT_IMAGE_ALT__: escHtml(matched.imageAlt || titleEn),
    __SSR_EVENT_ZALO_GROUP__: escHtml(matched.zaloGroupUrl || DEFAULT_ZALO_GROUP),
    __SSR_EVENT_HOST_SIGNATURE__: escHtml(`${pillarMeta.label} · HolaRise Community`),
    __SSR_EVENT_RSVP_HEADING__: escHtml(`Reserve your seat for ${dateDisplayEn}`),
    __SSR_INVITE_HEADLINE__: escHtml(titleEn),
    __SSR_INVITE_START_ISO__: escHtml(times.startIso || matched.date),
    __SSR_INVITE_END_ISO__: escHtml(times.endIso || matched.date),
    __SSR_INVITE_ICS_START__: escHtml(times.icsStart),
    __SSR_INVITE_ICS_END__: escHtml(times.icsEnd),
    __SSR_INVITE_TIME_LABEL__: escHtml(timeLabel),
    __SSR_INVITE_VENUE_NAME__: escHtml(matched.location || "Hoa Lac"),
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
