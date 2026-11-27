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
const DEFAULT_FROM_NAME = "HolaRise - Cộng đồng Thanh niên Hoà Lạc";
const DEFAULT_LOGO_URL = `${SITE_ORIGIN}/assets/images/favicon-96.png`;
const DEFAULT_ZALO_URL = "https://zalo.me/0777771948";
const DB_TEMPLATE_TYPES = new Set([
  "rsvp_confirm",
  "event_reminder",
  "event_thankyou",
  "test_preview",
]);

function mapTemplateTypeForDb(templateType) {
  if (DB_TEMPLATE_TYPES.has(templateType)) return templateType;
  if (templateType === "community_thankyou") return "event_thankyou";
  return "rsvp_confirm";
}

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

function buildEmailLayout({
  lang,
  preheader,
  eyebrow,
  heading,
  bodyHtml,
  quoteText = "",
  detailsRows = [],
  calloutHtml = "",
  primaryCta,
  secondaryCta,
  footerNote,
}) {
  const isEn = lang === "en";
  const quoteBlockHtml = quoteText
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background-color:#FBF8F1;border-left:3px solid #C59B5F;border-radius:0 8px 8px 0;">
        <tr>
          <td style="padding:14px 18px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.65;font-style:italic;color:#27352D;">
            &ldquo;${escapeHtml(quoteText)}&rdquo;
          </td>
        </tr>
      </table>`
    : "";

  const detailTableHtml =
    detailsRows.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background-color:#F5F1E8;border:1px solid #E6DFD2;border-radius:10px;border-collapse:separate;">
          ${detailsRows
            .map(
              ([label, value], idx) => `<tr>
                <td style="padding:${idx === 0 ? "14px" : "9px"} 16px ${idx === detailsRows.length - 1 ? "14px" : "9px"} 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5D645F;width:128px;vertical-align:top;${idx > 0 ? "border-top:1px solid #EAE4D8;" : ""}">${escapeHtml(label)}</td>
                <td style="padding:${idx === 0 ? "14px" : "9px"} 16px ${idx === detailsRows.length - 1 ? "14px" : "9px"} 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1F2421;font-weight:600;vertical-align:top;${idx > 0 ? "border-top:1px solid #EAE4D8;" : ""}">${escapeHtml(value)}</td>
              </tr>`
            )
            .join("")}
        </table>`
      : "";

  const calloutBlockHtml = calloutHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background-color:#F8F5EE;border:1px solid #E8DFCE;border-radius:10px;">
        <tr>
          <td style="padding:14px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;line-height:1.6;color:#35403A;">
            ${calloutHtml}
          </td>
        </tr>
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
    ? "Warmly,<br><strong>HolaRise Coordinating Team</strong><br><span style=\"color:#6E7570;font-size:12px;\">HolaHeart · HolaGreen · HolaConnect · holarise.org</span>"
    : "Thân mến,<br><strong>Ban Điều Phối HolaRise</strong><br><span style=\"color:#6E7570;font-size:12px;\">HolaHeart · HolaGreen · HolaConnect · holarise.org</span>";

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
            <td style="padding:20px 28px;background-color:#1B3B2B;color:#FAF8F4;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px;vertical-align:middle;">
                          <img src="${escapeHtml(DEFAULT_LOGO_URL)}" alt="HolaRise" width="32" height="32" style="display:block;width:32px;height:32px;border-radius:8px;background-color:#FAF8F4;border:1px solid rgba(250,248,244,0.2);">
                        </td>
                        <td style="vertical-align:middle;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:0.3px;color:#FAF8F4;">HolaRise</td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#D6C4A1;">${escapeHtml(eyebrow)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:3px;line-height:3px;font-size:3px;background-color:#C59B5F;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 24px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.68;color:#2C332F;">
              <h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.35;color:#1B3B2B;font-weight:700;">${escapeHtml(heading)}</h1>
              ${bodyHtml}
              ${quoteBlockHtml}
              ${detailTableHtml}
              ${calloutBlockHtml}
              ${ctaHtml}
              <hr style="border:none;border-top:1px solid #ECE7DD;margin:24px 0 18px 0;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#2C332F;">${signOff}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px;background-color:#F5F1E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:#6E7570;">
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

  if (templateType === "community_thankyou") {
    const subject = sanitizeHeaderValue(
      isEn ? "Thank you for walking with HolaRise" : "Lời cảm ơn từ HolaRise gửi tới bạn",
      180
    );
    const noteBlockHtml = trimmedNote
      ? `<div style="margin:16px 0 0 0;padding:12px 14px;background-color:#FBF7EE;border-left:3px solid #B58342;border-radius:6px;font-size:14px;color:#2C332F;">
           ${escapeHtml(trimmedNote).replace(/\n/g, "<br>")}
         </div>`
      : "";

    const bodyHtml = isEn
      ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">Thank you for being part of the HolaRise community. Whether you joined a circle in Hoa Lac, left a seat reservation, or simply followed our early steps, your presence means a great deal to our coordinating team.</p>
         <p style="margin:0 0 12px 0;">We have just opened our official email channel at <strong>phungsu@holarise.org</strong> so upcoming invitations, seat confirmations, and post-event photo albums reach you clearly and reliably.</p>
         <p style="margin:0;">We look forward to welcoming you at our next gatherings.</p>
         ${noteBlockHtml}`
      : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">Cảm ơn bạn đã tin tưởng đăng ký và đồng hành cùng HolaRise trong những chặng khởi đầu tại Hòa Lạc. Mỗi lần bạn dành thời gian có mặt, lắng nghe hay góp một ý nhỏ đều giúp cộng đồng thêm vững và ấm áp hơn.</p>
         <p style="margin:0 0 12px 0;">Từ hôm nay, HolaRise chính thức vận hành kênh thư <strong>phungsu@holarise.org</strong> để gửi tới bạn thư xác nhận giữ chỗ, nhắc lịch trước giờ gặp và kho ảnh kỷ niệm sau mỗi buổi một cách gọn gàng, rõ ràng.</p>
         <p style="margin:0;">Hẹn sớm gặp lại bạn ở những buổi gặp sắp tới.</p>
         ${noteBlockHtml}`;

    const html = buildEmailLayout({
      lang: safeLang,
      preheader: isEn
        ? "Thank you for being part of HolaRise."
        : "Cảm ơn bạn đã tin tưởng và đồng hành cùng HolaRise.",
      eyebrow: isEn ? "Community Note" : "Lời cảm ơn",
      heading: isEn ? "Thank you for walking with us" : "Cảm ơn bạn đã đồng hành cùng HolaRise",
      bodyHtml,
      detailsRows: [
        [isEn ? "Community" : "Cộng đồng", "HolaRise · HolaHeart · HolaGreen · HolaConnect"],
        [isEn ? "Official email" : "Thư chính thức", "phungsu@holarise.org"],
      ],
      primaryCta: {
        label: isEn ? "View Upcoming Gatherings" : "Xem lịch hoạt động sắp tới",
        url: `${SITE_ORIGIN}${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}`,
      },
      secondaryCta: {
        label: isEn ? "Explore Our Journey" : "Xem kho ký ức hành trình",
        url: `${SITE_ORIGIN}${isEn ? "/en/journey/" : "/hanh-trinh/"}`,
      },
      footerNote: isEn
        ? "You received this note because you registered or joined as a member on holarise.org. Reply directly if you have any feedback."
        : "Bạn nhận được thư này vì đã đăng ký hoạt động hoặc trở thành thành viên trên holarise.org. Bạn có thể bấm trả lời trực tiếp nếu muốn nhắn gửi thêm cho Ban Điều Phối.",
    });

    const text = isEn
      ? [
          `Hello ${name},`,
          "",
          "Thank you for being part of the HolaRise community.",
          "We have just opened our official email channel at phungsu@holarise.org for seat confirmations, reminders, and photo albums.",
          trimmedNote ? `\n${trimmedNote}` : "",
          "",
          `Upcoming Gatherings: ${SITE_ORIGIN}/en/schedule/`,
          `Journey Archive: ${SITE_ORIGIN}/en/journey/`,
          "",
          "Warmly,",
          "HolaRise Coordinating Team (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n")
      : [
          `Chào ${name},`,
          "",
          "Cảm ơn bạn đã tin tưởng đăng ký và đồng hành cùng HolaRise trong những chặng khởi đầu tại Hòa Lạc.",
          "Từ hôm nay, HolaRise chính thức vận hành kênh thư phungsu@holarise.org để gửi thư xác nhận giữ chỗ, nhắc lịch và kho ảnh kỷ niệm sau mỗi buổi gặp.",
          trimmedNote ? `\n${trimmedNote}` : "",
          "",
          `Lịch hoạt động sắp tới: ${SITE_ORIGIN}/lich-hoat-dong/`,
          `Kho ký ức hành trình: ${SITE_ORIGIN}/hanh-trinh/`,
          "",
          "Thân mến,",
          "Ban Điều Phối HolaRise (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n");

    return { subject, html, text, templateType: "community_thankyou", lang: safeLang };
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

  const contributeCalloutHtml = isEn
    ? `<strong style="color:#1B3B2B;">Captured a moment from the gathering?</strong><br>If you took a few photos, a short clip, or want to leave a quiet reflection, you can add them directly to the shared memory page at <a href="${escapeHtml(eventUrl)}" style="color:#1B3B2B;font-weight:600;text-decoration:underline;">holarise.org</a>.`
    : `<strong style="color:#1B3B2B;">Góp thêm góc nhìn của bạn vào ký ức chung</strong><br>Nếu trong máy bạn còn lưu vài khung hình đẹp, đoạn video ngắn hay đôi dòng cảm nhận sau buổi gặp, mời bạn gửi góp trực tiếp trên <a href="${escapeHtml(eventUrl)}" style="color:#1B3B2B;font-weight:600;text-decoration:underline;">trang kỷ niệm buổi gặp</a> để mọi người cùng xem lại.`;

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
    calloutHtml: contributeCalloutHtml,
    primaryCta: {
      label: isEn ? "Open Photo Album & Memories" : "Mở Kho ảnh & Lưu bút",
      url: resolvedAlbumUrl,
    },
    secondaryCta: {
      label: isEn ? "Share Your Photos" : "Góp ảnh & Lưu bút của bạn",
      url: eventUrl,
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
  const templateType = mapTemplateTypeForDb(entry.templateType);
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


/**
 * Render the bilingual Welcome Email sent right after a new Member creates an account
 * (via email/password registration or first-time Google OAuth sign-in).
 */
export function renderMemberWelcomeEmail({ member = {}, lang = "vi" }) {
  const safeLang = String(lang).toLowerCase() === "en" ? "en" : "vi";
  const isEn = safeLang === "en";
  const name = String(member.name || "").trim() || (isEn ? "friend" : "bạn");
  const memberCode = String(member.member_code || member.memberCode || "").trim();
  const cardUrl = memberCode ? `${SITE_ORIGIN}/tv/${encodeURIComponent(memberCode)}` : `${SITE_ORIGIN}/tham-gia/`;
  const scheduleUrl = `${SITE_ORIGIN}${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}`;

  const subject = sanitizeHeaderValue(
    isEn
      ? `Welcome to HolaRise${memberCode ? ` · Member Card ${memberCode}` : ""}`
      : `Chào mừng bạn đến với HolaRise${memberCode ? ` · Thẻ ${memberCode}` : ""}`,
    180
  );

  const detailsRows = [
    [isEn ? "Member" : "Thành viên", name],
    ...(memberCode ? [[isEn ? "Member Code" : "Mã thẻ", memberCode]] : []),
    [isEn ? "Pillars" : "3 Trụ cột", "HolaHeart · HolaGreen · HolaConnect"],
  ];

  const bodyHtml = isEn
    ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">Welcome to HolaRise. Your Member Card is now active, allowing you to reserve seats in one tap, keep track of the gatherings you join, and unlock full-resolution photo albums after each session.</p>
       <p style="margin:0;">We look forward to seeing you in person at our next gathering in Hoa Lac.</p>`
    : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">Chào mừng bạn chính thức trở thành thành viên của HolaRise. Thẻ Thành Viên của bạn đã sẵn sàng để giữ chỗ 1 chạm, lưu lại hành trình các buổi gặp và mở kho ảnh gốc sau mỗi chương trình.</p>
       <p style="margin:0;">Rất mong sớm được đón bạn trực tiếp tại những buổi gặp sắp tới ở Hòa Lạc.</p>`;

  const html = buildEmailLayout({
    lang: safeLang,
    preheader: isEn
      ? `Your HolaRise Member Card${memberCode ? ` (${memberCode})` : ""} is ready.`
      : `Thẻ Thành Viên HolaRise${memberCode ? ` (${memberCode})` : ""} của bạn đã sẵn sàng.`,
    eyebrow: isEn ? "Member Card" : "Thẻ Thành Viên",
    heading: isEn ? "Welcome to HolaRise" : "Chào mừng bạn đến với HolaRise",
    bodyHtml,
    detailsRows,
    primaryCta: {
      label: isEn ? "Open Your Member Card" : "Mở Thẻ Thành Viên của bạn",
      url: cardUrl,
    },
    secondaryCta: {
      label: isEn ? "View Upcoming Gatherings" : "Xem lịch hoạt động sắp tới",
      url: scheduleUrl,
    },
    footerNote: isEn
      ? "You received this email because you created a Member account on holarise.org. Reply directly if you need any assistance."
      : "Bạn nhận được thư này vì vừa kích hoạt Tài khoản Thành viên trên holarise.org. Bạn có thể bấm trả lời trực tiếp nếu cần hỗ trợ.",
  });

  const text = isEn
    ? [
        `Hello ${name},`,
        "",
        "Welcome to HolaRise. Your Member Card is now active.",
        memberCode ? `Member Code: ${memberCode}` : "",
        `Member Card: ${cardUrl}`,
        `Upcoming Gatherings: ${scheduleUrl}`,
        "",
        "Warmly,",
        "HolaRise Coordinating Team (phungsu@holarise.org)",
      ]
        .filter((l) => l !== "")
        .join("\n")
    : [
        `Chào ${name},`,
        "",
        "Chào mừng bạn chính thức trở thành thành viên của HolaRise.",
        memberCode ? `Mã Thẻ Thành Viên: ${memberCode}` : "",
        `Mở Thẻ Thành Viên: ${cardUrl}`,
        `Lịch hoạt động sắp tới: ${scheduleUrl}`,
        "",
        "Thân mến,",
        "Ban Điều Phối HolaRise (phungsu@holarise.org)",
      ]
        .filter((l) => l !== "")
        .join("\n");

  return { subject, html, text, templateType: "member_welcome", lang: safeLang };
}

/**
 * Send Welcome Email to a newly registered Member. Never throws.
 */
export async function sendMemberWelcomeEmail(env, { member, lang = "vi", fetchImpl = fetch }) {
  const email = String(member?.email || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, status: "skipped", provider: "none", error: "Thành viên không đăng ký bằng email." };
  }
  try {
    const rendered = renderMemberWelcomeEmail({ member, lang });
    const result = await sendTransactionalEmail(env, {
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fetchImpl,
    });
    if (env?.DB) {
      await logEmailAttempt(env.DB, {
        eventId: "member-welcome",
        registrationId: member.id || "",
        recipientEmail: email,
        recipientName: member.name || "",
        templateType: "member_welcome",
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


/**
 * Render and send confirmation email for general join/partnership inquiries (without a specific event_id).
 */
export function renderInquiryConfirmEmail({ registration = {}, lang = "vi" }) {
  const safeLang = String(lang).toLowerCase() === "en" ? "en" : "vi";
  const isEn = safeLang === "en";
  const name = String(registration.full_name || "").trim() || (isEn ? "friend" : "bạn");
  const topic = String(registration.activity_title || "").trim() || (isEn ? "General Inquiry" : "Đăng ký đồng hành cùng HolaRise");
  const regId = String(registration.id || "").trim();
  const org = String(registration.organization || "").trim();
  const scheduleUrl = `${SITE_ORIGIN}${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}`;

  const subject = sanitizeHeaderValue(
    isEn ? `We received your message · ${topic}` : `HolaRise đã tiếp nhận thông tin của bạn · ${regId || topic}`,
    180
  );

  const detailsRows = [
    [isEn ? "Topic" : "Nội dung", topic],
    ...(regId ? [[isEn ? "Reference" : "Mã tiếp nhận", regId]] : []),
    ...(org ? [[isEn ? "Organization" : "Đơn vị / Trường", org]] : []),
  ];

  const bodyHtml = isEn
    ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">Thank you for reaching out to HolaRise. We have recorded your information and our coordinating team will follow up with you shortly.</p>
       <p style="margin:0;">If you need a quicker response, feel free to reply directly to this email or message us on Zalo.</p>`
    : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">Cảm ơn bạn đã gửi thông tin đồng hành tới HolaRise. Ban Điều Phối đã ghi nhận đầy đủ và sẽ sớm liên hệ lại với bạn.</p>
       <p style="margin:0;">Nếu cần trao đổi gấp hơn, bạn có thể bấm trả lời trực tiếp thư này hoặc nhắn qua Zalo cộng đồng.</p>`;

  const html = buildEmailLayout({
    lang: safeLang,
    preheader: isEn ? "Thank you for contacting HolaRise." : "Ban Điều Phối HolaRise đã tiếp nhận thông tin của bạn.",
    eyebrow: isEn ? "Confirmation" : "Xác nhận tiếp nhận",
    heading: isEn ? "We received your inquiry" : "Đã tiếp nhận thông tin của bạn",
    bodyHtml,
    detailsRows,
    primaryCta: {
      label: isEn ? "View Upcoming Gatherings" : "Xem lịch hoạt động HolaRise",
      url: scheduleUrl,
    },
    secondaryCta: {
      label: isEn ? "Contact via Zalo" : "Nhắn qua Zalo Ban Điều Phối",
      url: DEFAULT_ZALO_URL,
    },
    footerNote: isEn
      ? "Sent automatically after your submission on holarise.org."
      : "Thư xác nhận gửi tự động sau khi bạn đăng ký thông tin trên holarise.org.",
  });

  const text = isEn
    ? [
        `Hello ${name},`,
        "",
        `Thank you for reaching out to HolaRise (${topic}).`,
        regId ? `Reference: ${regId}` : "",
        "Our coordinating team will follow up shortly.",
        `Upcoming Gatherings: ${scheduleUrl}`,
        "",
        "Warmly,",
        "HolaRise Coordinating Team (phungsu@holarise.org)",
      ]
        .filter((l) => l !== "")
        .join("\n")
    : [
        `Chào ${name},`,
        "",
        `Cảm ơn bạn đã gửi thông tin đồng hành tới HolaRise (${topic}).`,
        regId ? `Mã tiếp nhận: ${regId}` : "",
        "Ban Điều Phối sẽ sớm liên hệ lại với bạn.",
        `Lịch hoạt động: ${scheduleUrl}`,
        "",
        "Thân mến,",
        "Ban Điều Phối HolaRise (phungsu@holarise.org)",
      ]
        .filter((l) => l !== "")
        .join("\n");

  return { subject, html, text, templateType: "inquiry_confirm", lang: safeLang };
}

export async function sendInquiryConfirmationEmail(env, { registration, lang = "vi", fetchImpl = fetch }) {
  const email = String(registration?.email || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, status: "skipped", provider: "none", error: "Khách không để lại email." };
  }
  try {
    const rendered = renderInquiryConfirmEmail({ registration, lang });
    const result = await sendTransactionalEmail(env, {
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fetchImpl,
    });
    if (env?.DB) {
      await logEmailAttempt(env.DB, {
        eventId: "general-inquiry",
        registrationId: registration.id || "",
        recipientEmail: email,
        recipientName: registration.full_name || "",
        templateType: "inquiry_confirm",
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

/**
 * Render an editorial Thank-You Email when a Member contributes a photo/video to an event album
 * or submits a reflection on an event memory page.
 */
export function renderContributionThankYouEmail({
  kind = "media",
  lang = "vi",
  member = {},
  targetTitle = "",
  targetSlug = "",
  creditName = "",
  mediaType = "image",
  pullQuote = "",
}) {
  const safeLang = String(lang).toLowerCase() === "en" ? "en" : "vi";
  const isEn = safeLang === "en";
  const name = String(member.name || "").trim() || (isEn ? "friend" : "bạn");
  const memberCode = String(member.member_code || member.memberCode || "").trim();
  const title = String(targetTitle || "").trim() || (isEn ? "HolaRise Gathering" : "Buổi gặp HolaRise");
  const slug = String(targetSlug || "").trim();
  const pageUrl = slug
    ? `${SITE_ORIGIN}${isEn ? `/en/events/${slug}/` : `/su-kien/${slug}/`}`
    : `${SITE_ORIGIN}${isEn ? "/en/journey/" : "/hanh-trinh/"}`;
  const cardUrl = memberCode ? `${SITE_ORIGIN}/tv/${encodeURIComponent(memberCode)}` : `${SITE_ORIGIN}/tham-gia/`;

  if (kind === "reflection") {
    const cleanQuote = String(pullQuote || "").trim().slice(0, 220);
    const subject = sanitizeHeaderValue(
      isEn ? `Thank you for your reflection · ${title}` : `Cảm ơn những dòng lưu bút của bạn · ${title}`,
      180
    );
    const bodyHtml = isEn
      ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">Thank you for taking a quiet moment to leave your reflection for <strong>${escapeHtml(title)}</strong>. Words written from genuine presence are what keep a community grounded long after the lights dim.</p>
         <p style="margin:0;">Our coordinating team will review and publish your note on the shared memory page shortly.</p>`
      : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
         <p style="margin:0 0 12px 0;">Cảm ơn bạn đã dành một khoảng lặng để viết lại cảm nhận cho buổi gặp <strong>${escapeHtml(title)}</strong>. Những dòng chữ chân thành sau mỗi chặng hành trình luôn là phần ký ức quý nhất mà HolaRise muốn giữ gìn.</p>
         <p style="margin:0;">Ban Điều Phối sẽ sớm duyệt để trang lưu bút của bạn hiện diện cùng mọi người trên trang kỷ niệm.</p>`;

    const html = buildEmailLayout({
      lang: safeLang,
      preheader: isEn ? `We received your reflection for ${title}.` : `HolaRise đã nhận được trang lưu bút của bạn cho ${title}.`,
      eyebrow: isEn ? "Reflection Received" : "Cảm ơn Lưu bút",
      heading: isEn ? "Thank you for leaving a reflection" : "Cảm ơn những dòng lưu bút của bạn",
      bodyHtml,
      quoteText: cleanQuote,
      detailsRows: [
        [isEn ? "Gathering" : "Hoạt động", title],
        [isEn ? "Author" : "Người viết", name],
        ...(memberCode ? [[isEn ? "Member Card" : "Mã thẻ", memberCode]] : []),
        [isEn ? "Status" : "Trạng thái", isEn ? "Queued for editorial review" : "Đã tiếp nhận · Chờ duyệt hiển thị"],
      ],
      primaryCta: {
        label: isEn ? "Visit Event Memory Page" : "Xem trang Kỷ niệm buổi gặp",
        url: pageUrl,
      },
      secondaryCta: {
        label: isEn ? "Your Member Card" : "Mở Thẻ Thành Viên",
        url: cardUrl,
      },
      footerNote: isEn
        ? "Thank you for contributing to HolaRise's shared memory archive. You will receive at most one thank-you note per gathering within 24 hours."
        : "Cảm ơn bạn đã góp thêm ký ức cho HolaRise. Hệ thống chỉ gửi tối đa 1 thư cảm ơn cho mỗi buổi gặp trong 24 giờ để giữ hộp thư của bạn gọn gàng.",
    });

    const text = isEn
      ? [
          `Hello ${name},`,
          "",
          `Thank you for leaving your reflection for ${title}.`,
          cleanQuote ? `"${cleanQuote}"` : "",
          "Our coordinating team will review and publish it shortly.",
          `Event Memory Page: ${pageUrl}`,
          "",
          "Warmly,",
          "HolaRise Coordinating Team (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n")
      : [
          `Chào ${name},`,
          "",
          `Cảm ơn bạn đã viết lưu bút cho buổi gặp ${title}.`,
          cleanQuote ? `"${cleanQuote}"` : "",
          "Ban Điều Phối sẽ sớm duyệt hiển thị trên trang kỷ niệm.",
          `Trang Kỷ niệm: ${pageUrl}`,
          "",
          "Thân mến,",
          "Ban Điều Phối HolaRise (phungsu@holarise.org)",
        ]
          .filter((l) => l !== "")
          .join("\n");

    return { subject, html, text, templateType: "contribution_thankyou", lang: safeLang };
  }

  // Default: media (photo / video contribution to album)
  const isVideo = String(mediaType).toLowerCase() === "video";
  const mediaLabelVi = isVideo ? "đoạn video kỷ niệm" : "những khung hình kỷ niệm";
  const mediaLabelEn = isVideo ? "your video clip" : "your photos";
  const credited = String(creditName || name).trim();

  const subject = sanitizeHeaderValue(
    isEn ? `Thank you for sharing your lens · ${title}` : `Cảm ơn góc nhìn của bạn · ${title}`,
    180
  );

  const bodyHtml = isEn
    ? `<p style="margin:0 0 12px 0;">Hello ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">A gathering always feels richer when remembered through more than one pair of eyes. We have received ${mediaLabelEn} contributed to <strong>${escapeHtml(title)}</strong>.</p>
       <p style="margin:0;">Our media team will review and add your contribution to the shared album with full credit under your name.</p>`
    : `<p style="margin:0 0 12px 0;">Chào ${escapeHtml(name)},</p>
       <p style="margin:0 0 12px 0;">Một buổi gặp luôn trọn vẹn hơn khi được nhìn lại qua nhiều đôi mắt khác nhau. Chúng mình vừa nhận được ${mediaLabelVi} bạn gửi góp vào kho ảnh <strong>${escapeHtml(title)}</strong>.</p>
       <p style="margin:0;">Đội Truyền thông sẽ sớm duyệt để khung hình của bạn xuất hiện trong album chung cùng tên ghi nhận của tác giả.</p>`;

  const calloutHtml = isEn
    ? `You can keep uploading more moments from this session — we will not send extra emails within the next 24 hours so your inbox stays calm.`
    : `Bạn có thể tiếp tục tải thêm nhiều ảnh/video khác của buổi gặp này — hệ thống sẽ <strong>không gửi thêm thư lặp lại trong 24 giờ tới</strong> để giữ hộp thư của bạn luôn gọn gàng.`;

  const html = buildEmailLayout({
    lang: safeLang,
    preheader: isEn ? `Thank you for contributing to ${title}.` : `Cảm ơn bạn đã gửi góp khoảnh khắc cho ${title}.`,
    eyebrow: isEn ? "Memory Contributor" : "Cảm ơn Đóng góp Ảnh",
    heading: isEn ? "Thank you for sharing your lens" : "Cảm ơn góc nhìn bạn gửi góp",
    bodyHtml,
    detailsRows: [
      [isEn ? "Album" : "Kho ảnh", title],
      [isEn ? "Credit" : "Tên ghi nhận", credited],
      ...(memberCode ? [[isEn ? "Member Card" : "Mã thẻ", memberCode]] : []),
      [isEn ? "Status" : "Trạng thái", isEn ? "Received · Pending review" : "Đã tiếp nhận · Chờ duyệt lên album"],
    ],
    calloutHtml,
    primaryCta: {
      label: isEn ? "Open Event Gallery" : "Mở Kho ảnh buổi gặp",
      url: pageUrl,
    },
    secondaryCta: {
      label: isEn ? "Your Member Card" : "Mở Thẻ Thành Viên",
      url: cardUrl,
    },
    footerNote: isEn
      ? "Sent once per album within 24 hours when you contribute photos or videos on holarise.org."
      : "Thư cảm ơn chỉ gửi tối đa 1 lần mỗi 24 giờ cho mỗi kho ảnh bạn đóng góp trên holarise.org.",
  });

  const text = isEn
    ? [
        `Hello ${name},`,
        "",
        `Thank you for sharing ${mediaLabelEn} to ${title} (credit: ${credited}).`,
        "Our media team will review and publish your contribution to the shared album shortly.",
        `Event Gallery: ${pageUrl}`,
        "",
        "Warmly,",
        "HolaRise Coordinating Team (phungsu@holarise.org)",
      ].join("\n")
    : [
        `Chào ${name},`,
        "",
        `Cảm ơn bạn đã gửi góp ${mediaLabelVi} vào kho ảnh ${title} (tên ghi nhận: ${credited}).`,
        "Đội Truyền thông sẽ sớm duyệt để khung hình của bạn xuất hiện trong album chung.",
        `Kho ảnh buổi gặp: ${pageUrl}`,
        "",
        "Thân mến,",
        "Ban Điều Phối HolaRise (phungsu@holarise.org)",
      ].join("\n");

  return { subject, html, text, templateType: "contribution_thankyou", lang: safeLang };
}

/**
 * Send Contribution Thank-You Email with a strict 24-hour anti-spam cooldown per (member email, target key).
 * Prevents inbox flooding when a member uploads multiple photos in one session.
 */
export async function sendContributionThankYouEmail(
  env,
  { kind = "media", lang = "vi", member = {}, targetKey = "", targetTitle = "", targetSlug = "", creditName = "", mediaType = "image", pullQuote = "", fetchImpl = fetch }
) {
  const email = String(member?.email || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, status: "skipped", provider: "none", error: "Thành viên không có email." };
  }
  const eventScopeKey = `contrib:${kind}:${String(targetKey || targetSlug || "general").slice(0, 80)}`;
  try {
    if (env?.DB) {
      await ensureEmailLogsSchema(env.DB);
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recent = await env.DB.prepare(
        `SELECT id FROM email_logs
         WHERE event_id = ? AND recipient_email = ? AND status = 'sent' AND created_at >= ?
         LIMIT 1`
      )
        .bind(eventScopeKey, email, sinceIso)
        .first()
        .catch(() => null);
      if (recent) {
        return {
          ok: false,
          status: "skipped",
          provider: "none",
          error: "Đã gửi thư cảm ơn đóng góp trong 24 giờ qua (chống spam).",
        };
      }
    }

    const rendered = renderContributionThankYouEmail({
      kind,
      lang,
      member,
      targetTitle,
      targetSlug,
      creditName,
      mediaType,
      pullQuote,
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
        eventId: eventScopeKey,
        registrationId: member.id || "",
        recipientEmail: email,
        recipientName: member.name || "",
        templateType: "event_thankyou",
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
