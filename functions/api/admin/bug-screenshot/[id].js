/**
 * Admin-only private image endpoint for bug-report screenshots stored in MEDIA_KV.
 * Serves images at /api/admin/bug-screenshot/<id> only to authenticated admin roles.
 */

import { errorResponse, requireAdmin } from "../../../_lib/security.js";

const SAFE_ID_RE = /^[a-zA-Z0-9._-]{6,96}$/;
const ALLOWED_ROLES = ["super_admin", "editor", "media"];

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { allowedRoles: ALLOWED_ROLES });
  if (!auth.ok) return auth.response;

  const { env, params } = context;
  const id = String(params?.id || "");
  if (!SAFE_ID_RE.test(id)) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy ảnh báo lỗi.");
  }
  if (!env?.MEDIA_KV) {
    return errorResponse(503, "KV_UNAVAILABLE", "Kho lưu ảnh MEDIA_KV chưa được kết nối.");
  }

  const { value, metadata } = await env.MEDIA_KV.getWithMetadata(`bugshot:${id}`, {
    type: "arrayBuffer",
  });
  if (!value) {
    return errorResponse(404, "NOT_FOUND", "Ảnh báo lỗi không tồn tại hoặc đã hết hạn lưu trữ (30 ngày).");
  }

  const contentType = metadata?.contentType || "image/jpeg";
  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${id}"`,
    },
  });
}
