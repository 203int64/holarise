import {
  absUrl,
  BRAND_SHORT_NAME,
  buildArticleSchemas,
  escHtml,
  renderNewsCardsHtml,
  renderSafeArticleBody,
  serializePostRow,
} from "../_lib/render.js";

async function renderNotFoundResponse(request, env) {
  if (env?.ASSETS) {
    try {
      const notFoundRes = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url)));
      if (notFoundRes && notFoundRes.ok) {
        return new Response(await notFoundRes.text(), {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    } catch (_err) {}
  }

  return new Response(
    `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Không tìm thấy bài viết | ${BRAND_SHORT_NAME}</title><link rel="stylesheet" href="/assets/css/styles.css"></head><body style="display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center;"><div><h1 style="margin:0 0 12px;font-size:1.6rem;">Không tìm thấy bài viết</h1><p style="margin:0 0 24px;color:#4c5853;">Bài viết này có thể đã được gỡ xuống hoặc chưa xuất bản.</p><a class="btn btn--primary" href="/hanh-trinh/">Quay lại Hành trình HolaRise</a></div></body></html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function onRequestGet({ request, env, params }) {
  const slug = String(params?.slug || "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return renderNotFoundResponse(request, env);
  }

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS
      ? env.ASSETS.fetch(new Request(new URL(`/hanh-trinh/${slug}/index.html`, request.url)))
      : new Response("Not Found", { status: 404 });
  }

  const [shellRes, row, relatedRes] = await Promise.all([
    env.ASSETS.fetch(new Request(new URL("/_templates/news-detail-shell.tpl", request.url))),
    env.DB.prepare("SELECT * FROM posts WHERE slug = ? AND status = 'published'")
      .bind(slug)
      .first()
      .catch(() => null),
    env.DB.prepare(
      "SELECT * FROM posts WHERE slug != ? AND status = 'published' ORDER BY date DESC, created_at DESC LIMIT 2"
    )
      .bind(slug)
      .all()
      .catch(() => ({ results: [] })),
  ]);

  if (!row) {
    return renderNotFoundResponse(request, env);
  }

  if (!shellRes.ok) {
    return env.ASSETS.fetch(new Request(new URL(`/hanh-trinh/${slug}/index.html`, request.url)));
  }

  const article = serializePostRow(row);
  const related = (relatedRes?.results || []).map(serializePostRow);
  const canonicalUrl = absUrl(`/hanh-trinh/${article.slug}/`);
  const ogImageUrl = absUrl(article.image);
  const pageTitle = `${article.title} | HolaRise`;

  const replacements = {
    __SSR_PAGE_TITLE__: escHtml(pageTitle),
    __SSR_PAGE_DESCRIPTION__: escHtml(article.excerpt),
    __SSR_CANONICAL_URL__: escHtml(canonicalUrl),
    __SSR_OG_IMAGE_URL__: escHtml(ogImageUrl),
    __SSR_EXTRA_JSON_LD__: buildArticleSchemas(article),
    __SSR_ARTICLE_CATEGORY__: escHtml(article.category),
    __SSR_ARTICLE_TITLE__: escHtml(article.title),
    __SSR_ARTICLE_DATE__: escHtml(article.date),
    __SSR_ARTICLE_DATE_DISPLAY__: escHtml(article.dateDisplay),
    __SSR_ARTICLE_READ_TIME__: escHtml(article.readTime),
    __SSR_ARTICLE_AUTHOR__: escHtml(article.author),
    __SSR_ARTICLE_IMAGE__: escHtml(article.image),
    __SSR_ARTICLE_IMAGE_ALT__: escHtml(article.imageAlt || article.title),
    __SSR_ARTICLE_BODY__: renderSafeArticleBody(article.content),
    __SSR_RELATED_NEWS__: renderNewsCardsHtml(related, false),
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
