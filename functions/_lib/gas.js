/**
 * Google Apps Script Bridge (Google Sheets + Admin Email + Auto-Confirm User Email).
 * Runs asynchronously via context.waitUntil() after registration is durably saved in D1.
 */

import { isSafeGasWebhookUrl } from "./validation.js";

export async function getSettingsMap(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const map = {};
  for (const row of results || []) {
    map[row.key] = row.value;
  }
  return map;
}

export async function callGasWebhook({ url, secret, payload, fetchImpl = fetch }) {
  if (!url) {
    return { status: "skipped", error: "" };
  }
  if (!isSafeGasWebhookUrl(url)) {
    return { status: "failed", error: "Webhook URL không thuộc tên miền script.google.com hợp lệ." };
  }
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ ...payload, secret: secret || "" }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { status: "failed", error: `HTTP ${res.status}: ${text.slice(0, 180)}` };
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.ok === false) {
        return { status: "failed", error: String(parsed.error || "Apps Script trả về lỗi").slice(0, 180) };
      }
    } catch {
      // Apps Script may return plain text OK if user edited it; treat HTTP 200 without HTML error page as ok
      if (/<html/i.test(text) && /error|sign in|accounts\.google/i.test(text)) {
        return { status: "failed", error: "Apps Script yêu cầu đăng nhập — hãy chọn quyền 'Anyone' khi Deploy Web App." };
      }
    }
    return { status: "synced", error: "" };
  } catch (err) {
    return { status: "failed", error: String(err?.message || err).slice(0, 180) };
  }
}

export async function syncRegistrationToGas(db, registration, fetchImpl = fetch) {
  try {
    const settings = await getSettingsMap(db);
    const url = (settings.gas_webhook_url || "").trim();
    if (!url) {
      await db
        .prepare("UPDATE registrations SET sync_status = 'skipped', sync_error = '', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), registration.id)
        .run();
      return { status: "skipped", error: "" };
    }

    const result = await callGasWebhook({
      url,
      secret: settings.gas_webhook_secret || "",
      fetchImpl,
      payload: {
        action: "registration",
        notifyEmail: settings.notify_email || "phungsu@holarise.org",
        clubName: settings.club_name || "Cộng đồng HolaRise – Hòa Lạc",
        registration: {
          id: registration.id,
          source: registration.source,
          eventId: registration.event_id,
          activityTitle: registration.activity_title,
          fullName: registration.full_name,
          phone: registration.phone,
          email: registration.email,
          role: registration.role,
          organization: registration.organization,
          note: registration.note,
          createdAt: registration.created_at,
        },
      },
    });

    await db
      .prepare("UPDATE registrations SET sync_status = ?, sync_error = ?, updated_at = ? WHERE id = ?")
      .bind(result.status, result.error, new Date().toISOString(), registration.id)
      .run();
    return result;
  } catch (err) {
    const errMsg = String(err?.message || err).slice(0, 180);
    try {
      await db
        .prepare("UPDATE registrations SET sync_status = 'failed', sync_error = ?, updated_at = ? WHERE id = ?")
        .bind(errMsg, new Date().toISOString(), registration.id)
        .run();
    } catch {
      // Ignore secondary logging error
    }
    return { status: "failed", error: errMsg };
  }
}
