import { syncRegistrationToGas } from "../_lib/gas.js";
import {
  checkRateLimit,
  errorResponse,
  getClientIpHash,
  jsonResponse,
  readJsonBody,
  verifyCsrfOrigin,
} from "../_lib/security.js";
import { validateRegistrationInput } from "../_lib/validation.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì. Vui lòng liên hệ qua Zalo hoặc Email.");
  }

  // Allow same-origin requests (public forms on holarise.org and preview origins)
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn gửi biểu mẫu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validateRegistrationInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Vui lòng kiểm tra lại thông tin đăng ký.",
      validated.fields
    );
  }

  // Silent success on honeypot hit so bots do not adapt
  if (validated.honeypot) {
    return jsonResponse({ ok: true, id: "accepted" }, 200);
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `reg:${ipHash}`, 6, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Bạn đã gửi nhiều đơn đăng ký liên tiếp. Vui lòng thử lại sau ít phút hoặc liên hệ Zalo 077.777.1948.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const v = validated.value;
  const now = new Date().toISOString();
  const id = `REG-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const record = {
    id,
    source: v.source,
    event_id: v.event_id,
    activity_title: v.activity_title,
    full_name: v.full_name,
    phone: v.phone,
    email: v.email,
    role: v.role,
    organization: v.organization,
    note: v.note,
    status: "new",
    admin_note: "",
    sync_status: "pending",
    sync_error: "",
    ip_hash: ipHash,
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(
    `INSERT INTO registrations
     (id, source, event_id, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status, sync_error, ip_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      record.id,
      record.source,
      record.event_id,
      record.activity_title,
      record.full_name,
      record.phone,
      record.email,
      record.role,
      record.organization,
      record.note,
      record.status,
      record.admin_note,
      record.sync_status,
      record.sync_error,
      record.ip_hash,
      record.created_at,
      record.updated_at
    )
    .run();

  // Asynchronous sync to Google Sheets + Email notifications (never drops registration on failure)
  const syncPromise = syncRegistrationToGas(env.DB, record);
  if (typeof context.waitUntil === "function") {
    context.waitUntil(syncPromise);
  } else {
    await syncPromise;
  }

  return jsonResponse(
    {
      ok: true,
      id: record.id,
      emailSentHint: Boolean(record.email),
      message: `Cảm ơn ${record.full_name}! Ban Điều Phối HolaRise đã nhận được đăng ký của bạn (mã ${record.id}) và sẽ liên hệ trong vòng 24 giờ.`,
    },
    201
  );
}
