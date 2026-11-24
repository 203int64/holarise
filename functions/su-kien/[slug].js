import {
  absUrl,
  BRAND_SHORT_NAME,
  buildEventIsoTimes,
  buildEventsJsonLd,
  escHtml,
  resolveEventSlug,
  serializeEventRow,
} from "../_lib/render.js";

const DEFAULT_ZALO_GROUP = "https://zalo.me/g/7fock88aizzrdkmr9ggf";

export async function onRequestGet({ request, env, params }) {
  const slug = String(params?.slug || "").trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return new Response("Not Found", { status: 404 });
  }

  // Serve pre-rendered static invitation if it exists (preserves custom editorial letter copy)
  if (env?.ASSETS) {
    const staticRes = await env.ASSETS.fetch(new Request(new URL(`/su-kien/${slug}/index.html`, request.url)));
    if (staticRes && staticRes.ok) {
      return staticRes;
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

  const replacements = {
    __SSR_PAGE_TITLE__: escHtml(`Thư mời ${matched.title} | HolaRise`),
    __SSR_PAGE_DESCRIPTION__: escHtml(matched.summary || matched.title),
    __SSR_CANONICAL_URL__: escHtml(canonicalUrl),
    __SSR_OG_IMAGE_URL__: escHtml(absUrl(matched.image)),
    __SSR_EXTRA_JSON_LD__: buildEventsJsonLd([matched]),
    __SSR_EVENT_ID__: escHtml(matched.id),
    __SSR_EVENT_SLUG__: escHtml(slug),
    __SSR_EVENT_KICKER__: escHtml(matched.type || "HolaRise · Thư mời tham dự"),
    __SSR_EVENT_TITLE__: escHtml(matched.title),
    __SSR_EVENT_DATE_DISPLAY__: escHtml(matched.dateDisplay || matched.date),
    __SSR_EVENT_LOCATION__: escHtml(matched.location || "Hòa Lạc, Hà Nội"),
    __SSR_EVENT_SEATS__: escHtml(matched.seats || "Mở đăng ký"),
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
