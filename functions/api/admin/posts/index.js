import { notifyPostReviewEvent } from "../../../_lib/manager-notify.js";
import { ensureManagerSchema, logAudit, roleHasPermission } from "../../../_lib/rbac.js";
import { serializePostRow } from "../../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr, validatePostInput } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "posts.read" });
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const status = (url.searchParams.get("status") || "").trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);

  let stmt;
  if (status === "published" || status === "draft" || status === "pending_review" || status === "changes_requested") {
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
  const auth = await requireAdmin(context, { permission: "posts.draft" });
  if (!auth.ok) return auth.response;

  await ensureManagerSchema(context.env.DB);

  const parsed = await readJsonBody(context.request, 256 * 1024);
  if (!parsed.ok) return parsed.response;

  const canPublish = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "posts.publish", auth.isSoleAdmin);
  const rawBody = { ...parsed.data };
  if (!canPublish && !rawBody.status) {
    rawBody.status = "draft";
  }

  const validated = validatePostInput(rawBody);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin bài viết chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  if ((v.status === "published" || v.status === "changes_requested") && !canPublish) {
    return errorResponse(
      403,
      "PUBLISH_FORBIDDEN",
      "CTV Nội dung chỉ có thể lưu Nháp (draft) hoặc Gửi duyệt (pending_review). Trưởng ban Nội dung hoặc Chủ nhiệm sẽ duyệt xuất bản."
    );
  }

  const dup = await context.env.DB.prepare("SELECT id FROM posts WHERE slug = ?").bind(v.slug).first();
  if (dup) {
    return errorResponse(409, "DUPLICATE_SLUG", "Đường dẫn (slug) này đã tồn tại. Vui lòng đổi slug khác.", {
      slug: "Slug đã được sử dụng bởi bài viết khác.",
    });
  }

  const id = `post-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const submittedBy = v.status === "pending_review" ? auth.user.name || auth.user.email : "";
  const submittedById = auth.user.id || "";
  const reviewedBy = v.status === "published" ? auth.user.name || auth.user.email : "";
  const reviewedAt = v.status === "published" ? now : "";
  const reviewNote = canPublish ? cleanStr(parsed.data.reviewNote ?? parsed.data.review_note, 600) : "";

  try {
    await context.env.DB.prepare(
      `INSERT INTO posts
       (id, slug, title, category, category_slug, filters_json, date, date_display, read_time, author, image, image_alt, excerpt, content_json, status, submitted_by, submitted_by_id, reviewed_by, reviewed_at, review_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        submittedBy,
        submittedById,
        reviewedBy,
        reviewedAt,
        reviewNote,
        now,
        now
      )
      .run();
  } catch {
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
  }

  await logAudit(context.env.DB, auth.user, {
    action: v.status === "published" ? "post.publish" : "post.create",
    targetType: "post",
    targetId: id,
    summary: `Tạo bài viết "${v.title}" (${v.status})`,
    meta: { slug: v.slug, status: v.status },
  });

  if (v.status === "pending_review") {
    const reviewers = await context.env.DB.prepare(
      "SELECT email, name FROM admin_users WHERE is_active = 1 AND role IN ('content_editor', 'editor', 'super_admin') LIMIT 5"
    )
      .all()
      .catch(() => ({ results: [] }));
    for (const rv of reviewers.results || []) {
      await notifyPostReviewEvent(context.env, {
        recipientEmail: rv.email,
        recipientName: rv.name,
        post: { title: v.title, slug: v.slug, category: v.category },
        kind: "submitted",
        actorName: auth.user.name || auth.user.email,
      });
    }
  }

  const created = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializePostRow(created) }, 201);
}
