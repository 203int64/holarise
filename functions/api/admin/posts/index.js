import { serializePostRow } from "../../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { validatePostInput } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const status = (url.searchParams.get("status") || "").trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);

  let stmt;
  if (status === "published" || status === "draft") {
    stmt = context.env.DB.prepare(
      "SELECT * FROM posts WHERE status = ? ORDER BY date DESC, created_at DESC LIMIT ?"
    ).bind(status, limit);
  } else {
    stmt = context.env.DB.prepare(
      "SELECT * FROM posts ORDER BY date DESC, created_at DESC LIMIT ?"
    ).bind(limit);
  }

  const { results } = await stmt.all();
  return jsonResponse({
    ok: true,
    items: (results || []).map(serializePostRow),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 256 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validatePostInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin bài viết chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  const dup = await context.env.DB.prepare("SELECT id FROM posts WHERE slug = ?").bind(v.slug).first();
  if (dup) {
    return errorResponse(409, "DUPLICATE_SLUG", "Đường dẫn (slug) này đã tồn tại. Vui lòng đổi slug khác.", {
      slug: "Slug đã được sử dụng bởi bài viết khác.",
    });
  }

  const id = `post-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await context.env.DB.prepare(
    `INSERT INTO posts
     (id, slug, title, category, category_slug, filters_json, date, date_display, read_time, author, image, image_alt, excerpt, content_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      v.slug,
      v.title,
      v.category,
      v.category_slug,
      JSON.stringify(v.filters),
      v.date,
      v.date_display,
      v.read_time,
      v.author,
      v.image,
      v.image_alt,
      v.excerpt,
      JSON.stringify(v.content),
      v.status,
      now,
      now
    )
    .run();

  const created = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializePostRow(created) }, 201);
}
