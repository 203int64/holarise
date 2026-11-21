#!/usr/bin/env python3
"""
Static Site Generator (Zero external dependencies - Python 3 stdlib only)
v4 Apple / Editorial Gallery & ASEZ WAO Edition
"""

import argparse
import datetime
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = ROOT / "templates"
ASSETS_DIR = ROOT / "assets"
DIST_DIR = ROOT / "dist"


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


def render_hero_headline_lines(headline: str) -> str:
    parts = [part.strip() for part in headline.split(",") if part.strip()]
    if len(parts) >= 2:
        lines = [parts[0] + ",", ", ".join(parts[1:])]
    else:
        lines = [headline]
    rendered = []
    for idx, line in enumerate(lines):
        safe = esc(line)
        if idx == 0 and "Hòa Lạc" in line:
            safe = safe.replace("Hòa Lạc", '<span class="accent-word">Hòa Lạc</span>', 1)
        rendered.append(f'<span class="split-line-mask"><span class="split-line-inner">{safe}</span></span>')
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
    <button class="btn btn--outline btn--sm" type="button" data-register-event="{esc(ws['title'])}">Đăng ký giữ chỗ</button>
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


def render_blueprint(items: list) -> str:
    rows = []
    for item in items:
        img = esc(item.get("image", "/assets/images/hero-hoalac.jpg"))
        alt = esc(item.get("imageAlt", item["title"]))
        rows.append(
            f"""<article class="blueprint-row" data-stagger-item data-hover-photo="{img}" data-hover-alt="{alt}">
        <span class="blueprint-code">{esc(item['code'])}</span>
        <h3 class="blueprint-title">{esc(item['title'])}</h3>
        <p class="blueprint-desc">{esc(item['description'])}</p>
        <span class="blueprint-arrow" aria-hidden="true"><span class="arrow-swap"><span>↗</span><span>↗</span></span></span>
      </article>"""
        )
    return "\n      ".join(rows)


def render_charter(principles: list) -> str:
    items = []
    for idx, p in enumerate(principles, start=1):
        items.append(
            f"""<article class="charter-item" data-stagger-item>
        <span class="charter-num">CAM KẾT 0{idx}</span>
        <h3>{esc(p['title'])}</h3>
        <p>{esc(p['description'])}</p>
      </article>"""
        )
    return "\n      ".join(items)


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
        tabs.append(
            f'<button class="story-tab{active_cls}" type="button" role="tab" aria-selected="{selected}" data-story-tab="{idx}">{num} · {esc(p["badge"])}</button>'
        )

        highlights_html = "".join(f"<li>{esc(h)}</li>" for h in p["highlights"])
        sdg_tags = " ".join(f"<span>{esc(s)}</span>" for s in p.get("sdgs", []))
        cta_href = "/workshop/" if p["id"] == "workshop" else f'/hoat-dong/#{esc(p["id"])}'
        cta_label = "Xem lịch Workshop" if p["id"] == "workshop" else "Khám phá chương trình"

        panels.append(
            f"""<article class="story-panel{active_cls}" data-story-panel="{idx}">
          <div class="story-mobile-media">
            <img src="{esc(p['image'])}" alt="{esc(p['imageAlt'])}" width="640" height="400" loading="lazy">
          </div>
          <div class="story-panel-index">{num} / 0{len(pillars)} — {esc(p['badge'])}</div>
          <h3>{esc(p['title'])}</h3>
          <p class="story-panel-summary">{esc(p['summary'])}</p>
          <ul class="clean-list">{highlights_html}</ul>
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;padding-top:16px;border-top:1px solid var(--line);">
            <div class="sdg-inline-tags">{sdg_tags}</div>
            <a class="arrow-link" href="{cta_href}"><span>{cta_label}</span><span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span></a>
          </div>
        </article>"""
        )

        priority_attr = ' fetchpriority="low" loading="lazy"' if idx > 0 else ' loading="lazy"'
        slides.append(
            f"""<div class="story-slide{active_cls}" data-story-slide="{idx}">
          <img src="{esc(p['image'])}" alt="{esc(p['imageAlt'])}" width="960" height="720"{priority_attr}>
        </div>"""
        )

    return f"""<div class="story-stage" data-story-stage>
      <div>
        <div class="story-odometer-row" aria-hidden="true">
          <div class="story-odometer">
            <div class="story-odometer-drum" data-odometer-drum>
              {"".join(odometer_digits)}
            </div>
          </div>
          <span class="story-odometer-total">/ 0{len(pillars)}</span>
        </div>
        <div class="story-nav" role="tablist" aria-label="Chọn chương trình trọng tâm">
          {" ".join(tabs)}
        </div>
        <div class="story-panels">
          {" ".join(panels)}
        </div>
      </div>

      <div class="story-media-frame">
        {" ".join(slides)}
      </div>
    </div>"""


def render_pillars(pillars: list, detailed: bool = False) -> str:
    cards = []
    for p in pillars:
        highlights_html = "".join(f"<li>{esc(h)}</li>" for h in p["highlights"])
        sdg_tags = " · ".join(esc(s) for s in p.get("sdgs", []))
        anchor_id = f' id="{esc(p["id"])}"' if detailed else ""
        cta_href = "/workshop/" if p["id"] == "workshop" else f'/hoat-dong/#{esc(p["id"])}'
        cta_label = "Xem lịch Workshop" if p["id"] == "workshop" else "Tìm hiểu chi tiết"
        footer_html = (
            f'<div class="card-footer"><span class="seats-note">{sdg_tags}</span></div>'
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
        <ul class="clean-list">{highlights_html}</ul>
        {footer_html}
      </article>"""
        )
    return "\n      ".join(cards)


def render_workshops(upcoming: list) -> str:
    cards = []
    for ws in upcoming:
        cards.append(
            f"""<article class="editorial-card" data-stagger-item>
        <div class="plate-media" data-curtain>
          <img src="{esc(ws['image'])}" alt="{esc(ws['imageAlt'])}" width="640" height="420" loading="lazy">
        </div>
        <div class="card-meta">
          <span class="cat">{esc(ws['type'])}</span>
          <span>·</span>
          <span>{esc(ws['dateDisplay'])}</span>
        </div>
        <h3 class="card-title">{esc(ws['title'])}</h3>
        <p class="card-text">{esc(ws['summary'])}</p>
        <div class="event-meta-list">
          <div class="event-meta-row"><strong>Thời gian:</strong> <span>{esc(ws['time'])}</span></div>
          <div class="event-meta-row"><strong>Địa điểm:</strong> <span>{esc(ws['location'])}</span></div>
          <div class="event-meta-row"><strong>Chi phí:</strong> <span>{esc(ws['fee'])}</span></div>
        </div>
        <div class="card-footer">
          <span class="seats-note">{esc(ws['seats'])}</span>
          <button class="btn btn--primary btn--sm" type="button" data-register-event="{esc(ws['title'])}">Đăng ký giữ chỗ</button>
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
        attr = f' data-news-card data-category="{esc(a["categorySlug"])}"' if filterable else ""
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
          <span>·</span>
          <span>{esc(a['readTime'])}</span>
        </div>
        <h3 class="card-title"><a href="{href}">{esc(a['title'])}</a></h3>
        <p class="card-text">{esc(a['excerpt'])}</p>
        <div class="card-footer">
          <a class="arrow-link" href="{href}">Đọc bài viết →</a>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


def render_campaigns(campaigns: list) -> str:
    cards = []
    for c in campaigns:
        cards.append(
            f"""<article class="editorial-card" data-stagger-item data-campaign-card data-category="{esc(c['category'])}">
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
        <div class="event-meta-list">
          <div class="event-meta-row"><strong>Địa điểm:</strong> <span>{esc(c['location'])}</span></div>
          <div class="event-meta-row"><strong>Kết quả:</strong> <span>{esc(c['metric'])}</span></div>
        </div>
        <div class="card-footer">
          <button class="btn btn--outline btn--sm" type="button" data-register-event="{esc(c['title'])}">Đăng ký đồng hành</button>
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
        cards.append(
            f"""<article class="value-col" data-stagger-item>
        <span class="value-num">0{idx}</span>
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
        "logo": abs_url(b["siteUrl"], b["logoDark"]),
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
):
    b = site["brand"]
    c = site["contact"]
    canonical = abs_url(b["siteUrl"], url_path)
    og_img_url = abs_url(b["siteUrl"], og_image or b["ogImage"])
    json_ld_html = "\n  ".join(json_ld_script(s) for s in schemas)

    rendered = render_template(
        base_tpl,
        {
            "PAGE_TITLE": esc(title),
            "PAGE_DESCRIPTION": esc(description),
            "PAGE_KEYWORDS": esc(site["seo"]["keywords"]),
            "CANONICAL_URL": esc(canonical),
            "OG_TYPE": esc(og_type),
            "OG_IMAGE_URL": esc(og_img_url),
            "BODY_CLASS": esc(body_class),
            "BRAND_FULL_NAME": esc(b["fullName"]),
            "BRAND_SUBTITLE": esc(b["subtitle"]),
            "BRAND_TAGLINE": esc(b["tagline"]),
            "LOGO_DARK": esc(b["logoDark"]),
            "LOGO_LIGHT": esc(b["logoLight"]),
            "NAV_LINKS": build_nav_links(url_path),
            "MAIN_CONTENT": main_content,
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_MEETING": esc(c["meetingTime"]),
            "FORM_ENDPOINT": esc(c.get("formEndpoint", "")),
            "CURRENT_YEAR": str(datetime.date.today().year),
            "JSON_LD_SCRIPTS": json_ld_html,
        },
    )

    out_path = DIST_DIR / out_rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(rendered, encoding="utf-8")


def build_site() -> list:
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

    # 1. Home page
    home_main = render_template(
        load_template("home.html"),
        {
            "HERO_IMAGE": esc(h["image"]),
            "HERO_IMAGE_ALT": esc(h["imageAlt"]),
            "HERO_BADGE": esc(h["badge"]),
            "HERO_HEADLINE_LINES": render_hero_headline_lines(h["headline"]),
            "HERO_DESCRIPTION": esc(h["description"]),
            "HERO_PRIMARY_HREF": esc(h["primaryCta"]["href"]),
            "HERO_PRIMARY_LABEL": esc(h["primaryCta"]["label"]),
            "HERO_SECONDARY_HREF": esc(h["secondaryCta"]["href"]),
            "HERO_SECONDARY_LABEL": esc(h["secondaryCta"]["label"]),
            "HERO_UPCOMING_BAR": render_hero_upcoming_bar(workshops["upcoming"]),
            "BLUEPRINT_HTML": render_blueprint(site.get("projectBlueprint", [])),
            "IMPACT_METRICS_HTML": render_impact_metrics(site["impactMetrics"]),
            "STORY_STAGE_HTML": render_story_stage(activities["pillars"]),
            "PHILOSOPHY_QUOTE": esc(p["quote"]),
            "PHILOSOPHY_QUOTE_AUTHOR": esc(p["quoteAuthor"]),
            "PHILOSOPHY_MOTTO": esc(p["motto"]),
            "PHILOSOPHY_MISSION": esc(p["mission"]),
            "PHILOSOPHY_VISION": esc(p["vision"]),
            "CHARTER_HTML": render_charter(site["principles"]),
            "UPCOMING_WORKSHOPS_HTML": render_workshops(workshops["upcoming"]),
            "SDGS_HTML": render_sdgs(site["sdgs"]),
            "HORIZONTAL_GALLERY_HTML": render_horizontal_gallery(activities["gallery"]),
            "LATEST_NEWS_HTML": render_news_cards(news[:3], filterable=False),
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
        *events_schema(site, workshops["upcoming"][:1]),
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
            "UPCOMING_WORKSHOPS_HTML": render_workshops(workshops["upcoming"]),
            "PAST_WORKSHOPS_HTML": render_past_workshops(workshops["pastTopics"]),
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
            *events_schema(site, workshops["upcoming"]),
        ],
    )
    sitemap_urls.append(("/workshop/", "0.9", "weekly"))

    # 5. News list page
    news_list_main = render_template(
        load_template("news_list.html"),
        {
            "NEWS_LIST_HTML": render_news_cards(news, filterable=True),
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
                "logo": {"@type": "ImageObject", "url": abs_url(b["siteUrl"], b["logoDark"])},
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

    # 7. Join & Contact page
    c = site["contact"]
    join_main = render_template(
        load_template("join.html"),
        {
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "FORM_ENDPOINT": esc(c.get("formEndpoint", "")),
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_MEETING": esc(c["meetingTime"]),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
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

    # 8. Technical SEO files: sitemap.xml, robots.txt, site.webmanifest
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

Sitemap: {abs_url(b['siteUrl'], '/sitemap.xml')}
"""
    (DIST_DIR / "robots.txt").write_text(robots_txt, encoding="utf-8")

    manifest = {
        "name": b["fullName"],
        "short_name": b["shortName"],
        "description": b["subtitle"],
        "start_url": "/",
        "display": "standalone",
        "background_color": "#FFFFFF",
        "theme_color": "#0B6E4F",
        "icons": [
            {
                "src": "/assets/images/favicon.svg",
                "sizes": "any",
                "type": "image/svg+xml",
            }
        ],
    }
    (DIST_DIR / "site.webmanifest").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

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

        for required in ["<title>", 'name="description"', 'rel="canonical"', 'property="og:title"', 'property="og:image"']:
            if required not in text:
                errors.append(f"[{rel}] Missing SEO tag: {required}")

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
            if 'src=""' in img_tag:
                continue
            if 'alt=""' in img_tag or "alt=" not in img_tag:
                errors.append(f"[{rel}] Image missing descriptive alt: {img_tag[:80]}")

    for required_file in ["sitemap.xml", "robots.txt", "site.webmanifest"]:
        if not (DIST_DIR / required_file).exists():
            errors.append(f"Missing technical SEO file: {required_file}")

    return errors


def main():
    parser = argparse.ArgumentParser(description="Build Lạc Xanh static website")
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
