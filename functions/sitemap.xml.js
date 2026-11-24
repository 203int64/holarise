import { absUrl, escHtml, resolveEventHref, splitEventsByDate } from "./_lib/render.js";

const STATIC_ROUTES = [
  ["/", "1.0", "weekly"],
  ["/gioi-thieu/", "0.9", "monthly"],
  ["/lich-hoat-dong/", "0.9", "weekly"],
  ["/hanh-trinh/", "0.9", "weekly"],
  ["/tham-gia/", "0.9", "monthly"],
  ["/en/", "0.8", "monthly"],
  ["/chinh-sach/", "0.5", "yearly"],
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
  const pushUrl = (path, lastmod, freq, prio) => {
    const loc = absUrl(path);
    if (seen.has(loc)) return;
    seen.add(loc);
    entries.push(`  <url>
    <loc>${escHtml(loc)}</loc>
    <lastmod>${escHtml(lastmod)}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${prio}</priority>
  </url>`);
  };

  for (const [path, prio, freq] of STATIC_ROUTES) {
    pushUrl(path, today, freq, prio);
  }

  const { upcoming } = splitEventsByDate(eventsRes.results || []);
  for (const ev of upcoming) {
    const evHref = resolveEventHref(ev);
    if (!evHref) continue;
    const lastmod = String(ev.updatedAt || ev.date || today).slice(0, 10);
    pushUrl(evHref, lastmod, "weekly", "0.9");
  }

  for (const row of postsRes.results || []) {
    const lastmod = String(row.updated_at || row.date || today).slice(0, 10);
    pushUrl(`/hanh-trinh/${row.slug}/`, lastmod, "monthly", "0.7");
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
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
