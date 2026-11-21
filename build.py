#!/usr/bin/env python3
"""
Static Site Generator (Zero external dependencies - Python 3 stdlib only)
v6 Visual-First Mobile & Smart Compact HR Logo Edition
"""

import argparse
import datetime
import hashlib
import html
import json
import re
import shutil
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = ROOT / "templates"
ASSETS_DIR = ROOT / "assets"
DIST_DIR = ROOT / "dist"
MAX_PRECACHE_BYTES = 4 * 1024 * 1024  # 4 MB hard cap for initial PWA precache
CURRENT_BUILD_HASH = "dev"


def compute_build_hash() -> str:
    """Deterministic SHA-256 short hash of site inputs for cache-busting and SW versioning."""
    h = hashlib.sha256()
    inputs = []
    for directory in (DATA_DIR, TEMPLATES_DIR, ASSETS_DIR):
        for p in sorted(directory.rglob("*")):
            if p.is_file() and p.name != ".DS_Store":
                inputs.append(p)
    inputs.append(Path(__file__).resolve())
    for p in inputs:
        rel = p.relative_to(ROOT).as_posix()
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()[:10]


def read_png_dimensions(path: Path):
    data = path.read_bytes()
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", data[16:24])
    return (w, h)


def read_jpeg_dimensions(path: Path):
    data = path.read_bytes()
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    n = len(data)
    while i < n:
        while i < n and data[i] == 0xFF:
            i += 1
        if i >= n:
            break
        marker = data[i]
        i += 1
        if marker in (0xD8, 0xD9, 0x01) or (0xD0 <= marker <= 0xD7):
            continue
        if i + 2 > n:
            break
        seg_len = struct.unpack(">H", data[i : i + 2])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if i + 7 <= n:
                h, w = struct.unpack(">HH", data[i + 3 : i + 7])
                return (w, h)
            break
        i += seg_len
    return None


def load_json(name: str):
    with (DATA_DIR / name).open("r", encoding="utf-8") as f:
        return json.load(f)


def load_template(name: str) -> str:
    return (TEMPLATES_DIR / name).read_text(encoding="utf-8")


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def render_template(template: str, mapping: dict) -> str:
    result = template
    for key, val in mapping.items():
        result = result.replace("{{" + key + "}}", str(val))
    return result


def abs_url(site_url: str, path: str) -> str:
    base = site_url.rstrip("/")
    if not path.startswith("/"):
        path = "/" + path
    return base + path


def json_ld_script(data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    return f'<script type="application/ld+json">\n{payload}\n</script>'


def build_nav_links(active_path: str) -> str:
    items = [
        ("/", "Trang chủ"),
        ("/gioi-thieu/", "Giới thiệu"),
        ("/hoat-dong/", "Hoạt động"),
        ("/workshop/", "Workshop"),
        ("/tin-tuc/", "Tin tức"),
        ("/tham-gia/", "Tham gia"),
    ]
    links = []
    for href, label in items:
        is_active = active_path == href or (href != "/" and active_path.startswith(href))
        cls = "nav-link is-active" if is_active else "nav-link"
        aria = ' aria-current="page"' if is_active else ""
        links.append(f'<a class="{cls}" href="{href}"{aria}>{esc(label)}</a>')
    return "\n        ".join(links)


def build_mobile_nav_links(active_path: str) -> str:
    items = [
        ("/", "01", "Trang chủ"),
        ("/gioi-thieu/", "02", "Giới thiệu & Sứ mệnh"),
        ("/hoat-dong/", "03", "Hoạt động & Chiến dịch"),
        ("/workshop/", "04", "Lịch Workshop"),
        ("/tin-tuc/", "05", "Nhật ký hoạt động"),
        ("/tham-gia/", "06", "Tham gia cùng HolaRise"),
    ]
    links = []
    for idx, (href, num, label) in enumerate(items):
        is_active = active_path == href or (href != "/" and active_path.startswith(href))
        cls = "drawer-link is-active" if is_active else "drawer-link"
        aria = ' aria-current="page"' if is_active else ""
        links.append(
            f'<a class="{cls}" href="{href}" style="--i: {idx};"{aria}>'
            f'<span class="drawer-link-num">{num}</span>'
            f'<span class="drawer-link-label">{esc(label)}</span>'
            f'<span class="drawer-link-arrow" aria-hidden="true">→</span>'
            f"</a>"
        )
    return "\n        ".join(links)


def build_pwa_tabbar_links(active_path: str) -> str:
    items = [
        (
            "/",
            "Trang chủ",
            '<path d="M3 10.5 12 3l9 7.5"></path><path d="M5.5 9.5V20h13V9.5"></path>',
        ),
        (
            "/hoat-dong/",
            "Hoạt động",
            '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path>',
        ),
        (
            "/workshop/",
            "Workshop",
            '<rect x="3" y="5" width="18" height="16" rx="2.5"></rect><path d="M16 3v4M8 3v4M3 10h18"></path>',
        ),
        (
            "/tin-tuc/",
            "Tin tức",
            '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5Z"></path><path d="M8 7h8M8 11h8M8 15h5"></path>',
        ),
        (
            "/tham-gia/",
            "Tham gia",
            '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>',
        ),
    ]
    links = []
    for href, label, svg_body in items:
        is_active = active_path == href or (href != "/" and active_path.startswith(href))
        cls = "pwa-tab is-active" if is_active else "pwa-tab"
        aria = ' aria-current="page"' if is_active else ""
        links.append(
            f'<a class="{cls}" href="{href}"{aria}>'
            f'<svg class="pwa-tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{svg_body}</svg>'
            f'<span class="pwa-tab-label">{esc(label)}</span>'
            f"</a>"
        )
    return "\n      ".join(links)


def render_hero_headline_lines(headline: str) -> str:
    parts = [part.strip() for part in headline.split(",") if part.strip()]
    if len(parts) >= 2:
        lines = [parts[0] + ",", ", ".join(parts[1:])]
    else:
        lines = [headline]
    rendered = []
    for idx, line in enumerate(lines):
        safe = esc(line)
        if "Hòa Lạc" in line:
            safe = safe.replace("Hòa Lạc", '<span class="accent-word">Hòa Lạc</span>', 1)
        rendered.append(f'<span class="split-line-mask"><span class="split-line-inner">{safe}</span></span>')
    return "\n          ".join(rendered)


def render_hero_quick_pills(pills: list) -> str:
    if not pills:
        return ""
    rendered = []
    for p in pills:
        if isinstance(p, dict):
            label = esc(p.get("label", ""))
            href = esc(p.get("href", ""))
            if href:
                rendered.append(f'<a class="quick-pill" href="{href}">{label}</a>')
            else:
                rendered.append(f'<span class="quick-pill">{label}</span>')
        else:
            rendered.append(f'<span class="quick-pill">{esc(p)}</span>')
    return "\n          ".join(rendered)


def render_hero_upcoming_bar(upcoming: list) -> str:
    if not upcoming:
        return ""
    ws = upcoming[0]
    return f"""<div class="upcoming-bar" aria-label="Sự kiện sắp diễn ra">
  <div class="container upcoming-bar-inner">
    <div class="upcoming-bar-info">
      <span class="upcoming-dot" aria-hidden="true"></span>
      <span class="upcoming-label">Sắp diễn ra</span>
      <span class="upcoming-title">{esc(ws['title'])}</span>
      <span class="upcoming-date">· {esc(ws['dateDisplay'])} ({esc(ws['time'])}) · {esc(ws['fee'])}</span>
    </div>
    <button class="btn btn--outline btn--sm" type="button" data-register-event="{esc(ws['title'])}" data-event-id="{esc(ws['id'])}">Giữ chỗ miễn phí</button>
  </div>
</div>"""


def render_impact_metrics(metrics: list) -> str:
    blocks = []
    for item in metrics:
        formatted = f"{int(item['value']):,}".replace(",", ".")
        blocks.append(
            f"""<div class="metric-item" data-stagger-item>
        <div class="metric-value"><span data-counter="{int(item['value'])}">{formatted}</span><span class="accent">{esc(item['suffix'])}</span></div>
        <div class="metric-label">{esc(item['label'])}</div>
        <div class="metric-detail">{esc(item['detail'])}</div>
      </div>"""
        )
    return "\n      ".join(blocks)


def render_story_stage(pillars: list) -> str:
    tabs = []
    panels = []
    slides = []
    odometer_digits = []
    for idx, p in enumerate(pillars):
        num = f"0{idx + 1}"
        odometer_digits.append(f"<span>{num}</span>")
        active_cls = " is-active" if idx == 0 else ""
        selected = "true" if idx == 0 else "false"
        tab_label = p.get("shortTab", f'{num} · {p["badge"]}')
        tabs.append(
            f'<button class="story-tab{active_cls}" type="button" role="tab" aria-selected="{selected}" data-story-tab="{idx}">{esc(tab_label)}</button>'
        )

        chips_html = "".join(f'<span class="visual-chip">{esc(h)}</span>' for h in p["highlights"])
        metric_badge = p.get("metricBadge", "")
        metric_html = f'<span class="story-metric-pill">{esc(metric_badge)}</span>' if metric_badge else ""
        cta_href = "/workshop/" if p["id"] == "workshop" else f'/hoat-dong/#{esc(p["id"])}'
        cta_label = "Xem lịch Workshop" if p["id"] == "workshop" else "Xem hoạt động"

        panels.append(
            f"""<article class="story-panel{active_cls}" data-story-panel="{idx}">
          <div class="story-panel-index">{num} / 0{len(pillars)} — {esc(p['badge'])}</div>
          <h3>{esc(p['title'])}</h3>
          <p class="story-panel-summary">{esc(p['summary'])}</p>
          <div class="visual-chip-row" aria-label="Hoạt động tiêu biểu">{chips_html}</div>
          <div class="story-panel-footer">
            {metric_html}
            <a class="arrow-link" href="{cta_href}"><span>{cta_label}</span><span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span></a>
          </div>
        </article>"""
        )

        priority_attr = ' fetchpriority="low" loading="lazy"' if idx > 0 else ' loading="lazy"'
        slides.append(
            f"""<div class="story-slide{active_cls}" data-story-slide="{idx}">
          <img src="{esc(p['image'])}" alt="{esc(p['imageAlt'])}" width="960" height="720"{priority_attr}>
          <div class="story-slide-scrim" aria-hidden="true"></div>
          <span class="story-slide-badge">{esc(metric_badge)}</span>
        </div>"""
        )

    return f"""<div class="story-stage" data-story-stage>
      <div class="story-controls-col">
        <div class="story-nav" role="tablist" aria-label="Chọn chương trình trọng tâm" data-story-tablist>
          <span class="story-nav-glider" data-story-glider aria-hidden="true"></span>
          {" ".join(tabs)}
        </div>
        <div class="story-media-frame story-media-frame--mobile" data-story-swipe aria-label="Vuốt ngang để đổi chương trình">
          {" ".join(slides)}
        </div>
        <div class="story-panels">
          {" ".join(panels)}
        </div>
      </div>

      <div class="story-media-frame story-media-frame--desktop">
        {" ".join(slides)}
      </div>
    </div>"""


def render_pillars(pillars: list, detailed: bool = False) -> str:
    cards = []
    for p in pillars:
        chips_html = "".join(f'<span class="visual-chip">{esc(h)}</span>' for h in p["highlights"])
        metric_badge = p.get("metricBadge", " · ".join(p.get("sdgs", [])))
        anchor_id = f' id="{esc(p["id"])}"' if detailed else ""
        cta_href = "/workshop/" if p["id"] == "workshop" else f'/hoat-dong/#{esc(p["id"])}'
        cta_label = "Xem lịch Workshop" if p["id"] == "workshop" else "Tìm hiểu chi tiết"
        footer_html = (
            f'<div class="card-footer"><span class="seats-note">{esc(metric_badge)}</span><a class="btn btn--outline btn--sm" href="/tham-gia/">Tham gia</a></div>'
            if detailed
            else f'<div class="card-footer"><a class="arrow-link" href="{cta_href}">{cta_label} →</a></div>'
        )
        cards.append(
            f"""<article class="editorial-card" data-stagger-item{anchor_id}>
        <div class="plate-media" data-curtain>
          <img src="{esc(p['image'])}" alt="{esc(p['imageAlt'])}" width="640" height="420" loading="lazy">
        </div>
        <div class="card-meta"><span class="cat">{esc(p['badge'])}</span></div>
        <h3 class="card-title">{esc(p['title'])}</h3>
        <p class="card-text">{esc(p['summary'])}</p>
        <div class="visual-chip-row" style="margin-bottom: 18px;">{chips_html}</div>
        {footer_html}
      </article>"""
        )
    return "\n      ".join(cards)


ICON_CALENDAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
ICON_PIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'


def render_workshops(upcoming: list) -> str:
    cards = []
    for ws in upcoming:
        filters_attr = " ".join(ws.get("filters", []))
        cat_attr = f' data-workshop-card data-category="{esc(filters_attr)}"' if filters_attr else " data-workshop-card"
        cards.append(
            f"""<article class="event-card" data-stagger-item{cat_attr}>
        <div class="event-card-media" data-curtain>
          <img src="{esc(ws['image'])}" alt="{esc(ws['imageAlt'])}" width="640" height="420" loading="lazy">
          <div class="event-card-badges">
            <span class="glass-badge">{esc(ws['dateDisplay'])}</span>
            <span class="glass-badge glass-badge--accent">{esc(ws['fee'])}</span>
          </div>
        </div>
        <div class="event-card-body">
          <div class="card-meta">
            <span class="cat">{esc(ws['type'])}</span>
            <span>·</span>
            <span>{esc(ws['seats'])}</span>
          </div>
          <h3 class="card-title">{esc(ws['title'])}</h3>
          <p class="card-text">{esc(ws['summary'])}</p>
          <div class="event-info-inline">
            <span>{ICON_CALENDAR} {esc(ws['time'])}</span>
            <span>{ICON_PIN} {esc(ws['location'])}</span>
          </div>
          <div class="card-footer">
            <button class="btn btn--primary btn--sm" type="button" style="width: 100%; justify-content: space-between;" data-register-event="{esc(ws['title'])}" data-event-id="{esc(ws['id'])}">
              <span>Đăng ký giữ chỗ</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


def render_sdgs(sdgs: list) -> str:
    cards = []
    for s in sdgs:
        cards.append(
            f"""<article class="sdg-col" data-stagger-item style="--sdg-color: {esc(s['color'])};">
        <span class="sdg-code">{esc(s['code'])}</span>
        <h3>{esc(s['title'])}</h3>
        <p>{esc(s['description'])}</p>
      </article>"""
        )
    return "\n      ".join(cards)


def render_news_cards(articles: list, filterable: bool = False) -> str:
    cards = []
    for a in articles:
        filter_tokens = " ".join(a.get("filters", [])) or a["categorySlug"]
        attr = f' data-news-card data-category="{esc(filter_tokens)}"' if filterable else ""
        href = f'/tin-tuc/{esc(a["slug"])}/'
        cards.append(
            f"""<article class="editorial-card" data-stagger-item{attr}>
        <a class="plate-media" data-curtain data-cursor-label="Đọc" href="{href}" aria-label="{esc(a['title'])}">
          <img src="{esc(a['image'])}" alt="{esc(a['imageAlt'])}" width="640" height="420" loading="lazy">
        </a>
        <div class="card-meta">
          <span class="cat">{esc(a['category'])}</span>
          <span>·</span>
          <time datetime="{esc(a['date'])}">{esc(a['dateDisplay'])}</time>
        </div>
        <h3 class="card-title"><a href="{href}">{esc(a['title'])}</a></h3>
        <p class="card-text">{esc(a['excerpt'])}</p>
        <div class="card-footer">
          <a class="arrow-link" href="{href}">Xem hình &amp; nhật ký →</a>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


def render_campaigns(campaigns: list) -> str:
    cards = []
    for c in campaigns:
        filter_tokens = " ".join(c.get("filters", [])) or c["category"]
        cards.append(
            f"""<article class="editorial-card" data-stagger-item data-campaign-card data-category="{esc(filter_tokens)}">
        <div class="plate-media" data-curtain>
          <img src="{esc(c['image'])}" alt="{esc(c['imageAlt'])}" width="720" height="460" loading="lazy">
        </div>
        <div class="card-meta">
          <span class="cat">{esc(c['categoryLabel'])}</span>
          <span>·</span>
          <span>{esc(c['status'])}</span>
        </div>
        <h3 class="card-title">{esc(c['title'])}</h3>
        <p class="card-text">{esc(c['description'])}</p>
        <div class="event-info-inline">
          <span>{ICON_PIN} {esc(c['location'])}</span>
          <span>{ICON_CHECK} {esc(c['metric'])}</span>
        </div>
        <div class="card-footer">
          <button class="btn btn--outline btn--sm" type="button" data-register-event="{esc(c['title'])}">Đăng ký đồng hành →</button>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


def render_horizontal_gallery(gallery: list) -> str:
    items = []
    for idx, g in enumerate(gallery, start=1):
        items.append(
            f"""<button class="horizontal-card" type="button" data-cursor-label="Xem" data-lightbox-src="{esc(g['src'])}" data-lightbox-alt="{esc(g['alt'])}" data-lightbox-caption="{esc(g['caption'])}">
        <div class="horizontal-frame">
          <img src="{esc(g['src'])}" alt="{esc(g['alt'])}" width="960" height="600" loading="lazy">
        </div>
        <div class="horizontal-caption">
          <span>{esc(g['caption'])}</span>
          <span class="horizontal-index">0{idx} / 0{len(gallery)}</span>
        </div>
      </button>"""
        )
    return "\n      ".join(items)


def render_gallery(gallery: list) -> str:
    items = []
    for g in gallery:
        items.append(
            f"""<button class="gallery-item" type="button" data-cursor-label="Xem" data-lightbox-src="{esc(g['src'])}" data-lightbox-alt="{esc(g['alt'])}" data-lightbox-caption="{esc(g['caption'])}">
        <img src="{esc(g['src'])}" alt="{esc(g['alt'])}" width="720" height="480" loading="lazy">
        <span class="gallery-caption">{esc(g['caption'])}</span>
      </button>"""
        )
    return "\n      ".join(items)


def render_faqs(faqs: list) -> str:
    items = []
    for idx, f in enumerate(faqs):
        open_attr = " open" if idx == 0 else ""
        items.append(
            f"""<details class="faq-details"{open_attr}>
        <summary>{esc(f['question'])}</summary>
        <div class="faq-answer">{esc(f['answer'])}</div>
      </details>"""
        )
    return "\n      ".join(items)


def render_numbered_cards(items: list) -> str:
    cards = []
    for idx, item in enumerate(items, start=1):
        tag = item.get("tag", "")
        meta = f"0{idx} · {esc(tag)}" if tag else f"0{idx}"
        cards.append(
            f"""<article class="value-col" data-stagger-item>
        <span class="value-num">{meta}</span>
        <h3>{esc(item['title'])}</h3>
        <p>{esc(item['description'])}</p>
      </article>"""
        )
    return "\n      ".join(cards)


def render_past_workshops(past_list: list) -> str:
    rows = []
    for item in past_list:
        rows.append(
            f"""<div class="past-item" data-stagger-item>
        <span class="past-item-date">{esc(item['date'])}</span>
        <h3 class="past-item-title">{esc(item['title'])}</h3>
        <span class="past-item-meta">{esc(item['participants'])}</span>
      </div>"""
        )
    return "\n      ".join(rows)


def organization_schema(site: dict) -> dict:
    b = site["brand"]
    c = site["contact"]
    return {
        "@context": "https://schema.org",
        "@type": "NGO",
        "name": b["fullName"],
        "alternateName": [
            b.get("brandName", "HolaRise"),
            b["shortName"],
            b.get("englishName", "HolaRise – Hoa Lac Youth Empowerment Community"),
        ],
        "slogan": b["tagline"],
        "url": b["siteUrl"],
        "logo": abs_url(b["siteUrl"], b.get("logoMark", b["logoDark"])),
        "image": abs_url(b["siteUrl"], b["ogImage"]),
        "description": site["seo"]["defaultDescription"],
        "email": c["email"],
        "telephone": c["phoneDisplay"],
        "areaServed": {
            "@type": "Place",
            "name": "Tân Xã, Hòa Lạc, Hà Nội, Việt Nam",
        },
        "address": {
            "@type": "PostalAddress",
            "streetAddress": "Tân Xã, Hòa Lạc",
            "addressLocality": "Hòa Lạc",
            "addressRegion": "Hà Nội",
            "addressCountry": "VN",
        },
        "sameAs": [u for u in [c.get("facebook"), c.get("youtube"), c.get("instagram")] if u],
    }


def breadcrumb_schema(site_url: str, crumbs: list) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": idx,
                "name": name,
                "item": abs_url(site_url, path),
            }
            for idx, (name, path) in enumerate(crumbs, start=1)
        ],
    }


def events_schema(site: dict, upcoming: list) -> list:
    b = site["brand"]
    schemas = []
    for ws in upcoming:
        schemas.append(
            {
                "@context": "https://schema.org",
                "@type": "Event",
                "name": ws["title"],
                "startDate": ws["date"],
                "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
                "eventStatus": "https://schema.org/EventScheduled",
                "isAccessibleForFree": True,
                "image": [abs_url(b["siteUrl"], ws["image"])],
                "description": ws["summary"],
                "location": {
                    "@type": "Place",
                    "name": ws["location"],
                    "address": {
                        "@type": "PostalAddress",
                        "addressLocality": "Hòa Lạc, Thạch Thất",
                        "addressRegion": "Hà Nội",
                        "addressCountry": "VN",
                    },
                },
                "organizer": {
                    "@type": "NGO",
                    "name": b["fullName"],
                    "url": b["siteUrl"],
                },
            }
        )
    return schemas


def faq_schema(faqs: list) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": f["question"],
                "acceptedAnswer": {"@type": "Answer", "text": f["answer"]},
            }
            for f in faqs
        ],
    }


def write_page(
    base_tpl: str,
    site: dict,
    out_rel_path: str,
    url_path: str,
    title: str,
    description: str,
    main_content: str,
    schemas: list,
    og_type: str = "website",
    og_image: str = None,
    body_class: str = "",
    robots: str = "index, follow",
    cache_bust: str = None,
    event_schemas: list = None,
):
    b = site["brand"]
    c = site["contact"]
    canonical = abs_url(b["siteUrl"], url_path)
    og_img_url = abs_url(b["siteUrl"], og_image or b["ogImage"])
    json_ld_html = "\n  ".join(json_ld_script(s) for s in schemas)
    if event_schemas is not None:
        ev_scripts = "\n  ".join(json_ld_script(s) for s in event_schemas)
        json_ld_html += f"\n  <!-- CMS:EVENTS_JSON_LD:START -->\n  {ev_scripts}\n  <!-- CMS:EVENTS_JSON_LD:END -->"
    phone_raw = re.sub(r"[^0-9+]", "", c["phoneDisplay"])

    rendered = render_template(
        base_tpl,
        {
            "PAGE_TITLE": esc(title),
            "PAGE_DESCRIPTION": esc(description),
            "PAGE_KEYWORDS": esc(site["seo"]["keywords"]),
            "ROBOTS_CONTENT": esc(robots),
            "CANONICAL_URL": esc(canonical),
            "OG_TYPE": esc(og_type),
            "OG_IMAGE_URL": esc(og_img_url),
            "BODY_CLASS": esc(body_class),
            "BRAND_FULL_NAME": esc(b["fullName"]),
            "BRAND_SUBTITLE": esc(b["subtitle"]),
            "BRAND_TAGLINE": esc(b["tagline"]),
            "LOGO_DARK": esc(b["logoDark"]),
            "LOGO_LIGHT": esc(b["logoLight"]),
            "LOGO_MARK": esc(b.get("logoMark", "/assets/images/logo-mark.png")),
            "NAV_LINKS": build_nav_links(url_path),
            "MOBILE_NAV_LINKS": build_mobile_nav_links(url_path),
            "PWA_TABBAR_LINKS": build_pwa_tabbar_links(url_path),
            "MAIN_CONTENT": main_content,
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(phone_raw),
            "CONTACT_ZALO": esc(c.get("zalo", "")),
            "CONTACT_MEETING": esc(c["meetingTime"]),
            "FORM_ENDPOINT": esc(c.get("formEndpoint", "")),
            "CURRENT_YEAR": str(datetime.date.today().year),
            "CACHE_BUST": esc(cache_bust or CURRENT_BUILD_HASH),
            "JSON_LD_SCRIPTS": json_ld_html,
        },
    )

    out_path = DIST_DIR / out_rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(rendered, encoding="utf-8")


def collect_precache_urls() -> list:
    """Collect canonical routes and versioned core assets actually used by generated pages."""
    urls = set()
    excluded_prefixes = (
        "/assets/images/events/",
        "/assets/images/pwa/screenshot-",
        "/assets/images/og-cover.jpg",
    )

    for html_file in sorted(DIST_DIR.rglob("*.html")):
        rel = html_file.relative_to(DIST_DIR).as_posix()
        if rel.startswith("admin/") or rel.startswith("_templates/"):
            continue
        if rel == "index.html":
            urls.add("/")
        elif rel.endswith("/index.html"):
            urls.add("/" + rel[: -len("index.html")])

        text = html_file.read_text(encoding="utf-8")
        for target in re.findall(r'\b(?:href|src)="(/assets/[^"]+)"', text):
            target_no_hash = target.split("#")[0]
            clean = target_no_hash.split("?")[0]
            if any(clean.startswith(prefix) for prefix in excluded_prefixes):
                continue
            if (DIST_DIR / clean.lstrip("/")).is_file():
                urls.add(target_no_hash)

    for extra in (
        "/site.webmanifest",
        "/assets/images/favicon.svg",
        "/assets/images/apple-touch-icon.png",
        "/assets/images/pwa/icon-192.png",
        "/assets/images/pwa/icon-maskable-192.png",
    ):
        if (DIST_DIR / extra.lstrip("/")).is_file():
            urls.add(extra)

    return sorted(urls)


def generate_service_worker(build_hash: str, precache_urls: list) -> str:
    precache_json = json.dumps(precache_urls, ensure_ascii=False, indent=2)
    return f"""/* Auto-generated by build.py — HolaRise PWA Service Worker */
const CACHE_VERSION = "holarise-{build_hash}";
const CORE_CACHE = "holarise-core-" + CACHE_VERSION;
const RUNTIME_CACHE = "holarise-runtime-v1";
const MAX_RUNTIME_ENTRIES = 40;
const NETWORK_TIMEOUT_MS = 4500;
const OFFLINE_URL = "/offline/";
const PRECACHE_URLS = {precache_json};

function normalizeNavPath(pathname) {{
  if (!pathname || pathname === "/") return "/";
  if (pathname.endsWith("/index.html")) {{
    const base = pathname.slice(0, -10);
    return base || "/";
  }}
  const lastSegment = pathname.split("/").pop() || "";
  if (!pathname.endsWith("/") && !lastSegment.includes(".")) {{
    return pathname + "/";
  }}
  return pathname;
}}

async function trimCache(cacheName, maxEntries) {{
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {{
    await cache.delete(keys[i]);
  }}
}}

function fetchWithTimeout(request, timeoutMs) {{
  return new Promise((resolve, reject) => {{
    const timer = setTimeout(() => reject(new Error("Network timeout")), timeoutMs);
    fetch(request).then(
      (response) => {{
        clearTimeout(timer);
        resolve(response);
      }},
      (err) => {{
        clearTimeout(timer);
        reject(err);
      }}
    );
  }});
}}

self.addEventListener("install", (event) => {{
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          fetch(new Request(url, {{ cache: "reload" }})).then((res) => {{
            if (!res.ok) {{
              throw new Error("Precache failed for " + url + " (" + res.status + ")");
            }}
            return cache.put(url, res);
          }})
        )
      )
    )
  );
}});

self.addEventListener("activate", (event) => {{
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("holarise-core-") && key !== CORE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
}});

self.addEventListener("message", (event) => {{
  if (event.data && event.data.type === "SKIP_WAITING") {{
    self.skipWaiting();
  }}
}});

self.addEventListener("fetch", (event) => {{
  const {{ request }} = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // 0. Never intercept CMS Admin, API endpoints, or internal templates
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/_templates/"))
  ) {{
    return;
  }}

  // 1. HTML Navigation: Network-First (4.5s timeout) -> Normalized Cache -> /offline/
  if (request.mode === "navigate") {{
    const cleanPath = normalizeNavPath(url.pathname);
    event.respondWith(
      (async () => {{
        try {{
          const networkRes = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
          if (networkRes && networkRes.ok && networkRes.type === "basic") {{
            const clone = networkRes.clone();
            event.waitUntil(caches.open(CORE_CACHE).then((cache) => cache.put(cleanPath, clone)));
          }}
          return networkRes;
        }} catch (_err) {{
          const coreCache = await caches.open(CORE_CACHE);
          const cachedExact = await coreCache.match(cleanPath);
          if (cachedExact) return cachedExact;
          const cachedLoose = await caches.match(request, {{ ignoreSearch: true }});
          if (cachedLoose) return cachedLoose;
          const offlineFallback = await coreCache.match(OFFLINE_URL);
          if (offlineFallback) return offlineFallback;
          return new Response("Offline", {{
            status: 503,
            headers: {{ "Content-Type": "text/plain; charset=utf-8" }},
          }});
        }}
      }})()
    );
    return;
  }}

  // 2. Same-origin Web App Manifest: Network-First -> Core Cache -> Response.error()
  if (url.origin === self.location.origin && url.pathname === "/site.webmanifest") {{
    event.respondWith(
      fetch(request)
        .then((res) => {{
          if (res && res.ok) {{
            const clone = res.clone();
            event.waitUntil(caches.open(CORE_CACHE).then((c) => c.put(request, clone)));
          }}
          return res;
        }})
        .catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }}

  // 3. Same-origin Static Assets: Precache Cache-First; uncached images use Runtime SWR + LRU
  if (url.origin === self.location.origin) {{
    event.respondWith(
      (async () => {{
        const coreCache = await caches.open(CORE_CACHE);
        const coreHit = await coreCache.match(request);
        if (coreHit) return coreHit;

        if (url.pathname.startsWith("/assets/images/")) {{
          const runtimeCache = await caches.open(RUNTIME_CACHE);
          const runtimeHit = await runtimeCache.match(request);
          const networkPromise = fetch(request)
            .then((res) => {{
              if (res && res.ok) {{
                event.waitUntil(
                  runtimeCache.put(request, res.clone()).then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES))
                );
              }}
              return res;
            }})
            .catch(() => runtimeHit || Response.error());
          if (runtimeHit) {{
            event.waitUntil(networkPromise);
            return runtimeHit;
          }}
          return networkPromise;
        }}

        try {{
          return await fetch(request);
        }} catch (_err) {{
          const looseHit = await caches.match(request, {{ ignoreSearch: true }});
          return looseHit || Response.error();
        }}
      }})()
    );
    return;
  }}

  // 4. Google Fonts: SWR for CORS stylesheet CSS, Cache-First for immutable .woff2 files
  if (url.origin === "https://fonts.googleapis.com") {{
    event.respondWith(
      (async () => {{
        const runtimeCache = await caches.open(RUNTIME_CACHE);
        const cached = await runtimeCache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {{
            if (res && res.ok) {{
              event.waitUntil(
                runtimeCache.put(request, res.clone()).then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES))
              );
            }}
            return res;
          }})
          .catch(() => cached || Response.error());
        if (cached) {{
          event.waitUntil(networkPromise);
          return cached;
        }}
        return networkPromise;
      }})()
    );
    return;
  }}

  if (url.origin === "https://fonts.gstatic.com") {{
    event.respondWith(
      (async () => {{
        const runtimeCache = await caches.open(RUNTIME_CACHE);
        const cached = await runtimeCache.match(request);
        if (cached) return cached;
        try {{
          const res = await fetch(request);
          if (res && res.ok) {{
            event.waitUntil(
              runtimeCache.put(request, res.clone()).then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES))
            );
          }}
          return res;
        }} catch (_err) {{
          return Response.error();
        }}
      }})()
    );
  }}
}});
"""


def generate_cloudflare_headers() -> str:
    return """# Cloudflare Pages HTTP Headers — HolaRise PWA

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/sw.js
  Cache-Control: no-cache, no-store, must-revalidate
  Service-Worker-Allowed: /
  Content-Type: application/javascript; charset=utf-8

/site.webmanifest
  Content-Type: application/manifest+json; charset=utf-8
  Cache-Control: public, max-age=3600, must-revalidate

/
  Cache-Control: public, max-age=0, must-revalidate

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/gioi-thieu/*
  Cache-Control: public, max-age=0, must-revalidate

/hoat-dong/*
  Cache-Control: public, max-age=0, must-revalidate

/workshop/*
  Cache-Control: public, max-age=0, must-revalidate

/tin-tuc/*
  Cache-Control: public, max-age=0, must-revalidate

/tham-gia/*
  Cache-Control: public, max-age=0, must-revalidate

/offline/*
  Cache-Control: public, max-age=0, must-revalidate

/admin/*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow

/api/*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow

/assets/css/*
  Cache-Control: public, max-age=31536000, immutable

/assets/js/*
  Cache-Control: public, max-age=31536000, immutable

/assets/vendor/*
  Cache-Control: public, max-age=31536000, immutable

/assets/images/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
"""


def build_site() -> list:
    global CURRENT_BUILD_HASH
    CURRENT_BUILD_HASH = compute_build_hash()

    site = load_json("site.json")
    activities = load_json("activities.json")
    workshops = load_json("workshops.json")
    news = load_json("news.json")

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ASSETS_DIR, DIST_DIR / "assets")

    base_tpl = load_template("base.html")
    b = site["brand"]
    h = site["hero"]
    p = site["philosophy"]
    org_ld = organization_schema(site)

    sitemap_urls = []

    # 1. Home page (Visual-First 5 core sections)
    home_main = render_template(
        load_template("home.html"),
        {
            "HERO_IMAGE": esc(h["image"]),
            "HERO_IMAGE_ALT": esc(h["imageAlt"]),
            "HERO_BADGE": esc(h["badge"]),
            "HERO_HEADLINE_LINES": render_hero_headline_lines(h["headline"]),
            "HERO_QUICK_PILLS": render_hero_quick_pills(h.get("quickPills", [])),
            "HERO_DESCRIPTION": esc(h["description"]),
            "HERO_PRIMARY_HREF": esc(h["primaryCta"]["href"]),
            "HERO_PRIMARY_LABEL": esc(h["primaryCta"]["label"]),
            "HERO_SECONDARY_HREF": esc(h["secondaryCta"]["href"]),
            "HERO_SECONDARY_LABEL": esc(h["secondaryCta"]["label"]),
            "HERO_UPCOMING_BAR": f"<!-- CMS:HERO_UPCOMING_BAR:START -->\n{render_hero_upcoming_bar(workshops['upcoming'])}\n<!-- CMS:HERO_UPCOMING_BAR:END -->",
            "IMPACT_METRICS_HTML": render_impact_metrics(site["impactMetrics"]),
            "STORY_STAGE_HTML": render_story_stage(activities["pillars"]),
            "UPCOMING_WORKSHOPS_HTML": f"<!-- CMS:UPCOMING_WORKSHOPS:START -->\n{render_workshops(workshops['upcoming'])}\n<!-- CMS:UPCOMING_WORKSHOPS:END -->",
            "HORIZONTAL_GALLERY_HTML": render_horizontal_gallery(activities["gallery"]),
            "FAQ_HTML": render_faqs(site["faqs"]),
        },
    )
    home_schemas = [
        org_ld,
        {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": b["fullName"],
            "url": b["siteUrl"],
            "inLanguage": "vi-VN",
        },
        faq_schema(site["faqs"]),
    ]
    write_page(
        base_tpl,
        site,
        "index.html",
        "/",
        site["seo"]["defaultTitle"],
        site["seo"]["defaultDescription"],
        home_main,
        home_schemas,
        body_class="is-home",
        event_schemas=events_schema(site, workshops["upcoming"][:1]),
    )
    sitemap_urls.append(("/", "1.0", "weekly"))

    # 2. About page
    about_main = render_template(
        load_template("about.html"),
        {
            "BRAND_FULL_NAME": esc(b["fullName"]),
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "BRAND_SUBTITLE": esc(b["subtitle"]),
            "HERO_IMAGE": esc(h["image"]),
            "HERO_IMAGE_ALT": esc(h["imageAlt"]),
            "PHILOSOPHY_QUOTE": esc(p["quote"]),
            "PHILOSOPHY_MOTTO": esc(p["motto"]),
            "PHILOSOPHY_MISSION": esc(p["mission"]),
            "PHILOSOPHY_VISION": esc(p["vision"]),
            "CORE_VALUES_HTML": render_numbered_cards(p["coreValues"]),
            "SDGS_HTML": render_sdgs(site["sdgs"]),
            "PRINCIPLES_HTML": render_numbered_cards(site["principles"]),
        },
    )
    write_page(
        base_tpl,
        site,
        "gioi-thieu/index.html",
        "/gioi-thieu/",
        f"Giới thiệu & Sứ mệnh | {b['fullName']}",
        f"Tìm hiểu về sứ mệnh, tầm nhìn, 4 giá trị cốt lõi, định hướng UN SDGs và nguyên tắc minh bạch của {b['fullName']}.",
        about_main,
        [org_ld, breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Giới thiệu", "/gioi-thieu/")])],
    )
    sitemap_urls.append(("/gioi-thieu/", "0.9", "monthly"))

    # 3. Activities page
    activities_main = render_template(
        load_template("activities.html"),
        {
            "PILLARS_DETAIL_HTML": render_pillars(activities["pillars"], detailed=True),
            "CAMPAIGNS_HTML": render_campaigns(activities["campaigns"]),
            "GALLERY_HTML": render_gallery(activities["gallery"]),
        },
    )
    write_page(
        base_tpl,
        site,
        "hoat-dong/index.html",
        "/hoat-dong/",
        f"Hoạt động & Chiến dịch Môi trường – Cộng đồng | {b['shortName']} Hòa Lạc",
        f"Khám phá các chiến dịch làm sạch môi trường Hòa Lạc, trồng cây xanh, workshop chia sẻ giá trị sống và thiện nguyện cộng đồng của {b['fullName']}.",
        activities_main,
        [org_ld, breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Hoạt động", "/hoat-dong/")])],
    )
    sitemap_urls.append(("/hoat-dong/", "0.9", "weekly"))

    # 4. Workshops page
    ws_main = render_template(
        load_template("workshops.html"),
        {
            "WORKSHOP_INTRO_TITLE": esc(workshops["intro"]["title"]),
            "WORKSHOP_INTRO_DESC": esc(workshops["intro"]["description"]),
            "UPCOMING_WORKSHOPS_HTML": f"<!-- CMS:UPCOMING_WORKSHOPS:START -->\n{render_workshops(workshops['upcoming'])}\n<!-- CMS:UPCOMING_WORKSHOPS:END -->",
            "PAST_WORKSHOPS_HTML": f"<!-- CMS:PAST_WORKSHOPS:START -->\n{render_past_workshops(workshops['pastTopics'])}\n<!-- CMS:PAST_WORKSHOPS:END -->",
        },
    )
    write_page(
        base_tpl,
        site,
        "workshop/index.html",
        "/workshop/",
        f"Lịch Workshop Giá Trị Sống & Sự Kiện Hòa Lạc | {b['shortName']}",
        f"Đăng ký tham dự các buổi workshop chia sẻ nội dung cao đẹp, kỹ năng sống tích cực và chiến dịch môi trường cuối tuần tại Hòa Lạc cùng {b['shortName']}.",
        ws_main,
        [
            org_ld,
            breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Workshop", "/workshop/")]),
        ],
        event_schemas=events_schema(site, workshops["upcoming"]),
    )
    sitemap_urls.append(("/workshop/", "0.9", "weekly"))

    # 5. News list page
    news_list_main = render_template(
        load_template("news_list.html"),
        {
            "NEWS_LIST_HTML": f"<!-- CMS:NEWS_LIST:START -->\n{render_news_cards(news, filterable=True)}\n<!-- CMS:NEWS_LIST:END -->",
        },
    )
    write_page(
        base_tpl,
        site,
        "tin-tuc/index.html",
        "/tin-tuc/",
        f"Tin tức & Nhật ký Hoạt động | {b['fullName']}",
        f"Cập nhật bài viết, hình ảnh và báo cáo kết quả các chiến dịch môi trường, workshop và hoạt động cộng đồng tại Hòa Lạc của {b['shortName']}.",
        news_list_main,
        [org_ld, breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Tin tức", "/tin-tuc/")])],
    )
    sitemap_urls.append(("/tin-tuc/", "0.8", "weekly"))

    # 6. Individual news detail pages
    news_detail_tpl = load_template("news_detail.html")
    for article in news:
        related = [a for a in news if a["slug"] != article["slug"]][:2]
        paragraphs = "\n      ".join(f"<p>{esc(para)}</p>" for para in article["content"])
        slug_path = f"/tin-tuc/{article['slug']}/"
        detail_main = render_template(
            news_detail_tpl,
            {
                "BRAND_SHORT_NAME": esc(b["shortName"]),
                "ARTICLE_CATEGORY": esc(article["category"]),
                "ARTICLE_TITLE": esc(article["title"]),
                "ARTICLE_DATE": esc(article["date"]),
                "ARTICLE_DATE_DISPLAY": esc(article["dateDisplay"]),
                "ARTICLE_READ_TIME": esc(article["readTime"]),
                "ARTICLE_AUTHOR": esc(article["author"]),
                "ARTICLE_IMAGE": esc(article["image"]),
                "ARTICLE_IMAGE_ALT": esc(article["imageAlt"]),
                "ARTICLE_PARAGRAPHS": paragraphs,
                "RELATED_NEWS_HTML": render_news_cards(related, filterable=False),
            },
        )
        article_schema = {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": article["title"],
            "description": article["excerpt"],
            "image": [abs_url(b["siteUrl"], article["image"])],
            "datePublished": article["date"],
            "dateModified": article["date"],
            "author": {"@type": "Organization", "name": article["author"]},
            "publisher": {
                "@type": "Organization",
                "name": b["fullName"],
                "logo": {"@type": "ImageObject", "url": abs_url(b["siteUrl"], b.get("logoMark", b["logoDark"]))},
            },
            "mainEntityOfPage": abs_url(b["siteUrl"], slug_path),
        }
        write_page(
            base_tpl,
            site,
            f"tin-tuc/{article['slug']}/index.html",
            slug_path,
            f"{article['title']} | {b['shortName']} Hòa Lạc",
            article["excerpt"],
            detail_main,
            [
                org_ld,
                article_schema,
                breadcrumb_schema(
                    b["siteUrl"],
                    [("Trang chủ", "/"), ("Tin tức", "/tin-tuc/"), (article["title"], slug_path)],
                ),
            ],
            og_type="article",
            og_image=article["image"],
        )
        sitemap_urls.append((slug_path, "0.7", "monthly"))

    # 6b. SSR shell template for dynamic CMS articles (/tin-tuc/<new-slug>/)
    ssr_detail_main = render_template(
        news_detail_tpl,
        {
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "ARTICLE_CATEGORY": "__SSR_ARTICLE_CATEGORY__",
            "ARTICLE_TITLE": "__SSR_ARTICLE_TITLE__",
            "ARTICLE_DATE": "__SSR_ARTICLE_DATE__",
            "ARTICLE_DATE_DISPLAY": "__SSR_ARTICLE_DATE_DISPLAY__",
            "ARTICLE_READ_TIME": "__SSR_ARTICLE_READ_TIME__",
            "ARTICLE_AUTHOR": "__SSR_ARTICLE_AUTHOR__",
            "ARTICLE_IMAGE": "__SSR_ARTICLE_IMAGE__",
            "ARTICLE_IMAGE_ALT": "__SSR_ARTICLE_IMAGE_ALT__",
            "ARTICLE_PARAGRAPHS": "__SSR_ARTICLE_BODY__",
            "RELATED_NEWS_HTML": "__SSR_RELATED_NEWS__",
        },
    )
    write_page(
        base_tpl,
        site,
        "_templates/news-detail-shell.tpl",
        "/tin-tuc/__SSR_SLUG__/",
        "__SSR_PAGE_TITLE__",
        "__SSR_PAGE_DESCRIPTION__",
        ssr_detail_main,
        [org_ld],
        og_type="article",
        og_image="/__SSR_OG_IMAGE_PATH__",
    )
    shell_path = DIST_DIR / "_templates" / "news-detail-shell.tpl"
    shell_txt = shell_path.read_text(encoding="utf-8")
    shell_txt = shell_txt.replace(
        abs_url(b["siteUrl"], "/__SSR_OG_IMAGE_PATH__"), "__SSR_OG_IMAGE_URL__"
    ).replace(
        abs_url(b["siteUrl"], "/tin-tuc/__SSR_SLUG__/"), "__SSR_CANONICAL_URL__"
    ).replace(
        "</head>", "  __SSR_EXTRA_JSON_LD__\n</head>", 1
    )
    shell_path.write_text(shell_txt, encoding="utf-8")

    # 7. Join & Contact page
    c = site["contact"]
    join_phone_raw = re.sub(r"[^0-9+]", "", c["phoneDisplay"])
    join_main = render_template(
        load_template("join.html"),
        {
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "FORM_ENDPOINT": esc(c.get("formEndpoint", "")),
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_MEETING": esc(c["meetingTime"]),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(join_phone_raw),
            "CONTACT_ZALO": esc(c.get("zalo", "")),
            "FAQ_HTML": render_faqs(site["faqs"]),
        },
    )
    write_page(
        base_tpl,
        site,
        "tham-gia/index.html",
        "/tham-gia/",
        f"Đăng ký Tham gia & Liên hệ | {b['fullName']}",
        f"Đăng ký làm tình nguyện viên môi trường, tham dự workshop giá trị sống hoặc kết nối hợp tác cùng {b['fullName']}.",
        join_main,
        [
            org_ld,
            faq_schema(site["faqs"]),
            breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Tham gia", "/tham-gia/")]),
        ],
    )
    sitemap_urls.append(("/tham-gia/", "0.9", "monthly"))

    # 7b. Offline PWA fallback page (not indexed, not in sitemap.xml)
    offline_phone_raw = re.sub(r"[^0-9+]", "", c["phoneDisplay"])
    offline_main = render_template(
        load_template("offline.html"),
        {
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_MEETING": esc(c["meetingTime"]),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(offline_phone_raw),
        },
    )
    write_page(
        base_tpl,
        site,
        "offline/index.html",
        "/offline/",
        f"Chế độ ngoại tuyến | {b['shortName']}",
        f"Bạn đang xem chế độ ngoại tuyến của {b['fullName']}. Vui lòng kết nối lại mạng để cập nhật lịch hoạt động mới nhất.",
        offline_main,
        [org_ld],
        body_class="is-offline-page",
        robots="noindex, nofollow",
    )

    # 7c. CMS Admin page (/admin/index.html — noindex, excluded from sitemap & SW precache)
    admin_html = render_template(
        load_template("admin.html"),
        {"CACHE_BUST": CURRENT_BUILD_HASH},
    )
    admin_out = DIST_DIR / "admin" / "index.html"
    admin_out.parent.mkdir(parents=True, exist_ok=True)
    admin_out.write_text(admin_html, encoding="utf-8")

    # 8. Technical SEO & PWA files: sitemap.xml, robots.txt, site.webmanifest, sw.js, _headers
    today = datetime.date.today().isoformat()
    url_entries = "\n".join(
        f"""  <url>
    <loc>{esc(abs_url(b['siteUrl'], path))}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>{freq}</changefreq>
    <priority>{prio}</priority>
  </url>"""
        for path, prio, freq in sitemap_urls
    )
    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{url_entries}
</urlset>
"""
    (DIST_DIR / "sitemap.xml").write_text(sitemap_xml, encoding="utf-8")

    robots_txt = f"""User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /_templates/

Sitemap: {abs_url(b['siteUrl'], '/sitemap.xml')}
"""
    (DIST_DIR / "robots.txt").write_text(robots_txt, encoding="utf-8")

    manifest = {
        "id": "/",
        "name": b["fullName"],
        "short_name": b.get("brandName", "HolaRise"),
        "description": b["subtitle"],
        "lang": "vi-VN",
        "dir": "ltr",
        "start_url": "/?source=pwa",
        "scope": "/",
        "display": "standalone",
        "display_override": ["standalone", "minimal-ui"],
        "orientation": "portrait-primary",
        "background_color": "#FEF7EF",
        "theme_color": "#FFFFFF",
        "categories": ["social", "education", "lifestyle"],
        "prefer_related_applications": False,
        "icons": [
            {
                "src": "/assets/images/pwa/icon-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": "/assets/images/pwa/icon-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": "/assets/images/pwa/icon-maskable-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "maskable",
            },
            {
                "src": "/assets/images/pwa/icon-maskable-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
        "shortcuts": [
            {
                "name": "Lịch Workshop sắp tới",
                "short_name": "Workshop",
                "description": "Xem lịch Workshop giá trị sống và giữ chỗ miễn phí",
                "url": "/workshop/?source=pwa-shortcut",
                "icons": [
                    {
                        "src": "/assets/images/pwa/icon-192.png",
                        "sizes": "192x192",
                        "type": "image/png",
                    }
                ],
            },
            {
                "name": "Hoạt động & Chiến dịch",
                "short_name": "Hoạt động",
                "description": "3 chương trình HolaGreen, HolaHeart, HolaConnect",
                "url": "/hoat-dong/?source=pwa-shortcut",
                "icons": [
                    {
                        "src": "/assets/images/pwa/icon-192.png",
                        "sizes": "192x192",
                        "type": "image/png",
                    }
                ],
            },
            {
                "name": "Đăng ký tham gia",
                "short_name": "Tham gia",
                "description": "Đăng ký tình nguyện viên và kết nối cùng HolaRise",
                "url": "/tham-gia/?source=pwa-shortcut",
                "icons": [
                    {
                        "src": "/assets/images/pwa/icon-192.png",
                        "sizes": "192x192",
                        "type": "image/png",
                    }
                ],
            },
        ],
        "screenshots": [
            {
                "src": "/assets/images/pwa/screenshot-mobile.jpg",
                "sizes": "540x960",
                "type": "image/jpeg",
                "form_factor": "narrow",
                "label": "Trang chủ HolaRise trên điện thoại",
            },
            {
                "src": "/assets/images/pwa/screenshot-desktop.jpg",
                "sizes": "1280x720",
                "type": "image/jpeg",
                "form_factor": "wide",
                "label": "Giao diện HolaRise trên máy tính",
            },
        ],
    }
    (DIST_DIR / "site.webmanifest").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    precache_urls = collect_precache_urls()
    (DIST_DIR / "sw.js").write_text(
        generate_service_worker(CURRENT_BUILD_HASH, precache_urls), encoding="utf-8"
    )
    (DIST_DIR / "_headers").write_text(generate_cloudflare_headers(), encoding="utf-8")

    return sitemap_urls


def verify_dist() -> list:
    errors = []
    html_files = sorted(DIST_DIR.rglob("*.html"))
    if not html_files:
        return ["No HTML files generated in dist/"]

    for f in html_files:
        text = f.read_text(encoding="utf-8")
        rel = f.relative_to(DIST_DIR)

        if "{{" in text or "}}" in text:
            errors.append(f"[{rel}] Unreplaced template placeholder found")

        is_admin_page = rel == Path("admin/index.html")
        if is_admin_page:
            if 'content="noindex, nofollow"' not in text:
                errors.append(f"[{rel}] Admin page must declare robots noindex, nofollow")
            for attr, target in re.findall(r'\b(href|src)="(/[^"]*)"', text):
                clean = target.split("#")[0].split("?")[0]
                if not clean or clean == "/" or clean.startswith("/api/"):
                    continue
                target_path = DIST_DIR / clean.lstrip("/")
                if clean.endswith("/"):
                    if not (target_path / "index.html").exists():
                        errors.append(f"[{rel}] Broken internal route {attr}=\"{target}\"")
                elif not target_path.exists():
                    errors.append(f"[{rel}] Missing asset {attr}=\"{target}\"")
            continue

        for required in [
            "<title>",
            'name="description"',
            'name="robots"',
            'rel="canonical"',
            'rel="manifest"',
            'property="og:title"',
            'property="og:image"',
            'property="og:image:width"',
            'property="og:image:height"',
        ]:
            if required not in text:
                errors.append(f"[{rel}] Missing SEO/PWA tag: {required}")

        if "https://holarise.pages.dev/" not in text:
            errors.append(f"[{rel}] Canonical or OG URL does not point to https://holarise.pages.dev/")

        ld_blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
        if not ld_blocks:
            errors.append(f"[{rel}] Missing JSON-LD structured data")
        for idx, block in enumerate(ld_blocks):
            try:
                json.loads(block)
            except json.JSONDecodeError as exc:
                errors.append(f"[{rel}] Invalid JSON-LD #{idx + 1}: {exc}")

        for attr, target in re.findall(r'\b(href|src)="(/[^"]*)"', text):
            clean = target.split("#")[0].split("?")[0]
            if not clean or clean == "/":
                continue
            target_path = DIST_DIR / clean.lstrip("/")
            if clean.endswith("/"):
                if not (target_path / "index.html").exists():
                    errors.append(f"[{rel}] Broken internal route {attr}=\"{target}\"")
            elif not target_path.exists():
                errors.append(f"[{rel}] Missing asset {attr}=\"{target}\"")

        for img_tag in re.findall(r"<img\b[^>]*>", text):
            if 'src=""' in img_tag or 'class="brand-part' in img_tag:
                continue
            if 'alt=""' in img_tag or "alt=" not in img_tag:
                errors.append(f"[{rel}] Image missing descriptive alt: {img_tag[:80]}")

    for required_file in ["sitemap.xml", "robots.txt", "site.webmanifest", "sw.js", "_headers", "offline/index.html"]:
        if not (DIST_DIR / required_file).exists():
            errors.append(f"Missing technical SEO/PWA file: {required_file}")

    # Verify offline page has noindex and is excluded from sitemap.xml
    offline_html_path = DIST_DIR / "offline" / "index.html"
    if offline_html_path.exists():
        if "noindex" not in offline_html_path.read_text(encoding="utf-8"):
            errors.append("[offline/index.html] Offline fallback page must declare robots noindex")
    sitemap_path = DIST_DIR / "sitemap.xml"
    if sitemap_path.exists():
        sm_txt = sitemap_path.read_text(encoding="utf-8")
        if "/offline/" in sm_txt:
            errors.append("[sitemap.xml] Offline fallback route must not be included in sitemap.xml")
        if "/admin/" in sm_txt:
            errors.append("[sitemap.xml] Admin route must not be included in sitemap.xml")

    # Verify Web App Manifest contract & actual icon/screenshot pixel sizes
    manifest_path = DIST_DIR / "site.webmanifest"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"[site.webmanifest] Invalid JSON: {exc}")
            manifest = None

        if isinstance(manifest, dict):
            for field in ("id", "name", "short_name", "start_url", "scope", "display"):
                if not manifest.get(field):
                    errors.append(f"[site.webmanifest] Missing required field: {field}")
            if manifest.get("display") != "standalone":
                errors.append("[site.webmanifest] Expected display='standalone'")

            icons = manifest.get("icons", [])
            found_icon_pairs = set()
            for ic in icons:
                src = ic.get("src", "")
                sizes = ic.get("sizes", "")
                purpose = ic.get("purpose", "any")
                ic_path = DIST_DIR / src.lstrip("/")
                if not ic_path.is_file():
                    errors.append(f"[site.webmanifest] Missing icon file: {src}")
                    continue
                dims = read_png_dimensions(ic_path)
                if not dims:
                    errors.append(f"[site.webmanifest] Icon is not a valid PNG: {src}")
                elif f"{dims[0]}x{dims[1]}" != sizes:
                    errors.append(f"[site.webmanifest] Icon {src} actual size {dims[0]}x{dims[1]} != declared {sizes}")
                found_icon_pairs.add((sizes, purpose))

            for req_pair in (("192x192", "any"), ("512x512", "any"), ("192x192", "maskable"), ("512x512", "maskable")):
                if req_pair not in found_icon_pairs:
                    errors.append(f"[site.webmanifest] Missing required icon {req_pair[0]} purpose='{req_pair[1]}'")

            for sc in manifest.get("screenshots", []):
                sc_path = DIST_DIR / sc.get("src", "").lstrip("/")
                if not sc_path.is_file():
                    errors.append(f"[site.webmanifest] Missing screenshot: {sc.get('src')}")
                    continue
                dims = read_jpeg_dimensions(sc_path) if sc_path.suffix.lower() in (".jpg", ".jpeg") else read_png_dimensions(sc_path)
                if dims and f"{dims[0]}x{dims[1]}" != sc.get("sizes"):
                    errors.append(
                        f"[site.webmanifest] Screenshot {sc.get('src')} actual {dims[0]}x{dims[1]} != declared {sc.get('sizes')}"
                    )

            for sh in manifest.get("shortcuts", []):
                sh_url = sh.get("url", "").split("?")[0].split("#")[0]
                sh_target = DIST_DIR / sh_url.lstrip("/") / "index.html"
                if sh_url != "/" and not sh_target.is_file():
                    errors.append(f"[site.webmanifest] Shortcut points to missing route: {sh.get('url')}")

    # Verify Service Worker precache coherence & size budget
    sw_path = DIST_DIR / "sw.js"
    if sw_path.exists():
        sw_text = sw_path.read_text(encoding="utf-8")
        ver_match = re.search(r'const CACHE_VERSION = "holarise-([0-9a-f]+)";', sw_text)
        if not ver_match:
            errors.append("[sw.js] Missing deterministic CACHE_VERSION hash")
        else:
            expected_qs = f"?v={ver_match.group(1)}"
            for hf in html_files:
                if expected_qs not in hf.read_text(encoding="utf-8"):
                    errors.append(
                        f"[sw.js] CACHE_VERSION hash {ver_match.group(1)} does not match {expected_qs} in {hf.relative_to(DIST_DIR)}"
                    )

        precache_match = re.search(r"const PRECACHE_URLS = (\[.*?\]);", sw_text, re.S)
        if not precache_match:
            errors.append("[sw.js] Missing PRECACHE_URLS manifest")
        else:
            try:
                precache_urls = json.loads(precache_match.group(1))
                total_bytes = 0
                for u in precache_urls:
                    clean = u.split("?")[0]
                    if clean.startswith("/admin") or "admin.css" in clean or "admin.js" in clean:
                        errors.append(f"[sw.js] Admin route/asset must not be precached: {u}")
                    if clean == "/":
                        p = DIST_DIR / "index.html"
                    elif clean.endswith("/"):
                        p = DIST_DIR / clean.lstrip("/") / "index.html"
                    else:
                        p = DIST_DIR / clean.lstrip("/")
                    if not p.is_file():
                        errors.append(f"[sw.js] Precached URL does not exist in dist/: {u}")
                    else:
                        total_bytes += p.stat().st_size
                if total_bytes > MAX_PRECACHE_BYTES:
                    errors.append(
                        f"[sw.js] Precache budget exceeded: {total_bytes / (1024 * 1024):.2f} MB > {MAX_PRECACHE_BYTES / (1024 * 1024):.2f} MB"
                    )
            except json.JSONDecodeError as exc:
                errors.append(f"[sw.js] Invalid PRECACHE_URLS JSON: {exc}")

    # Verify Cloudflare Pages _headers
    headers_path = DIST_DIR / "_headers"
    if headers_path.exists():
        hdr_text = headers_path.read_text(encoding="utf-8")
        for req_hdr in ("/sw.js", "no-cache, no-store, must-revalidate", "application/manifest+json"):
            if req_hdr not in hdr_text:
                errors.append(f"[_headers] Missing required Cloudflare PWA header directive: {req_hdr}")

    return errors


def main():
    parser = argparse.ArgumentParser(description="Build HolaRise static website")
    parser.add_argument("--check", action="store_true", help="Run automated SEO & link verification after build")
    args = parser.parse_args()

    urls = build_site()
    print(f"Built {len(urls)} pages successfully into {DIST_DIR}")

    if args.check:
        errors = verify_dist()
        if errors:
            print("Verification FAILED:")
            for err in errors:
                print("  -", err)
            sys.exit(1)
        print("Verification PASSED: All HTML pages, SEO tags, JSON-LD schemas, alt texts, and internal links are valid.")


if __name__ == "__main__":
    main()
