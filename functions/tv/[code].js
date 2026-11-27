import { generateQrSvg } from "../_lib/qr.js";
import { escHtml, resolveEventHref } from "../_lib/render.js";
import { normalizePhone } from "../_lib/validation.js";

const PILLAR_META = {
  holaheart: {
    key: "holaheart",
    label: "HolaHeart",
    subtitleVi: "Tĩnh tại, Lắng nghe & Gia đình",
    subtitleEn: "Stillness, Listening & Family",
    accent: "#B58342",
  },
  holagreen: {
    key: "holagreen",
    label: "HolaGreen",
    subtitleVi: "Sinh thái & Cảnh quan Bền vững",
    subtitleEn: "Ecology & Sustainable Landscape",
    accent: "#2D6A4F",
  },
  holaconnect: {
    key: "holaconnect",
    label: "HolaConnect",
    subtitleVi: "Tri thức & Phụng sự Cộng đồng",
    subtitleEn: "Knowledge & Community Service",
    accent: "#3B5B8A",
  },
};

function inferPillarKey(eventType, eventId, title) {
  const hay = `${eventType || ""} ${eventId || ""} ${title || ""}`.toLowerCase();
  if (hay.includes("holagreen") || hay.includes("sinh thái") || hay.includes("cảnh quan")) {
    return "holagreen";
  }
  if (hay.includes("holaconnect") || hay.includes("leo núi") || hay.includes("tri thức") || hay.includes("phụng sự")) {
    return "holaconnect";
  }
  return "holaheart";
}

function formatJoinDate(iso) {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "2026";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function safeImgUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const parsed = new URL(s);
    return parsed.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
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
  <title>${isEn ? "Member Passport Not Found" : "Không tìm thấy Thẻ Thành Viên"} | HolaRise</title>
  <link rel="icon" type="image/png" href="/assets/images/favicon-96.png">
  <style>
    body { margin: 0; background: #FAF8F4; color: #1B2420; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 20px; }
    .nf-card { max-width: 480px; width: 100%; background: #FFFFFF; border: 1px solid #E8E3D9; border-radius: 20px; padding: 36px 28px; text-align: center; box-shadow: 0 16px 40px rgba(27,59,43,0.06); }
    .nf-kicker { font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase; color: #B58342; font-weight: 600; margin: 0 0 10px; }
    .nf-card h1 { font-family: Georgia, "Times New Roman", serif; font-size: 1.45rem; color: #1B3B2B; margin: 0 0 12px; }
    .nf-card p { color: #4E5953; line-height: 1.65; margin: 0 0 24px; font-size: 0.94rem; }
    .nf-btn { display: inline-block; padding: 11px 22px; background: #1B3B2B; color: #FAF8F4; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main class="nf-card">
    <p class="nf-kicker">${isEn ? "HolaRise Member Passport" : "Thẻ Thành Viên HolaRise"}</p>
    <h1>${isEn ? "Pass not found:" : "Không tìm thấy mã"} ${escHtml(code || "")}</h1>
    <p>${isEn ? "Member passports are activated after joining HolaRise or checking in at a community gathering." : "Thẻ thành viên được kích hoạt ngay khi bạn tạo tài khoản hoặc check-in tại một buổi gặp của HolaRise."}</p>
    <a class="nf-btn" href="${isEn ? "/en/" : "/"}">${isEn ? "Back to HolaRise Home" : "Về trang chủ HolaRise"}</a>
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
    ? normalizePhone(member.phone_norm)?.phoneNorm || String(member.phone_norm).replace(/\D/g, "")
    : "";

  // Run all public-safe journey queries in parallel
  const [regRows, refRows, photoRows] = await Promise.all([
    // Verified participation history (no e.slug column in D1 events schema — resolve href via resolveEventHref)
    env.DB.prepare(
      `SELECT r.id, r.event_id, r.activity_title, r.status, r.created_at,
              e.title AS event_title, e.title_en AS event_title_en, e.date AS event_date,
              e.date_display, e.location AS event_location, e.type AS event_type, e.image AS event_image
       FROM registrations r
       LEFT JOIN events e ON e.id = r.event_id
       WHERE r.status != 'cancelled'
         AND (r.member_id = ? OR (? != '' AND REPLACE(REPLACE(REPLACE(r.phone, ' ', ''), '.', ''), '-', '') = ?))
       ORDER BY COALESCE(NULLIF(e.date, ''), substr(r.created_at, 1, 10)) DESC, r.created_at DESC
       LIMIT 30`
    )
      .bind(member.id, normalizedMemberPhone, normalizedMemberPhone)
      .all()
      .catch(() => ({ results: [] })),

    // Approved reflections authored specifically by this member_id
    env.DB.prepare(
      `SELECT id, pull_quote, content, photo_url, activity_slug, created_at
       FROM activity_reflections
       WHERE status = 'approved' AND member_id = ?
       ORDER BY created_at DESC
       LIMIT 8`
    )
      .bind(member.id)
      .all()
      .catch(() => ({ results: [] })),

    // Approved photos/videos contributed by this member to public albums
    env.DB.prepare(
      `SELECT p.id, p.url, p.web_url, p.caption, p.media_type, p.created_at, a.title AS album_title
       FROM media_photos p
       LEFT JOIN media_albums a ON a.id = p.album_id
       WHERE p.contributor_member_id = ?
         AND COALESCE(p.approval_status, 'approved') = 'approved'
         AND COALESCE(p.media_type, 'image') = 'image'
         AND COALESCE(a.visibility, 'public') = 'public'
       ORDER BY p.created_at DESC
       LIMIT 9`
    )
      .bind(member.id)
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const origin = reqUrl.origin || "https://holarise.org";
  const canonicalUrl = `${origin}/tv/${encodeURIComponent(member.member_code)}`;
  const altLangUrl = isEn ? canonicalUrl : `${canonicalUrl}?lang=en`;
  const qrSvg = generateQrSvg(canonicalUrl, {
    sizePx: 132,
    fg: "#1B3B2B",
    bg: "#FAF8F4",
    label: `Mã QR thẻ thành viên ${member.member_code}`,
  });

  const pillar = PILLAR_META[member.pillar_choice] || PILLAR_META.holaheart;
  const activities = (regRows?.results || []).filter((r) => r.event_title || r.activity_title);
  const reflections = refRows?.results || [];
  const contributedPhotos = (photoRows?.results || []).filter((p) => safeImgUrl(p.web_url || p.url));

  const attendedCount = activities.filter((a) => a.status === "attended").length;
  const verifiedCount = activities.length;

  // Track which pillars this member has touched
  const touchedPillars = new Set([pillar.key]);
  for (const item of activities) {
    touchedPillars.add(inferPillarKey(item.event_type, item.event_id, item.event_title || item.activity_title));
  }

  const safeAvatar = safeImgUrl(member.avatar_url);
  const avatarHtml = safeAvatar
    ? `<img class="hp-avatar" src="${escHtml(safeAvatar)}" alt="${escHtml(member.name)}" width="84" height="84" loading="eager">`
    : `<div class="hp-avatar hp-avatar--fallback" aria-hidden="true">${escHtml(getInitials(member.name))}</div>`;

  // Pillar Stamps strip (shows real pillars touched)
  const pillarStampsHtml = ["holaheart", "holagreen", "holaconnect"]
    .map((key) => {
      const meta = PILLAR_META[key];
      const active = touchedPillars.has(key);
      return `<div class="hp-stamp ${active ? "is-active" : ""}">
        <span class="hp-stamp-dot" style="background:${active ? meta.accent : "#D5CFC4"}"></span>
        <div>
          <strong>${escHtml(meta.label)}</strong>
          <span>${escHtml(isEn ? meta.subtitleEn : meta.subtitleVi)}</span>
        </div>
      </div>`;
    })
    .join("");

  // Editorial Journey Timeline
  const activitiesHtml =
    activities.length > 0
      ? `<ol class="hp-timeline">${activities
          .map((item) => {
            const title = (isEn && item.event_title_en) || item.event_title || item.activity_title;
            const dateStr = item.date_display || formatJoinDate(item.event_date || item.created_at);
            const locStr = item.event_location || "";
            const pKey = inferPillarKey(item.event_type, item.event_id, title);
            const pMeta = PILLAR_META[pKey];
            const rawHref = item.event_id ? resolveEventHref({ id: item.event_id }) : "";
            const href = rawHref
              ? isEn
                ? rawHref.replace(/^\/su-kien\//, "/en/events/")
                : rawHref
              : "";
            const safeEvImg = safeImgUrl(item.event_image);
            const imgHtml = safeEvImg
              ? `<img src="${escHtml(safeEvImg)}" alt="${escHtml(title)}" loading="lazy">`
              : `<div class="hp-tl-placeholder">${escHtml(pMeta.label)}</div>`;
            const isAttended = item.status === "attended";
            const statusBadge = isEn
              ? isAttended
                ? "Attended"
                : "Reserved"
              : isAttended
                ? "Đã tham dự"
                : "Đã ghi nhận";

            const cardInner = `<div class="hp-tl-media">${imgHtml}</div>
              <div class="hp-tl-body">
                <div class="hp-tl-meta">
                  <span class="hp-tl-pillar" style="color:${pMeta.accent}">${escHtml(pMeta.label)}</span>
                  <span aria-hidden="true">·</span>
                  <span>${escHtml(dateStr)}</span>
                </div>
                <h3>${escHtml(title)}</h3>
                ${locStr ? `<p class="hp-tl-loc">${escHtml(locStr)}</p>` : ""}
                <span class="hp-tl-badge ${isAttended ? "is-attended" : ""}">${statusBadge}</span>
              </div>`;

            return `<li class="hp-tl-item">
              <span class="hp-tl-node" aria-hidden="true"></span>
              ${href ? `<a class="hp-tl-card" href="${escHtml(href)}">${cardInner}</a>` : `<article class="hp-tl-card">${cardInner}</article>`}
            </li>`;
          })
          .join("")}</ol>`
      : `<div class="hp-empty">
          <p>${isEn ? "Your verified gatherings will appear along this timeline automatically after each reservation and check-in with HolaRise." : "Dấu ấn các buổi gặp sẽ tự động hiện lên dòng thời gian này sau mỗi lần bạn giữ chỗ và check-in cùng HolaRise."}</p>
          <a class="hp-btn hp-btn--outline" href="${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}">${isEn ? "Explore upcoming gatherings →" : "Xem lịch hoạt động sắp tới →"}</a>
        </div>`;

  // Contributed Photos Mosaic (only renders if member has approved public contributions)
  const contributedHtml =
    contributedPhotos.length > 0
      ? `<section class="hp-section">
          <div class="hp-section-head">
            <h2>${isEn ? "Through Your Lens" : "Góc nhìn bạn đã gửi góp"}</h2>
            <span class="hp-section-count">${contributedPhotos.length} ${isEn ? "photos" : "khung hình"}</span>
          </div>
          <div class="hp-photo-grid">
            ${contributedPhotos
              .map((p) => {
                const src = safeImgUrl(p.web_url || p.url);
                const cap = p.caption || p.album_title || (isEn ? "Contributed moment" : "Khoảnh khắc đóng góp");
                return `<figure class="hp-photo-item">
                  <img src="${escHtml(src)}" alt="${escHtml(cap)}" loading="lazy">
                  ${p.album_title ? `<figcaption>${escHtml(p.album_title)}</figcaption>` : ""}
                </figure>`;
              })
              .join("")}
          </div>
        </section>`
      : "";

  // Reflections Section
  const reflectionsHtml =
    reflections.length > 0
      ? `<section class="hp-section">
          <div class="hp-section-head">
            <h2>${isEn ? "Shared Reflections" : "Những dòng lưu bút đã chia sẻ"}</h2>
            <span class="hp-section-count">${reflections.length} ${isEn ? "notes" : "trang lưu bút"}</span>
          </div>
          <div class="hp-ref-list">
            ${reflections
              .map((r) => {
                const safeRefPhoto = safeImgUrl(r.photo_url);
                return `<article class="hp-ref-card ${safeRefPhoto ? "has-photo" : ""}">
                  ${safeRefPhoto ? `<img src="${escHtml(safeRefPhoto)}" alt="${isEn ? "HolaRise memory photo" : "Ảnh kỷ niệm cùng HolaRise"}" class="hp-ref-photo" loading="lazy">` : ""}
                  <div class="hp-ref-copy">
                    ${r.pull_quote ? `<blockquote>&ldquo;${escHtml(r.pull_quote)}&rdquo;</blockquote>` : ""}
                    <p>${escHtml(r.content)}</p>
                    <span class="hp-ref-date">${escHtml(formatJoinDate(r.created_at))}</span>
                  </div>
                </article>`;
              })
              .join("")}
          </div>
        </section>`
      : "";

  const roleLine = [
    member.role_title || (isEn ? "Community Member" : "Thành viên đồng hành"),
    member.organization,
  ]
    .filter(Boolean)
    .join(" · ");

  const ogDescription = isEn
    ? `HolaRise Member Passport for ${member.name} (${member.member_code}) · ${verifiedCount} recorded gatherings.`
    : `Hộ chiếu Hành trình Thành viên ${member.name} (${member.member_code}) tại HolaRise · ${verifiedCount} dấu ấn hoạt động.`;

  const canvasExportData = {
    name: String(member.name || ""),
    code: String(member.member_code || ""),
    role: roleLine,
    pillar: pillar.label,
    pillarSub: isEn ? pillar.subtitleEn : pillar.subtitleVi,
    joined: formatJoinDate(member.created_at),
    count: String(verifiedCount),
    reflections: String(reflections.length),
    photos: String(contributedPhotos.length),
    isEn,
    qrSvg,
  };

  const html = `<!doctype html>
<html lang="${isEn ? "en" : "vi"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, follow">
  <title>${escHtml(member.name)} (${escHtml(member.member_code)}) | ${isEn ? "HolaRise Member Passport" : "Thẻ Thành Viên HolaRise"}</title>
  <meta name="description" content="${escHtml(ogDescription)}">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${escHtml(member.name)} · ${escHtml(member.member_code)} | HolaRise">
  <meta property="og:description" content="${escHtml(ogDescription)}">
  <meta property="og:url" content="${escHtml(canonicalUrl)}">
  <meta property="og:image" content="${escHtml(safeAvatar || `${origin}/assets/images/logo-holarise.png`)}">
  <link rel="icon" type="image/png" href="/assets/images/favicon-96.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Lora:ital,wght@0,500;0,600;0,700;1,400;1,500&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #FAF8F4;
      --paper-2: #F3EFE6;
      --card: #FFFFFF;
      --pine: #1B3B2B;
      --pine-deep: #132A1F;
      --gold: #C59B5F;
      --gold-soft: #E8D7B9;
      --ink: #1B2420;
      --ink-2: #4B5751;
      --muted: #707C76;
      --line: #E6E0D4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    a { color: inherit; text-decoration: none; }
    .hp-shell { max-width: 840px; margin: 0 auto; padding: 24px 18px 72px; }

    /* Top bar */
    .hp-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 24px; }
    .hp-brand { display: inline-flex; align-items: center; gap: 10px; font-family: "Lora", Georgia, serif; font-weight: 700; font-size: 1.05rem; color: var(--pine); }
    .hp-brand img { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: #fff; }
    .hp-top-links { display: inline-flex; align-items: center; gap: 8px; }
    .hp-pill-link { font-size: 0.8rem; font-weight: 500; color: var(--pine); padding: 7px 13px; border-radius: 999px; border: 1px solid var(--line); background: #fff; transition: border-color 0.18s ease, background 0.18s ease; }
    .hp-pill-link:hover { border-color: var(--pine); background: var(--paper-2); }

    /* Hero Member Passport Card (Pine & Gold Foil) */
    .hp-passport {
      position: relative;
      background:
        radial-gradient(120% 90% at 95% 5%, rgba(197, 155, 95, 0.22) 0%, rgba(197, 155, 95, 0) 55%),
        radial-gradient(90% 80% at 5% 95%, rgba(197, 155, 95, 0.12) 0%, rgba(27, 59, 43, 0) 60%),
        linear-gradient(145deg, #1E4230 0%, #163124 55%, #11261B 100%);
      color: #FAF8F4;
      border-radius: 24px;
      padding: 28px 30px 26px;
      border: 1px solid rgba(197, 155, 95, 0.42);
      box-shadow: 0 24px 56px rgba(19, 42, 31, 0.18), inset 0 1px 0 rgba(250, 248, 244, 0.12);
      overflow: hidden;
    }
    .hp-passport::after {
      content: "";
      position: absolute;
      inset: 8px;
      border-radius: 17px;
      border: 1px solid rgba(197, 155, 95, 0.22);
      pointer-events: none;
    }
    .hp-pass-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 18px;
      margin-bottom: 22px;
      border-bottom: 1px solid rgba(197, 155, 95, 0.28);
    }
    .hp-pass-emblem {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--gold-soft);
    }
    .hp-pass-emblem img { width: 24px; height: 24px; border-radius: 6px; background: #FAF8F4; }
    .hp-code-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 5px 12px;
      border-radius: 999px;
      background: rgba(197, 155, 95, 0.16);
      border: 1px solid rgba(197, 155, 95, 0.48);
      color: #F6E9D2;
    }

    .hp-pass-main {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: center;
    }
    .hp-identity { display: flex; align-items: center; gap: 18px; }
    .hp-avatar {
      width: 84px;
      height: 84px;
      border-radius: 999px;
      object-fit: cover;
      border: 2.5px solid var(--gold);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      flex-shrink: 0;
    }
    .hp-avatar--fallback {
      display: grid;
      place-items: center;
      font-family: "Lora", Georgia, serif;
      font-weight: 700;
      font-size: 1.55rem;
      color: var(--pine);
      background: linear-gradient(135deg, #F5E8CE, #C59B5F);
    }
    .hp-pillar-kicker {
      font-size: 0.74rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--gold);
      margin: 0 0 4px;
    }
    .hp-name {
      margin: 0 0 4px;
      font-family: "Lora", Georgia, serif;
      font-size: clamp(1.45rem, 3.2vw, 1.95rem);
      font-weight: 600;
      line-height: 1.2;
      color: #FAF8F4;
      letter-spacing: -0.01em;
    }
    .hp-role { margin: 0; font-size: 0.9rem; color: rgba(250, 248, 244, 0.78); }
    .hp-bio {
      margin: 14px 0 0;
      font-family: "Lora", Georgia, serif;
      font-style: italic;
      font-size: 0.95rem;
      line-height: 1.6;
      color: rgba(250, 248, 244, 0.88);
      max-width: 50ch;
    }

    .hp-qr-card {
      background: #FAF8F4;
      padding: 10px 10px 8px;
      border-radius: 14px;
      border: 1px solid rgba(197, 155, 95, 0.55);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
    }
    .hp-qr-card svg { display: block; border-radius: 6px; }
    .hp-qr-label {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.68rem;
      font-weight: 600;
      color: var(--pine);
      letter-spacing: 0.04em;
    }

    .hp-pass-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 22px;
      padding-top: 16px;
      border-top: 1px solid rgba(250, 248, 244, 0.14);
      font-size: 0.8rem;
      color: rgba(250, 248, 244, 0.75);
    }
    .hp-pass-foot strong { color: #FAF8F4; font-weight: 600; }

    /* Action Bar */
    .hp-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }
    .hp-btn {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 10px 18px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #FFFFFF;
      color: var(--pine);
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.18s ease, background 0.18s ease;
    }
    .hp-btn:hover { border-color: var(--pine); background: var(--paper-2); }
    .hp-btn--primary { background: var(--pine); color: #FAF8F4; border-color: var(--pine); }
    .hp-btn--primary:hover { background: var(--pine-deep); color: #FAF8F4; }
    .hp-btn--gold { background: #FBF6EC; color: #7C5824; border-color: rgba(197, 155, 95, 0.65); }
    .hp-btn--gold:hover { background: #F5EBD7; border-color: #B58342; }

    /* Metrics & Pillar Stamps */
    .hp-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 22px;
    }
    .hp-metric {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px 16px 14px;
    }
    .hp-metric-val {
      display: block;
      font-family: "Lora", Georgia, serif;
      font-size: 1.65rem;
      font-weight: 700;
      line-height: 1.15;
      color: var(--pine);
    }
    .hp-metric-lbl { display: block; margin-top: 4px; font-size: 0.78rem; color: var(--muted); }

    .hp-stamps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .hp-stamp {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.65);
      opacity: 0.62;
    }
    .hp-stamp.is-active {
      background: #FFFFFF;
      border-color: rgba(197, 155, 95, 0.55);
      opacity: 1;
      box-shadow: 0 6px 18px rgba(27, 59, 43, 0.04);
    }
    .hp-stamp-dot { width: 10px; height: 10px; border-radius: 999px; flex-shrink: 0; }
    .hp-stamp strong { display: block; font-size: 0.84rem; color: var(--pine); line-height: 1.25; }
    .hp-stamp span { display: block; font-size: 0.72rem; color: var(--muted); line-height: 1.3; margin-top: 2px; }

    /* Sections */
    .hp-section { margin-top: 38px; }
    .hp-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .hp-section h2 {
      margin: 0;
      font-family: "Lora", Georgia, serif;
      font-size: 1.3rem;
      font-weight: 600;
      color: var(--pine);
      letter-spacing: -0.01em;
    }
    .hp-section-count { font-size: 0.8rem; color: var(--muted); font-weight: 500; }

    /* Journey Timeline */
    .hp-timeline { list-style: none; margin: 0; padding: 0 0 0 22px; position: relative; display: grid; gap: 16px; }
    .hp-timeline::before {
      content: "";
      position: absolute;
      left: 6px;
      top: 10px;
      bottom: 10px;
      width: 2px;
      background: linear-gradient(180deg, var(--gold) 0%, #E3DBCC 100%);
    }
    .hp-tl-item { position: relative; }
    .hp-tl-node {
      position: absolute;
      left: -21px;
      top: 22px;
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: var(--paper);
      border: 2.5px solid var(--gold);
      box-shadow: 0 0 0 3px var(--paper);
    }
    .hp-tl-card {
      display: grid;
      grid-template-columns: 184px 1fr;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .hp-tl-card:hover { transform: translateY(-2px); border-color: rgba(197, 155, 95, 0.7); box-shadow: 0 14px 30px rgba(27, 59, 43, 0.07); }
    .hp-tl-media { background: var(--paper-2); min-height: 124px; overflow: hidden; }
    .hp-tl-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hp-tl-placeholder { width: 100%; height: 100%; display: grid; place-items: center; font-family: "Lora", Georgia, serif; font-weight: 600; color: var(--muted); }
    .hp-tl-body { padding: 16px 20px; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    .hp-tl-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.76rem; color: var(--muted); font-weight: 500; }
    .hp-tl-pillar { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.7rem; }
    .hp-tl-body h3 { margin: 0; font-family: "Lora", Georgia, serif; font-size: 1.06rem; line-height: 1.35; color: var(--ink); }
    .hp-tl-loc { margin: 0; font-size: 0.82rem; color: var(--ink-2); }
    .hp-tl-badge {
      align-self: flex-start;
      margin-top: 2px;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      background: #FBF5E8;
      color: #8A5D20;
    }
    .hp-tl-badge.is-attended { background: #E9F6EE; color: #165B3A; }

    /* Contributed Photos Mosaic */
    .hp-photo-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .hp-photo-item { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
    .hp-photo-item img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
    .hp-photo-item figcaption { padding: 8px 10px; font-size: 0.74rem; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Reflections */
    .hp-ref-list { display: grid; gap: 14px; }
    .hp-ref-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-left: 3px solid var(--gold);
      border-radius: 16px;
      padding: 18px 20px;
      display: grid;
      gap: 16px;
      align-items: start;
    }
    .hp-ref-card.has-photo { grid-template-columns: 132px 1fr; }
    .hp-ref-photo { width: 132px; height: 104px; object-fit: cover; border-radius: 10px; display: block; }
    .hp-ref-copy blockquote {
      margin: 0 0 8px;
      font-family: "Lora", Georgia, serif;
      font-style: italic;
      font-size: 1.02rem;
      line-height: 1.5;
      color: var(--pine);
    }
    .hp-ref-copy p { margin: 0 0 8px; font-size: 0.9rem; color: var(--ink-2); line-height: 1.6; }
    .hp-ref-date { font-size: 0.75rem; color: var(--muted); }

    .hp-empty {
      padding: 28px 22px;
      border-radius: 18px;
      background: var(--card);
      border: 1px dashed #D6CEBE;
      text-align: center;
      color: var(--ink-2);
      font-size: 0.92rem;
    }
    .hp-empty p { margin: 0 0 14px; }
    .hp-footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      text-align: center;
      font-size: 0.8rem;
      color: var(--muted);
    }

    @media (max-width: 700px) {
      .hp-passport { padding: 22px 18px 20px; }
      .hp-pass-main { grid-template-columns: 1fr; }
      .hp-identity { flex-direction: column; align-items: flex-start; gap: 12px; }
      .hp-qr-card { align-self: flex-start; flex-direction: row; padding: 10px 14px; gap: 12px; }
      .hp-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .hp-stamps { grid-template-columns: 1fr; }
      .hp-tl-card { grid-template-columns: 1fr; }
      .hp-tl-media { aspect-ratio: 16 / 9; }
      .hp-photo-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .hp-ref-card.has-photo { grid-template-columns: 1fr; }
      .hp-ref-photo { width: 100%; height: 180px; }
    }
    @media print {
      .hp-topbar, .hp-actions, .hp-footer { display: none !important; }
      body { background: #fff; }
      .hp-passport { box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <main class="hp-shell">
    <header class="hp-topbar">
      <a class="hp-brand" href="${isEn ? "/en/" : "/"}">
        <img src="/assets/images/favicon-96.png" alt="HolaRise">
        <span>HolaRise</span>
      </a>
      <div class="hp-top-links">
        <a class="hp-pill-link" href="${escHtml(altLangUrl)}">${isEn ? "Tiếng Việt" : "English"}</a>
        <a class="hp-pill-link" href="${isEn ? "/en/schedule/" : "/lich-hoat-dong/"}">${isEn ? "Schedule →" : "Lịch hoạt động →"}</a>
      </div>
    </header>

    <section class="hp-passport" aria-label="${isEn ? "HolaRise Member Passport" : "Thẻ Thành Viên HolaRise"}">
      <div class="hp-pass-head">
        <div class="hp-pass-emblem">
          <img src="/assets/images/favicon-96.png" alt="" aria-hidden="true">
          <span>${isEn ? "HolaRise · Member Passport" : "HolaRise · Hộ Chiếu Thành Viên"}</span>
        </div>
        <span class="hp-code-chip">${escHtml(member.member_code)}</span>
      </div>

      <div class="hp-pass-main">
        <div>
          <div class="hp-identity">
            ${avatarHtml}
            <div>
              <p class="hp-pillar-kicker">${escHtml(pillar.label)} · ${escHtml(isEn ? pillar.subtitleEn : pillar.subtitleVi)}</p>
              <h1 class="hp-name">${escHtml(member.name)}</h1>
              <p class="hp-role">${escHtml(roleLine)}</p>
            </div>
          </div>
          ${member.bio ? `<p class="hp-bio">&ldquo;${escHtml(member.bio)}&rdquo;</p>` : ""}
        </div>

        <div class="hp-qr-card">
          ${qrSvg}
          <span class="hp-qr-label">${escHtml(member.member_code)}</span>
        </div>
      </div>

      <div class="hp-pass-foot">
        <span>${isEn ? "Member since:" : "Đồng hành từ:"} <strong>${escHtml(formatJoinDate(member.created_at))}</strong></span>
        <span>${isEn ? "Verified check-ins:" : "Đã có mặt:"} <strong>${attendedCount}</strong> · ${isEn ? "Recorded:" : "Ghi nhận:"} <strong>${verifiedCount}</strong></span>
        <span>holarise.org</span>
      </div>
    </section>

    <div class="hp-actions">
      <button type="button" class="hp-btn hp-btn--primary" id="tv-share-btn">${isEn ? "Share Passport Link" : "Chia sẻ link Thẻ"}</button>
      <button type="button" class="hp-btn hp-btn--gold" id="tv-png-btn">${isEn ? "Save Card Image (PNG)" : "Tải ảnh Thẻ (PNG)"}</button>
      <button type="button" class="hp-btn" onclick="window.print()">${isEn ? "Print / PDF" : "In / Lưu PDF"}</button>
    </div>

    <section class="hp-metrics" aria-label="${isEn ? "Journey Summary" : "Tổng quan hành trình"}">
      <div class="hp-metric">
        <span class="hp-metric-val">${verifiedCount}</span>
        <span class="hp-metric-lbl">${isEn ? "Gatherings recorded" : "Hoạt động ghi nhận"}</span>
      </div>
      <div class="hp-metric">
        <span class="hp-metric-val">${touchedPillars.size}/3</span>
        <span class="hp-metric-lbl">${isEn ? "Pillars touched" : "Trụ cột đồng hành"}</span>
      </div>
      <div class="hp-metric">
        <span class="hp-metric-val">${reflections.length}</span>
        <span class="hp-metric-lbl">${isEn ? "Shared reflections" : "Trang lưu bút"}</span>
      </div>
      <div class="hp-metric">
        <span class="hp-metric-val">${contributedPhotos.length}</span>
        <span class="hp-metric-lbl">${isEn ? "Contributed photos" : "Ảnh đã đóng góp"}</span>
      </div>
    </section>

    <div class="hp-stamps" aria-label="${isEn ? "Three Pillars" : "Dấu ấn 3 trụ cột"}">
      ${pillarStampsHtml}
    </div>

    <section class="hp-section">
      <div class="hp-section-head">
        <h2>${isEn ? "Journey Timeline at HolaRise" : "Dòng thời gian hành trình tại HolaRise"}</h2>
        ${verifiedCount > 0 ? `<span class="hp-section-count">${verifiedCount} ${isEn ? "milestones" : "dấu ấn"}</span>` : ""}
      </div>
      ${activitiesHtml}
    </section>

    ${contributedHtml}
    ${reflectionsHtml}

    <footer class="hp-footer">
      HolaRise · HolaHeart · HolaGreen · HolaConnect · holarise.org
    </footer>
  </main>

  <script>
    (function () {
      var shareBtn = document.getElementById("tv-share-btn");
      var pngBtn = document.getElementById("tv-png-btn");
      var shareUrl = ${JSON.stringify(canonicalUrl)};
      var shareTitle = ${JSON.stringify(`${isEn ? "HolaRise Member Passport" : "Thẻ Thành Viên HolaRise"} · ${member.name} (${member.member_code})`)};
      var copiedLabel = ${JSON.stringify(isEn ? "Passport link copied" : "Đã sao chép liên kết thẻ")};
      var defaultShareLabel = ${JSON.stringify(isEn ? "Share Passport Link" : "Chia sẻ link Thẻ")};
      var cardData = ${JSON.stringify(canvasExportData)};

      if (shareBtn) {
        shareBtn.addEventListener("click", function () {
          if (navigator.share) {
            navigator.share({ title: shareTitle, url: shareUrl }).catch(function () {});
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(function () {
              shareBtn.textContent = copiedLabel;
              setTimeout(function () { shareBtn.textContent = defaultShareLabel; }, 2200);
            });
          }
        });
      }

      if (pngBtn) {
        pngBtn.addEventListener("click", function () {
          var origText = pngBtn.textContent;
          pngBtn.disabled = true;
          pngBtn.textContent = cardData.isEn ? "Creating image..." : "Đang xuất ảnh...";
          try {
            var W = 1080, H = 1350;
            var canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            var ctx = canvas.getContext("2d");

            // Paper backdrop
            ctx.fillStyle = "#FAF8F4";
            ctx.fillRect(0, 0, W, H);

            // Inner pine card
            var pad = 64;
            var cw = W - pad * 2, ch = H - pad * 2;
            var grad = ctx.createLinearGradient(pad, pad, W - pad, H - pad);
            grad.addColorStop(0, "#1E4230");
            grad.addColorStop(0.55, "#163124");
            grad.addColorStop(1, "#11261B");

            function roundRect(x, y, w, h, r) {
              ctx.beginPath();
              ctx.moveTo(x + r, y);
              ctx.arcTo(x + w, y, x + w, y + h, r);
              ctx.arcTo(x + w, y + h, x, y + h, r);
              ctx.arcTo(x, y + h, x, y, r);
              ctx.arcTo(x, y, x + w, y, r);
              ctx.closePath();
            }

            roundRect(pad, pad, cw, ch, 40);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(197, 155, 95, 0.55)";
            ctx.stroke();

            // Inner gold hairline frame
            roundRect(pad + 20, pad + 20, cw - 40, ch - 40, 28);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(197, 155, 95, 0.28)";
            ctx.stroke();

            // Top eyebrow + code
            ctx.fillStyle = "#E8D7B9";
            ctx.font = "600 24px -apple-system, BlinkMacSystemFont, sans-serif";
            ctx.fillText(cardData.isEn ? "HOLARISE · MEMBER PASSPORT" : "HOLARISE · HỘ CHIẾU THÀNH VIÊN", pad + 60, pad + 110);

            ctx.fillStyle = "#C59B5F";
            ctx.font = "600 28px ui-monospace, Menlo, monospace";
            ctx.textAlign = "right";
            ctx.fillText(cardData.code, W - pad - 60, pad + 110);
            ctx.textAlign = "left";

            // Gold divider
            ctx.fillStyle = "rgba(197, 155, 95, 0.35)";
            ctx.fillRect(pad + 60, pad + 144, cw - 120, 2);

            // Pillar label
            ctx.fillStyle = "#C59B5F";
            ctx.font = "600 26px -apple-system, BlinkMacSystemFont, sans-serif";
            ctx.fillText((cardData.pillar + " · " + cardData.pillarSub).toUpperCase(), pad + 60, pad + 240);

            // Member name
            ctx.fillStyle = "#FAF8F4";
            ctx.font = "700 66px Georgia, serif";
            ctx.fillText(cardData.name.slice(0, 26), pad + 60, pad + 336);

            // Role line
            ctx.fillStyle = "rgba(250, 248, 244, 0.78)";
            ctx.font = "400 32px -apple-system, BlinkMacSystemFont, sans-serif";
            ctx.fillText(cardData.role.slice(0, 44), pad + 60, pad + 398);

            // Stats boxes
            var stats = [
              [cardData.count, cardData.isEn ? "GATHERINGS" : "HOẠT ĐỘNG"],
              [cardData.reflections, cardData.isEn ? "REFLECTIONS" : "LƯU BÚT"],
              [cardData.photos, cardData.isEn ? "PHOTOS" : "ẢNH ĐÓNG GÓP"],
            ];
            var boxW = (cw - 120 - 40) / 3;
            stats.forEach(function (st, idx) {
              var bx = pad + 60 + idx * (boxW + 20);
              var by = pad + 470;
              roundRect(bx, by, boxW, 150, 20);
              ctx.fillStyle = "rgba(250, 248, 244, 0.07)";
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "rgba(197, 155, 95, 0.32)";
              ctx.stroke();

              ctx.fillStyle = "#FAF8F4";
              ctx.font = "700 56px Georgia, serif";
              ctx.fillText(st[0], bx + 28, by + 80);

              ctx.fillStyle = "#D6C4A1";
              ctx.font = "600 20px -apple-system, BlinkMacSystemFont, sans-serif";
              ctx.fillText(st[1], bx + 28, by + 120);
            });

            // Render QR SVG onto canvas
            var qrBlob = new Blob([cardData.qrSvg], { type: "image/svg+xml;charset=utf-8" });
            var qrUrl = URL.createObjectURL(qrBlob);
            var qrImg = new Image();
            qrImg.onload = function () {
              var qrBoxSize = 280;
              var qx = (W - qrBoxSize) / 2;
              var qy = pad + 700;
              roundRect(qx - 22, qy - 22, qrBoxSize + 44, qrBoxSize + 78, 28);
              ctx.fillStyle = "#FAF8F4";
              ctx.fill();
              ctx.drawImage(qrImg, qx, qy, qrBoxSize, qrBoxSize);
              ctx.fillStyle = "#1B3B2B";
              ctx.font = "600 24px ui-monospace, Menlo, monospace";
              ctx.textAlign = "center";
              ctx.fillText(cardData.code, W / 2, qy + qrBoxSize + 36);

              // Footer
              ctx.fillStyle = "rgba(250, 248, 244, 0.72)";
              ctx.font = "400 24px -apple-system, BlinkMacSystemFont, sans-serif";
              ctx.fillText((cardData.isEn ? "Member since " : "Đồng hành từ ") + cardData.joined + "  ·  holarise.org", W / 2, H - pad - 54);
              URL.revokeObjectURL(qrUrl);

              var a = document.createElement("a");
              a.download = "HolaRise-Passport-" + cardData.code + ".png";
              a.href = canvas.toDataURL("image/png");
              a.click();
              pngBtn.disabled = false;
              pngBtn.textContent = origText;
            };
            qrImg.onerror = function () {
              URL.revokeObjectURL(qrUrl);
              pngBtn.disabled = false;
              pngBtn.textContent = origText;
            };
            qrImg.src = qrUrl;
          } catch (_err) {
            pngBtn.disabled = false;
            pngBtn.textContent = origText;
          }
        });
      }
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
