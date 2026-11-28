/**
 * POST /api/auth/media-gate
 * Self-registration on /media/ is intentionally closed.
 * Media access is granted exclusively by upgrading an existing Member account to NGV in /admin/.
 */

import { errorResponse, verifyCsrfOrigin } from "../../_lib/security.js";

export async function onRequestPost({ request }) {
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }
  return errorResponse(
    403,
    "REGISTRATION_DISABLED",
    "Cổng Media không mở tự đăng ký. Hãy tạo tài khoản Thành viên tại /tham-gia/ và liên hệ Quản trị để nâng quyền NGV."
  );
}
