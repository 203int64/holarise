import {
  absUrl,
  buildArticleSchemas,
  escHtml,
  imageAttrs,
  renderNewsCardsHtml,
  renderSafeArticleBody,
  serializePostRow,
} from "../../_lib/render.js";

function renderNotFoundEn() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Story Not Found | HolaRise</title><link rel="stylesheet" href="/assets/css/styles.css"></head><body style="display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center;"><div><h1 style="margin:0 0 12px;font-size:1.6rem;">Story not found</h1><p style="margin:0 0 24px;color:#4c5853;">This story may have been removed or is not yet published.</p><a class="btn btn--primary" href="/en/journey/">Back to HolaRise Journey</a></div></body></html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function onRequestGet({ request, env, params }) {
  const slug = String(params?.slug || "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return renderNotFoundEn();
  }

  // Prefer pre-translated static EN story when available
  if (env?.ASSETS) {
    const staticRes = await env.ASSETS.fetch(new Request(new URL(`/en/journey/${slug}/index.html`, request.url)));
    if (staticRes && staticRes.ok) {
      const headers = new Headers(staticRes.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "public, max-age=0, must-revalidate");
      return new Response(staticRes.body, { status: 200, headers });
    }
  }

  if (!env?.DB || !env?.ASSETS) {
    return renderNotFoundEn();
  }

  const [shellRes, row, relatedRes] = await Promise.all([
    env.ASSETS.fetch(new Request(new URL("/_templates/en-news-detail-shell.tpl", request.url))),
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

  if (!row || !shellRes?.ok) {
    return renderNotFoundEn();
  }

  const article = serializePostRow(row);
  const related = (relatedRes?.results || []).map(serializePostRow);
  const canonicalUrl = absUrl(`/en/journey/${article.slug}/`);
  const ogImageUrl = absUrl(article.image);
  const pageTitle = `${article.title} | HolaRise`;

  const replacements = {
    __SSR_PAGE_TITLE__: escHtml(pageTitle),
    __SSR_PAGE_DESCRIPTION__: escHtml(article.excerpt),
    __SSR_CANONICAL_URL__: escHtml(canonicalUrl),
    __SSR_OG_IMAGE_URL__: escHtml(ogImageUrl),
    __SSR_EXTRA_JSON_LD__: buildArticleSchemas(article, "en"),
    __SSR_ARTICLE_SLUG__: escHtml(article.slug),
    __SSR_ARTICLE_CATEGORY__: escHtml(article.category),
    __SSR_ARTICLE_TITLE__: escHtml(article.title),
    __SSR_ARTICLE_DATE__: escHtml(article.date),
    __SSR_ARTICLE_DATE_DISPLAY__: escHtml(article.dateDisplay),
    __SSR_ARTICLE_READ_TIME__: escHtml(article.readTime || "2 min read"),
    __SSR_ARTICLE_AUTHOR__: escHtml("HolaRise Coordinating Team"),
    __SSR_ARTICLE_IMAGE_ATTRS__: imageAttrs(
      article.image, "(min-width: 1280px) 1240px, calc(100vw - 40px)"
    ),
    __SSR_ARTICLE_IMAGE_ALT__: escHtml(article.imageAlt || article.title),
    __SSR_ARTICLE_BODY__: renderSafeArticleBody(article.content),
    __SSR_RELATED_NEWS__: renderNewsCardsHtml(related, false, "en"),
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
