/**
 * Best-effort transactional email notifications for HolaRise Manager workflows:
 * - 1-Click Staff Invite (48h activation link + role & safeguarding overview)
 * - Task Assignment (Staff & Member CTV)
 * - Editorial Maker-Checker loop (submitted / changes_requested / published)
 *
 * Always non-fatal: if email provider is unconfigured, returns { ok: false, status: "skipped" }.
 */

import { escapeHtml, sendTransactionalEmail } from "./email.js";
import { getRoleMeta } from "./rbac.js";

const ORIGIN = "https://holarise.org";

function wrapCard({ kicker, heading, bodyHtml, ctaUrl, ctaLabel, footerNote = "" }) {
  return `<!DOCTYPE html>
<html lang="vi">
<body style="margin:0;padding:24px;background:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111b17;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:26px;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#14532d;font-weight:700;">${escapeHtml(kicker)}</p>
    <h1 style="margin:0 0 14px;font-size:20px;line-height:1.35;color:#0b110f;">${escapeHtml(heading)}</h1>
    <div style="font-size:14px;line-height:1.65;color:#273530;">${bodyHtml}</div>
    ${
      ctaUrl
        ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:11px 18px;border-radius:9px;background:#14532d;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(ctaLabel || "Mở HolaRise Manager")}</a></p>`
        : ""
    }
    <hr style="border:0;border-top:1px solid #eceee9;margin:22px 0 14px;">
    <p style="margin:0;font-size:12px;color:#64746e;">${escapeHtml(footerNote || "HolaRise · Cộng đồng Thanh niên Hòa Lạc · holarise.org")}</p>
  </div>
</body>
</html>`;
}

export async function notifyStaffInvite(env, { invite, inviteUrl, fetchImpl = fetch }) {
  try {
    const roleMeta = getRoleMeta(invite.role);
    const subject = `[HolaRise Manager] Lời mời tham gia ${invite.department || roleMeta.department} (${roleMeta.shortLabel})`;
    const bodyHtml = `
      <p>Chào <strong>${escapeHtml(invite.name)}</strong>,</p>
      <p><strong>${escapeHtml(invite.invitedByName || "Ban Điều Hành HolaRise")}</strong> mời bạn tham gia <strong>HolaRise Manager</strong> với vai trò <strong>${escapeHtml(roleMeta.label)}</strong> (${escapeHtml(invite.department || roleMeta.department)}).</p>
      ${invite.note ? `<p style="padding:10px 12px;background:#f7f8f5;border-radius:8px;margin:12px 0;"><em>"${escapeHtml(invite.note)}"</em></p>` : ""}
      <p>Bấm nút bên dưới để xác nhận cam kết bảo mật, tự đặt mật khẩu riêng và vào làm việc ngay (link có hiệu lực 48 giờ).</p>
    `;
    const html = wrapCard({
      kicker: "HolaRise Manager · Lời mời nhân sự",
      heading: `Chào mừng ${invite.name} đồng hành cùng ${invite.department || roleMeta.department}`,
      bodyHtml,
      ctaUrl: inviteUrl,
      ctaLabel: "Kích hoạt tài khoản & Vào làm việc →",
      footerNote: "Nếu bạn không mong đợi lời mời này, chỉ cần bỏ qua email này.",
    });
    const text = `Chào ${invite.name}, bạn được mời vào HolaRise Manager (${roleMeta.label} · ${invite.department}). Mở link để kích hoạt trong 48h: ${inviteUrl}`;
    return await sendTransactionalEmail(env, { to: invite.email, subject, html, text, fetchImpl });
  } catch (err) {
    return { ok: false, status: "failed", error: String(err?.message || err) };
  }
}

export async function notifyTaskAssigned(env, { recipientEmail, recipientName, task, isMember = false, fetchImpl = fetch }) {
  if (!recipientEmail) return { ok: false, status: "skipped" };
  try {
    const targetUrl = isMember ? `${ORIGIN}/tham-gia/` : `${ORIGIN}/admin/?tab=tasks`;
    const subject = `[HolaRise Manager] Nhiệm vụ mới: ${task.title}`;
    const bodyHtml = `
      <p>Chào <strong>${escapeHtml(recipientName || "bạn")}</strong>,</p>
      <p>Bạn vừa được giao một nhiệm vụ mới thuộc <strong>${escapeHtml(task.department || "Ban Sự Kiện")}</strong>:</p>
      <ul style="padding-left:18px;margin:10px 0;">
        <li><strong>Nhiệm vụ:</strong> ${escapeHtml(task.title)}</li>
        ${task.eventTitle ? `<li><strong>Sự kiện:</strong> ${escapeHtml(task.eventTitle)}</li>` : ""}
        ${task.dueAt ? `<li><strong>Hạn chót:</strong> ${escapeHtml(String(task.dueAt).slice(0, 10))}</li>` : ""}
      </ul>
      ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
      ${task.zaloUrl ? `<p>Trao đổi nhanh tại <a href="${escapeHtml(task.zaloUrl)}">Nhóm Zalo sự kiện</a>.</p>` : ""}
    `;
    const html = wrapCard({
      kicker: isMember ? "HolaRise CTV · Phân công nhiệm vụ" : "HolaRise Manager · Giao nhiệm vụ",
      heading: task.title,
      bodyHtml,
      ctaUrl: targetUrl,
      ctaLabel: isMember ? "Mở Nhiệm vụ trên /tham-gia/ →" : "Mở bảng Nhiệm vụ →",
    });
    const text = `Nhiệm vụ mới (${task.department}): ${task.title}${task.dueAt ? ` | Hạn: ${String(task.dueAt).slice(0, 10)}` : ""} | Mở tại: ${targetUrl}`;
    return await sendTransactionalEmail(env, { to: recipientEmail, subject, html, text, fetchImpl });
  } catch (err) {
    return { ok: false, status: "failed", error: String(err?.message || err) };
  }
}

export async function notifyPostReviewEvent(
  env,
  { recipientEmail, recipientName, post, kind = "submitted", reviewNote = "", actorName = "", fetchImpl = fetch }
) {
  if (!recipientEmail) return { ok: false, status: "skipped" };
  try {
    const isReturned = kind === "changes_requested";
    const isPublished = kind === "published";
    const subject = isReturned
      ? `[HolaRise Manager] Cần chỉnh sửa bài: ${post.title}`
      : isPublished
        ? `[HolaRise Manager] Bài viết đã xuất bản: ${post.title}`
        : `[HolaRise Manager] Có bài Hành trình chờ duyệt: ${post.title}`;

    const bodyHtml = isReturned
      ? `<p>Chào <strong>${escapeHtml(recipientName || "bạn")}</strong>,</p>
         <p><strong>${escapeHtml(actorName || "Trưởng ban Nội dung")}</strong> đã xem bài <strong>"${escapeHtml(post.title)}"</strong> và đề nghị chỉnh lại trước khi xuất bản:</p>
         <blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #b45309;background:#fffbeb;color:#78350f;">${escapeHtml(reviewNote || "Vui lòng kiểm tra lại câu chữ và số liệu thực tế.")}</blockquote>`
      : isPublished
        ? `<p>Chào <strong>${escapeHtml(recipientName || "bạn")}</strong>,</p>
           <p>Bài viết <strong>"${escapeHtml(post.title)}"</strong> đã được <strong>${escapeHtml(actorName || "Trưởng ban Nội dung")}</strong> duyệt và xuất bản công khai trên <strong>holarise.org</strong>.</p>`
        : `<p>Chào <strong>${escapeHtml(recipientName || "Trưởng ban Nội dung")}</strong>,</p>
           <p><strong>${escapeHtml(actorName || "CTV Nội dung")}</strong> vừa gửi duyệt bài viết <strong>"${escapeHtml(post.title)}"</strong> (${escapeHtml(post.category || "")}).</p>`;

    const ctaUrl = isPublished && post.slug ? `${ORIGIN}/hanh-trinh/${post.slug}/` : `${ORIGIN}/admin/?tab=posts`;
    const ctaLabel = isPublished ? "Xem bài trên web ↗" : "Mở bài viết để xử lý →";

    const html = wrapCard({
      kicker: "HolaRise Manager · Ban Nội Dung",
      heading: post.title,
      bodyHtml,
      ctaUrl,
      ctaLabel,
    });
    const text = `${subject}${reviewNote ? `\nGhi chú: ${reviewNote}` : ""}\nLink: ${ctaUrl}`;
    return await sendTransactionalEmail(env, { to: recipientEmail, subject, html, text, fetchImpl });
  } catch (err) {
    return { ok: false, status: "failed", error: String(err?.message || err) };
  }
}
