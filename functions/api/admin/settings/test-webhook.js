import { callGasWebhook, getSettingsMap } from "../../../_lib/gas.js";
import { errorResponse, jsonResponse, requireAdmin } from "../../../_lib/security.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const settings = await getSettingsMap(context.env.DB);
  const url = (settings.gas_webhook_url || "").trim();
  if (!url) {
    return errorResponse(400, "NO_WEBHOOK", "Bạn chưa lưu URL Google Apps Script Web App.");
  }

  const res = await callGasWebhook({
    url,
    secret: settings.gas_webhook_secret || "",
    payload: {
      action: "ping",
      notifyEmail: settings.notify_email || auth.user.email,
      clubName: settings.club_name || "Cộng đồng HolaRise – Hòa Lạc",
      tester: auth.user.email,
      sentAt: new Date().toISOString(),
    },
  });

  if (res.status !== "synced") {
    return errorResponse(502, "WEBHOOK_FAILED", `Kết nối thất bại: ${res.error}`);
  }

  return jsonResponse({
    ok: true,
    message: "Kết nối Google Sheets & Gmail thành công! Vui lòng kiểm tra hộp thư nhận thông báo.",
  });
}
