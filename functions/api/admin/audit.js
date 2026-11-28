import { ensureManagerSchema } from "../../_lib/rbac.js";
import { jsonResponse, requireAdmin } from "../../_lib/security.js";
import { cleanStr } from "../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const url = new URL(context.request.url);
  const actionPrefix = cleanStr(url.searchParams.get("action"), 40);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10) || 80, 1), 200);

  let stmt;
  if (actionPrefix) {
    stmt = db
      .prepare(
        `SELECT id, actor_id, actor_email, actor_name, actor_role, action, target_type, target_id, summary, meta_json, created_at
         FROM admin_audit_logs
         WHERE action LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(`${actionPrefix}%`, limit);
  } else {
    stmt = db
      .prepare(
        `SELECT id, actor_id, actor_email, actor_name, actor_role, action, target_type, target_id, summary, meta_json, created_at
         FROM admin_audit_logs
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(limit);
  }

  const { results } = await stmt.all();
  return jsonResponse({
    ok: true,
    items: (results || []).map((r) => {
      let meta = {};
      try {
        meta = JSON.parse(r.meta_json || "{}");
      } catch {}
      return {
        id: r.id,
        actorId: r.actor_id,
        actorEmail: r.actor_email,
        actorName: r.actor_name,
        actorRole: r.actor_role,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        summary: r.summary,
        meta,
        createdAt: r.created_at,
      };
    }),
  });
}
