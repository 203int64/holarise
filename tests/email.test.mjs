import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleCalendarUrl,
  getEmailProviderStatus,
  renderEventEmailTemplate,
  renderInquiryConfirmEmail,
  renderMemberWelcomeEmail,
  sendRsvpConfirmationEmail,
  sendTransactionalEmail,
} from "../functions/_lib/email.js";

const SAMPLE_EVENT = {
  id: "holaheart-cuoc-doi-cua-cha-2026-11-29",
  slug: "cuoc-doi-cua-cha",
  title: "Cuộc đời của Cha",
  titleEn: "A Father's Life",
  date: "2026-11-29",
  dateDisplay: "Chủ Nhật, 29/11/2026",
  time: "14:00 - 17:00",
  location: "Đồi Thông Tân Xã, Hòa Lạc",
  fee: "Miễn phí tham dự · Tự túc đồ uống tại quán",
  summary: "Buổi trò chuyện lắng nghe về tình cha trong không gian yên tĩnh.",
  zaloGroupUrl: "https://zalo.me/g/holaheart-cha",
};

test("getEmailProviderStatus detects unconfigured, Cloudflare Free, Dual-Mode, and Cloudflare Paid", () => {
  assert.equal(getEmailProviderStatus({}).activeMode, "unconfigured");
  assert.equal(getEmailProviderStatus({}).canSendToGuests, false);

  const cfFree = getEmailProviderStatus({ EMAIL: { send: async () => ({}) } });
  assert.equal(cfFree.activeMode, "cloudflare_free");
  assert.equal(cfFree.canSendToGuests, false);

  const dual = getEmailProviderStatus({
    EMAIL: { send: async () => ({}) },
    RESEND_API_KEY: "re_test_123",
  });
  assert.equal(dual.activeMode, "dual_mode");
  assert.equal(dual.canSendToGuests, true);

  const cfPaid = getEmailProviderStatus({
    EMAIL: { send: async () => ({}) },
    EMAIL_CLOUDFLARE_PAID: "1",
  });
  assert.equal(cfPaid.activeMode, "cloudflare_paid");
  assert.equal(cfPaid.canSendToGuests, true);
});

test("buildGoogleCalendarUrl formats timed and all-day events in Asia/Ho_Chi_Minh", () => {
  const timed = buildGoogleCalendarUrl(SAMPLE_EVENT, "https://holarise.org/su-kien/cuoc-doi-cua-cha/");
  assert.ok(timed.startsWith("https://calendar.google.com/calendar/render?"));
  assert.ok(timed.includes("dates=20261129T140000%2F20261129T170000"));
  assert.ok(timed.includes("ctz=Asia%2FHo_Chi_Minh"));

  const allDay = buildGoogleCalendarUrl({ ...SAMPLE_EVENT, time: "" });
  assert.ok(allDay.includes("dates=20261129%2F20261130"));
});

test("renderEventEmailTemplate renders all 3 bilingual templates and escapes XSS safely", () => {
  const xssName = 'Minh <script>alert("xss")</script>';
  const rsvpVi = renderEventEmailTemplate({
    templateType: "rsvp_confirm",
    lang: "vi",
    recipientName: xssName,
    registrationId: "REG-261126-ABC123",
    event: SAMPLE_EVENT,
  });
  assert.equal(rsvpVi.subject, "Xác nhận giữ chỗ · Cuộc đời của Cha");
  assert.ok(rsvpVi.html.includes("REG-261126-ABC123"));
  assert.ok(rsvpVi.html.includes("https://zalo.me/g/holaheart-cha"));
  assert.ok(rsvpVi.html.includes("calendar.google.com"));
  assert.ok(!rsvpVi.html.includes("<script>"));
  assert.ok(rsvpVi.html.includes("&lt;script&gt;"));
  assert.ok(rsvpVi.text.includes("REG-261126-ABC123"));
  assert.ok(!/tụi mình/i.test(rsvpVi.html));

  const reminderEn = renderEventEmailTemplate({
    templateType: "event_reminder",
    lang: "en",
    recipientName: "Alex",
    event: SAMPLE_EVENT,
    customNote: "Bring a light jacket <b>please</b>.",
  });
  assert.equal(reminderEn.subject, "Event Reminder · A Father's Life");
  assert.ok(reminderEn.html.includes("Bring a light jacket &lt;b&gt;please&lt;/b&gt;."));
  assert.ok(reminderEn.text.includes("A Father's Life"));

  const thankyouVi = renderEventEmailTemplate({
    templateType: "event_thankyou",
    lang: "vi",
    recipientName: "Lan Anh",
    event: SAMPLE_EVENT,
    albumUrl: "https://drive.google.com/drive/folders/abc123",
  });
  assert.equal(thankyouVi.subject, "Cảm ơn bạn đã đồng hành · Cuộc đời của Cha");
  assert.ok(thankyouVi.html.includes("https://drive.google.com/drive/folders/abc123"));
  assert.ok(thankyouVi.html.includes("https://holarise.org/assets/images/favicon-96.png"));
  assert.ok(thankyouVi.text.includes("https://drive.google.com/drive/folders/abc123"));

  const communityVi = renderEventEmailTemplate({
    templateType: "community_thankyou",
    lang: "vi",
    recipientName: "Minh Quân",
  });
  assert.equal(communityVi.subject, "Lời cảm ơn từ HolaRise gửi tới bạn");
  assert.ok(communityVi.html.includes("phungsu@holarise.org"));
  assert.ok(communityVi.html.includes("https://holarise.org/assets/images/favicon-96.png"));
});

test("sendTransactionalEmail routes via Dual-Mode (Resend for guests on Free, Cloudflare Paid when enabled, graceful fallback)", async () => {
  // 1. Unconfigured skips cleanly
  const unconf = await sendTransactionalEmail({}, {
    to: "guest@example.com",
    subject: "Test",
    html: "<p>Hi</p>",
    text: "Hi",
  });
  assert.equal(unconf.ok, false);
  assert.equal(unconf.status, "skipped");
  assert.equal(unconf.provider, "none");

  // 2. Dual-mode (Cloudflare Free + Resend key) sends guest email via Resend directly
  let resendCalled = 0;
  let cfCalled = 0;
  const mockResendFetch = async (url, opts) => {
    resendCalled += 1;
    assert.equal(url, "https://api.resend.com/emails");
    const parsed = JSON.parse(opts.body);
    assert.deepEqual(parsed.to, ["guest@example.com"]);
    assert.equal(parsed.reply_to, "phungsu@holarise.org");
    return new Response(JSON.stringify({ id: "re_msg_001" }), { status: 200 });
  };

  const dualEnv = {
    EMAIL: {
      send: async () => {
        cfCalled += 1;
        return { messageId: "cf_msg_001" };
      },
    },
    RESEND_API_KEY: "re_live_key",
  };

  const guestRes = await sendTransactionalEmail(dualEnv, {
    to: "guest@example.com",
    subject: "Xác nhận giữ chỗ",
    html: "<p>Xin chào</p>",
    text: "Xin chào",
    fetchImpl: mockResendFetch,
  });
  assert.equal(guestRes.ok, true);
  assert.equal(guestRes.provider, "resend");
  assert.equal(guestRes.messageId, "re_msg_001");
  assert.equal(resendCalled, 1);
  assert.equal(cfCalled, 0);

  // 3. preferCloudflare=true tries Cloudflare first and falls back to Resend on Free plan restriction
  const fallbackEnv = {
    EMAIL: {
      send: async () => {
        throw new Error("E_RECIPIENT_PLAN_RESTRICTED: Destination address is not verified");
      },
    },
    RESEND_API_KEY: "re_live_key",
  };
  const fbRes = await sendTransactionalEmail(fallbackEnv, {
    to: "guest@example.com",
    subject: "Test fallback",
    html: "<p>Test</p>",
    text: "Test",
    preferCloudflare: true,
    fetchImpl: mockResendFetch,
  });
  assert.equal(fbRes.ok, true);
  assert.equal(fbRes.provider, "resend");
  assert.equal(resendCalled, 2);

  // 4. Cloudflare Paid routes directly via native binding without touching Resend
  const paidEnv = {
    EMAIL: {
      send: async (msg) => {
        cfCalled += 1;
        assert.equal(msg.to, "guest@example.com");
        assert.equal(msg.from.email, "phungsu@holarise.org");
        return { messageId: "cf_paid_999" };
      },
    },
    EMAIL_CLOUDFLARE_PAID: "1",
    RESEND_API_KEY: "re_live_key",
  };
  const paidRes = await sendTransactionalEmail(paidEnv, {
    to: "guest@example.com",
    subject: "Paid CF",
    html: "<p>Paid</p>",
    text: "Paid",
    fetchImpl: mockResendFetch,
  });
  assert.equal(paidRes.ok, true);
  assert.equal(paidRes.provider, "cloudflare");
  assert.equal(paidRes.messageId, "cf_paid_999");
  assert.equal(cfCalled, 1);
  assert.equal(resendCalled, 2);
});

test("sendRsvpConfirmationEmail skips cleanly when guest did not enter an email", async () => {
  const res = await sendRsvpConfirmationEmail({}, {
    registration: { id: "REG-1", full_name: "Nam", email: "" },
    event: SAMPLE_EVENT,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, "skipped");
});

test("renderMemberWelcomeEmail and renderInquiryConfirmEmail render bilingual confirmation emails with logo", () => {
  const welcomeVi = renderMemberWelcomeEmail({
    member: { name: "Ngọc Anh", member_code: "HR-261126-012" },
    lang: "vi",
  });
  assert.equal(welcomeVi.subject, "Chào mừng bạn đến với HolaRise · Thẻ HR-261126-012");
  assert.ok(welcomeVi.html.includes("https://holarise.org/tv/HR-261126-012"));
  assert.ok(welcomeVi.html.includes("https://holarise.org/assets/images/favicon-96.png"));
  assert.ok(welcomeVi.text.includes("HR-261126-012"));

  const welcomeEn = renderMemberWelcomeEmail({
    member: { name: "Alex", member_code: "HR-261126-013" },
    lang: "en",
  });
  assert.equal(welcomeEn.subject, "Welcome to HolaRise · Member Card HR-261126-013");

  const inquiryVi = renderInquiryConfirmEmail({
    registration: { id: "REG-261126-XYZ", full_name: "Minh Khôi", activity_title: "Đồng hành đối tác", organization: "ĐH FPT" },
    lang: "vi",
  });
  assert.ok(inquiryVi.subject.includes("REG-261126-XYZ"));
  assert.ok(inquiryVi.html.includes("ĐH FPT"));
  assert.ok(inquiryVi.html.includes("https://holarise.org/assets/images/favicon-96.png"));
});
