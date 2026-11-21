import { syncRegistrationToGas } from "../../../../_lib/gas.js";
import { errorResponse, jsonResponse, requireAdmin } from "../../../../_lib/security.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const reg = await context.env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
  if (!reg) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy đơn đăng ký.");
  }

  const result = await syncRegistrationToGas(context.env.DB, reg);
  return jsonResponse({
    ok: true,
    sync_status: result.status,
    sync_error: result.error,
  });
}
