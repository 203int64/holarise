import { generateQrSvg } from "../_lib/qr.js";
import { escHtml } from "../_lib/render.js";
import { normalizePhone } from "../_lib/validation.js";

const PILLAR_META = {
  holaheart: { label: "HolaHeart", subtitle: "Tĩnh tại, Lắng nghe & Gia đình", accent: "#B45309" },
  holagreen: { label: "HolaGreen", subtitle: "Sinh thái & Cảnh quan Bền vững", accent: "#0B6E4F" },
  holaconnect: { label: "HolaConnect", subtitle: "Tri thức & Phụng sự Cộng đồng", accent: "#1D4ED8" },
};

function formatJoinDate(iso) {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "2026";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function getInitials(name) {
  const parts = String(name || "HR").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "HR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderNotFoundHtml(code, isEn = false) {
  return `<!doctype html>
<html lang="${isEn ? "en" : "vi"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${isEn ? "Member Pass Not Found" : "Không tìm thấy thẻ thành viên"} | HolaRise</title>
  <link rel="stylesheet" href="/assets/css/styles.css">
</head>
<body style="background: var(--surface, #F6F7F6); color: var(--ink, #0B110F); font-family: system-ui, -apple-system, sans-serif; margin: 0;">
  <main style="max-width: 520px; margin: 80px auto; padding: 32px 24px; background: #fff; border: 1px solid rgba(11,17,15,0.08); border-radius: 20px; text-align: center;">
    <p style="font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: #5C6B64; margin: 0 0 8px;">${isEn ? "HolaRise Member Pass" : "Thẻ Thành Viên HolaRise"}</p>
    <h1 style="font-size: 1.4rem; margin: 0 0 12px;">${isEn ? "Pass not found:" : "Không tìm thấy mã"} ${escHtml(code || "")}</h1>
    <p style="color: #4A5550; line-height: 1.6; margin: 0 0 24px;">${isEn ? "Member passes are activated after joining HolaRise or checking in at a community gathering." : "Thẻ thành viên được kích hoạt sau khi Ban Điều Phối xác nhận tham dự hoạt động cùng cộng đồng HolaRise."}</p>
    <a class="btn btn--primary" href="${isEn ? "/en/" : "/"}">${isEn ? "Back to HolaRise Home" : "Về trang chủ HolaRise"}</a>
  </main>
</body>
</html>`;
}

export async function onRequestGet({ params, request, env }) {
  const reqUrl = new URL(request.url);
  const isEn = reqUrl.searchParams.get("lang") === "en";
  const rawCode = String(params?.code || "").trim().toUpperCase();
  if (!rawCode || !/^[A-Z0-9-]{4,32}$/.test(rawCode) || !env?.DB) {
    return new Response(renderNotFoundHtml(rawCode, isEn), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // Strictly select public-safe columns + phone_norm ONLY for internal server-side attendance join (never rendered)
  const member = await env.DB.prepare(
    `SELECT id, member_code, name, organization, pillar_choice, role_title, bio, avatar_url, created_at, phone_norm
     FROM members
     WHERE UPPER(member_code) = ? AND is_active = 1
     LIMIT 1`
  )
    .bind(rawCode)
    .first()
    .catch(() => null);

  if (!member) {
    return new Response(renderNotFoundHtml(rawCode, isEn), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const normalizedMemberPhone = member.phone_norm
    ? (normalizePhone(member.phone_norm)?.phoneNorm || String(member.phone_norm).replace(/\D/g, ""))
    : "";

  // Verified participation history (only real non-cancelled registrations linked to this member)
  const regRows = await env.DB.prepare(
    `SELECT r.id, r.event_id, r.activity_title, r.status, r.created_at,
            e.title AS event_title, e.date_display, e.type AS event_type, e.image AS event_image, e.slug AS event_slug
     FROM registrations r
     LEFT JOIN events e ON e.id = r.event_id
     WHERE r.status != 'cancelled'
       AND (r.member_id = ? OR (? != '' AND REPLACE(REPLACE(REPLACE(r.phone, ' ', ''), '.', ''), '-', '') = ?))
     ORDER BY r.created_at DESC
     LIMIT 24`
  )
    .bind(member.id, normalizedMemberPhone, normalizedMemberPhone)
    .all()
    .catch(() => ({ results: [] }));

  // Approved reflections / memories authored by this member (public-safe only)
  const refRows = await env.DB.prepare(
    `SELECT id, pull_quote, content, photo_url, activity_slug, created_at
     FROM community_testimonials
     WHERE status = 'approved' AND author_name = ?
     ORDER BY created_at DESC
     LIMIT 6`
  )
    .bind(member.name)
    .all()
    .catch(() => ({ results: [] }));

  const origin = new URL(request.url).origin || "https://holarise.org";
  const canonicalUrl = `${origin}/tv/${encodeURIComponent(member.member_code)}`;
  const qrSvg = generateQrSvg(canonicalUrl, {
    sizePx: 148,
    fg: "#0B110F",
    bg: "#FFFFFF",
    label: `Mã QR thẻ thành viên ${member.member_code}`,
  });

  const pillar = PILLAR_META[member.pillar_choice] || PILLAR_META.holaheart;
  const activities = (regRows?.results || []).filter((r) => r.event_title || r.activity_title);
  const reflections = refRows?.results || [];
  const verifiedCount = activities.length;

  const avatarHtml = member.avatar_url
    ? `<img src="${escHtml(member.avatar_url)}" alt="${escHtml(member.name)}" width="88" height="88" loading="eager" style="width:88px;height:88px;border-radius:999px;object-fit:cover;border:2px solid #fff;box-shadow:0 6px 20px rgba(11,17,15,0.1);">`
    : `<div aria-hidden="true" style="width:88px;height:88px;border-radius:999px;display:grid;place-items:center;font-weight:700;font-size:1.5rem;letter-spacing:0.04em;color:#fff;background:${pillar.accent};box-shadow:0 6px 20px rgba(11,17,15,0.12);">${escHtml(getInitials(member.name))}</div>`;

  const activitiesHtml =
    activities.length > 0
      ? `<div class="tv-grid">${activities
          .map((item) => {
            const title = item.event_title || item.activity_title;
            const dateStr = item.date_display || formatJoinDate(item.created_at);
            const href = item.event_slug
              ? `${isEn ? "/en/events/" : "/su-kien/"}${encodeURIComponent(item.event_slug)}/`
              : "";
            const imgHtml = item.event_image
              ? `<img src="${escHtml(item.event_image)}" alt="${escHtml(title)}" loading="lazy">`
              : `<div class="tv-event-placeholder">${escHtml(pillar.label)}</div>`;
            const statusBadge = isEn
              ? item.status === "attended"
                ? "Attended"
                : "Recorded"
              : item.status === "attended"
                ? "Đã tham dự"
                : "Đã ghi nhận";
            const body = `<div class="tv-event-thumb">${imgHtml}</div>
              <div class="tv-event-body">
                <span class="tv-event-date">${escHtml(dateStr)}</span>
                <h3>${escHtml(title)}</h3>
                <span class="tv-event-badge">${statusBadge}</span>
              </div>`;
            return href
              ? `<a class="tv-event-card" href="${href}">${body}</a>`
              : `<article class="tv-event-card">${body}</article>`;
          })
          .join("")}</div>`
      : `<div class="tv-empty">${isEn ? "Your verified gatherings will appear here automatically after each check-in with HolaRise." : "Dấu ấn các buổi hoạt động sẽ được cập nhật tự động sau mỗi lần check-in cùng HolaRise."}</div>`;

  const reflectionsHtml =
    reflections.length > 0
      ? `<section class="tv-section">
          <h2>${isEn ? "Shared Reflections &amp; Moments" : "Khoảnh khắc &amp; Cảm nhận đã chia sẻ"}</h2>
          <div class="tv-ref-list">
            ${reflections
              .map(
                (r) => `<article class="tv-ref-card">
                ${r.photo_url ? `<img src="${escHtml(r.photo_url)}" alt="${isEn ? "HolaRise memory photo" : "Ảnh kỷ niệm cùng HolaRise"}" class="tv-ref-photo" loading="lazy">` : ""}
                <div class="tv-ref-copy">
                  ${r.pull_quote ? `<blockquote>“${escHtml(r.pull_quote)}”</blockquote>` : ""}
                  <p>${escHtml(r.content)}</p>
                  <span class="tv-ref-date">${escHtml(formatJoinDate(r.created_at))}</span>
                </div>
              </article>`
              )
              .join("")}
          </div>
        </section>`
      : "";

  const html = `<!doctype html>
<html lang="${isEn ? "en" : "vi"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, follow">
  <title>${escHtml(member.name)} (${escHtml(member.member_code)}) | ${isEn ? "HolaRise Member Pass" : "Thẻ Thành Viên HolaRise"}</title>
  <meta name="description" content="${isEn ? `HolaRise Member Journey Profile for ${escHtml(member.name)} (${escHtml(member.member_code)}).` : `Hồ sơ hành trình thành viên ${escHtml(member.name)} (${escHtml(member.member_code)}) tại HolaRise – Cộng đồng Thanh niên Hòa Lạc.`}">
  <link rel="icon" type="image/png" href="/assets/images/logo-mark.png">
  <style>
    :root { --bg: #F6F7F6; --card: #FFFFFF; --ink: #0B110F; --ink-2: #4A5550; --muted: #6C7872; --line: rgba(11,17,15,0.09); --accent: ${pillar.accent}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    .tv-shell { max-width: 780px; margin: 0 auto; padding: 28px 18px 64px; }
    .tv-topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
    .tv-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.94rem; }
    .tv-brand img { width: 26px; height: 26px; border-radius: 6px; }
    .tv-pass { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 28px; box-shadow: 0 18px 48px rgba(11,17,15,0.06); display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; }
    .tv-identity { display: flex; align-items: center; gap: 18px; }
    .tv-kicker { display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
    .tv-code { display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: #F1F4F2; color: var(--ink); margin-left: 6px; }
    .tv-name { margin: 0 0 4px; font-size: clamp(1.35rem, 3vw, 1.75rem); letter-spacing: -0.02em; line-height: 1.2; }
    .tv-sub { margin: 0; font-size: 0.92rem; color: var(--ink-2); }
    .tv-bio { margin: 12px 0 0; font-size: 0.9rem; line-height: 1.55; color: var(--ink-2); max-width: 48ch; }
    .tv-stats { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 0.82rem; color: var(--muted); }
    .tv-stats strong { color: var(--ink); font-weight: 600; }
    .tv-qr-box { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; border-radius: 18px; border: 1px solid var(--line); background: #fff; }
    .tv-qr-caption { font-size: 0.72rem; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .tv-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .tv-btn { appearance: none; border: 1px solid var(--line); background: #fff; color: var(--ink); font-size: 0.84rem; font-weight: 500; padding: 9px 15px; border-radius: 999px; cursor: pointer; transition: background 0.18s ease, border-color 0.18s ease; }
    .tv-btn:hover { border-color: var(--ink); }
    .tv-btn--primary { background: var(--ink); color: #fff; border-color: var(--ink); }
    .tv-section { margin-top: 32px; }
    .tv-section h2 { font-size: 1.1rem; letter-spacing: -0.01em; margin: 0 0 14px; }
    .tv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .tv-event-card { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; transition: transform 0.2s ease, box-shadow 0.2s ease; }
    .tv-event-card:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(11,17,15,0.06); }
    .tv-event-thumb { aspect-ratio: 16 / 9; background: #EAECEB; overflow: hidden; }
    .tv-event-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tv-event-placeholder { width: 100%; height: 100%; display: grid; place-items: center; font-weight: 600; color: var(--muted); }
    .tv-event-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; }
    .tv-event-date { font-size: 0.76rem; color: var(--muted); }
    .tv-event-body h3 { margin: 0; font-size: 0.96rem; line-height: 1.35; }
    .tv-event-badge { align-self: flex-start; font-size: 0.72rem; font-weight: 500; padding: 3px 9px; border-radius: 999px; background: #ECFDF5; color: #065F46; }
    .tv-empty { padding: 20px; border-radius: 16px; background: var(--card); border: 1px dashed var(--line); color: var(--muted); font-size: 0.9rem; }
    .tv-ref-list { display: grid; gap: 12px; }
    .tv-ref-card { display: grid; grid-template-columns: 120px 1fr; gap: 16px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px; align-items: start; }
    .tv-ref-photo { width: 120px; height: 96px; object-fit: cover; border-radius: 10px; }
    .tv-ref-copy blockquote { margin: 0 0 6px; font-weight: 600; font-size: 0.95rem; }
    .tv-ref-copy p { margin: 0 0 6px; font-size: 0.88rem; color: var(--ink-2); line-height: 1.5; }
    .tv-ref-date { font-size: 0.75rem; color: var(--muted); }
    @media (max-width: 680px) {
      .tv-pass { grid-template-columns: 1fr; padding: 22px; }
      .tv-identity { flex-direction: column; align-items: flex-start; }
      .tv-qr-box { align-self: center; }
      .tv-grid { grid-template-columns: 1fr; }
      .tv-ref-card { grid-template-columns: 1fr; }
      .tv-ref-photo { width: 100%; height: 180px; }
    }
    @media print { .tv-topbar, .tv-actions { display: none !important; } body { background: #fff; } .tv-pass { box-shadow: none; } }
  </style>
</head>
<body>
  <main class="tv-shell">
    <header class="tv-topbar">
      <a class="tv-brand" href="${isEn ? "/en/" : "/"}">
        <img src="/assets/images/logo-mark.png" alt="HolaRise">
        <span>HolaRise</span>
      </a>
      <a class="tv-btn" href="${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}">${isEn ? "Schedule →" : "Lịch hoạt động →"}</a>
    </header>

    <section class="tv-pass" aria-label="${isEn ? "HolaRise Member Pass" : "Thẻ thành viên HolaRise"}">
      <div>
        <div class="tv-identity">
          ${avatarHtml}
          <div>
            <div class="tv-kicker">
              <span>${escHtml(pillar.label)}</span>
              <span class="tv-code">${escHtml(member.member_code)}</span>
            </div>
            <h1 class="tv-name">${escHtml(member.name)}</h1>
            <p class="tv-sub">${escHtml([member.role_title || (isEn ? "Community Member" : "Thành viên đồng hành"), member.organization].filter(Boolean).join(" · "))}</p>
          </div>
        </div>
        ${member.bio ? `<p class="tv-bio">${escHtml(member.bio)}</p>` : ""}
        <div class="tv-stats">
          <span>${isEn ? "Joined:" : "Gia nhập:"} <strong>${escHtml(formatJoinDate(member.created_at))}</strong></span>
          <span>${isEn ? "Recorded gatherings:" : "Hoạt động đã ghi nhận:"} <strong>${verifiedCount}</strong></span>
          <span>${isEn ? "Pillar:" : "Trụ cột:"} <strong>${escHtml(pillar.label)}</strong></span>
        </div>
        <div class="tv-actions">
          <button type="button" class="tv-btn tv-btn--primary" id="tv-share-btn">${isEn ? "Share Member Pass" : "Chia sẻ thẻ thành viên"}</button>
          <button type="button" class="tv-btn" onclick="window.print()">${isEn ? "Save PDF / Print" : "Lưu PDF / In thẻ"}</button>
        </div>
      </div>

      <div class="tv-qr-box">
        ${qrSvg}
        <span class="tv-qr-caption">${escHtml(member.member_code)}</span>
      </div>
    </section>

    <section class="tv-section">
      <h2>${isEn ? "Journey Milestones at HolaRise" : "Dấu ấn hành trình tại HolaRise"}</h2>
      ${activitiesHtml}
    </section>

    ${reflectionsHtml}
  </main>

  <script>
    (function () {
      var btn = document.getElementById("tv-share-btn");
      if (!btn) return;
      var shareUrl = ${JSON.stringify(canonicalUrl)};
      var shareTitle = ${JSON.stringify(`${isEn ? "HolaRise Member Pass" : "Thẻ thành viên HolaRise"} · ${member.name} (${member.member_code})`)};
      var copiedLabel = ${JSON.stringify(isEn ? "Pass link copied" : "Đã sao chép liên kết thẻ")};
      var defaultLabel = ${JSON.stringify(isEn ? "Share Member Pass" : "Chia sẻ thẻ thành viên")};
      btn.addEventListener("click", function () {
        if (navigator.share) {
          navigator.share({ title: shareTitle, url: shareUrl }).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(function () {
            btn.textContent = copiedLabel;
            setTimeout(function () { btn.textContent = defaultLabel; }, 2200);
          });
        }
      });
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=120",
      "X-Robots-Tag": "noindex, follow",
    },
  });
}
