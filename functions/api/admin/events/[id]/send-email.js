import {
  ensureEmailLogsSchema,
  getEmailProviderStatus,
  getSentRegistrationIdsForTemplate,
  listEventEmailLogs,
  logEmailAttempt,
  renderEventEmailTemplate,
  sendTransactionalEmail,
} from "../../../../_lib/email.js";
import { serializeEventRow } from "../../../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../../_lib/security.js";
import { cleanStr, isValidEmail } from "../../../../_lib/validation.js";

const ALLOWED_TEMPLATES = new Set(["event_reminder", "event_thankyou"]);
const ALLOWED_MODES = new Set(["preview", "test", "send_all"]);
const ALLOWED_AUDIENCES = new Set(["active", "attended"]);
const BATCH_CONCURRENCY = 4;

async function findEventAndAlbum(db, id) {
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!row) return { ev: null, albumUrl: "" };
  const ev = serializeEventRow(row);

  let album = await db
    .prepare("SELECT slug, drive_url FROM media_albums WHERE event_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(ev.id)
    .first()
    .catch(() => null);
  if (!album && ev.slug) {
    album = await db
      .prepare("SELECT slug, drive_url FROM media_albums WHERE slug = ? ORDER BY created_at DESC LIMIT 1")
      .bind(ev.slug)
      .first()
      .catch(() => null);
  }

  const albumUrl = album?.drive_url
    ? String(album.drive_url).trim()
    : ev.slug
      ? `https://holarise.org/su-kien/${ev.slug}/`
      : `https://holarise.org/su-kien/${ev.id}/`;

  return { ev, albumUrl };
}

async function fetchEligibleRegistrations(db, ev, audience = "active") {
  const statusClause =
    audience === "attended"
      ? "status = 'attended'"
      : "status != 'cancelled'";

  const res = await db
    .prepare(
      `SELECT id, full_name, email, status, created_at
       FROM registrations
       WHERE (event_id = ? OR activity_title = ?)
         AND ${statusClause}
         AND TRIM(COALESCE(email, '')) != ''
       ORDER BY created_at ASC
       LIMIT 300`
    )
    .bind(ev.id, ev.title)
    .all()
    .catch(() => ({ results: [] }));

  const seenEmails = new Set();
  const unique = [];
  for (const r of res.results || []) {
    const email = String(r.email || "").trim().toLowerCase();
    if (!isValidEmail(email) || seenEmails.has(email)) continue;
    seenEmails.add(email);
    unique.push({
      id: r.id,
      fullName: r.full_name || "",
      email,
      status: r.status,
    });
  }
  return unique;
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "events.read" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureEmailLogsSchema(db);

  const id = String(context.params?.id || "").trim();
  const { ev, albumUrl } = await findEventAndAlbum(db, id);
  if (!ev) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const [activeRegs, attendedRegs, logs] = await Promise.all([
    fetchEligibleRegistrations(db, ev, "active"),
    fetchEligibleRegistrations(db, ev, "attended"),
    listEventEmailLogs(db, ev.id, 60),
  ]);

  return jsonResponse({
    ok: true,
    provider: getEmailProviderStatus(context.env),
    defaultAlbumUrl: albumUrl,
    eligibleCounts: {
      active: activeRegs.length,
      attended: attendedRegs.length,
    },
    logs,
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context, { permission: "events.write" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await ensureEmailLogsSchema(db);

  const id = String(context.params?.id || "").trim();
  const { ev, albumUrl: defaultAlbumUrl } = await findEventAndAlbum(db, id);
  if (!ev) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện.");
  }

  const parsed = await readJsonBody(context.request, 64 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data || {};

  const templateType = cleanStr(body.templateType || body.template_type, 40);
  const mode = cleanStr(body.mode || "preview", 20);
  const lang = cleanStr(body.lang || "vi", 8).toLowerCase() === "en" ? "en" : "vi";
  const audience = ALLOWED_AUDIENCES.has(body.audience) ? body.audience : "active";
  const customNote = cleanStr(body.customNote || body.custom_note, 1000);
  const albumUrl = cleanStr(body.albumUrl || body.album_url, 400) || defaultAlbumUrl;
  const forceResend = Boolean(body.forceResend || body.force_resend);

  if (!ALLOWED_TEMPLATES.has(templateType)) {
    return errorResponse(400, "INVALID_TEMPLATE", "Loại thư phải là 'event_reminder' hoặc 'event_thankyou'.");
  }
  if (!ALLOWED_MODES.has(mode)) {
    return errorResponse(400, "INVALID_MODE", "Chế độ phải là 'preview', 'test' hoặc 'send_all'.");
  }

  const providerStatus = getEmailProviderStatus(context.env);
  const eligible = await fetchEligibleRegistrations(db, ev, audience);
  const alreadySentSet = await getSentRegistrationIdsForTemplate(db, ev.id, templateType);
  const pendingRecipients = eligible.filter(
    (r) => forceResend || (!alreadySentSet.has(r.id) && !alreadySentSet.has(r.email))
  );

  // 1. PREVIEW MODE — no email sent
  if (mode === "preview") {
    const sampleName = eligible[0]?.fullName || (lang === "en" ? "Minh Anh" : "Minh Anh");
    const rendered = renderEventEmailTemplate({
      templateType,
      lang,
      recipientName: sampleName,
      event: ev,
      albumUrl,
      customNote,
    });
    return jsonResponse({
      ok: true,
      mode: "preview",
      provider: providerStatus,
      eligibleCount: eligible.length,
      pendingCount: pendingRecipients.length,
      alreadySentCount: eligible.length - pendingRecipients.length,
      preview: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
    });
  }

  // 2. TEST MODE — send 1 test email to admin / specified address
  if (mode === "test") {
    const testEmail = cleanStr(body.testEmail || body.test_email || auth.user?.email || "", 180).toLowerCase();
    if (!isValidEmail(testEmail)) {
      return errorResponse(400, "INVALID_EMAIL", "Vui lòng nhập địa chỉ email nhận bản test hợp lệ.");
    }
    const rendered = renderEventEmailTemplate({
      templateType,
      lang,
      recipientName: auth.user?.name || "Ban Điều Phối",
      event: ev,
      albumUrl,
      customNote,
    });
    const subject = `[TEST] ${rendered.subject}`;
    const result = await sendTransactionalEmail(context.env, {
      to: testEmail,
      subject,
      html: rendered.html,
      text: rendered.text,
      preferCloudflare: true,
    });

    await logEmailAttempt(db, {
      eventId: ev.id,
      registrationId: "",
      recipientEmail: testEmail,
      recipientName: auth.user?.name || "Admin Test",
      templateType: "test_preview",
      lang,
      subject,
      provider: result.provider,
      status: result.status,
      messageId: result.messageId,
      error: result.error,
      sentBy: auth.user?.email || "admin",
    });

    if (!result.ok) {
      return errorResponse(502, "EMAIL_SEND_FAILED", result.error || "Không gửi được email test.");
    }

    return jsonResponse({
      ok: true,
      mode: "test",
      recipient: testEmail,
      provider: result.provider,
      messageId: result.messageId,
      message: `Đã gửi bản test tới ${testEmail} qua ${result.provider}.`,
    });
  }

  // 3. SEND_ALL MODE — bulk send to eligible event guests with deduplication
  if (eligible.length === 0) {
    return errorResponse(400, "NO_RECIPIENTS", "Sự kiện này chưa có khách nào để lại địa chỉ email hợp lệ.");
  }
  if (pendingRecipients.length === 0) {
    return jsonResponse({
      ok: true,
      mode: "send_all",
      sentCount: 0,
      skippedCount: eligible.length,
      failedCount: 0,
      totalEligible: eligible.length,
      message: "Tất cả khách có email của sự kiện này đã được gửi loại thư này trước đó.",
    });
  }

  let sentCount = 0;
  let failedCount = 0;
  const errors = [];

  for (let i = 0; i < pendingRecipients.length; i += BATCH_CONCURRENCY) {
    const batch = pendingRecipients.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (recipient) => {
        const rendered = renderEventEmailTemplate({
          templateType,
          lang,
          recipientName: recipient.fullName,
          registrationId: recipient.id,
          event: ev,
          albumUrl,
          customNote,
        });
        const res = await sendTransactionalEmail(context.env, {
          to: recipient.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        await logEmailAttempt(db, {
          eventId: ev.id,
          registrationId: recipient.id,
          recipientEmail: recipient.email,
          recipientName: recipient.fullName,
          templateType,
          lang,
          subject: rendered.subject,
          provider: res.provider,
          status: res.status,
          messageId: res.messageId,
          error: res.error,
          sentBy: auth.user?.email || "admin",
        });
        return { recipient, res };
      })
    );

    for (const { recipient, res } of results) {
      if (res.ok) {
        sentCount += 1;
      } else {
        failedCount += 1;
        if (errors.length < 10) {
          errors.push({ email: recipient.email, error: res.error });
        }
      }
    }
  }

  const skippedCount = eligible.length - pendingRecipients.length;
  return jsonResponse({
    ok: true,
    mode: "send_all",
    sentCount,
    skippedCount,
    failedCount,
    totalEligible: eligible.length,
    errors,
    message:
      failedCount === 0
        ? `Đã gửi thành công ${sentCount} email${skippedCount > 0 ? ` (bỏ qua ${skippedCount} người đã nhận trước đó)` : ""}.`
        : `Đã gửi ${sentCount} email, lỗi ${failedCount} email${skippedCount > 0 ? `, bỏ qua ${skippedCount}` : ""}.`,
  });
}
