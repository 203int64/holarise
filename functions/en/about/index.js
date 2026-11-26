import {
  applySiteVisualsSsr,
  parsePartnersJson,
  renderPartnersStripHtml,
  renderPublicTeamHtml,
  renderPublicTestimonialsHtml,
  replaceMarker,
} from "../../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/en/about/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  const [assetRes, partnersRow, visualsRow, teamRes, testimonialsRes] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'partners_json'")
      .first()
      .catch(() => null),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'site_visuals_json'")
      .first()
      .catch(() => null),
    env.DB.prepare(
      `SELECT name, role_title, organization, bio, avatar_url
       FROM members
       WHERE is_active = 1 AND is_public_team = 1
       ORDER BY created_at ASC
       LIMIT 24`
    )
      .all()
      .catch(() => null),
    env.DB.prepare(
      `SELECT author_name, author_role, author_org, pull_quote, content, photo_url
       FROM community_testimonials
       WHERE status = 'approved' AND is_featured_home = 1
       ORDER BY created_at DESC
       LIMIT 6`
    )
      .all()
      .catch(() => null),
  ]);

  if (!assetRes.ok) {
    return assetRes;
  }

  let html = await assetRes.text();
  if (partnersRow) {
    const partners = parsePartnersJson(partnersRow.value || "[]");
    html = replaceMarker(html, "PARTNERS_STRIP", renderPartnersStripHtml(partners, "en"));
  }
  if (visualsRow?.value) {
    html = applySiteVisualsSsr(html, visualsRow.value, "en");
  }
  if (teamRes?.results?.length) {
    html = replaceMarker(html, "PUBLIC_TEAM", renderPublicTeamHtml(teamRes.results, "en"));
  }
  if (testimonialsRes?.results?.length) {
    html = replaceMarker(html, "TESTIMONIALS", renderPublicTestimonialsHtml(testimonialsRes.results, "en"));
  }

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
