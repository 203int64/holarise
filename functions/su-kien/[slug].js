import {
  absUrl,
  BRAND_SHORT_NAME,
  buildEventIsoTimes,
  buildEventsJsonLd,
  escHtml,
  renderSeatBarHtml,
  replaceMarker,
  resolveEventSlug,
  serializeEventRow,
} from "../_lib/render.js";

const DEFAULT_ZALO_GROUP = "https://zalo.me/g/7fock88aizzrdkmr9ggf";

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

  // Serve pre-rendered static invitation if it exists, enriched with live D1 seat bar, fee & personalized title
  if (env?.ASSETS) {
    const staticRes = await env.ASSETS.fetch(new Request(new URL(`/su-kien/${slug}/index.html`, request.url)));
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
          html = replaceMarker(html, "EVENT_SEAT_BAR", renderSeatBarHtml(matchedStatic, webBooked));
          if (matchedStatic.fee) {
            html = replaceMarker(html, "EVENT_FEE", escHtml(matchedStatic.fee));
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
    env.ASSETS.fetch(new Request(new URL("/_templates/event-invitation-shell.tpl", request.url))),
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
    __SSR_EVENT_ZALO_GROUP__: escHtml(DEFAULT_ZALO_GROUP),
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
