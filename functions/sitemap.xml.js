import { absUrl, escHtml, resolveEventHref, resolveEventHrefEn, splitEventsByDate } from "./_lib/render.js";

const STATIC_PAIRS = [
  ["/", "/en/", "1.0", "0.9", "weekly"],
  ["/gioi-thieu/", "/en/about/", "0.9", "0.8", "monthly"],
  ["/lich-hoat-dong/", "/en/schedule/", "0.9", "0.9", "weekly"],
  ["/hanh-trinh/", "/en/journey/", "0.9", "0.8", "weekly"],
  ["/tham-gia/", "/en/join/", "0.9", "0.8", "monthly"],
  ["/chinh-sach/", "/en/privacy/", "0.5", "0.5", "yearly"],
];

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return env?.ASSETS
      ? env.ASSETS.fetch(new Request(new URL("/sitemap.xml", request.url)))
      : new Response("Not Found", { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const [postsRes, eventsRes] = await Promise.all([
    env.DB.prepare(
      "SELECT slug, updated_at, date FROM posts WHERE status = 'published' ORDER BY date DESC LIMIT 500"
    )
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare(
      "SELECT id, kind, date, updated_at, sort_order, created_at FROM events WHERE status = 'published' ORDER BY sort_order ASC, date ASC LIMIT 100"
    )
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const seen = new Set();
  const entries = [];
  const pushUrl = (path, lastmod, freq, prio, { viPath = "", enPath = "" } = {}) => {
    const loc = absUrl(path);
    if (seen.has(loc)) return;
    seen.add(loc);
    const altXml =
      viPath && enPath
        ? `\n    <xhtml:link rel="alternate" hreflang="vi" href="${escHtml(absUrl(viPath))}"/>` +
          `\n    <xhtml:link rel="alternate" hreflang="en" href="${escHtml(absUrl(enPath))}"/>` +
          `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${escHtml(absUrl(viPath))}"/>`
        : "";
    entries.push(`  <url>
    <loc>${escHtml(loc)}</loc>${altXml}
    <lastmod>${escHtml(lastmod)}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${prio}</priority>
  </url>`);
  };

  for (const [viPath, enPath, viPrio, enPrio, freq] of STATIC_PAIRS) {
    pushUrl(viPath, today, freq, viPrio, { viPath, enPath });
    pushUrl(enPath, today, freq, enPrio, { viPath, enPath });
  }

  const { upcoming, past } = splitEventsByDate(eventsRes.results || []);
  for (const ev of upcoming) {
    const evHref = resolveEventHref(ev);
    const evHrefEn = resolveEventHrefEn(ev);
    const lastmod = String(ev.updatedAt || ev.date || today).slice(0, 10);
    if (evHref) pushUrl(evHref, lastmod, "weekly", "0.9", { viPath: evHref, enPath: evHrefEn });
    if (evHrefEn) pushUrl(evHrefEn, lastmod, "weekly", "0.8", { viPath: evHref, enPath: evHrefEn });
  }
  // Include published past events (Memory Stage archives with galleries & reflections)
  for (const ev of past) {
    const evHref = resolveEventHref(ev);
    const evHrefEn = resolveEventHrefEn(ev);
    const lastmod = String(ev.updatedAt || ev.date || today).slice(0, 10);
    if (evHref) pushUrl(evHref, lastmod, "monthly", "0.7", { viPath: evHref, enPath: evHrefEn });
    if (evHrefEn) pushUrl(evHrefEn, lastmod, "monthly", "0.6", { viPath: evHref, enPath: evHrefEn });
  }

  for (const row of postsRes.results || []) {
    const lastmod = String(row.updated_at || row.date || today).slice(0, 10);
    const viPath = `/hanh-trinh/${row.slug}/`;
    const enPath = `/en/journey/${row.slug}/`;
    pushUrl(viPath, lastmod, "monthly", "0.7", { viPath, enPath });
    pushUrl(enPath, lastmod, "monthly", "0.7", { viPath, enPath });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
