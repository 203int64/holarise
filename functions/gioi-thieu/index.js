import {
  parsePartnersJson,
  renderPartnersStripHtml,
  replaceMarker,
} from "../_lib/render.js";

export async function onRequestGet({ request, env }) {
  const staticAssetReq = new Request(new URL("/gioi-thieu/index.html", request.url), { method: "GET" });

  if (!env?.DB || !env?.ASSETS) {
    return env?.ASSETS ? env.ASSETS.fetch(staticAssetReq) : new Response("Not Found", { status: 404 });
  }

  const [assetRes, partnersRow] = await Promise.all([
    env.ASSETS.fetch(staticAssetReq),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'partners_json'")
      .first()
      .catch(() => null),
  ]);

  if (!assetRes.ok) {
    return assetRes;
  }

  const partners = parsePartnersJson(partnersRow?.value || "[]");
  let html = await assetRes.text();
  html = replaceMarker(html, "PARTNERS_STRIP", renderPartnersStripHtml(partners));

  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, { status: 200, headers });
}
