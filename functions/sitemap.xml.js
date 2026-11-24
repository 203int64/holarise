import { absUrl, escHtml } from "./_lib/render.js";

const STATIC_ROUTES = [
  ["/", "1.0", "weekly"],
  ["/gioi-thieu/", "0.9", "monthly"],
  ["/lich-hoat-dong/", "0.9", "weekly"],
  ["/su-kien/cuoc-doi-cua-cha/", "0.9", "weekly"],
  ["/hanh-trinh/", "0.9", "weekly"],
  ["/tham-gia/", "0.9", "monthly"],
  ["/chinh-sach/", "0.5", "yearly"],
];

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return env?.ASSETS
      ? env.ASSETS.fetch(new Request(new URL("/sitemap.xml", request.url)))
      : new Response("Not Found", { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const postsRes = await env.DB.prepare(
    "SELECT slug, updated_at, date FROM posts WHERE status = 'published' ORDER BY date DESC LIMIT 500"
  )
    .all()
    .catch(() => ({ results: [] }));

  const entries = STATIC_ROUTES.map(
    ([path, prio, freq]) => `  <url>
    <loc>${escHtml(absUrl(path))}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${prio}</priority>
  </url>`
  );

  for (const row of postsRes.results || []) {
    const lastmod = String(row.updated_at || row.date || today).slice(0, 10);
    entries.push(`  <url>
    <loc>${escHtml(absUrl(`/hanh-trinh/${row.slug}/`))}</loc>
    <lastmod>${escHtml(lastmod)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
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
