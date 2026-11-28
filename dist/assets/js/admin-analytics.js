/**
 * HolaRise Analytics, Audience Intelligence, Core Web Vitals & SEO API Hub
 * Sole Super-Admin (203int64) Module — Zero External Dependencies, Vanilla ES6+.
 */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    days: 30,
    subtab: "audience",
    data: null,
    gsc: null,
    loading: false,
    bound: false,
  };

  const GOAL_LABELS = {
    open_rsvp: "Mở form giữ chỗ",
    submit_rsvp: "Gửi đơn đăng ký",
    join_zalo_group: "Bấm vào Nhóm Zalo",
    save_calendar: "Lưu lịch (.ics / Calendar)",
    share_page: "Chia sẻ / Sao chép link",
    open_member_pass: "Mở Thẻ Thành Viên",
    lang_switch: "Chuyển ngôn ngữ VN ↔ EN",
    outbound_partner: "Mở link đối tác",
  };

  const PRIORITY_META = {
    critical: { label: "Ưu tiên ngay", cls: "an-prio--critical" },
    high: { label: "Quan trọng", cls: "an-prio--high" },
    medium: { label: "Nên làm", cls: "an-prio--medium" },
    opportunity: { label: "Cơ hội mở rộng", cls: "an-prio--opportunity" },
  };

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString("vi-VN");
  }

  function fmtDwell(sec) {
    const s = Math.max(0, Math.round(Number(sec || 0)));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}p ${rem}s`;
  }

  function fmtRelTime(iso) {
    if (!iso) return "—";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return esc(iso);
    const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (diffSec < 60) return `${diffSec}s trước`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
    return new Date(t).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    return new Date(t).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function cwvStatus(metric, value) {
    if (!value || value <= 0) return { label: "Chưa có mẫu", cls: "an-badge--muted" };
    if (metric === "lcp") {
      if (value <= 2500) return { label: "Tốt", cls: "an-badge--good" };
      if (value <= 4000) return { label: "Cần cải thiện", cls: "an-badge--warn" };
      return { label: "Chậm", cls: "an-badge--bad" };
    }
    if (metric === "inp") {
      if (value <= 200) return { label: "Tốt", cls: "an-badge--good" };
      if (value <= 500) return { label: "Cần cải thiện", cls: "an-badge--warn" };
      return { label: "Chậm", cls: "an-badge--bad" };
    }
    if (metric === "cls") {
      if (value <= 0.1) return { label: "Tốt", cls: "an-badge--good" };
      if (value <= 0.25) return { label: "Cần cải thiện", cls: "an-badge--warn" };
      return { label: "Giật bố cục", cls: "an-badge--bad" };
    }
    if (metric === "ttfb") {
      if (value <= 800) return { label: "Nhanh", cls: "an-badge--good" };
      if (value <= 1800) return { label: "Trung bình", cls: "an-badge--warn" };
      return { label: "Chậm", cls: "an-badge--bad" };
    }
    return { label: "—", cls: "an-badge--muted" };
  }

  function scoreTone(score) {
    const n = Number(score || 0);
    if (n >= 90) return "good";
    if (n >= 50) return "warn";
    return "bad";
  }

  function showAlert(id, msg, type = "info") {
    const el = $(id);
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.className = `form-alert ${type === "error" ? "is-error" : type === "success" ? "is-success" : ""}`;
    el.textContent = msg;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers || {}),
      },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function switchSubtab(subtab) {
    state.subtab = subtab;
    $$("[data-an-subtab]").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-an-subtab") === subtab));
    });
    $$("[data-an-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-an-panel") !== subtab;
    });
  }

  function renderKpis(summary) {
    const onlineEl = $("#an-online-count");
    if (onlineEl) {
      onlineEl.textContent = `${fmtNum(summary.onlineNow)} đang xem (5p qua)`;
    }
    const container = $("#an-kpis-container");
    if (!container) return;

    const cards = [
      {
        label: "Lượt xem trang",
        value: fmtNum(summary.views),
        sub: `Hôm nay: ${fmtNum(summary.todayViews)} · ${summary.viewsPerVisit} trang/phiên`,
      },
      {
        label: "Người xem duy nhất",
        value: fmtNum(summary.uniques),
        sub: `${fmtNum(summary.sessions)} phiên · Tỷ lệ thoát ${summary.bounceRate}%`,
      },
      {
        label: "Thời gian ở lại TB",
        value: fmtDwell(summary.avgDwellSec),
        sub: `Đọc sâu trung bình ${summary.avgScrollPct}% trang`,
      },
      {
        label: "Nguồn từ Zalo",
        value: `${summary.zaloSharePct}%`,
        sub: `Bản tiếng Anh (/en/): ${summary.enSharePct}%`,
      },
      {
        label: "Phiên Thành viên",
        value: `${summary.memberSharePct}%`,
        sub: `${fmtNum(summary.memberViews)} lượt từ người đã kích hoạt thẻ`,
      },
      {
        label: "Nút CTA được bấm",
        value: fmtNum(summary.ctaClicks),
        sub: "Giữ chỗ, Nhóm Zalo, Lưu lịch, Chia sẻ",
      },
    ];

    container.innerHTML = cards
      .map(
        (c) => `
        <article class="an-kpi-card">
          <span class="an-kpi-label">${esc(c.label)}</span>
          <strong class="an-kpi-val">${esc(c.value)}</strong>
          <span class="an-kpi-sub">${esc(c.sub)}</span>
        </article>`
      )
      .join("");
  }

  function renderRecommendations(recs) {
    const el = $("#an-recommendations-container");
    if (!el) return;
    if (!recs || recs.length === 0) {
      el.innerHTML = `<p class="an-empty">Chưa có cảnh báo nào.</p>`;
      return;
    }
    el.innerHTML = recs
      .map((item) => {
        const meta = PRIORITY_META[item.priority] || PRIORITY_META.medium;
        return `
        <article class="an-rec-card">
          <div class="an-rec-top">
            <span class="an-prio ${meta.cls}">${esc(meta.label)}</span>
            <span class="an-rec-cat">${esc(item.category)}</span>
          </div>
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.detail)}</p>
          ${
            item.actionTab
              ? `<button class="btn btn--ghost btn--sm" type="button" data-an-jump="${esc(item.actionTab)}">${esc(item.actionLabel || "Xem chi tiết")} →</button>`
              : ""
          }
        </article>`;
      })
      .join("");
  }

  function renderTrendChart(series) {
    const el = $("#an-trend-chart");
    if (!el) return;
    if (!series || series.length === 0) {
      el.innerHTML = `<p class="an-empty">Chưa có dữ liệu lưu lượng trong khoảng thời gian này.</p>`;
      return;
    }
    const maxViews = Math.max(1, ...series.map((d) => d.views));
    const width = 760;
    const height = 190;
    const padL = 36;
    const padR = 14;
    const padT = 16;
    const padB = 30;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;
    const barW = Math.max(4, Math.floor(chartW / series.length) - 3);

    const bars = series
      .map((d, idx) => {
        const x = padL + (idx * chartW) / series.length + 1;
        const h = Math.round((d.views / maxViews) * chartH);
        const y = padT + chartH - h;
        const tip = `${d.date}: ${d.views} lượt xem · ${d.sessions} phiên · ở lại TB ${fmtDwell(d.avgDwellSec)}`;
        return `<g class="an-bar-g">
          <rect x="${x.toFixed(1)}" y="${y}" width="${barW}" height="${Math.max(2, h)}" rx="3" fill="${d.views > 0 ? "#145a40" : "#e4e7e4"}">
            <title>${esc(tip)}</title>
          </rect>
        </g>`;
      })
      .join("");

    const step = Math.max(1, Math.ceil(series.length / 6));
    const xLabels = series
      .map((d, idx) => {
        if (idx % step !== 0 && idx !== series.length - 1) return "";
        const x = padL + (idx * chartW) / series.length + barW / 2;
        return `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#66736d">${esc(d.date.slice(5))}</text>`;
      })
      .join("");

    el.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="an-chart-svg" role="img" aria-label="Biểu đồ lượt xem theo ngày">
        <line x1="${padL}" y1="${padT}" x2="${width - padR}" y2="${padT}" stroke="#eef1ee" stroke-dasharray="3 3" />
        <line x1="${padL}" y1="${padT + chartH / 2}" x2="${width - padR}" y2="${padT + chartH / 2}" stroke="#eef1ee" stroke-dasharray="3 3" />
        <line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="#cdd3ce" />
        <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" font-size="10" fill="#66736d">${fmtNum(maxViews)}</text>
        <text x="${padL - 6}" y="${padT + chartH / 2 + 4}" text-anchor="end" font-size="10" fill="#66736d">${fmtNum(Math.round(maxViews / 2))}</text>
        <text x="${padL - 6}" y="${padT + chartH + 3}" text-anchor="end" font-size="10" fill="#66736d">0</text>
        ${bars}
        ${xLabels}
      </svg>`;
  }

  function renderDimCard(title, subtitle, items, { emptyText = "Chưa có dữ liệu.", valueKey = "views", unitLabel = "lượt" } = {}) {
    const total = (items || []).reduce((a, b) => a + Number(b[valueKey] || 0), 0);
    const body =
      !items || items.length === 0
        ? `<p class="an-empty">${esc(emptyText)}</p>`
        : `<ul class="an-bar-list">
            ${items
              .slice(0, 8)
              .map((item) => {
                const val = Number(item[valueKey] || 0);
                const share = total > 0 ? Math.round((val / total) * 100) : 0;
                return `<li class="an-bar-row">
                  <div class="an-bar-fill" style="width:${Math.max(3, share)}%"></div>
                  <span class="an-bar-label" title="${esc(item.label)}">${esc(item.label)}</span>
                  <span class="an-bar-val">${fmtNum(val)} <small>${share}%</small></span>
                </li>`;
              })
              .join("")}
          </ul>`;
    return `<section class="panel-box an-dim-card">
      <div class="an-dim-head">
        <h3>${esc(title)}</h3>
        <span>${esc(subtitle)}</span>
      </div>
      ${body}
    </section>`;
  }

  function renderAudienceDims(audience) {
    const el = $("#an-dims-container");
    if (!el) return;
    const cards = [
      renderDimCard("Ai đang xem? (Phân loại khách)", "Thành viên đã kích hoạt thẻ vs Khách mới / Quay lại", audience.visitorTypes),
      renderDimCard("Nguồn truy cập & Dark Social", "Tách riêng Zalo/Messenger WebView, Google, AI Search", audience.sources),
      renderDimCard("Địa điểm (Thành phố / Tỉnh)", "Định vị ẩn danh từ Cloudflare Edge (0 lưu IP)", audience.cities, { emptyText: "Chưa có dữ liệu thành phố (chỉ có trên Cloudflare Production)." }),
      renderDimCard("Quốc gia & Nhà mạng / Mạng trường", "Kết hợp Quốc gia & ISP/Tổ chức mạng", [
        ...(audience.countries || []).slice(0, 4).map((c) => ({ ...c, label: `Quốc gia: ${c.label}` })),
        ...(audience.isps || []).slice(0, 4),
      ]),
      renderDimCard("Thiết bị & Trình duyệt", "Mobile / Desktop · Zalo In-App · Safari · Chrome", [
        ...(audience.devices || []).map((d) => ({ ...d, label: d.label === "mobile" ? "Điện thoại (Mobile)" : d.label === "tablet" ? "Máy tính bảng" : "Máy tính (Desktop)" })),
        ...(audience.browsers || []).slice(0, 5),
      ]),
      renderDimCard("Bot Tìm kiếm & AI Crawl (Đã tách riêng)", "Googlebot · Bingbot · GPTBot · PerplexityBot · ZaloPreview", audience.bots, { emptyText: "Chưa ghi nhận lượt bot crawl nào trong khoảng thời gian này." }),
    ];
    el.innerHTML = cards.join("");
  }

  function renderLiveVisits(visits) {
    const el = $("#an-live-visits-container");
    if (!el) return;
    if (!visits || visits.length === 0) {
      el.innerHTML = `<p class="an-empty">Chưa có lượt truy cập công khai nào được ghi nhận. Mở trang chủ hoặc bất kỳ bài viết nào để thấy dữ liệu chạy trực tiếp.</p>`;
      return;
    }
    el.innerHTML = `
      <table class="an-table">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Người xem</th>
            <th>Địa điểm &amp; Nhà mạng</th>
            <th>Nguồn vào</th>
            <th>Trang xem</th>
            <th>Ở lại / Cuộn</th>
            <th>Thiết bị</th>
          </tr>
        </thead>
        <tbody>
          ${visits
            .map((v) => {
              const typeBadge = v.isMember
                ? `<span class="an-badge an-badge--good">Thành viên</span>`
                : v.isReturning
                ? `<span class="an-badge an-badge--info">Quay lại</span>`
                : `<span class="an-badge an-badge--muted">Khách mới</span>`;
              const loc = [v.city, v.country].filter(Boolean).join(", ") || "—";
              const utm = v.utmCampaign ? ` · ${v.utmCampaign}` : "";
              const goalsHtml =
                v.goals && v.goals.length
                  ? `<div class="an-cell-sub">${v.goals.map((g) => esc(GOAL_LABELS[g] || g)).join(", ")}</div>`
                  : "";
              return `<tr>
                <td class="an-nowrap">${esc(fmtRelTime(v.visitedAt))}</td>
                <td>${typeBadge}</td>
                <td>
                  <strong>${esc(loc)}</strong>
                  ${v.asOrg ? `<div class="an-cell-sub">${esc(v.asOrg)}</div>` : ""}
                </td>
                <td>
                  <strong>${esc(v.sourceLabel)}</strong>
                  ${utm ? `<div class="an-cell-sub">${esc(utm)}</div>` : ""}
                </td>
                <td>
                  <a href="${esc(v.path)}" target="_blank" rel="noopener" class="an-path-link">${esc(v.path)}</a>
                  ${goalsHtml}
                </td>
                <td class="an-num an-nowrap">
                  ${fmtDwell(v.dwellSec)} · ${v.scrollPct}%
                  ${v.lcpMs > 0 ? `<div class="an-cell-sub">LCP ${(v.lcpMs / 1000).toFixed(2)}s</div>` : ""}
                </td>
                <td>
                  <span>${esc(v.browser)}</span>
                  <div class="an-cell-sub">${esc(v.os)} · ${esc(v.lang.toUpperCase())}</div>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  }

  function renderFunnel(funnel, topPages, goals) {
    const t = funnel?.totals || {};
    const kpiEl = $("#an-funnel-kpis");
    if (kpiEl) {
      kpiEl.innerHTML = [
        { label: "Đơn đăng ký hợp lệ", value: fmtNum(t.totalRegistrations), sub: `Mới: ${fmtNum(t.newCount)} · Đã liên hệ: ${fmtNum(t.contacted)} · Hủy: ${fmtNum(t.cancelled)}` },
        { label: "Check-in có mặt thật", value: fmtNum(t.attended), sub: "Xác nhận tại buổi gặp (attended)" },
        { label: "Tỷ lệ Show-up chung", value: `${t.overallShowupRate || 0}%`, sub: "Số người có mặt / Tổng đơn không hủy" },
        { label: "Thành viên đã kích hoạt Thẻ", value: fmtNum(t.activeMembers), sub: `Tổng tài khoản: ${fmtNum(t.totalMembers)}` },
      ]
        .map(
          (c) => `<article class="an-kpi-card">
            <span class="an-kpi-label">${esc(c.label)}</span>
            <strong class="an-kpi-val">${esc(c.value)}</strong>
            <span class="an-kpi-sub">${esc(c.sub)}</span>
          </article>`
        )
        .join("");
    }

    const pillarsEl = $("#an-pillars-container");
    if (pillarsEl) {
      pillarsEl.innerHTML = (funnel?.pillars || [])
        .map(
          (p) => `<article class="an-pillar-card">
            <h3>${esc(p.pillar)}</h3>
            <div class="an-pillar-metrics">
              <div><span>Sự kiện</span><strong>${fmtNum(p.events)}</strong></div>
              <div><span>Lượt xem</span><strong>${fmtNum(p.pageViews)}</strong></div>
              <div><span>Đăng ký</span><strong>${fmtNum(p.registered)}</strong></div>
              <div><span>Check-in</span><strong>${fmtNum(p.attended)} (${p.showupRate}%)</strong></div>
            </div>
          </article>`
        )
        .join("");
    }

    const evEl = $("#an-event-funnel-container");
    if (evEl) {
      const events = funnel?.events || [];
      if (events.length === 0) {
        evEl.innerHTML = `<p class="an-empty">Chưa có sự kiện nào trong cơ sở dữ liệu.</p>`;
      } else {
        evEl.innerHTML = `
          <table class="an-table">
            <thead>
              <tr>
                <th>Sự kiện</th>
                <th>Trụ cột</th>
                <th class="an-num">Xem trang</th>
                <th class="an-num">Đăng ký</th>
                <th class="an-num">Chuyển đổi</th>
                <th class="an-num">Check-in</th>
                <th class="an-num">Show-up</th>
              </tr>
            </thead>
            <tbody>
              ${events
                .map(
                  (ev) => `<tr>
                    <td>
                      <a href="${esc(ev.href)}" target="_blank" rel="noopener" class="an-path-link"><strong>${esc(ev.title)}</strong></a>
                      <div class="an-cell-sub">${esc(ev.dateDisplay || ev.date || "—")} · ${ev.kind === "upcoming" ? "Sắp diễn ra" : "Đã tổ chức"}</div>
                    </td>
                    <td><span class="an-badge an-badge--muted">${esc(ev.pillar)}</span></td>
                    <td class="an-num">${fmtNum(ev.pageViews)}</td>
                    <td class="an-num"><strong>${fmtNum(ev.registered)}</strong></td>
                    <td class="an-num">${ev.pageViews > 0 ? `${ev.conversionRate}%` : "—"}</td>
                    <td class="an-num"><strong>${fmtNum(ev.attended)}</strong></td>
                    <td class="an-num">
                      <span class="an-badge ${ev.showupRate >= 65 ? "an-badge--good" : ev.showupRate >= 40 ? "an-badge--warn" : "an-badge--muted"}">${ev.registered > 0 ? `${ev.showupRate}%` : "—"}</span>
                    </td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>`;
      }
    }

    const pagesEl = $("#an-top-pages-container");
    if (pagesEl) {
      if (!topPages || topPages.length === 0) {
        pagesEl.innerHTML = `<p class="an-empty">Chưa có dữ liệu trang trong khoảng thời gian này.</p>`;
      } else {
        pagesEl.innerHTML = `
          <table class="an-table">
            <thead>
              <tr>
                <th>Đường dẫn</th>
                <th class="an-num">Xem</th>
                <th class="an-num">Ở lại</th>
                <th class="an-num">Cuộn</th>
                <th class="an-num">Thoát</th>
                <th class="an-num">LCP</th>
              </tr>
            </thead>
            <tbody>
              ${topPages
                .map(
                  (p) => `<tr>
                    <td><a href="${esc(p.path)}" target="_blank" rel="noopener" class="an-path-link">${esc(p.path)}</a></td>
                    <td class="an-num"><strong>${fmtNum(p.views)}</strong></td>
                    <td class="an-num">${fmtDwell(p.avgDwellSec)}</td>
                    <td class="an-num">${p.avgScrollPct}%</td>
                    <td class="an-num">${p.bounceRate}%</td>
                    <td class="an-num">${p.avgLcpMs > 0 ? `${(p.avgLcpMs / 1000).toFixed(2)}s` : "—"}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>`;
      }
    }

    const goalsEl = $("#an-goals-container");
    if (goalsEl) {
      const mapped = (goals || []).map((g) => ({ ...g, label: GOAL_LABELS[g.label] || g.label }));
      const total = mapped.reduce((a, b) => a + b.views, 0);
      if (mapped.length === 0) {
        goalsEl.innerHTML = `<p class="an-empty">Chưa ghi nhận lượt bấm CTA nào.</p>`;
      } else {
        goalsEl.innerHTML = `<ul class="an-bar-list">
          ${mapped
            .map((g) => {
              const share = total > 0 ? Math.round((g.views / total) * 100) : 0;
              return `<li class="an-bar-row">
                <div class="an-bar-fill" style="width:${Math.max(4, share)}%"></div>
                <span class="an-bar-label">${esc(g.label)}</span>
                <span class="an-bar-val">${fmtNum(g.views)} <small>${share}%</small></span>
              </li>`;
            })
            .join("")}
        </ul>`;
      }
    }
  }

  function renderPsiResult(snapshot, opportunities = []) {
    const el = $("#an-psi-latest-result");
    if (!el || !snapshot) return;
    const scores = [
      { label: "Hiệu năng (Performance)", val: snapshot.perfScore },
      { label: "SEO", val: snapshot.seoScore },
      { label: "Tiếp cận (Accessibility)", val: snapshot.a11yScore },
      { label: "Chuẩn mực (Best Practices)", val: snapshot.bpScore },
    ];
    el.innerHTML = `
      <div class="an-psi-card">
        <div class="an-psi-meta">
          <strong>${esc(snapshot.url)}</strong>
          <span>${snapshot.strategy === "desktop" ? "Desktop" : "Mobile"} · Quét lúc ${esc(fmtDateTime(snapshot.createdAt))}</span>
        </div>
        <div class="an-score-grid">
          ${scores
            .map(
              (s) => `<div class="an-score-ring an-score--${scoreTone(s.val)}">
                <strong>${s.val}</strong>
                <span>${esc(s.label)}</span>
              </div>`
            )
            .join("")}
        </div>
        <div class="an-psi-metrics-strip">
          <span><strong>FCP:</strong> ${(snapshot.fcpMs / 1000).toFixed(2)}s</span>
          <span><strong>LCP:</strong> ${(snapshot.lcpMs / 1000).toFixed(2)}s</span>
          <span><strong>TBT:</strong> ${fmtNum(snapshot.tbtMs)}ms</span>
          <span><strong>CLS:</strong> ${Number(snapshot.cls || 0).toFixed(3)}</span>
          <span><strong>TTFB:</strong> ${fmtNum(snapshot.ttfbMs)}ms</span>
        </div>
        ${
          opportunities.length
            ? `<div class="an-psi-opps">
                <h4>Cơ hội tăng tốc lớn nhất từ Lighthouse:</h4>
                <ul>${opportunities
                  .map((o) => `<li><strong>${esc(o.title)}</strong> — tiết kiệm khoảng ${fmtNum(o.savingsMs)}ms ${o.displayValue ? `(${esc(o.displayValue)})` : ""}</li>`)
                  .join("")}</ul>
              </div>`
            : ""
        }
      </div>`;
  }

  function renderSpeed(vitals) {
    const kpiEl = $("#an-cwv-kpis");
    if (kpiEl) {
      const lcpS = cwvStatus("lcp", vitals.avgLcpMs);
      const inpS = cwvStatus("inp", vitals.avgInpMs);
      const clsS = cwvStatus("cls", vitals.avgCls);
      const ttfbS = cwvStatus("ttfb", vitals.avgTtfbMs);
      const zaloS = cwvStatus("lcp", vitals.zaloAvgLcpMs);
      const cards = [
        { label: "LCP thực địa (≤ 2.5s)", val: vitals.avgLcpMs > 0 ? `${(vitals.avgLcpMs / 1000).toFixed(2)}s` : "—", badge: lcpS, sub: `${fmtNum(vitals.sampleCount)} mẫu người dùng thật` },
        { label: "INP phản hồi (≤ 200ms)", val: vitals.avgInpMs > 0 ? `${fmtNum(vitals.avgInpMs)}ms` : "—", badge: inpS, sub: "Độ trễ khi người dùng chạm/bấm" },
        { label: "CLS ổn định (≤ 0.10)", val: vitals.avgCls > 0 ? vitals.avgCls.toFixed(3) : "—", badge: clsS, sub: "Độ nhảy bố cục lúc tải trang" },
        { label: "TTFB máy chủ (≤ 800ms)", val: vitals.avgTtfbMs > 0 ? `${fmtNum(vitals.avgTtfbMs)}ms` : "—", badge: ttfbS, sub: "Cloudflare Pages Edge response" },
        { label: "LCP trong Zalo WebView", val: vitals.zaloAvgLcpMs > 0 ? `${(vitals.zaloAvgLcpMs / 1000).toFixed(2)}s` : "—", badge: zaloS, sub: `${fmtNum(vitals.zaloSampleCount)} phiên mở từ Zalo` },
      ];
      kpiEl.innerHTML = cards
        .map(
          (c) => `<article class="an-kpi-card">
            <div class="an-kpi-head-row">
              <span class="an-kpi-label">${esc(c.label)}</span>
              <span class="an-badge ${c.badge.cls}">${esc(c.badge.label)}</span>
            </div>
            <strong class="an-kpi-val">${esc(c.val)}</strong>
            <span class="an-kpi-sub">${esc(c.sub)}</span>
          </article>`
        )
        .join("");
    }

    if (vitals.latestPsi?.mobile || vitals.latestPsi?.desktop) {
      renderPsiResult(vitals.latestPsi.mobile || vitals.latestPsi.desktop, []);
    } else if ($("#an-psi-latest-result")) {
      $("#an-psi-latest-result").innerHTML = `<p class="an-empty">Chưa có bản quét PageSpeed nào. Bấm <strong>Quét tốc độ ngay</strong> để lưu mốc điểm đầu tiên.</p>`;
    }

    const slowEl = $("#an-slow-pages-container");
    if (slowEl) {
      const slow = vitals.slowestPages || [];
      if (slow.length === 0) {
        slowEl.innerHTML = `<p class="an-empty">Chưa có dữ liệu tốc độ thực địa theo trang.</p>`;
      } else {
        slowEl.innerHTML = `
          <table class="an-table">
            <thead>
              <tr><th>Đường dẫn</th><th class="an-num">LCP</th><th class="an-num">TTFB</th><th class="an-num">CLS</th></tr>
            </thead>
            <tbody>
              ${slow
                .map(
                  (p) => `<tr>
                    <td><a href="${esc(p.path)}" target="_blank" rel="noopener" class="an-path-link">${esc(p.path)}</a></td>
                    <td class="an-num">${p.avgLcpMs > 0 ? `${(p.avgLcpMs / 1000).toFixed(2)}s` : "—"}</td>
                    <td class="an-num">${p.avgTtfbMs > 0 ? `${fmtNum(p.avgTtfbMs)}ms` : "—"}</td>
                    <td class="an-num">${p.avgCls.toFixed(3)}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>`;
      }
    }

    const histEl = $("#an-psi-history-container");
    if (histEl) {
      const hist = vitals.psiHistory || [];
      if (hist.length === 0) {
        histEl.innerHTML = `<p class="an-empty">Chưa có lịch sử quét PageSpeed.</p>`;
      } else {
        histEl.innerHTML = `
          <table class="an-table">
            <thead>
              <tr><th>Trang</th><th>Thiết bị</th><th class="an-num">Perf</th><th class="an-num">SEO</th><th class="an-num">LCP</th><th>Lúc</th></tr>
            </thead>
            <tbody>
              ${hist
                .map(
                  (h) => `<tr>
                    <td><span class="an-path-link">${esc(h.url.replace("https://holarise.org", "") || "/")}</span></td>
                    <td>${h.strategy === "desktop" ? "Desktop" : "Mobile"}</td>
                    <td class="an-num"><span class="an-badge an-badge--${scoreTone(h.perfScore)}">${h.perfScore}</span></td>
                    <td class="an-num"><span class="an-badge an-badge--${scoreTone(h.seoScore)}">${h.seoScore}</span></td>
                    <td class="an-num">${(h.lcpMs / 1000).toFixed(2)}s</td>
                    <td class="an-nowrap">${esc(fmtRelTime(h.createdAt))}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>`;
      }
    }
  }

  function renderSeoAndConfig(seoAudit, cfg) {
    const healthEl = $("#an-seo-health-container");
    if (healthEl) {
      const endpointsHtml = (seoAudit.endpoints || [])
        .map(
          (ep) => `<a class="an-endpoint-chip" href="${esc(ep.url)}" target="_blank" rel="noopener">${esc(ep.label)} ↗</a>`
        )
        .join("");

      const issuesHtml =
        seoAudit.issues && seoAudit.issues.length > 0
          ? `<div class="an-issue-list">
              <h4>Các điểm SEO cần hoàn thiện (${seoAudit.issues.length}):</h4>
              <ul>${seoAudit.issues
                .map((i) => `<li><strong>${esc(i.title)}</strong> (<code>${esc(i.path)}</code>): ${esc(i.issue)}</li>`)
                .join("")}</ul>
            </div>`
          : `<p class="an-ok-note">Toàn bộ bài viết và sự kiện công khai đều đã có mô tả và alt ảnh đầy đủ.</p>`;

      healthEl.innerHTML = `
        <div class="an-seo-stats">
          <div><span>URL trong Sitemap</span><strong>${fmtNum(seoAudit.sitemapUrlCount)}</strong></div>
          <div><span>Bài Hành trình</span><strong>${fmtNum(seoAudit.publishedPosts)}</strong></div>
          <div><span>Sự kiện công khai</span><strong>${fmtNum(seoAudit.publishedEvents)}</strong></div>
          <div><span>Ping IndexNow gần nhất</span><strong>${cfg.last_indexnow_ping_at ? esc(fmtRelTime(cfg.last_indexnow_ping_at)) : "Chưa ping"}</strong></div>
        </div>
        ${cfg.last_indexnow_status ? `<p class="an-cell-sub" style="margin:8px 0 12px;">Kết quả IndexNow: <strong>${esc(cfg.last_indexnow_status)}</strong> (${fmtNum(cfg.last_indexnow_count)} URL)</p>` : ""}
        <div class="an-endpoints-row">${endpointsHtml}</div>
        ${issuesHtml}
      `;
    }

    // Hydrate config form
    if ($("#an-cfg-telemetry")) $("#an-cfg-telemetry").checked = cfg.telemetry_enabled !== false;
    if ($("#an-cfg-gverify")) $("#an-cfg-gverify").value = cfg.google_site_verification || "";
    if ($("#an-cfg-bverify")) $("#an-cfg-bverify").value = cfg.bing_site_verification || "";
    if ($("#an-cfg-indexnow")) $("#an-cfg-indexnow").value = cfg.indexnow_key || "";
    if ($("#an-cfg-cf-token")) $("#an-cfg-cf-token").value = cfg.cf_web_analytics_token || "";
    if ($("#an-cfg-gsc-site")) $("#an-cfg-gsc-site").value = cfg.gsc_site_url || "sc-domain:holarise.org";
    if ($("#an-cfg-psi-key")) $("#an-cfg-psi-key").value = "";
    if ($("#an-cfg-gsc-json")) $("#an-cfg-gsc-json").value = "";
    if ($("#an-cfg-clear-psi")) $("#an-cfg-clear-psi").checked = false;
    if ($("#an-cfg-clear-gsc")) $("#an-cfg-clear-gsc").checked = false;

    if ($("#an-cfg-psi-hint")) {
      $("#an-cfg-psi-hint").textContent = cfg.has_pagespeed_key
        ? `Trạng thái: Đã lưu khóa PageSpeed riêng (${cfg.pagespeed_key_hint}). Để trống nếu giữ nguyên.`
        : "Trạng thái: Chưa gắn khóa riêng (vẫn quét được bằng hạn mức công khai).";
    }
    if ($("#an-cfg-gsc-hint")) {
      $("#an-cfg-gsc-hint").textContent = cfg.has_gsc_credentials
        ? `Trạng thái: Đã kết nối Service Account (${cfg.gsc_client_email}). Để trống nếu giữ nguyên.`
        : "Trạng thái: Chưa kết nối GSC API. Tạo Service Account trên Google Cloud → bật Search Console API → thêm email vào GSC (quyền Restricted) → dán nội dung JSON vào đây.";
    }

    renderGscPlaceholder(cfg);
  }

  function renderGscPlaceholder(cfg) {
    const el = $("#an-gsc-container");
    if (!el || state.gsc) return;
    if (cfg.has_gsc_credentials) {
      el.innerHTML = `<p class="an-empty">Đã kết nối <strong>${esc(cfg.gsc_client_email)}</strong> cho <code>${esc(cfg.gsc_site_url)}</code>. Bấm <strong>Tải dữ liệu GSC</strong> để kéo từ khóa &amp; lượt hiển thị 28 ngày mới nhất.</p>`;
    } else {
      el.innerHTML = `
        <div class="an-gsc-guide">
          <p>Chưa cắm Service Account JSON. Bạn có thể mở nhanh Google Search Console bên ngoài hoặc dán khóa Service Account ở form bên dưới để xem từ khóa ngay trong tab này.</p>
          <div class="btn-row" style="margin-top:10px;">
            <a class="btn btn--outline btn--sm" href="https://search.google.com/search-console" target="_blank" rel="noopener">Mở Google Search Console ↗</a>
            <a class="btn btn--outline btn--sm" href="https://www.bing.com/webmasters" target="_blank" rel="noopener">Mở Bing Webmaster ↗</a>
            <a class="btn btn--outline btn--sm" href="https://dash.cloudflare.com" target="_blank" rel="noopener">Mở Cloudflare Analytics ↗</a>
          </div>
        </div>`;
    }
  }

  function renderGscData(gsc) {
    const el = $("#an-gsc-container");
    if (!el) return;
    if (!gsc || !gsc.configured) {
      renderGscPlaceholder(state.data?.config || {});
      return;
    }
    const t = gsc.totals || {};
    const qRows = (gsc.queries || [])
      .map(
        (q) => `<tr>
          <td><strong>${esc(q.query)}</strong></td>
          <td class="an-num">${fmtNum(q.clicks)}</td>
          <td class="an-num">${fmtNum(q.impressions)}</td>
          <td class="an-num">${q.ctr}%</td>
          <td class="an-num">${q.position}</td>
        </tr>`
      )
      .join("");

    el.innerHTML = `
      <div class="an-seo-stats">
        <div><span>Clicks (28 ngày)</span><strong>${fmtNum(t.clicks)}</strong></div>
        <div><span>Impressions</span><strong>${fmtNum(t.impressions)}</strong></div>
        <div><span>CTR trung bình</span><strong>${t.ctr || 0}%</strong></div>
        <div><span>Vị trí TB</span><strong>${t.position || "—"}</strong></div>
      </div>
      ${
        qRows
          ? `<div class="table-wrap" style="margin-top:12px;">
              <table class="an-table">
                <thead><tr><th>Từ khóa tìm kiếm</th><th class="an-num">Clicks</th><th class="an-num">Hiển thị</th><th class="an-num">CTR</th><th class="an-num">Vị trí</th></tr></thead>
                <tbody>${qRows}</tbody>
              </table>
            </div>`
          : `<p class="an-empty" style="margin-top:12px;">Google Search Console chưa ghi nhận từ khóa nào cho ${esc(gsc.siteUrl)} trong 28 ngày qua.</p>`
      }`;
  }

  async function loadAnalytics(force = false) {
    if (state.loading && !force) return;
    state.loading = true;
    showAlert("#an-status-banner", "");
    try {
      const data = await api(`/api/admin/analytics?days=${state.days}`);
      state.data = data;
      renderKpis(data.summary);
      renderRecommendations(data.recommendations);
      renderTrendChart(data.dailySeries);
      renderAudienceDims(data.audience);
      renderLiveVisits(data.liveVisits);
      renderFunnel(data.funnel, data.topPages, data.audience?.goals || []);
      renderSpeed(data.vitals);
      renderSeoAndConfig(data.seoAudit, data.config);
    } catch (err) {
      showAlert("#an-status-banner", `Không tải được dữ liệu Phân tích & SEO: ${err.message}`, "error");
    } finally {
      state.loading = false;
    }
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;

    // Range pills (7 / 30 / 90 days)
    $$("[data-an-days]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number(btn.getAttribute("data-an-days") || 30);
        if (d === state.days) return;
        state.days = d;
        $$("[data-an-days]").forEach((b) => b.classList.toggle("is-active", Number(b.getAttribute("data-an-days")) === d));
        loadAnalytics(true);
      });
    });

    // Sub-tabs
    $$("[data-an-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => switchSubtab(btn.getAttribute("data-an-subtab")));
    });

    // Quick jump buttons inside recommendations
    $("#panel-analytics")?.addEventListener("click", (e) => {
      const jump = e.target.closest("[data-an-jump]");
      if (jump) {
        switchSubtab(jump.getAttribute("data-an-jump"));
      }
    });

    $("#btn-refresh-analytics")?.addEventListener("click", () => loadAnalytics(true));

    // Generate random 32-char IndexNow key
    $("#btn-gen-indexnow")?.addEventListener("click", () => {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      if ($("#an-cfg-indexnow")) $("#an-cfg-indexnow").value = hex;
    });

    // Save unified SEO & API Config
    $("#an-config-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#btn-save-an-config");
      if (btn) btn.disabled = true;
      showAlert("#an-config-alert", "Đang lưu cấu hình SEO & API...", "info");
      try {
        const payload = {
          telemetry_enabled: Boolean($("#an-cfg-telemetry")?.checked),
          google_site_verification: $("#an-cfg-gverify")?.value.trim() || "",
          bing_site_verification: $("#an-cfg-bverify")?.value.trim() || "",
          indexnow_key: $("#an-cfg-indexnow")?.value.trim() || "",
          cf_web_analytics_token: $("#an-cfg-cf-token")?.value.trim() || "",
          gsc_site_url: $("#an-cfg-gsc-site")?.value.trim() || "sc-domain:holarise.org",
          clear_pagespeed_key: Boolean($("#an-cfg-clear-psi")?.checked),
          clear_gsc_credentials: Boolean($("#an-cfg-clear-gsc")?.checked),
        };
        const psiKey = $("#an-cfg-psi-key")?.value.trim();
        if (psiKey) payload.pagespeed_api_key = psiKey;
        const gscJson = $("#an-cfg-gsc-json")?.value.trim();
        if (gscJson) payload.gsc_service_account_json = gscJson;

        const res = await api("/api/admin/analytics/config", {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        state.gsc = null;
        if (state.data) {
          state.data.config = res.config;
          renderSeoAndConfig(state.data.seoAudit, res.config);
        }
        showAlert("#an-config-alert", "Đã lưu cấu hình SEO & API thành công. Các thẻ meta xác minh có hiệu lực tức thì trên Edge.", "success");
      } catch (err) {
        showAlert("#an-config-alert", err.message, "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // 1-Click IndexNow Ping
    $("#btn-ping-indexnow")?.addEventListener("click", async () => {
      const btn = $("#btn-ping-indexnow");
      if (btn) btn.disabled = true;
      showAlert("#an-indexnow-alert", "Đang đẩy toàn bộ URL Sitemap lên IndexNow...", "info");
      try {
        const res = await api("/api/admin/analytics/indexnow", { method: "POST" });
        showAlert("#an-indexnow-alert", `Đã gửi ${res.submittedCount} URL lên IndexNow (${res.status}).`, "success");
        await loadAnalytics(true);
      } catch (err) {
        showAlert("#an-indexnow-alert", err.message, "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // Run Google PageSpeed Insights v5
    $("#an-psi-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#btn-run-psi");
      const urlVal = $("#an-psi-url")?.value.trim() || "/";
      const strategy = $("#an-psi-strategy")?.value || "mobile";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Đang đo tốc độ (10–25s)...";
      }
      showAlert("#an-psi-alert", `Đang gọi Google PageSpeed Insights (${strategy}) cho ${urlVal}...`, "info");
      try {
        const res = await api("/api/admin/analytics/pagespeed", {
          method: "POST",
          body: JSON.stringify({ url: urlVal, strategy }),
        });
        renderPsiResult(res.snapshot, res.opportunities || []);
        showAlert("#an-psi-alert", `Hoàn tất đo tốc độ: Performance ${res.snapshot.perfScore}/100 · SEO ${res.snapshot.seoScore}/100.`, "success");
        await loadAnalytics(true);
      } catch (err) {
        showAlert("#an-psi-alert", err.message, "error");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Quét tốc độ ngay";
        }
      }
    });

    // Load Google Search Console 28-day report
    $("#btn-load-gsc")?.addEventListener("click", async () => {
      const btn = $("#btn-load-gsc");
      if (btn) btn.disabled = true;
      showAlert("#an-gsc-alert", "Đang đồng bộ dữ liệu từ Google Search Console API...", "info");
      try {
        const res = await api("/api/admin/analytics/gsc?days=28");
        state.gsc = res;
        renderGscData(res);
        showAlert(
          "#an-gsc-alert",
          res.configured
            ? `Đã tải dữ liệu Search Console (${res.startDate} → ${res.endDate}).`
            : res.message || "Chưa cấu hình Service Account.",
          res.configured ? "success" : "info"
        );
      } catch (err) {
        showAlert("#an-gsc-alert", err.message, "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  window.__holariseAnalytics = {
    open() {
      bindOnce();
      loadAnalytics(true);
    },
  };
})();
