/**
 * HolaRise Transactional Email Engine (Dual-Mode: Cloudflare Email Sending + Resend REST API)
 *
 * Strategy (Zero-cost production friendly):
 * - Cloudflare `send_email` binding (`env.EMAIL`) works natively on Workers/Pages.
 *   On Workers Free, Cloudflare only delivers to verified destination addresses;
 *   on Workers Paid ($5/mo), it delivers to arbitrary recipient addresses.
 * - When `RESEND_API_KEY` is configured and `EMAIL_CLOUDFLARE_PAID !== "1"`,
 *   customer-facing emails route through Resend Free (3,000 emails/month) using
 *   a single `fetch()` call with zero external SDK dependencies.
 * - Switching to 100% Cloudflare Paid later requires only setting `EMAIL_CLOUDFLARE_PAID = "1"`
 *   (or `EMAIL_PROVIDER = "cloudflare"`) with zero code changes.
 */

const SITE_ORIGIN = "https://holarise.org";
const DEFAULT_FROM_EMAIL = "phungsu@holarise.org";
const DEFAULT_FROM_NAME = "HolaRise";
const DEFAULT_ZALO_URL = "https://zalo.me/0777771948";
const VALID_TEMPLATE_TYPES = new Set([
  "rsvp_confirm",
  "event_reminder",
  "event_thankyou",
  "test_preview",
]);

let emailSchemaEnsured = false;

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHeaderValue(str, maxLen = 200) {
  return String(str ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function parseFromAddress(rawFrom) {
  const cleaned = sanitizeHeaderValue(rawFrom || "", 200);
  const match = cleaned.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/^["']|["']$/g, "").trim() || DEFAULT_FROM_NAME,
      email: match[2].trim(),
    };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    return { name: DEFAULT_FROM_NAME, email: cleaned };
  }
  return { name: DEFAULT_FROM_NAME, email: DEFAULT_FROM_EMAIL };
}

export function getEmailProviderStatus(env = {}) {
  const hasCloudflareBinding = Boolean(env?.EMAIL && typeof env.EMAIL.send === "function");
  const hasResendKey = Boolean(String(env?.RESEND_API_KEY || "").trim());
  const isCloudflarePaid = String(env?.EMAIL_CLOUDFLARE_PAID || "").trim() === "1";
  const explicit = String(env?.EMAIL_PROVIDER || "auto").trim().toLowerCase();

  let activeMode = "unconfigured";
  let label = "Chưa cấu hình kênh gửi email";
  let canSendToGuests = false;

  if (explicit === "cloudflare") {
    if (hasCloudflareBinding) {
      activeMode = isCloudflarePaid ? "cloudflare_paid" : "cloudflare_free";
      label = isCloudflarePaid
        ? "Cloudflare Email Sending (Paid — gửi mọi địa chỉ)"
        : "Cloudflare Email Sending (Free — chỉ địa chỉ đã verify)";
      canSendToGuests = isCloudflarePaid;
    }
  } else if (explicit === "resend") {
    if (hasResendKey) {
      activeMode = "resend";
      label = "Resend REST API (gửi mọi địa chỉ)";
      canSendToGuests = true;
    }
  } else {
    // Auto Dual-Mode
    if (hasCloudflareBinding && isCloudflarePaid) {
      activeMode = "cloudflare_paid";
      label = "Cloudflare Email Sending (Paid — gửi mọi địa chỉ)";
      canSendToGuests = true;
    } else if (hasResendKey && hasCloudflareBinding) {
      activeMode = "dual_mode";
      label = "Dual-Mode: Cloudflare Free (test BTC) + Resend Free (gửi khách)";
      canSendToGuests = true;
    } else if (hasResendKey) {
      activeMode = "resend";
      label = "Resend REST API (gửi mọi địa chỉ)";
      canSendToGuests = true;
    } else if (hasCloudflareBinding) {
      activeMode = "cloudflare_free";
      label = "Cloudflare Email Sending (Free — chỉ địa chỉ đã verify)";
      canSendToGuests = false;
    }
  }

  return {
    activeMode,
    label,
    canSendToGuests,
    hasCloudflareBinding,
    hasResendKey,
    isCloudflarePaid,
    from: parseFromAddress(env?.EMAIL_FROM),
    replyTo: sanitizeHeaderValue(env?.EMAIL_REPLY_TO || DEFAULT_FROM_EMAIL, 160),
  };
}

export async function ensureEmailLogsSchema(db) {
  if (!db || emailSchemaEnsured) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS email_logs (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL DEFAULT '',
          registration_id TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL,
          recipient_name TEXT NOT NULL DEFAULT '',
          template_type TEXT NOT NULL CHECK(template_type IN ('rsvp_confirm', 'event_reminder', 'event_thankyou', 'test_preview')),
          lang TEXT NOT NULL DEFAULT 'vi' CHECK(lang IN ('vi', 'en')),
          subject TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT 'none',
          status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'skipped')),
          provider_message_id TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT '',
          sent_by TEXT NOT NULL DEFAULT 'system',
          created_at TEXT NOT NULL
        )`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_email_logs_event_type
         ON email_logs(event_id, template_type, status, created_at DESC)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_email_logs_dedup
         ON email_logs(event_id, registration_id, template_type, status)`
      )
      .run();
    emailSchemaEnsured = true;
  } catch {
    // Ignore if read-only or already migrated
  }
}

export function resetEmailSchemaCacheForTests() {
  emailSchemaEnsured = false;
}

/**
 * Build a Google Calendar "Add to Calendar" URL for an event in Asia/Ho_Chi_Minh (UTC+7).
 */
export function buildGoogleCalendarUrl(event = {}, eventUrl = "") {
  const title = sanitizeHeaderValue(event.title || "Buổi gặp HolaRise", 160);
  const location = sanitizeHeaderValue(event.location || "Hòa Lạc, Hà Nội", 200);
  const detailsParts = [];
  if (event.summary) detailsParts.push(String(event.summary).trim());
  if (eventUrl) detailsParts.push(`Chi tiết: ${eventUrl}`);
  const details = detailsParts.join("\n\n").slice(0, 800);

  const dateMatch = String(event.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let datesParam = "";
  if (dateMatch) {
    const [, y, m, d] = dateMatch;
    const timeMatches = [...String(event.time || "").matchAll(/(\d{1,2})\s*[:hH]\s*(\d{2})/g)];
    if (timeMatches.length >= 1) {
      const sh = Number(timeMatches[0][1]);
      const sm = Number(timeMatches[0][2]);
      let eh = timeMatches.length >= 2 ? Number(timeMatches[1][1]) : sh + 2;
      let em = timeMatches.length >= 2 ? Number(timeMatches[1][2]) : sm;
      if (eh < sh || (eh === sh && em <= sm)) {
        eh = Math.min(23, sh + 2);
        em = sm;
      }
      const pad = (n) => String(n).padStart(2, "0");
      datesParam = `${y}${m}${d}T${pad(sh)}${pad(sm)}00/${y}${m}${d}T${pad(eh)}${pad(em)}00`;
    } else {
      // All-day event
      const nextDay = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1));
      const ny = nextDay.getUTCFullYear();
      const nm = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
      const nd = String(nextDay.getUTCDate()).padStart(2, "0");
      datesParam = `${y}${m}${d}/${ny}${nm}${nd}`;
    }
  }

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    location,
    details,
    ctz: "Asia/Ho_Chi_Minh",
  });
  if (datesParam) params.set("dates", datesParam);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildEmailLayout({ lang, preheader, eyebrow, heading, bodyHtml, detailsRows = [], primaryCta, secondaryCta, footerNote }) {
  const isEn = lang === "en";
  const detailTableHtml =
    detailsRows.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background-color:#F5F1E8;border:1px solid #E6DFD2;border-radius:10px;border-collapse:separate;">
          ${detailsRows
            .map(
              ([label, value], idx) => `<tr>
                <td style="padding:${idx === 0 ? "14px" : "8px"} 16px ${idx === detailsRows.length - 1 ? "14px" : "8px"} 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5D645F;width:120px;vertical-align:top;${idx > 0 ? "border-top:1px solid #EAE4D8;" : ""}">${escapeHtml(label)}</td>
                <td style="padding:${idx === 0 ? "14px" : "8px"} 16px ${idx === detailsRows.length - 1 ? "14px" : "8px"} 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1F2421;font-weight:600;vertical-align:top;${idx > 0 ? "border-top:1px solid #EAE4D8;" : ""}">${escapeHtml(value)}</td>
              </tr>`
            )
            .join("")}
        </table>`
      : "";

  const ctaHtml =
    primaryCta || secondaryCta
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 12px 0;">
          <tr>
            ${
              primaryCta
                ? `<td style="padding-right:10px;padding-bottom:8px;">
                    <a href="${escapeHtml(primaryCta.url)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;background-color:#1B3B2B;color:#FAF8F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;border-radius:999px;">${escapeHtml(primaryCta.label)}</a>
                  </td>`
                : ""
            }
            ${
              secondaryCta
                ? `<td style="padding-bottom:8px;">
                    <a href="${escapeHtml(secondaryCta.url)}" target="_blank" rel="noopener" style="display:inline-block;padding:11px 18px;background-color:#FFFFFF;color:#1B3B2B;border:1px solid #1B3B2B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;border-radius:999px;">${escapeHtml(secondaryCta.label)}</a>
                  </td>`
                : ""
            }
          </tr>
        </table>`
      : "";

  const signOff = isEn
    ? "Warmly,<br><strong>HolaRise Coordinating Team</strong><br><span style=\"color:#6E7570;font-size:12px;\">Hoa Lac, Hanoi · holarise.org · phungsu@holarise.org</span>"
    : "Thân mến,<br><strong>Ban Điều Phối HolaRise</strong><br><span style=\"color:#6E7570;font-size:12px;\">Hòa Lạc, Hà Nội · holarise.org · phungsu@holarise.org</span>";

  return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "vi"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAF8F4;color:#1F2421;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF8F4;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background-color:#FFFFFF;border:1px solid #E8E3D9;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:22px 28px;background-color:#1B3B2B;color:#FAF8F4;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:0.3px;color:#FAF8F4;">HolaRise</td>
                  <td align="right" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#D6C4A1;">${escapeHtml(eyebrow)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 24px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#2C332F;">
              <h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.35;color:#1B3B2B;font-weight:700;">${escapeHtml(heading)}</h1>
              ${bodyHtml}
              ${detailTableHtml}
              ${ctaHtml}
              <hr style="border:none;border-top:1px solid #ECE7DD;margin:24px 0 18px 0;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#2C332F;">${signOff}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px;background-color:#F5F1E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6E7570;">
              ${escapeHtml(footerNote)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Render one of the 3 bilingual HolaRise transactional email templates.
 * Returns { subject, html, text, templateType, lang }.
 */
export function renderEventEmailTemplate({
  templateType,
  lang = "vi",
  recipientName = "",
  registrationId = "",
  event = {},
  albumUrl = "",
  customNote = "",
}) {
  const safeLang = String(lang).toLowerCase() === "en" ? "en" : "vi";
  const isEn = safeLang === "en";
  const name = String(recipientName || "").trim() || (isEn ? "friend" : "bạn");
  const slug = event.slug || event.id || "";
  const title = isEn && event.titleEn ? event.titleEn : event.title || "Buổi gặp HolaRise";
  const eventPath = slug ? (isEn ? `/en/events/${slug}/` : `/su-kien/${slug}/`) : isEn ? "/en/schedule/" : "/lich-hoat-dong/";
  const eventUrl = `${SITE_ORIGIN}${eventPath}`;
  const zaloUrl = (event.zaloGroupUrl || event.zalo_group_url || "").trim() || DEFAULT_ZALO_URL;
  const dateLabel = [event.dateDisplay || event.date_display || event.date || "", event.time || ""].filter(Boolean).join(" · ");
  const locationLabel = event.location || (isEn ? "Hoa Lac, Hanoi" : "Hòa Lạc, Hà Nội");
  const feeLabel = event.fee || (isEn ? "Free entry" : "Miễn phí tham dự");
  const calUrl = buildGoogleCalendarUrl({ ...event, title }, eventUrl);
  const resolvedAlbumUrl = String(albumUrl || "").trim() || eventUrl;
  const trimmedNote = String(customNote || "").trim();

  if (templateType === "rsvp_confirm") {
    const subject = sanitizeHeaderValue(
      isEn ? `Seat Confirmed · ${title}` : `Xác nhận giữ chỗ · ${title}`,
      180
    );
    const detailsRows = [
      [isEn ? "Event" : "Buổi gặp", title],
      ...(dateLabel ? [[isEn ? "Time" : "Thời gian", dateLabel]] : []),
      [isEn ? "Location" : "Địa điểm", locationLabel],
      [isEn ? "Fee" : "Chi phí", feeLabel],
      ...(registrationId ? [[isEn ? "Reference" : "Mã giữ chỗ", registrationId]] : []),
    ];

    const bodyHtml = isEn
      ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">We have reserved your seat for <strong>${escapeHtml(title)}</strong>. Whether you are coming on your own or with a friend, our coordinating team will welcome you at the venue.</p>
         <p style="margin:0;">Please join the session Zalo group below for arrival directions, carpooling, and any last-minute updates.</p>`
      : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">Chúng mình đã ghi nhận chỗ ngồi của bạn cho buổi gặp <strong>${escapeHtml(title)}</strong>. Nếu bạn đi một mình, tại điểm hẹn luôn có thành viên HolaRise đón từ sớm và bạn không bị ép phát biểu.</p>
         <p style="margin:0;">Mời bạn tham gia nhóm Zalo bên dưới để nhận hướng dẫn đường đi, ghép xe và cập nhật sát giờ gặp.</p>`;

    const html = buildEmailLayout({
      lang: safeLang,
      preheader: isEn ? `Your seat for ${title} is confirmed.` : `Chỗ ngồi của bạn tại ${title} đã được xác nhận.`,
      eyebrow: isEn ? "Seat Confirmation" : "Xác nhận giữ chỗ",
      heading: isEn ? `See you at ${title}` : `Hẹn gặp bạn tại ${title}`,
      bodyHtml,
      detailsRows,
      primaryCta: {
        label: isEn ? "Join Session Zalo Group" : "Vào Nhóm Zalo buổi gặp",
        url: zaloUrl,
      },
      secondaryCta: {
        label: isEn ? "Add to Google Calendar" : "Lưu vào Google Calendar",
        url: calUrl,
      },
      footerNote: isEn
        ? `You received this confirmation because you reserved a seat on holarise.org. Event details: ${eventUrl}`
        : `Bạn nhận được thư này vì đã giữ chỗ trên holarise.org. Xem lại thư mời tại: ${eventUrl}`,
    });

    const text = isEn
      ? [
          `Hello ${name},`,
          "",
          `We have reserved your seat for: ${title}`,
          dateLabel ? `Time: ${dateLabel}` : "",
          `Location: ${locationLabel}`,
          `Fee: ${feeLabel}`,
          registrationId ? `Reference: ${registrationId}` : "",
          "",
          `Join Session Zalo Group: ${zaloUrl}`,
          `Add to Google Calendar: ${calUrl}`,
          `Event page: ${eventUrl}`,
          "",
          "Warmly,",
          "HolaRise Coordinating Team (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n")
      : [
          `Chào ${name},`,
          "",
          `Chúng mình đã ghi nhận chỗ ngồi của bạn cho buổi gặp: ${title}`,
          dateLabel ? `Thời gian: ${dateLabel}` : "",
          `Địa điểm: ${locationLabel}`,
          `Chi phí: ${feeLabel}`,
          registrationId ? `Mã giữ chỗ: ${registrationId}` : "",
          "",
          "Nếu bạn đi một mình, tại điểm hẹn luôn có thành viên HolaRise đón từ sớm.",
          `Nhóm Zalo buổi gặp: ${zaloUrl}`,
          `Lưu lịch Google Calendar: ${calUrl}`,
          `Thư mời chi tiết: ${eventUrl}`,
          "",
          "Thân mến,",
          "Ban Điều Phối HolaRise (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n");

    return { subject, html, text, templateType, lang: safeLang };
  }

  if (templateType === "event_reminder") {
    const subject = sanitizeHeaderValue(
      isEn ? `Event Reminder · ${title}` : `Nhắc lịch buổi gặp · ${title}`,
      180
    );
    const detailsRows = [
      [isEn ? "Event" : "Buổi gặp", title],
      ...(dateLabel ? [[isEn ? "Time" : "Thời gian", dateLabel]] : []),
      [isEn ? "Location" : "Địa điểm", locationLabel],
      [isEn ? "Fee" : "Chi phí", feeLabel],
    ];

    const noteBlockHtml = trimmedNote
      ? `<div style="margin:16px 0 0 0;padding:12px 14px;background-color:#FBF7EE;border-left:3px solid #B58342;border-radius:6px;font-size:14px;color:#2C332F;">
           <strong>${isEn ? "Note from the host:" : "Lời nhắn từ Ban Điều Phối:"}</strong><br>${escapeHtml(trimmedNote).replace(/\n/g, "<br>")}
         </div>`
      : "";

    const bodyHtml = isEn
      ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">Just a gentle reminder that <strong>${escapeHtml(title)}</strong> is coming up soon. We have prepared the space and look forward to welcoming you.</p>
         <p style="margin:0;">If your plans change or you need a ride from campus, simply drop a quick message in the Zalo group.</p>
         ${noteBlockHtml}`
      : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">Buổi gặp <strong>${escapeHtml(title)}</strong> sắp diễn ra. Chúng mình đã chuẩn bị sẵn không gian và hẹn đón bạn đúng giờ tại điểm hẹn.</p>
         <p style="margin:0;">Nếu cần ghép xe, hỏi đường hoặc có thay đổi lịch đột xuất, bạn nhắn nhanh vào nhóm Zalo buổi gặp để Ban Điều Phối tiện sắp xếp.</p>
         ${noteBlockHtml}`;

    const html = buildEmailLayout({
      lang: safeLang,
      preheader: isEn ? `Reminder: ${title} at ${locationLabel}.` : `Nhắc lịch: ${title} tại ${locationLabel}.`,
      eyebrow: isEn ? "Event Reminder" : "Nhắc lịch trước giờ G",
      heading: isEn ? `Reminder · ${title}` : `Hẹn sớm gặp bạn · ${title}`,
      bodyHtml,
      detailsRows,
      primaryCta: {
        label: isEn ? "Open Session Zalo Group" : "Mở Nhóm Zalo buổi gặp",
        url: zaloUrl,
      },
      secondaryCta: {
        label: isEn ? "View Event Details" : "Xem lại Thư mời",
        url: eventUrl,
      },
      footerNote: isEn
        ? `Sent to registered participants of ${title} on holarise.org.`
        : `Thư nhắc gửi riêng tới các bạn đã giữ chỗ cho ${title} trên holarise.org.`,
    });

    const text = isEn
      ? [
          `Hello ${name},`,
          "",
          `Gentle reminder: ${title} is coming up soon.`,
          dateLabel ? `Time: ${dateLabel}` : "",
          `Location: ${locationLabel}`,
          `Fee: ${feeLabel}`,
          trimmedNote ? `\nNote from the host:\n${trimmedNote}` : "",
          "",
          `Session Zalo Group: ${zaloUrl}`,
          `Event details: ${eventUrl}`,
          "",
          "Warmly,",
          "HolaRise Coordinating Team (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n")
      : [
          `Chào ${name},`,
          "",
          `Buổi gặp ${title} sắp diễn ra. Chúng mình hẹn đón bạn tại điểm hẹn.`,
          dateLabel ? `Thời gian: ${dateLabel}` : "",
          `Địa điểm: ${locationLabel}`,
          `Chi phí: ${feeLabel}`,
          trimmedNote ? `\nLời nhắn từ Ban Điều Phối:\n${trimmedNote}` : "",
          "",
          `Nhóm Zalo buổi gặp: ${zaloUrl}`,
          `Xem lại thư mời: ${eventUrl}`,
          "",
          "Thân mến,",
          "Ban Điều Phối HolaRise (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n");

    return { subject, html, text, templateType, lang: safeLang };
  }

  // Default: event_thankyou
  const subject = sanitizeHeaderValue(
    isEn ? `Thank you for joining · ${title}` : `Cảm ơn bạn đã đồng hành · ${title}`,
    180
  );
  const noteBlockHtml = trimmedNote
    ? `<div style="margin:16px 0 0 0;padding:12px 14px;background-color:#FBF7EE;border-left:3px solid #B58342;border-radius:6px;font-size:14px;color:#2C332F;">
         <strong>${isEn ? "Message from HolaRise:" : "Đôi lời gửi thêm:"}</strong><br>${escapeHtml(trimmedNote).replace(/\n/g, "<br>")}
       </div>`
    : "";

  const bodyHtml = isEn
    ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">Thank you for spending your time with us at <strong>${escapeHtml(title)}</strong>. Every calm conversation and quiet presence helped make the gathering meaningful.</p>
       <p style="margin:0;">The photo album and reflection space for this session are now open. You can browse the memories or leave a short note for the next gathering below.</p>
       ${noteBlockHtml}`
    : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">Cảm ơn bạn đã dành thời gian có mặt và đồng hành cùng chúng mình tại <strong>${escapeHtml(title)}</strong>. Sự lắng nghe chân thành của mỗi người đã tạo nên một buổi gặp ấm áp và trọn vẹn.</p>
       <p style="margin:0;">Kho ảnh kỷ niệm và không gian lưu bút của buổi gặp đã sẵn sàng. Mời bạn xem lại những khung hình đẹp hoặc gửi vài dòng góp ý để chặng sau thêm chu đáo.</p>
       ${noteBlockHtml}`;

  const html = buildEmailLayout({
    lang: safeLang,
    preheader: isEn ? `Memories and photos from ${title} are ready.` : `Kho ảnh và lưu bút của buổi gặp ${title} đã sẵn sàng.`,
    eyebrow: isEn ? "Post-Event Memories" : "Cảm ơn & Kỷ niệm",
    heading: isEn ? `Thank you · ${title}` : `Cảm ơn bạn đã có mặt · ${title}`,
    bodyHtml,
    detailsRows: [
      [isEn ? "Gathering" : "Buổi gặp", title],
      ...(dateLabel ? [[isEn ? "Date" : "Ngày diễn ra", dateLabel]] : []),
      [isEn ? "Location" : "Địa điểm", locationLabel],
    ],
    primaryCta: {
      label: isEn ? "Open Photo Album & Memories" : "Mở Kho ảnh & Lưu bút",
      url: resolvedAlbumUrl,
    },
    secondaryCta: {
      label: isEn ? "Upcoming Gatherings" : "Xem lịch hoạt động tiếp theo",
      url: `${SITE_ORIGIN}${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}`,
    },
    footerNote: isEn
      ? `Thank you for being part of HolaRise. View the event memory page: ${eventUrl}`
      : `Cảm ơn bạn đã đồng hành cùng HolaRise. Xem lại trang kỷ niệm tại: ${eventUrl}`,
  });

  const text = isEn
    ? [
        `Hello ${name},`,
        "",
        `Thank you for joining us at ${title}.`,
        trimmedNote ? `\nMessage from HolaRise:\n${trimmedNote}` : "",
        "",
        `Photo Album & Memories: ${resolvedAlbumUrl}`,
        `Upcoming Gatherings: ${SITE_ORIGIN}/en/schedule/`,
        "",
        "Warmly,",
        "HolaRise Coordinating Team (phungsu@holarise.org)",
      ]
        .filter((l) => l !== "")
        .join("\n")
    : [
        `Chào ${name},`,
        "",
        `Cảm ơn bạn đã dành thời gian có mặt và đồng hành cùng chúng mình tại ${title}.`,
        trimmedNote ? `\nĐôi lời gửi thêm:\n${trimmedNote}` : "",
        "",
        `Kho ảnh & Lưu bút buổi gặp: ${resolvedAlbumUrl}`,
        `Lịch hoạt động tiếp theo: ${SITE_ORIGIN}/lich-hoat-dong/`,
        "",
        "Thân mến,",
        "Ban Điều Phối HolaRise (phungsu@holarise.org)",
      ]
        .filter((l) => l !== "")
        .join("\n");

  return { subject, html, text, templateType: "event_thankyou", lang: safeLang };
}

async function sendViaCloudflareBinding(emailBinding, { from, replyTo, to, subject, html, text }) {
  const res = await emailBinding.send({
    from: { email: from.email, name: from.name },
    to,
    replyTo,
    subject,
    html,
    text,
  });
  return {
    ok: true,
    provider: "cloudflare",
    messageId: String(res?.messageId || res?.id || ""),
  };
}

async function sendViaResendApi(apiKey, { from, replyTo, to, subject, html, text }, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      from: `${from.name} <${from.email}>`,
      to: [to],
      reply_to: replyTo,
      subject,
      html,
      text,
    }),
  });
  const rawText = await res.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errMsg = data?.message || data?.error || `HTTP ${res.status}: ${rawText.slice(0, 160)}`;
    throw new Error(String(errMsg));
  }
  return {
    ok: true,
    provider: "resend",
    messageId: String(data?.id || ""),
  };
}

/**
 * Send a transactional email using Dual-Mode routing (Cloudflare send_email + Resend fallback).
 */
export async function sendTransactionalEmail(
  env,
  { to, subject, html, text, preferCloudflare = false, fetchImpl = fetch }
) {
  const recipient = sanitizeHeaderValue(to, 180).toLowerCase();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { ok: false, status: "skipped", provider: "none", messageId: "", error: "Email người nhận không hợp lệ." };
  }

  const status = getEmailProviderStatus(env);
  const resendKey = String(env?.RESEND_API_KEY || "").trim();
  const payload = {
    from: status.from,
    replyTo: status.replyTo,
    to: recipient,
    subject: sanitizeHeaderValue(subject, 200),
    html: String(html || ""),
    text: String(text || ""),
  };

  const explicit = String(env?.EMAIL_PROVIDER || "auto").trim().toLowerCase();

  // Explicit Resend
  if (explicit === "resend") {
    if (!resendKey) {
      return { ok: false, status: "skipped", provider: "none", messageId: "", error: "Chưa cấu hình RESEND_API_KEY." };
    }
    try {
      const r = await sendViaResendApi(resendKey, payload, fetchImpl);
      return { ok: true, status: "sent", provider: r.provider, messageId: r.messageId, error: "" };
    } catch (err) {
      return { ok: false, status: "failed", provider: "resend", messageId: "", error: String(err?.message || err).slice(0, 220) };
    }
  }

  // Explicit Cloudflare
  if (explicit === "cloudflare") {
    if (!status.hasCloudflareBinding) {
      return { ok: false, status: "skipped", provider: "none", messageId: "", error: "Chưa gắn binding send_email (EMAIL)." };
    }
    try {
      const r = await sendViaCloudflareBinding(env.EMAIL, payload);
      return { ok: true, status: "sent", provider: r.provider, messageId: r.messageId, error: "" };
    } catch (err) {
      return { ok: false, status: "failed", provider: "cloudflare", messageId: "", error: String(err?.message || err).slice(0, 220) };
    }
  }

  // Auto Dual-Mode:
  // 1. If Cloudflare Paid is enabled, OR caller explicitly prefers Cloudflare (e.g. admin test), OR no Resend key exists -> try Cloudflare first
  const tryCloudflareFirst = status.hasCloudflareBinding && (status.isCloudflarePaid || preferCloudflare || !resendKey);

  if (tryCloudflareFirst) {
    try {
      const r = await sendViaCloudflareBinding(env.EMAIL, payload);
      return { ok: true, status: "sent", provider: r.provider, messageId: r.messageId, error: "" };
    } catch (cfErr) {
      const cfMsg = String(cfErr?.message || cfErr);
      // Graceful fallback to Resend if available (e.g. Workers Free E_RECIPIENT_PLAN_RESTRICTED)
      if (resendKey) {
        try {
          const r = await sendViaResendApi(resendKey, payload, fetchImpl);
          return { ok: true, status: "sent", provider: r.provider, messageId: r.messageId, error: "" };
        } catch (rsErr) {
          return {
            ok: false,
            status: "failed",
            provider: "resend",
            messageId: "",
            error: `Cloudflare: ${cfMsg.slice(0, 90)} | Resend: ${String(rsErr?.message || rsErr).slice(0, 90)}`,
          };
        }
      }
      return { ok: false, status: "failed", provider: "cloudflare", messageId: "", error: cfMsg.slice(0, 220) };
    }
  }

  // 2. Otherwise (Workers Free + Resend key configured for arbitrary guest emails) -> route via Resend directly
  if (resendKey) {
    try {
      const r = await sendViaResendApi(resendKey, payload, fetchImpl);
      return { ok: true, status: "sent", provider: r.provider, messageId: r.messageId, error: "" };
    } catch (err) {
      return { ok: false, status: "failed", provider: "resend", messageId: "", error: String(err?.message || err).slice(0, 220) };
    }
  }

  return {
    ok: false,
    status: "skipped",
    provider: "none",
    messageId: "",
    error: "Chưa cấu hình kênh gửi email (Cloudflare EMAIL binding hoặc RESEND_API_KEY).",
  };
}

export async function logEmailAttempt(db, entry) {
  if (!db) return null;
  await ensureEmailLogsSchema(db);
  const now = new Date().toISOString();
  const id = `EML-${now.slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const templateType = VALID_TEMPLATE_TYPES.has(entry.templateType) ? entry.templateType : "rsvp_confirm";
  const lang = entry.lang === "en" ? "en" : "vi";
  try {
    await db
      .prepare(
        `INSERT INTO email_logs
         (id, event_id, registration_id, recipient_email, recipient_name, template_type, lang, subject, provider, status, provider_message_id, error_message, sent_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        String(entry.eventId || ""),
        String(entry.registrationId || ""),
        String(entry.recipientEmail || "").toLowerCase(),
        String(entry.recipientName || ""),
        templateType,
        lang,
        String(entry.subject || "").slice(0, 220),
        String(entry.provider || "none"),
        String(entry.status || "skipped"),
        String(entry.messageId || "").slice(0, 160),
        String(entry.error || "").slice(0, 240),
        String(entry.sentBy || "system").slice(0, 160),
        now
      )
      .run();
  } catch {
    // Do not break caller if log write fails
  }
  return id;
}

export async function getSentRegistrationIdsForTemplate(db, eventId, templateType) {
  if (!db || !eventId || !templateType) return new Set();
  await ensureEmailLogsSchema(db);
  const res = await db
    .prepare(
      `SELECT registration_id, recipient_email
       FROM email_logs
       WHERE event_id = ? AND template_type = ? AND status = 'sent'`
    )
    .bind(eventId, templateType)
    .all()
    .catch(() => ({ results: [] }));
  const set = new Set();
  for (const row of res.results || []) {
    if (row.registration_id) set.add(row.registration_id);
    if (row.recipient_email) set.add(String(row.recipient_email).toLowerCase());
  }
  return set;
}

export async function listEventEmailLogs(db, eventId, limit = 60) {
  if (!db || !eventId) return [];
  await ensureEmailLogsSchema(db);
  const res = await db
    .prepare(
      `SELECT id, event_id, registration_id, recipient_email, recipient_name, template_type, lang,
              subject, provider, status, provider_message_id, error_message, sent_by, created_at
       FROM email_logs
       WHERE event_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(eventId, limit)
    .all()
    .catch(() => ({ results: [] }));
  return (res.results || []).map((r) => ({
    id: r.id,
    eventId: r.event_id,
    registrationId: r.registration_id,
    recipientEmail: r.recipient_email,
    recipientName: r.recipient_name,
    templateType: r.template_type,
    lang: r.lang,
    subject: r.subject,
    provider: r.provider,
    status: r.status,
    providerMessageId: r.provider_message_id || "",
    errorMessage: r.error_message || "",
    sentBy: r.sent_by || "system",
    createdAt: r.created_at,
  }));
}

/**
 * Convenience helper for auto-sending RSVP confirmation right after a registration is saved.
 * Never throws; always logs to `email_logs` when an email is present.
 */
export async function sendRsvpConfirmationEmail(env, { registration, event, lang = "vi", fetchImpl = fetch }) {
  const email = String(registration?.email || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, status: "skipped", provider: "none", error: "Khách không để lại email." };
  }
  try {
    let eventObj = event;
    if (!eventObj && registration.event_id && env?.DB) {
      const row = await env.DB.prepare("SELECT * FROM events WHERE id = ?")
        .bind(registration.event_id)
        .first()
        .catch(() => null);
      if (row) {
        eventObj = {
          id: row.id,
          slug: row.slug || row.id,
          title: row.title,
          titleEn: row.title_en || "",
          date: row.date,
          dateDisplay: row.date_display,
          time: row.time,
          location: row.location,
          fee: row.fee,
          summary: row.summary,
          zaloGroupUrl: row.zalo_group_url || "",
        };
      }
    }
    if (!eventObj) {
      eventObj = {
        id: registration.event_id || "",
        title: registration.activity_title || "Buổi gặp HolaRise",
      };
    }

    const rendered = renderEventEmailTemplate({
      templateType: "rsvp_confirm",
      lang,
      recipientName: registration.full_name,
      registrationId: registration.id,
      event: eventObj,
    });

    const result = await sendTransactionalEmail(env, {
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fetchImpl,
    });

    if (env?.DB) {
      await logEmailAttempt(env.DB, {
        eventId: eventObj.id || registration.event_id || "",
        registrationId: registration.id || "",
        recipientEmail: email,
        recipientName: registration.full_name || "",
        templateType: "rsvp_confirm",
        lang: rendered.lang,
        subject: rendered.subject,
        provider: result.provider,
        status: result.status,
        messageId: result.messageId,
        error: result.error,
        sentBy: "system",
      });
    }
    return result;
  } catch (err) {
    return { ok: false, status: "failed", provider: "none", error: String(err?.message || err).slice(0, 220) };
  }
}
