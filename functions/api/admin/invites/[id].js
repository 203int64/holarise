import { ensureManagerSchema, logAudit } from "../../../_lib/rbac.js";
import { errorResponse, jsonResponse, requireAdmin } from "../../../_lib/security.js";
import { cleanStr } from "../../../_lib/validation.js";

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureManagerSchema(db);

  const id = cleanStr(context.params?.id, 80);
  const existing = await db.prepare("SELECT * FROM staff_invites WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy lời mời.");
  }

  const nowIso = new Date().toISOString();
  await db
    .prepare("UPDATE staff_invites SET status = 'revoked', updated_at = ? WHERE id = ?")
    .bind(nowIso, id)
    .run();

  await logAudit(db, auth.user, {
    action: "invite.revoke",
    targetType: "staff_invite",
    targetId: id,
    summary: `Thu hồi link mời của ${existing.name} (${existing.email})`,
  });

  return jsonResponse({ ok: true, id, status: "revoked" });
}
