import { getSettingsMap } from "../../../_lib/gas.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { cleanStr, isSafeGasWebhookUrl, isValidEmail } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const map = await getSettingsMap(context.env.DB);
  return jsonResponse({
    ok: true,
    settings: {
      notify_email: map.notify_email || "phungsu@holarise.org",
      gas_webhook_url: map.gas_webhook_url || "",
      has_webhook_secret: Boolean(map.gas_webhook_secret),
      club_name: map.club_name || "Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên",
    },
  });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context, { superAdminOnly: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  const notifyEmail = cleanStr(parsed.data.notify_email, 160);
  const webhookUrl = cleanStr(parsed.data.gas_webhook_url, 500);
  const clubName = cleanStr(parsed.data.club_name, 160) || "Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên";

  const fields = {};
  if (notifyEmail && !isValidEmail(notifyEmail)) {
    fields.notify_email = "Email nhận thông báo không hợp lệ.";
  }
  if (webhookUrl && !isSafeGasWebhookUrl(webhookUrl)) {
    fields.gas_webhook_url = "URL phải là đường dẫn Web App HTTPS từ script.google.com.";
  }
  if (Object.keys(fields).length > 0) {
    return errorResponse(400, "VALIDATION_ERROR", "Cấu hình chưa hợp lệ.", fields);
  }

  const now = new Date().toISOString();
  const stmts = [
    context.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "notify_email",
      notifyEmail,
      now
    ),
    context.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "gas_webhook_url",
      webhookUrl,
      now
    ),
    context.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(
      "club_name",
      clubName,
      now
    ),
  ];

  // Only overwrite secret if caller explicitly passed a non-empty string or clearSecret=true
  if (parsed.data.clear_webhook_secret === true) {
    stmts.push(
      context.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(
        "gas_webhook_secret",
        "",
        now
      )
    );
  } else if (typeof parsed.data.gas_webhook_secret === "string" && parsed.data.gas_webhook_secret.trim()) {
    stmts.push(
      context.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(
        "gas_webhook_secret",
        cleanStr(parsed.data.gas_webhook_secret, 200),
        now
      )
    );
  }

  await context.env.DB.batch(stmts);
  const map = await getSettingsMap(context.env.DB);

  return jsonResponse({
    ok: true,
    settings: {
      notify_email: map.notify_email || "",
      gas_webhook_url: map.gas_webhook_url || "",
      has_webhook_secret: Boolean(map.gas_webhook_secret),
      club_name: map.club_name || "",
    },
  });
}
