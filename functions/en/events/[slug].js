import {
  absUrl,
  buildEventIsoTimes,
  buildEventsJsonLd,
  escHtml,
  renderSeatBarHtml,
  replaceMarker,
  resolveEventSlug,
  serializeEventRow,
} from "../../_lib/render.js";

const DEFAULT_ZALO_GROUP = "https://zalo.me/g/7fock88aizzrdkmr9ggf";

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

  // Serve pre-rendered static EN invitation if it exists, enriched with live D1 seat bar & personalized title
  if (env?.ASSETS) {
    const staticRes = await env.ASSETS.fetch(new Request(new URL(`/en/events/${slug}/index.html`, request.url)));
    if (staticRes && staticRes.ok) {
      let html = await staticRes.text();
      if (recipientParam) {
        html = injectPersonalizedTitleTags(html, recipientParam);
      }
      if (env?.DB) {
        const eventsRes = await env.DB.prepare("SELECT * FROM events WHERE status = 'published' LIMIT 100")
          .all()
          .catch(() => ({ results: [] }));
        const matchedStatic = (eventsRes.results || [])
          .map(serializeEventRow)
          .find((ev) => ev && (resolveEventSlug(ev) === slug || ev.id.toLowerCase() === slug));
        if (matchedStatic) {
          const webBooked = matchedStatic.showSeatBar ? await countWebRegistrations(env.DB, matchedStatic.id) : 0;
          html = replaceMarker(html, "EVENT_SEAT_BAR", renderSeatBarHtml(matchedStatic, webBooked, "en"));
          if (matchedStatic.zaloGroupUrl) {
            html = html.replaceAll(DEFAULT_ZALO_GROUP, escHtml(matchedStatic.zaloGroupUrl));
          }
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

  const [shellRes, eventsRes] = await Promise.all([
    env.ASSETS.fetch(new Request(new URL("/_templates/en-event-invitation-shell.tpl", request.url))),
    env.DB.prepare("SELECT * FROM events WHERE status = 'published' ORDER BY sort_order ASC, date ASC LIMIT 100")
      .all()
      .catch(() => ({ results: [] })),
  ]);

  if (!shellRes || !shellRes.ok) {
    return new Response("Not Found", { status: 404 });
  }

  const matched = (eventsRes.results || [])
    .map(serializeEventRow)
    .find((ev) => ev && (resolveEventSlug(ev) === slug || ev.id.toLowerCase() === slug));

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
  const timeLabel = [matched.time, matched.dateDisplay || matched.date].filter(Boolean).join(", ");
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
    __SSR_EVENT_DATE_DISPLAY__: escHtml(matched.dateDisplay || matched.date),
    __SSR_EVENT_LOCATION__: escHtml(matched.location || "Hoa Lac, Hanoi"),
    __SSR_EVENT_FEE__: escHtml("Free admission · Cover your own drink/supplies if any"),
    __SSR_EVENT_SEATS__: escHtml(matched.seats || ""),
    __SSR_EVENT_SEAT_BAR_HTML__: seatBarHtml,
    __SSR_EVENT_IMAGE__: escHtml(matched.image),
    __SSR_EVENT_IMAGE_ALT__: escHtml(matched.imageAlt || titleEn),
    __SSR_EVENT_ZALO_GROUP__: escHtml(matched.zaloGroupUrl || DEFAULT_ZALO_GROUP),
    __SSR_EVENT_HOST_SIGNATURE__: escHtml(`${pillarMeta.label} · HolaRise Community`),
    __SSR_EVENT_RSVP_HEADING__: escHtml(`Reserve your seat for ${matched.dateDisplay || matched.date}`),
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
