import { notifyPostReviewEvent } from "../../../_lib/manager-notify.js";
import { ensureManagerSchema, logAudit, roleHasPermission } from "../../../_lib/rbac.js";
import { serializePostRow } from "../../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr, validatePostInput } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "posts.read" });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const row = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  if (!row) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài viết.");
  }
  return jsonResponse({ ok: true, item: serializePostRow(row) });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context, { permission: "posts.draft" });
  if (!auth.ok) return auth.response;

  await ensureManagerSchema(context.env.DB);

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài viết để cập nhật.");
  }

  const parsed = await readJsonBody(context.request, 256 * 1024);
  if (!parsed.ok) return parsed.response;

  const canPublish = auth.isSoleAdmin || roleHasPermission(auth.canonicalRole, "posts.publish", auth.isSoleAdmin);
  const validated = validatePostInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin bài viết chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  if (!canPublish && (v.status === "published" || v.status === "changes_requested" || existing.status === "published")) {
    return errorResponse(
      403,
      "PUBLISH_FORBIDDEN",
      "CTV Nội dung không thể tự xuất bản hoặc chỉnh sửa trực tiếp bài đã công khai. Vui lòng gửi duyệt Trưởng ban Nội dung."
    );
  }

  const dup = await context.env.DB.prepare("SELECT id FROM posts WHERE slug = ? AND id != ?")
    .bind(v.slug, id)
    .first();
  if (dup) {
    return errorResponse(409, "DUPLICATE_SLUG", "Đường dẫn (slug) này đã thuộc về bài viết khác.", {
      slug: "Slug đã tồn tại.",
    });
  }

  const now = new Date().toISOString();
  const submittedBy =
    v.status === "pending_review"
      ? auth.user.name || auth.user.email
      : existing.submitted_by || "";
  const submittedById =
    v.status === "pending_review"
      ? auth.user.id || existing.submitted_by_id || ""
      : existing.submitted_by_id || "";
  const isReviewAction =
    (v.status === "published" || v.status === "changes_requested") && v.status !== existing.status;
  const reviewedBy = isReviewAction ? auth.user.name || auth.user.email : existing.reviewed_by || "";
  const reviewedAt = isReviewAction ? now : existing.reviewed_at || "";
  const incomingNote = parsed.data.reviewNote !== undefined || parsed.data.review_note !== undefined
    ? cleanStr(parsed.data.reviewNote ?? parsed.data.review_note, 600)
    : existing.review_note || "";
  const reviewNote =
    v.status === "published"
      ? ""
      : canPublish
        ? incomingNote
        : existing.review_note || "";

  try {
    await context.env.DB.prepare(
      `UPDATE posts
       SET slug = ?, title = ?, category = ?, category_slug = ?, filters_json = ?, date = ?, date_display = ?,
           read_time = ?, author = ?, image = ?, image_alt = ?, excerpt = ?, content_json = ?, status = ?,
           submitted_by = ?, submitted_by_id = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ?
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
        submittedBy,
        submittedById,
        reviewedBy,
        reviewedAt,
        reviewNote,
        now,
        id
      )
      .run();
  } catch {
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
  }

  const auditAction =
    v.status === "published" && existing.status !== "published"
      ? "post.publish"
      : v.status === "changes_requested"
        ? "post.changes_requested"
        : "post.update";

  await logAudit(context.env.DB, auth.user, {
    action: auditAction,
    targetType: "post",
    targetId: id,
    summary: `Cập nhật bài viết "${v.title}" (${existing.status} → ${v.status})${reviewNote ? ` · Ghi chú: ${reviewNote.slice(0, 80)}` : ""}`,
    meta: { fromStatus: existing.status, toStatus: v.status, reviewNote },
  });

  if (submittedById && (v.status === "changes_requested" || (v.status === "published" && existing.status !== "published"))) {
    const authorRow = await context.env.DB.prepare("SELECT email, name FROM admin_users WHERE id = ?")
      .bind(submittedById)
      .first()
      .catch(() => null);
    if (authorRow?.email && authorRow.email !== auth.user.email) {
      await notifyPostReviewEvent(context.env, {
        recipientEmail: authorRow.email,
        recipientName: authorRow.name,
        post: { title: v.title, slug: v.slug, category: v.category },
        kind: v.status === "changes_requested" ? "changes_requested" : "published",
        reviewNote,
        actorName: auth.user.name || auth.user.email,
      });
    }
  }

  const updated = await context.env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializePostRow(updated) });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT id, title FROM posts WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy bài viết để xóa.");
  }
  await context.env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
  await logAudit(context.env.DB, auth.user, {
    action: "post.delete",
    targetType: "post",
    targetId: id,
    summary: `Xóa bài viết "${existing.title}"`,
  });
  return jsonResponse({ ok: true, id });
}
