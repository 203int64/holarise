import { serializePostRow } from "../../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { validatePostInput } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const row = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  if (!row) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài viết.");
  }
  return jsonResponse({ ok: true, item: serializePostRow(row) });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài viết để cập nhật.");
  }

  const parsed = await readJsonBody(context.request, 256 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validatePostInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin bài viết chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  const dup = await context.env.DB.prepare("SELECT id FROM posts WHERE slug = ? AND id != ?")
    .bind(v.slug, id)
    .first();
  if (dup) {
    return errorResponse(409, "DUPLICATE_SLUG", "Đường dẫn (slug) này đã thuộc về bài viết khác.", {
      slug: "Slug đã tồn tại.",
    });
  }

  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `UPDATE posts
     SET slug = ?, title = ?, category = ?, category_slug = ?, filters_json = ?, date = ?, date_display = ?,
         read_time = ?, author = ?, image = ?, image_alt = ?, excerpt = ?, content_json = ?, status = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
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
      id
    )
    .run();

  const updated = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializePostRow(updated) });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const res = await context.env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
  if (Number(res?.meta?.changes || 0) === 0) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài viết để xóa.");
  }
  return jsonResponse({ ok: true, id });
}
