#!/usr/bin/env python3
"""
Static Site Generator (Zero external dependencies - Python 3 stdlib only)
v6 Visual-First Mobile & Smart Compact HR Logo Edition
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import html
import json
import re
import shutil
import struct
import sys
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode, urlparse

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


@lru_cache(maxsize=1)
def image_widths() -> dict:
    # The same JSON-shaped data is imported as a JS module by Pages Functions.
    module = (DATA_DIR / "image-widths.js").read_text(encoding="utf-8").strip()
    return json.loads(module.removeprefix("export default ").removesuffix(";"))


def image_variant(src: str, width: int) -> str:
    stem = src.removeprefix("/assets/images/").rsplit(".", 1)[0]
    return f"/assets/images/web/{stem}-{width}.webp"


def full_image_url(src: str) -> str:
    widths = image_widths().get(src)
    return image_variant(src, widths[-1]) if widths else src


def image_attrs(src: str, sizes: str) -> str:
    attrs = f'src="{esc(src)}"'
    widths = image_widths().get(src)
    if not widths:
        return attrs
    srcset = ", ".join(f"{image_variant(src, width)} {width}w" for width in widths)
    return f'{attrs} srcset="{esc(srcset)}" sizes="{esc(sizes)}"'


def srcset_urls(srcset: str) -> list:
    return [candidate.split()[0] for candidate in srcset.split(",") if candidate.strip()]


def format_inline_pillar_tags(text: str, lang: str = "vi") -> str:
    """Wrap (HolaHeart), (HolaGreen), (HolaConnect) in interactive pillar tags."""
    safe = esc(text)
    base = "/en/schedule/" if lang == "en" else "/lich-hoat-dong/"
    pillars = (
        ("HolaHeart", f"{base}?nhom=holaheart", "holaheart"),
        ("HolaGreen", f"{base}?nhom=holagreen", "holagreen"),
        ("HolaConnect", f"{base}?nhom=holaconnect", "holaconnect"),
    )
    for name, href, slug in pillars:
        tag_html = f'<a class="pillar-inline-tag pillar-inline-tag--{slug}" href="{href}">{name}</a>'
        safe = safe.replace(f"({name})", tag_html)
    return safe


def minify_css(css_text: str) -> str:
    """Safe, dependency-free CSS minifier: preserves quoted strings, url(), and calc() spacing."""
    tokens = []
    # Tokenize strings, url(...), and comments so we never corrupt data URIs or content values.
    pattern = re.compile(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|url\([^)]*\)|/\*[\s\S]*?\*/)')
    pos = 0
    for m in pattern.finditer(css_text):
        chunk = css_text[pos:m.start()]
        if chunk:
            chunk = re.sub(r"\s+", " ", chunk)
            chunk = re.sub(r"\s*([{}:;,>~])\s*", r"\1", chunk)
            chunk = chunk.replace(";}", "}")
            tokens.append(chunk)
        tok = m.group(0)
        if not tok.startswith("/*"):
            tokens.append(tok)
        pos = m.end()
    tail = css_text[pos:]
    if tail:
        tail = re.sub(r"\s+", " ", tail)
        tail = re.sub(r"\s*([{}:;,>~])\s*", r"\1", tail)
        tail = tail.replace(";}", "}")
        tokens.append(tail)
    # Restore required space after media-query/supports keywords like `and(` or `not(` without breaking `:not(`
    out = "".join(tokens).strip()
    out = re.sub(r"(?<![:\w-])(and|or|not)\(", r"\1 (", out)
    return out


def render_template(template: str, mapping: dict) -> str:
    result = template
    for key, val in mapping.items():
        result = result.replace("{{" + key + "}}", str(val))
    return "\n".join(line.rstrip() for line in result.split("\n"))


def abs_url(site_url: str, path: str) -> str:
    base = site_url.rstrip("/")
    if not path.startswith("/"):
        path = "/" + path
    return base + path


def json_ld_script(data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    return f'<script type="application/ld+json">\n{payload}\n</script>'


def _is_nav_item_active(active_path: str, href: str) -> bool:
    if active_path == href:
        return True
    if href in ("/", "/en/"):
        return active_path == href
    if active_path.startswith(href):
        return True
    if href == "/lich-hoat-dong/" and active_path.startswith("/su-kien/"):
        return True
    if href == "/en/schedule/" and active_path.startswith("/en/events/"):
        return True
    return False


def resolve_lang_pair(url_path: str) -> tuple[str | None, str | None]:
    """Return (vi_path, en_path) for any paired public route, or (None, None)."""
    static_pairs = (
        ("/", "/en/"),
        ("/gioi-thieu/", "/en/about/"),
        ("/lich-hoat-dong/", "/en/schedule/"),
        ("/hanh-trinh/", "/en/journey/"),
        ("/tham-gia/", "/en/join/"),
        ("/chinh-sach/", "/en/privacy/"),
    )
    for vi_p, en_p in static_pairs:
        if url_path == vi_p or url_path == en_p:
            return (vi_p, en_p)
    if url_path.startswith("/su-kien/") and len(url_path) > len("/su-kien/"):
        slug = url_path[len("/su-kien/"):].strip("/")
        if slug and "/" not in slug:
            return (f"/su-kien/{slug}/", f"/en/events/{slug}/")
    if url_path.startswith("/en/events/") and len(url_path) > len("/en/events/"):
        slug = url_path[len("/en/events/"):].strip("/")
        if slug and "/" not in slug:
            return (f"/su-kien/{slug}/", f"/en/events/{slug}/")
    if url_path.startswith("/hanh-trinh/") and len(url_path) > len("/hanh-trinh/"):
        slug = url_path[len("/hanh-trinh/"):].strip("/")
        if slug and "/" not in slug:
            return (f"/hanh-trinh/{slug}/", f"/en/journey/{slug}/")
    if url_path.startswith("/en/journey/") and len(url_path) > len("/en/journey/"):
        slug = url_path[len("/en/journey/"):].strip("/")
        if slug and "/" not in slug:
            return (f"/hanh-trinh/{slug}/", f"/en/journey/{slug}/")
    return (None, None)


def build_nav_links(active_path: str) -> str:
    is_en = active_path == "/en/" or active_path.startswith("/en/")
    items = (
        [
            ("/en/about/", "About"),
            ("/en/schedule/", "Schedule"),
            ("/en/journey/", "Journey"),
        ]
        if is_en
        else [
            ("/gioi-thieu/", "Về HolaRise"),
            ("/lich-hoat-dong/", "Lịch hoạt động"),
            ("/hanh-trinh/", "Hành trình"),
        ]
    )
    links = []
    for href, label in items:
        is_active = _is_nav_item_active(active_path, href)
        cls = "nav-link is-active" if is_active else "nav-link"
        aria = ' aria-current="page"' if active_path == href else ""
        links.append(f'<a class="{cls}" href="{href}"{aria}>{esc(label)}</a>')
    return "\n        ".join(links)


def build_mobile_nav_links(active_path: str) -> str:
    is_en = active_path == "/en/" or active_path.startswith("/en/")
    items = (
        [
            ("/en/", "01", "Home"),
            ("/en/about/", "02", "About"),
            ("/en/schedule/", "03", "Schedule"),
            ("/en/journey/", "04", "Journey"),
        ]
        if is_en
        else [
            ("/", "01", "Trang chủ"),
            ("/gioi-thieu/", "02", "Về HolaRise"),
            ("/lich-hoat-dong/", "03", "Lịch hoạt động"),
            ("/hanh-trinh/", "04", "Hành trình"),
        ]
    )
    links = []
    for idx, (href, num, label) in enumerate(items):
        is_active = _is_nav_item_active(active_path, href)
        cls = "drawer-link is-active" if is_active else "drawer-link"
        aria = ' aria-current="page"' if active_path == href else ""
        links.append(
            f'<a class="{cls}" href="{href}" style="--i: {idx};"{aria}>'
            f'<span class="drawer-link-num">{num}</span>'
            f'<span class="drawer-link-label">{esc(label)}</span>'
            f'<span class="drawer-link-arrow" aria-hidden="true">→</span>'
            f"</a>"
        )
    return "\n        ".join(links)


def build_mobile_dock(active_path: str) -> str:
    is_en = active_path == "/en/" or active_path.startswith("/en/")
    items = [
        (
            "/en/" if is_en else "/",
            "Home" if is_en else "Trang chủ",
            '<path pathLength="1" d="M3 10.5 12 3l9 7.5"></path><path pathLength="1" d="M5.5 9.5V20h13V9.5"></path>',
        ),
        (
            "/en/schedule/" if is_en else "/lich-hoat-dong/",
            "Schedule" if is_en else "Lịch",
            '<rect pathLength="1" x="3" y="5" width="18" height="16" rx="2.5"></rect><path pathLength="1" d="M16 3v4M8 3v4M3 10h18"></path>',
        ),
        (
            "/en/journey/" if is_en else "/hanh-trinh/",
            "Journey" if is_en else "Hành trình",
            '<path pathLength="1" d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5Z"></path><path pathLength="1" d="M8 7h8M8 11h8M8 15h5"></path>',
        ),
        (
            "/en/join/" if is_en else "/tham-gia/",
            "Join" if is_en else "Tham gia",
            '<path pathLength="1" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>',
        ),
    ]
    active_idx = -1
    links = []
    for idx, (href, label, svg_body) in enumerate(items):
        is_active = _is_nav_item_active(active_path, href)
        if is_active:
            active_idx = idx
        cls = "mobile-dock-link is-active" if is_active else "mobile-dock-link"
        aria = ' aria-current="page"' if is_active else ""
        stroke_w = "2.05" if is_active else "1.8"
        links.append(
            f'<a class="{cls}" href="{href}" aria-label="{esc(label)}"{aria}>'
            f'<svg class="mobile-dock-icon" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{stroke_w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{svg_body}</svg>'
            f'<span class="mobile-dock-label" aria-hidden="true">{esc(label)}</span>'
            f"</a>"
        )
    nav_label = "Primary navigation" if is_en else "Điều hướng chính"
    ind_idx = max(0, active_idx)
    inner = "\n    ".join(links)
    return (
        f'<nav class="mobile-dock" id="mobile-dock" data-mobile-dock data-active="{active_idx}" '
        f'style="--i: {ind_idx};" aria-label="{nav_label}">\n'
        f'    <span class="mobile-dock-ind" aria-hidden="true"></span>\n'
        f'    {inner}\n'
        f"  </nav>"
    )


def derive_pillar_filter(label: str = "", filters: list = None, fallback_slug: str = "") -> str:
    tokens = [str(x or "").lower() for x in (filters or [])]
    for t in tokens:
        if t in ("holaheart", "holagreen", "holaconnect"):
            return t
    lower = f"{label or ''} {fallback_slug or ''}".lower()
    if "holagreen" in lower or "moi-truong" in lower or "sach" in tokens:
        return "holagreen"
    if "holaconnect" in lower or "cong-dong" in lower or "se-chia" in tokens:
        return "holaconnect"
    if "holaheart" in lower or "workshop" in lower or "biet-on" in tokens:
        return "holaheart"
    return "holaheart"


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


def resolve_event_slug(ws: dict) -> str:
    if not isinstance(ws, dict):
        return ""
    landing = ws.get("landing")
    if isinstance(landing, dict) and str(landing.get("slug") or "").strip():
        return str(landing["slug"]).strip().strip("/")
    raw_href = str(ws.get("href") or "").strip()
    if raw_href.startswith("/su-kien/"):
        return raw_href[len("/su-kien/"):].strip("/")
    ev_id = str(ws.get("id") or "").strip().lower()
    return re.sub(r"[^a-z0-9-]+", "-", ev_id).strip("-")


def resolve_event_href(ws: dict) -> str:
    if not isinstance(ws, dict):
        return ""
    raw = str(ws.get("href") or "").strip()
    if raw.startswith("/") and not raw.startswith("//"):
        return raw
    slug = resolve_event_slug(ws)
    return f"/su-kien/{slug}/" if slug else ""


def render_hero_upcoming_bar(upcoming: list) -> str:
    if not upcoming:
        return ""
    ws = upcoming[0]
    event_href = resolve_event_href(ws)
    title_html = (
        f'<a class="upcoming-title upcoming-title--link" href="{esc(event_href)}">{esc(ws["title"])}</a>'
        if event_href
        else f'<span class="upcoming-title">{esc(ws["title"])}</span>'
    )
    if event_href:
        actions_html = f"""<div class="upcoming-bar-actions">
      <a class="btn btn--primary btn--sm" href="{esc(event_href)}">Xem thư mời &amp; Giữ chỗ →</a>
      <button class="btn btn--outline btn--sm" type="button" data-register-event="{esc(ws['title'])}" data-event-id="{esc(ws['id'])}" data-event-date="{esc(ws['dateDisplay'])}" data-event-time="{esc(ws['time'])}" data-event-location="{esc(ws['location'])}" data-venue-url="{esc(ws.get('venueUrl', ''))}" data-event-fee="{esc(ws['fee'])}" data-event-type="{esc(ws['type'])}" data-event-href="{esc(event_href)}">Giữ chỗ nhanh</button>
    </div>"""
    else:
        actions_html = f"""<button class="btn btn--outline btn--sm" type="button" data-register-event="{esc(ws['title'])}" data-event-id="{esc(ws['id'])}" data-event-date="{esc(ws['dateDisplay'])}" data-event-time="{esc(ws['time'])}" data-event-location="{esc(ws['location'])}" data-event-fee="{esc(ws['fee'])}" data-event-type="{esc(ws['type'])}">Giữ chỗ tham gia</button>"""

    return f"""<div class="upcoming-bar" aria-label="Sự kiện sắp diễn ra">
  <div class="container upcoming-bar-inner">
    <div class="upcoming-bar-info">
      <span class="upcoming-bar-badge"><span class="upcoming-dot" aria-hidden="true"></span><span class="upcoming-label">Sắp diễn ra</span></span>
      {title_html}
      <span class="upcoming-sep" aria-hidden="true">·</span>
      <span class="upcoming-date">{esc(ws['dateDisplay'])} ({esc(ws['time'])})</span>
      <span class="upcoming-sep" aria-hidden="true">·</span>
      <span class="upcoming-fee">{esc(ws['fee'])}</span>
    </div>
    {actions_html}
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


def render_image_tooltip(alt: str, label: str = "") -> str:
    """Keep photo provenance and context available without a persistent image badge."""
    detail = (alt or "").strip()
    generated_prefix = "Ảnh minh họa:"
    if detail.startswith(generated_prefix):
        detail = detail[len(generated_prefix):].strip()
    parts = [part.strip() for part in (label, detail) if part and part.strip()]
    caption = " · ".join(parts)
    return f'<span class="image-note-caption" aria-hidden="true">{esc(caption)}</span>' if caption else ""


def compact_location(raw: str) -> str:
    loc = str(raw or "").strip()
    if not loc:
        return ""
    loc = re.sub(r"\s*\([^)]*\)\s*", " ", loc).strip()
    return re.sub(r"\s{2,}", " ", loc)


def render_home_pillars_grid(pillars: list, lang: str = "vi") -> str:
    is_en = lang == "en"
    cards = []
    for idx, p in enumerate(pillars):
        num = f"0{idx + 1}"
        filter_key = p.get("filterKey") or derive_pillar_filter(p.get("badge", ""), [], p.get("id", ""))
        title = (p.get("titleEn") if is_en else None) or p["title"]
        short_desc = ((p.get("shortSummaryEn") or p.get("summaryEn")) if is_en else (p.get("shortSummary") or p.get("summary")) or "").strip()
        metric_badge = ((p.get("metricBadgeEn") if is_en else p.get("metricBadge")) or "").strip()
        status_html = f'<span class="pillar-editorial-status">{esc(metric_badge)}</span>' if metric_badge else ""
        cta_href = f"{'/en/schedule/' if is_en else '/lich-hoat-dong/'}?nhom={esc(filter_key)}"
        cta_more = f"{esc(p['badge'])} schedule" if is_en else f"Xem lịch {esc(p['badge'])}"
        img_alt = (p.get("imageAltEn") if is_en else None) or p["imageAlt"]
        priority_attr = ' fetchpriority="low" loading="lazy" decoding="async"' if idx > 0 else ' loading="lazy" decoding="async"'
        orient_chip = (
            f'<span class="visual-orientation-chip">{"Concept Visual" if is_en else "Ảnh định hướng"}</span>'
            if p.get("imageIsIllustration")
            else ""
        )
        cards.append(
            f"""<article class="pillar-editorial-card" data-stagger-item data-pillar="{esc(filter_key)}">
        <div class="pillar-editorial-media" data-curtain>
          <!-- CMS:PILLAR_SLIDE_{idx}:START -->
          <img {image_attrs(p['image'], '(max-width: 760px) calc(100vw - 40px), 380px')} alt="{esc(img_alt)}" width="960" height="720"{priority_attr}>{orient_chip}
          <!-- CMS:PILLAR_SLIDE_{idx}:END -->
        </div>
        <div class="pillar-editorial-body">
          <div class="pillar-editorial-meta">
            <span class="pillar-editorial-num">{num} · {esc(p['badge'])}</span>
            {status_html}
          </div>
          <h3 class="pillar-editorial-title">
            <a class="card-link" href="{cta_href}">{esc(title)}</a>
          </h3>
          <p class="pillar-editorial-desc">{esc(short_desc)}</p>
          <div class="pillar-editorial-foot">
            <span class="pillar-editorial-more">{cta_more}</span>
            <span class="circle-go" aria-hidden="true">→</span>
          </div>
        </div>
      </article>"""
        )
    return f"""<div class="pillar-editorial-grid" data-stagger-group>
      {" ".join(cards)}
    </div>"""


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
        filter_key = p.get("filterKey") or derive_pillar_filter(p.get("badge", ""), [], p.get("id", ""))
        tabs.append(
            f'<button class="story-tab{active_cls}" type="button" role="tab" aria-selected="{selected}" data-story-tab="{idx}" data-pillar="{esc(filter_key)}">{esc(tab_label)}</button>'
        )

        chips_html = "".join(f'<span class="visual-chip">{esc(h)}</span>' for h in p["highlights"])
        metric_badge = p.get("metricBadge", "")
        metric_html = f'<span class="story-metric-pill">{esc(metric_badge)}</span>' if metric_badge else ""
        cta_href = f"/lich-hoat-dong/?nhom={esc(filter_key)}"
        cta_label = f"Xem lịch {p['badge']}"

        panels.append(
            f"""<article class="story-panel{active_cls}" data-story-panel="{idx}" data-pillar="{esc(filter_key)}">
          <div class="story-panel-index">{num} / 0{len(pillars)} — {esc(p['badge'])}</div>
          <h3 data-i18n="pillar.{esc(filter_key)}.title">{esc(p['title'])}</h3>
          <p class="story-panel-summary" data-i18n="pillar.{esc(filter_key)}.summary">{esc(p['summary'])}</p>
          <div class="visual-chip-row" aria-label="Hoạt động tiêu biểu">{chips_html}</div>
          <div class="story-panel-footer">
            {metric_html}
            <a class="arrow-link" href="{cta_href}"><span data-i18n="pillar.{esc(filter_key)}.cta">{esc(cta_label)}</span><span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span></a>
          </div>
        </article>"""
        )

        priority_attr = ' fetchpriority="low" loading="lazy" decoding="async"' if idx > 0 else ' loading="lazy" decoding="async"'
        image_label = "HolaHeart · 15/11/2026" if filter_key == "holaheart" else f"{p['badge']} · Hòa Lạc"
        orient_chip = (
            '<span class="visual-orientation-chip" data-i18n="media.orientation">Ảnh định hướng</span>'
            if p.get("imageIsIllustration")
            else ""
        )
        slides.append(
            f"""<div class="story-slide image-note{active_cls}" data-story-slide="{idx}" data-pillar="{esc(filter_key)}" tabindex="{0 if idx == 0 else -1}" role="group" aria-label="{esc(image_label)} · {esc(p['imageAlt'])}">
          <!-- CMS:PILLAR_SLIDE_{idx}:START -->
          <img {image_attrs(p['image'], '(max-width: 1023px) calc(100vw - 40px), 620px')} alt="{esc(p['imageAlt'])}" width="960" height="720"{priority_attr}>{orient_chip}
          <!-- CMS:PILLAR_SLIDE_{idx}:END -->
          {render_image_tooltip(p['imageAlt'], image_label)}
          <div class="story-slide-scrim" aria-hidden="true"></div>
        </div>"""
        )

    return f"""<div class="story-stage" data-story-stage>
      <div class="story-controls-col">
        <div class="story-nav" role="tablist" aria-label="Chọn trụ cột hoạt động" data-story-tablist>
          <span class="story-nav-glider" data-story-glider aria-hidden="true"></span>
          {" ".join(tabs)}
        </div>
        <div class="story-media-frame story-media-frame--mobile" data-story-swipe aria-label="Vuốt ngang để đổi trụ cột">
          {" ".join(slides)}
        </div>
        <div class="story-panels">
          {" ".join(panels)}
        </div>
      </div>

      <div class="story-media-frame story-media-frame--desktop">
        <div class="story-stage-hud" aria-hidden="true">
          <div class="story-odometer-row">
            <div class="story-odometer">
              <div class="story-odometer-drum" data-odometer-drum>
                {"".join(odometer_digits)}
              </div>
            </div>
            <span class="story-odometer-total">/ 0{len(pillars)}</span>
          </div>
          <span class="story-hud-kicker">Mô hình Tạo Tác Động</span>
        </div>
        {" ".join(slides)}
      </div>
    </div>"""


PILLAR_IDENTITY_META = {
    "holaheart": {
        "theme": "sunrise",
        "level_num": 1,
        "level_label": "Cấp độ 01 · Cá nhân (Tu thân)",
        "scale_label": "Từ một trái tim",
        "icon_svg": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
        "connector_next": "Từ nội lực bước ra cảnh quan",
    },
    "holagreen": {
        "theme": "emerald",
        "level_num": 2,
        "level_label": "Cấp độ 02 · Không gian sống (Hòa Lạc)",
        "scale_label": "Ra môi trường quanh mình",
        "icon_svg": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>',
        "connector_next": "Từ mảng xanh lan tỏa tới cộng đồng",
    },
    "holaconnect": {
        "theme": "obsidian",
        "level_num": 3,
        "level_label": "Cấp độ 03 · Cộng đồng & Xã hội (Lan tỏa)",
        "scale_label": "Tới cộng đồng rộng lớn",
        "icon_svg": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        "connector_next": "",
    },
}


def render_pillar_ripple_svg(level_num: int) -> str:
    radii = [46, 86, 126][: max(1, min(3, level_num))]
    circles = "".join(
        f'<circle cx="150" cy="150" r="{r}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-dasharray="{6 + idx * 4} {6 + idx * 2}" opacity="{0.65 - idx * 0.14:.2f}"/>'
        for idx, r in enumerate(radii)
    )
    return (
        '<svg class="pillar-ripple-bg" viewBox="0 0 300 300" aria-hidden="true">'
        '<circle cx="150" cy="150" r="9" fill="currentColor" opacity="0.22"/>'
        f"{circles}</svg>"
    )


def render_pillars(pillars: list, detailed: bool = False, lang: str = "vi") -> str:
    is_en = lang == "en"
    chapters = []
    for idx, p in enumerate(pillars, start=1):
        filter_key = p.get("filterKey") or derive_pillar_filter(p.get("badge", ""), [], p.get("id", ""))
        anchor_id = f' id="{esc(p["id"])}"' if detailed else ""
        reverse_cls = " pillar-chapter--reverse" if idx % 2 == 0 else ""

        cta_href = f"{'/en/schedule/' if is_en else '/lich-hoat-dong/'}?nhom={esc(filter_key)}"
        cta_label = f"View {p['badge']} schedule" if is_en else f"Xem lịch hoạt động {p['badge']}"
        title = (p.get("titleEn") if is_en else None) or p["title"]
        summary = (p.get("summaryEn") if is_en else None) or p["summary"]
        highlights_list = (p.get("highlightsEn") if is_en else None) or p.get("highlights", [])

        highlights_html = "".join(
            f"<li>{esc(h)}</li>"
            for h in highlights_list
        )

        story_text = (p.get("story") or "").strip() if not is_en else ""
        story_html = f'<p class="pillar-story">{esc(story_text)}</p>' if story_text else ""

        main_caption = ((p.get("imageCaptionEn") if is_en else p.get("imageCaption")) or title)
        main_alt = (p.get("imageAltEn") if is_en else None) or p["imageAlt"]
        photo_frames = [
            {
                "src": p["image"],
                "alt": main_alt,
                "caption": main_caption,
                "is_main": True,
            }
        ]
        for extra in p.get("storyPhotos", [])[:2]:
            ex_alt = (extra.get("altEn") if is_en else None) or (f"{p['badge']} gathering in Hoa Lac" if is_en else extra.get("alt", ""))
            ex_cap = (extra.get("captionEn") if is_en else None) or (f"{p['badge']} · 15 Nov 2026" if is_en else (extra.get("caption") or ex_alt))
            photo_frames.append(
                {
                    "src": extra.get("src", ""),
                    "alt": ex_alt,
                    "caption": ex_cap,
                    "is_main": False,
                }
            )

        collage_buttons = []
        orient_chip = (
            f'<span class="visual-orientation-chip">{"Concept Visual" if is_en else "Ảnh định hướng"}</span>'
            if p.get("imageIsIllustration")
            else ""
        )
        for frame in photo_frames:
            main_cls = " pillar-photo--main" if frame["is_main"] else ""
            cap = frame["caption"]
            full_cap = f"{p['badge']} · {cap}" if p["badge"] not in cap else cap
            loading_attr = 'loading="lazy" decoding="async"'
            width_attr = 'width="960" height="600"' if frame["is_main"] else 'width="480" height="300"'
            photo_sizes = (
                "(max-width: 960px) calc(100vw - 40px), 620px" if frame["is_main"]
                else "(max-width: 960px) calc((100vw - 52px) / 2), 300px"
            )
            if frame["is_main"]:
                img_block = f"""<!-- CMS:PILLAR_MAIN_{filter_key.upper()}:START -->
            <img {image_attrs(frame['src'], photo_sizes)} alt="{esc(frame['alt'])}" {width_attr} {loading_attr}>{orient_chip}
            <!-- CMS:PILLAR_MAIN_{filter_key.upper()}:END -->"""
            else:
                img_block = f'<img {image_attrs(frame["src"], photo_sizes)} alt="{esc(frame["alt"])}" {width_attr} {loading_attr}>'
            aria_prefix = "View photo" if is_en else "Xem ảnh"
            collage_buttons.append(
                f"""<button class="pillar-photo{main_cls}" type="button" aria-label="{aria_prefix}: {esc(cap)}" data-lightbox-src="{esc(full_image_url(frame['src']))}" data-lightbox-alt="{esc(frame['alt'])}" data-lightbox-caption="{esc(full_cap)}">
            {img_block}
            <span class="pillar-photo-cap" aria-hidden="true">{esc(cap)}</span>
          </button>"""
            )

        focus_aria = "Key focus areas" if is_en else "Trọng tâm hoạt động"
        chapters.append(
            f"""<article class="pillar-chapter{reverse_cls}"{anchor_id} data-pillar="{esc(filter_key)}" data-reveal data-mobile-pillar>
        <div class="pillar-chapter-copy">
          <div class="pillar-chapter-head" data-mobile-pillar-toggle>
            <div class="pillar-chapter-head-main">
              <div class="pillar-chapter-eyebrow">
                <span class="pillar-chapter-num">0{idx}</span>
                <span aria-hidden="true">·</span>
                <span class="pillar-chapter-kicker">{esc(p['badge'])}</span>
              </div>
              <h3>{esc(title)}</h3>
            </div>
            <span class="mobile-fold-indicator" aria-hidden="true"></span>
          </div>
          <div class="pillar-chapter-fold">
            <p class="pillar-lead">{esc(summary)}</p>
            {story_html}
            <ul class="pillar-focus-list" aria-label="{focus_aria}">
              {highlights_html}
            </ul>
            <div class="pillar-chapter-actions">
              <a class="arrow-link" href="{cta_href}"><span>{esc(cta_label)}</span><span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span></a>
            </div>
          </div>
        </div>
        <div class="pillar-collage">
          {"".join(collage_buttons)}
        </div>
      </article>"""
        )
    return "\n      ".join(chapters)


ICON_CALENDAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
ICON_PIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'


def compact_date_pill(date_display: str, lang: str = "vi") -> str:
    raw = (date_display or "").strip()
    if not raw:
        return ""
    if lang == "en":
        day_en = {
            "sunday": "Sun", "monday": "Mon", "tuesday": "Tue",
            "wednesday": "Wed", "thursday": "Thu", "friday": "Fri", "saturday": "Sat",
            "chủ nhật": "Sun", "thứ hai": "Mon", "thứ ba": "Tue",
            "thứ tư": "Wed", "thứ năm": "Thu", "thứ sáu": "Fri", "thứ bảy": "Sat",
        }
        lower = raw.lower()
        m_en = re.search(r"(\d{1,2}\s+[A-Za-z]{3})", raw)
        m_num = re.search(r"(\d{1,2}/\d{1,2})(?:/\d{2,4})?", raw)
        short_date = m_en.group(1) if m_en else (m_num.group(1) if m_num else raw)
        for full_day, short_day in day_en.items():
            if full_day in lower:
                return f"{short_day} · {short_date}"
        return short_date
    day_map = {
        "chủ nhật": "CN",
        "thứ hai": "T2",
        "thứ ba": "T3",
        "thứ tư": "T4",
        "thứ năm": "T5",
        "thứ sáu": "T6",
        "thứ bảy": "T7",
    }
    lower = raw.lower()
    m_date = re.search(r"(\d{1,2}/\d{1,2})(?:/\d{2,4})?", raw)
    short_date = m_date.group(1) if m_date else raw
    for full_day, short_day in day_map.items():
        if full_day in lower:
            return f"{short_day} · {short_date}"
    return short_date


def compact_pillar_label(type_str: str) -> str:
    raw = (type_str or "").strip()
    if not raw:
        return "HolaRise"
    return raw.split("·", 1)[0].strip() or raw


def compact_fee_label(fee_str: str, lang: str = "vi") -> str:
    raw = (fee_str or "").strip()
    if not raw:
        return "Free" if lang == "en" else "Miễn phí"
    head = raw.split("·", 1)[0].strip()
    lower = head.lower()
    if "miễn phí" in lower or "0đ" in lower or "free" in lower:
        return "Free" if lang == "en" else "Miễn phí"
    return head[:20]


def compact_seats_label(seats_str: str, lang: str = "vi") -> str:
    raw = (seats_str or "").strip()
    m = re.search(r"(\d+)", raw)
    if m:
        return f"{m.group(1)} seats" if lang == "en" else f"{m.group(1)} chỗ"
    return raw[:16]


def render_home_upcoming_cards(upcoming: list, keep_full_location: bool = False, lang: str = "vi") -> str:
    if not upcoming:
        return ""
    is_en = lang == "en"
    cards = []
    for ws in upcoming:
        pillar = derive_pillar_filter(ws.get("type", ""), ws.get("filters", []))
        token_set = [pillar] + [x for x in ws.get("filters", []) if x != pillar]
        vi_href = resolve_event_href(ws)
        event_href = (ws.get("hrefEn") or (f"/en/events/{resolve_event_slug(ws)}/" if vi_href else "")) if is_en else vi_href
        event_id_attr = f' data-event-id="{esc(ws["id"])}"' if ws.get("id") else ""
        event_href_attr = f' data-event-href="{esc(event_href)}"' if event_href else ""
        cat_attr = f' data-workshop-card data-pillar="{esc(pillar)}" data-category="{esc(" ".join(token_set))}"{event_id_attr}{event_href_attr}'
        title_text = (ws.get("titleEn") if is_en else None) or ws["title"]
        date_display = (ws.get("dateDisplayEn") if is_en else None) or ws.get("dateDisplay", "")
        type_text = (ws.get("typeEn") if is_en else None) or ws.get("type", "")
        fee_text = (ws.get("feeEn") if is_en else None) or ws.get("fee", "")
        loc_raw = (ws.get("locationEn") if is_en else None) or ws.get("location", "")
        img_alt = (ws.get("imageAltEn") if is_en else None) or ws["imageAlt"]
        date_pill = compact_date_pill(date_display, lang=lang)
        pillar_label = compact_pillar_label(type_text)
        fee_label = compact_fee_label(fee_text, lang=lang)
        seats_label = compact_seats_label(ws.get("seats", ""), lang=lang)
        meta_right = " · ".join(p for p in [fee_label, seats_label] if p)
        loc_text = loc_raw if keep_full_location else compact_location(loc_raw)
        info_line = " · ".join(p for p in [ws.get("time", ""), loc_text] if p)

        if event_href:
            title_html = f'<h3 class="card-title"><a class="card-link" href="{esc(event_href)}">{esc(title_text)}</a></h3>'
            go_html = '<span class="circle-go" aria-hidden="true">→</span>'
        else:
            title_html = f'<h3 class="card-title"><button class="card-link card-link--btn" type="button" data-register-event="{esc(title_text)}" data-event-id="{esc(ws["id"])}" data-event-date="{esc(date_display)}" data-event-time="{esc(ws["time"])}" data-event-location="{esc(loc_raw)}" data-event-fee="{esc(fee_text)}" data-event-type="{esc(type_text)}">{esc(title_text)}</button></h3>'
            go_html = '<span class="circle-go" aria-hidden="true">→</span>'

        cards.append(
            f"""<article class="event-card event-card--editorial" data-stagger-item{cat_attr}>
        <div class="event-card-media" data-curtain>
          <img {image_attrs(ws['image'], '(max-width: 820px) 84vw, 560px')} alt="{esc(img_alt)}" width="640" height="420" loading="lazy" decoding="async">
          <div class="event-card-badges">
            <span class="glass-badge">{esc(date_pill)}</span>
          </div>
        </div>
        <div class="event-card-body">
          <div class="event-card-eyebrow">
            <span class="cat">{esc(pillar_label)}</span>
            <span class="event-card-meta-pill">{esc(meta_right)}</span>
          </div>
          {title_html}
          <div class="event-card-foot">
            <span class="event-card-loc">{esc(info_line)}</span>
            {go_html}
          </div>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


def render_home_upcoming_section(upcoming: list, lang: str = "vi") -> str:
    if not upcoming:
        return ""
    is_en = lang == "en"
    rail_mod = " events-rail--duo" if len(upcoming) == 2 else (" events-rail--solo" if len(upcoming) == 1 else "")
    section_id = "upcoming" if is_en else "lich-hen"
    kicker = "This Week" if is_en else "Lịch tuần này"
    heading = "Upcoming in Hoa Lac" if is_en else "Sắp diễn ra tại Hòa Lạc"
    all_href = "/en/schedule/" if is_en else "/lich-hoat-dong/"
    all_label = "Full schedule" if is_en else "Tất cả lịch"
    return f"""<section class="section section--editorial-upcoming" id="{section_id}">
  <div class="container">
    <div class="section-header--split section-header--editorial" data-reveal>
      <div>
        <div class="kicker">{kicker}</div>
        <h2 class="section-title">{heading}</h2>
      </div>
      <a class="arrow-link" href="{all_href}">
        <span>{all_label}</span>
        <span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span>
      </a>
    </div>

    <div class="events-rail{rail_mod}" data-stagger-group>
      {render_home_upcoming_cards(upcoming, lang=lang)}
    </div>
  </div>
</section>"""


def render_schedule_upcoming_content(upcoming: list, lang: str = "vi") -> str:
    is_en = lang == "en"
    if not upcoming:
        if is_en:
            return """<div class="schedule-empty-flagship" role="status">
      <div class="schedule-empty-copy">
        <span class="kicker">Weekly Rhythm</span>
        <h3>Our coordinating team is preparing the next gatherings in Hoa Lac</h3>
        <p>HolaHeart, HolaGreen, and HolaConnect sessions rotate 1–2 times per week on a non-profit basis.</p>
      </div>
      <div class="schedule-empty-actions">
        <a class="btn btn--primary" href="/en/join/">Get your Member Pass for updates →</a>
        <a class="btn btn--outline" href="/en/about/#pillars">Explore 3 Pillars</a>
      </div>
    </div>"""
        return """<div class="schedule-empty-flagship" role="status">
      <div class="schedule-empty-copy">
        <span class="kicker">Nhịp hoạt động định kỳ</span>
        <h3>Ban Điều Phối đang chuẩn bị cho những cuộc gặp tiếp theo tại Hòa Lạc</h3>
        <p>Các buổi HolaHeart, HolaGreen và HolaConnect diễn ra luân phiên 1–2 buổi mỗi tuần theo tinh thần phi lợi nhuận.</p>
      </div>
      <div class="schedule-empty-actions">
        <a class="btn btn--primary" href="/tham-gia/">Tạo Thẻ Thành Viên nhận lịch mới →</a>
        <a class="btn btn--outline" href="/gioi-thieu/#chuong-trinh">Tìm hiểu 3 trụ cột</a>
      </div>
    </div>"""
    rail_mod = " events-rail--duo" if len(upcoming) == 2 else (" events-rail--solo" if len(upcoming) == 1 else "")
    empty_msg = "No upcoming gathering in this pillar this week." if is_en else "Hiện chưa có buổi sắp tới nào thuộc nhóm này trong tuần."
    reset_lbl = "View all gatherings" if is_en else "Xem tất cả lịch hoạt động"
    return f"""<div class="events-rail{rail_mod}" data-stagger-group>
      {render_home_upcoming_cards(upcoming, keep_full_location=True, lang=lang)}
    </div>
    <div class="filter-empty" data-filter-empty="[data-workshop-card]" hidden>
      <p>{empty_msg}</p>
      <button class="btn btn--outline btn--sm" type="button" data-filter-reset="[data-workshop-card]">{reset_lbl}</button>
    </div>"""


def render_join_event_options(upcoming: list, lang: str = "vi") -> str:
    is_en = lang == "en"
    cards = []
    for ws in upcoming:
        safe_id = esc(ws["id"])
        title = (ws.get("titleEn") if is_en else None) or ws["title"]
        date_display = (ws.get("dateDisplayEn") if is_en else None) or ws["dateDisplay"]
        location = (ws.get("locationEn") if is_en else None) or ws["location"]
        ev_type = (ws.get("typeEn") if is_en else None) or ws["type"]
        cards.append(
            f"""<div class="join-event-option">
        <input class="visually-hidden" type="radio" name="eventChoice" id="join-ev-{safe_id}" value="{safe_id}" data-event-title="{esc(title)}" data-event-date="{esc(date_display)}" data-event-time="{esc(ws['time'])}" data-event-location="{esc(location)}" data-event-type="{esc(ev_type)}" data-event-seats="{esc(ws['seats'])}">
        <label class="join-event-card" for="join-ev-{safe_id}">
          <span class="join-event-top">
            <span class="join-event-date">{esc(date_display)}</span>
            <span class="join-event-seats">{esc(ws['seats'])}</span>
          </span>
          <span class="join-event-title">{esc(title)}</span>
          <span class="join-event-meta">{esc(ws['time'])} · {esc(location)}</span>
        </label>
      </div>"""
        )
    if not cards:
        return ""
    return '<div class="join-event-grid">\n      ' + "\n      ".join(cards) + "\n    </div>"


def render_join_events_section(upcoming: list, lang: str = "vi") -> str:
    inner = render_join_event_options(upcoming, lang=lang)
    if not inner:
        return ""
    legend = "Select a gathering to attend" if lang == "en" else "Chọn hoạt động bạn muốn tham gia"
    return f"""<fieldset class="join-fieldset" data-join-events-step>
          <legend class="join-legend">{legend}</legend>
          {inner}
        </fieldset>"""


def render_sdgs(sdgs: list) -> str:
    cards = []
    for s in sdgs:
        cards.append(
            f"""<article class="sdg-editorial-item" data-stagger-item style="--sdg-color: {esc(s['color'])};">
        <span class="sdg-code">{esc(s['code'])}</span>
        <h3>{esc(s['title'])}</h3>
        <p>{esc(s['description'])}</p>
      </article>"""
        )
    return "\n      ".join(cards)


def render_news_cards(articles: list, filterable: bool = False, lang: str = "vi") -> str:
    is_en = lang == "en"
    cards = []
    for a in articles:
        pillar = derive_pillar_filter(a.get("category", ""), a.get("filters", []), a.get("categorySlug", ""))
        tokens = [pillar] + [x for x in a.get("filters", []) if x != pillar]
        if a.get("categorySlug") and a["categorySlug"] not in tokens:
            tokens.append(a["categorySlug"])
        attr = (
            f' data-news-card data-pillar="{esc(pillar)}" data-category="{esc(" ".join(tokens))}"'
            if filterable
            else f' data-pillar="{esc(pillar)}"'
        )
        href = f'/en/journey/{esc(a["slug"])}/' if is_en else f'/hanh-trinh/{esc(a["slug"])}/'
        title = (a.get("titleEn") if is_en else None) or a["title"]
        category = (a.get("categoryEn") if is_en else None) or a["category"]
        date_display = (a.get("dateDisplayEn") if is_en else None) or a["dateDisplay"]
        excerpt = (a.get("excerptEn") if is_en else None) or a["excerpt"]
        img_alt = (a.get("imageAltEn") if is_en else None) or a["imageAlt"]
        read_lbl = "Read story" if is_en else "Đọc tường thuật"
        cards.append(
            f"""<article class="editorial-card editorial-card--clean" data-stagger-item{attr}>
        <div class="plate-media" data-curtain>
          <img {image_attrs(a['image'], '(max-width: 640px) calc(100vw - 40px), 560px')} alt="{esc(img_alt)}" width="640" height="420" loading="lazy" decoding="async">
        </div>
        <div class="editorial-card-body">
          <div class="card-meta">
            <span class="cat">{esc(category)}</span>
            <span aria-hidden="true">·</span>
            <time datetime="{esc(a['date'])}">{esc(date_display)}</time>
          </div>
          <h3 class="card-title"><a class="card-link" href="{href}">{esc(title)}</a></h3>
          <p class="card-text">{esc(excerpt)}</p>
          <div class="event-card-foot">
            <span class="pillar-editorial-more">{read_lbl}</span>
            <span class="circle-go" aria-hidden="true">→</span>
          </div>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


def render_horizontal_gallery(gallery: list, lang: str = "vi") -> str:
    is_en = lang == "en"
    total = len(gallery)
    items = []
    for idx, g in enumerate(gallery, start=1):
        src = g.get("src") or g.get("url") or ""
        caption = ((g.get("captionEn") or g.get("altEn")) if is_en else (g.get("caption") or g.get("alt"))) or ("HolaRise Moment in Hoa Lac" if is_en else "Khoảnh khắc Hola tại Hòa Lạc")
        alt = ((g.get("altEn") if is_en else g.get("alt")) or caption)
        label = g.get("label") or g.get("sourceLabel") or ""
        full_caption = f"{label} · {caption}" if label and label not in caption else caption
        aria_prefix = "View photo" if is_en else "Xem ảnh"
        items.append(
            f"""<button class="horizontal-card" type="button" aria-label="{aria_prefix}: {esc(caption)}" data-lightbox-src="{esc(full_image_url(src))}" data-lightbox-alt="{esc(alt)}" data-lightbox-caption="{esc(full_caption)}" data-card-index="{idx:02d} / {total:02d}">
        <div class="horizontal-frame">
          <img {image_attrs(src, '(max-width: 640px) 82vw, 620px')} alt="{esc(alt)}" width="960" height="600" loading="lazy" decoding="async">
          <div class="horizontal-caption">
            <span>{esc(caption)}</span>
            <span class="horizontal-index">{idx:02d} / {total:02d}</span>
          </div>
        </div>
      </button>"""
        )
    return "\n      ".join(items)


def _format_gallery_caption(label: str, caption: str) -> str:
    label_clean = (label or "").strip()
    caption_clean = (caption or "").strip()
    if not label_clean:
        return caption_clean
    if not caption_clean:
        return label_clean
    if label_clean.lower() in caption_clean.lower():
        return caption_clean
    # Avoid duplicating trailing date/segment already present in caption
    label_parts = [p.strip() for p in label_clean.split("·") if p.strip()]
    unique_parts = [p for p in label_parts if p.lower() not in caption_clean.lower()]
    if not unique_parts:
        return caption_clean
    return f"{' · '.join(unique_parts)} · {caption_clean}"


def render_archive_drawer(
    gallery: list,
    *,
    title: str,
    meta: str,
    pillar: str = "holaheart",
    default_label: str = "Tư liệu HolaRise",
    desc: str = "",
    story_href: str = "",
    story_label: str = "Đọc tường thuật &amp; Viết lưu bút →",
    drawer_id: str = "",
    lang: str = "vi",
) -> str:
    is_en = lang == "en"
    total = len(gallery)
    if total == 0:
        return ""

    # 3-photo fanned stack preview (max 3 distinct thumbnails)
    stack_classes = ["is-front", "is-mid", "is-back"]
    stack_imgs = []
    for idx, g in enumerate(gallery[:3]):
        src = g.get("src") or g.get("url") or ""
        stack_alt = ((g.get("altEn") or g.get("captionEn")) if is_en else (g.get("alt") or g.get("caption"))) or title
        stack_imgs.append(
            f'<img class="archive-stack-img {stack_classes[idx]}" {image_attrs(src, "120px")} alt="{esc(stack_alt)}" width="160" height="120" loading="lazy" decoding="async">'
        )
    # Render back-to-front so DOM paint order matches z-depth cleanly
    stack_html = "\n          ".join(reversed(stack_imgs))

    thumbs = []
    aria_prefix = "View photo" if is_en else "Xem ảnh"
    for idx, g in enumerate(gallery, start=1):
        src = g.get("src") or g.get("url") or ""
        label = g.get("label") or g.get("sourceLabel") or default_label
        caption = ((g.get("captionEn") or g.get("altEn")) if is_en else (g.get("caption") or g.get("alt"))) or label
        alt = ((g.get("altEn") if is_en else g.get("alt")) or caption)
        full_caption = _format_gallery_caption(label, caption)
        thumbs.append(
            f"""<button class="archive-thumb" type="button" aria-label="{aria_prefix} {idx:02d}: {esc(alt)}" data-lightbox-src="{esc(full_image_url(src))}" data-lightbox-alt="{esc(alt)}" data-lightbox-caption="{esc(full_caption)}">
            <img {image_attrs(src, '(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 280px')} alt="{esc(alt)}" width="480" height="360" loading="lazy" decoding="async">
            <span class="archive-thumb-idx" aria-hidden="true">{idx:02d}</span>
            <span class="archive-thumb-cap" aria-hidden="true">{esc(caption)}</span>
          </button>"""
        )

    id_attr = f' id="{esc(drawer_id)}"' if drawer_id else ""
    desc_html = f'\n          <p class="archive-drawer-desc">{esc(desc)}</p>' if desc else ""
    story_link_html = (
        f'<a class="arrow-link" href="{esc(story_href)}">{story_label}</a>'
        if story_href
        else ""
    )
    count_label = f"{total} photos" if is_en else f"{total} ảnh"
    open_label = "Open album" if is_en else "Mở bộ ảnh"
    close_label = "Collapse" if is_en else "Thu gọn"
    close_btn_label = "Collapse album ↑" if is_en else "Thu gọn bộ ảnh ↑"

    return f"""<details class="archive-drawer" name="journey-gallery"{id_attr} data-pillar="{esc(pillar)}" data-lightbox-group>
      <summary class="archive-drawer-head">
        <div class="archive-drawer-stack" aria-hidden="true">
          {stack_html}
        </div>
        <div class="archive-drawer-info">
          <div class="archive-drawer-meta">
            <span class="archive-drawer-date">{esc(meta)}</span>
            <span class="archive-drawer-count">{count_label}</span>
          </div>
          <h3 class="archive-drawer-title">{esc(title)}</h3>{desc_html}
        </div>
        <span class="archive-drawer-toggle" aria-hidden="true">
          <span class="archive-toggle-closed">{open_label}</span>
          <span class="archive-toggle-open">{close_label}</span>
          <svg class="archive-toggle-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </summary>
      <div class="archive-drawer-body">
        <div class="archive-contact-sheet">
          {chr(10).join('          ' + t for t in thumbs)}
        </div>
        <div class="archive-drawer-foot">
          {story_link_html}
          <button class="btn btn--outline btn--sm" type="button" data-drawer-close>{close_btn_label}</button>
        </div>
      </div>
    </details>"""


def render_photo_wall(photos: list) -> str:
    tiles = []
    for photo in photos:
        caption = f"{photo.get('sourceLabel', 'Ảnh tư liệu MusicSpace')} · {photo['caption']}"
        tiles.append(
            f"""<div class="heart-memory-tile image-note">
        <img src="{esc(photo['src'])}" alt="{esc(photo.get('alt', photo['caption']))}" width="640" height="420" loading="lazy" decoding="async">
        <span class="image-note-caption" aria-hidden="true">{esc(caption)}</span>
      </div>"""
        )
    return "\n      ".join(tiles)


def render_faqs(faqs: list, lang: str = "vi") -> str:
    is_en = lang == "en"
    items = []
    for idx, f in enumerate(faqs):
        q_lower = f["question"].lower()
        if is_en:
            if "collaborate" in q_lower or "partner" in q_lower or "universities" in q_lower:
                cta_html = '<a class="faq-inline-link" href="/en/join/?tab=partner">Propose a partnership →</a>'
            elif "fee" in q_lower or "reserve" in q_lower or "seat" in q_lower:
                cta_html = '<a class="faq-inline-link" href="/en/schedule/">View schedule &amp; upfront costs →</a>'
            else:
                cta_html = ""
        else:
            if "đối tác" in q_lower or "nhà trường" in q_lower or "đồng tổ chức" in q_lower:
                cta_html = '<a class="faq-inline-link" href="/tham-gia/?chuong-trinh=hoptac">Đề xuất đồng tổ chức →</a>'
            elif "chi phí" in q_lower or "mất phí" in q_lower or "giữ chỗ" in q_lower:
                cta_html = '<a class="faq-inline-link" href="/lich-hoat-dong/">Xem lịch &amp; chi phí từng buổi →</a>'
            else:
                cta_html = ""
        num = f"{idx + 1:02d}"
        is_open = idx == 0
        open_cls = " is-open" if is_open else ""
        expanded = "true" if is_open else "false"
        panel_id = f"faq-panel-{idx + 1}"
        items.append(
            f"""<div class="faq-row{open_cls}" data-faq-row>
        <button class="faq-trigger" type="button" aria-expanded="{expanded}" aria-controls="{panel_id}">
          <span class="faq-num" aria-hidden="true">{num}</span>
          <span class="faq-q">{esc(f['question'])}</span>
          <span class="faq-plus" aria-hidden="true"></span>
        </button>
        <div class="faq-panel" id="{panel_id}" role="region">
          <div class="faq-panel-inner">
            <div class="faq-panel-content">
              <p>{esc(f['answer'])}</p>
              {cta_html}
            </div>
          </div>
        </div>
      </div>"""
        )
    return "\n      ".join(items)


def render_editorial_values(items: list) -> str:
    cards = []
    for idx, item in enumerate(items, start=1):
        cards.append(
            f"""<article class="editorial-strip-item" data-stagger-item>
        <span class="value-num">0{idx}</span>
        <h3>{esc(item['title'])}</h3>
        <p>{esc(item['description'])}</p>
      </article>"""
        )
    return "\n      ".join(cards)


def render_principles_list(items: list) -> str:
    rows = []
    for idx, item in enumerate(items, start=1):
        tag = (item.get("tag") or "").strip()
        tag_html = f'<span class="editorial-index-tag">{esc(tag)}</span>' if tag else ""
        rows.append(
            f"""<li class="editorial-index-row" data-stagger-item>
        <span class="editorial-index-num">0{idx}</span>
        <div class="editorial-index-head">
          {tag_html}
          <h3>{esc(item['title'])}</h3>
        </div>
        <p>{esc(item['description'])}</p>
      </li>"""
        )
    return "\n      ".join(rows)


def render_numbered_cards(items: list) -> str:
    cards = []
    for idx, item in enumerate(items, start=1):
        cards.append(
            f"""<article class="value-col" data-stagger-item data-mobile-fold>
        <div class="mobile-fold-head" data-mobile-fold-toggle>
          <div class="mobile-fold-titles">
            <span class="value-num">0{idx}</span>
            <h3>{esc(item['title'])}</h3>
          </div>
          <span class="mobile-fold-indicator" aria-hidden="true"></span>
        </div>
        <div class="mobile-fold-body">
          <p>{esc(item['description'])}</p>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


def render_partners_strip(partners: list, lang: str = "vi") -> str:
    is_en = lang == "en"
    active = [
        p
        for p in (partners or [])
        if isinstance(p, dict) and p.get("isActive", True) is not False and str(p.get("name", "")).strip()
    ]
    if not active:
        return ""
    items = []
    partner_suffix = "Community Partner" if is_en else "Đơn vị đồng hành"
    for p in active:
        name = str(p.get("name", "")).strip()
        logo_url = str(p.get("logoUrl", "")).strip()
        website_url = str(p.get("websiteUrl", "")).strip()
        logo_html = (
            f'<img class="partner-colophon-logo" src="{esc(logo_url)}" alt="{esc(name)} logo" width="20" height="20" loading="lazy" decoding="async">'
            if logo_url and (logo_url.startswith("/") or logo_url.startswith("https://"))
            else ""
        )
        label_html = f'<span class="partner-colophon-name">{esc(name)}</span>'
        if website_url and website_url.startswith("https://"):
            items.append(
                f'<a class="partner-colophon-link" href="{esc(website_url)}" target="_blank" rel="noopener noreferrer" aria-label="{esc(name)} — {partner_suffix}">{logo_html}{label_html}<span class="partner-colophon-arrow" aria-hidden="true">↗</span></a>'
            )
        else:
            items.append(f'<span class="partner-colophon-link">{logo_html}{label_html}</span>')

    items_joined = '<span class="partner-colophon-dot" aria-hidden="true">·</span>'.join(items)
    section_id = "partners" if is_en else "doi-tac"
    section_aria = "Community partners" if is_en else "Đơn vị đồng hành"
    colophon_label = "Space & Venue Partner" if is_en else "Đồng hành không gian"
    return f"""<div class="partner-colophon" id="{section_id}" aria-label="{section_aria}">
  <div class="container partner-colophon-inner">
    <span class="partner-colophon-label">{colophon_label}</span>
    <span class="partner-colophon-dot" aria-hidden="true">·</span>
    <div class="partner-colophon-list">{items_joined}</div>
  </div>
</div>"""


def render_testimonials_section(testimonials: list) -> str:
    if not testimonials:
        return ""
    return f"""<section class="section section--mist" aria-label="Góc nhìn người trẻ Hòa Lạc – Thạch Thất">
  <div class="container">
    <div class="section-header--split" style="margin-bottom: 28px;" data-reveal>
      <div>
        <div class="kicker">Chia sẻ cộng đồng</div>
        <h2 class="section-title" style="margin-bottom: 0;">Góc nhìn từ người đồng hành</h2>
      </div>
      <a class="arrow-link" href="/tham-gia/">
        <span>Tham gia cùng HolaRise</span>
        <span class="arrow-swap" aria-hidden="true"><span>→</span><span>→</span></span>
      </a>
    </div>

    <div class="grid-3" data-stagger-group>
      {render_testimonials(testimonials)}
    </div>
  </div>
</section>"""


def render_testimonials(testimonials: list) -> str:
    if not testimonials:
        return ""
    cards = []
    for item in testimonials:
        initials = item.get("initials", item["name"][:2].upper())
        cards.append(
            f"""<article class="testimonial-card" data-stagger-item>
        <div class="testimonial-quote">“{esc(item['quote'])}”</div>
        <div class="testimonial-author">
          <div class="testimonial-badge" aria-hidden="true">{esc(initials)}</div>
          <div class="testimonial-info">
            <span class="testimonial-name">{esc(item['name'])}</span>
            <span class="testimonial-role">{esc(item['role'])}</span>
          </div>
        </div>
      </article>"""
        )
    return "\n      ".join(cards)


PAST_FALLBACK_IMAGES = (
    "/assets/images/activity-environment.jpg",
    "/assets/images/activity-workshop.jpg",
    "/assets/images/activity-community.jpg",
)


def render_past_workshops(past_list: list, lang: str = "vi") -> str:
    is_en = lang == "en"
    rows = []
    for idx, item in enumerate(past_list):
        photo = item.get("image") or PAST_FALLBACK_IMAGES[idx % len(PAST_FALLBACK_IMAGES)]
        alt = (item.get("imageAltEn") if is_en else None) or item.get("imageAlt") or item["title"]
        raw_title = (item.get("titleEn") if is_en else None) or item["title"]
        title = esc(raw_title)
        raw_href = (item.get("hrefEn") if is_en else None) or item.get("href", "")
        if raw_href.startswith("/"):
            event_href = esc(raw_href)
            title = f'<a class="past-item-title-link" href="{event_href}">{title}</a>'
        meta_parts = [
            (item.get("timeEn") if is_en else None) or item.get("time", ""),
            (item.get("locationEn") if is_en else None) or item.get("location", ""),
            (item.get("participantsEn") if is_en else None) or item.get("participants", ""),
        ]
        meta = " · ".join(esc(part) for part in meta_parts if part)
        date_val = (item.get("dateEn") if is_en else None) or item["date"]
        rows.append(
            f"""<div class="past-item" data-stagger-item data-hover-photo="{esc(full_image_url(photo))}" data-hover-alt="{esc(alt)}">
        <span class="past-item-date">{esc(date_val)}</span>
        <h3 class="past-item-title">{title}</h3>
        <span class="past-item-meta">{meta}</span>
        <span class="past-item-arrow" aria-hidden="true">↗</span>
      </div>"""
        )
    return "\n      ".join(rows)


_SAFE_REL_LINK_RE = re.compile(
    r"\[([^\[\]]+)\]\((/(?:[a-z0-9_-][a-z0-9/_-]*)?(?:#[a-z0-9_-]+)?)\)"
)
_SAFE_MUSICSPACE_LINK_RE = re.compile(
    r"\[([^\[\]]+)\]\((https://musicspace\.edu\.vn(?:/[^\s)]*)?)\)", re.IGNORECASE
)
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")


def format_inline_safe(escaped_line: str) -> str:
    with_external_links = _SAFE_MUSICSPACE_LINK_RE.sub(
        r'<a href="\2" rel="noopener noreferrer">\1</a>', escaped_line
    )
    with_links = _SAFE_REL_LINK_RE.sub(r'<a href="\2">\1</a>', with_external_links)
    return _BOLD_RE.sub(r"<strong>\1</strong>", with_links)


def render_article_body(paragraphs: list) -> str:
    """Mirror functions/_lib/render.js renderSafeArticleBody() for static article builds."""
    out = []
    in_list = False

    def close_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    for raw in paragraphs or []:
        line = str(raw or "").strip()
        if not line:
            continue
        if line.startswith("- "):
            if not in_list:
                out.append('<ul class="clean-list">')
                in_list = True
            out.append(f"<li>{format_inline_safe(esc(line[2:].strip()))}</li>")
            continue

        close_list()
        if line.startswith("### "):
            out.append(f"<h3>{format_inline_safe(esc(line[4:].strip()))}</h3>")
        elif line.startswith("## "):
            out.append(f"<h2>{format_inline_safe(esc(line[3:].strip()))}</h2>")
        elif line.startswith("> "):
            out.append(f"<blockquote>{format_inline_safe(esc(line[2:].strip()))}</blockquote>")
        else:
            out.append(f"<p>{format_inline_safe(esc(line))}</p>")

    close_list()
    return "\n      ".join(out)


def organization_schema(site: dict, lang: str = "vi") -> dict:
    b = site["brand"]
    c = site["contact"]
    org_id = f"{b['siteUrl'].rstrip('/')}/#organization"
    same_as = []
    for key in ("facebook", "youtube", "instagram"):
        raw = (c.get(key) or "").strip()
        if not raw:
            continue
        parsed = urlparse(raw)
        if parsed.scheme in ("http", "https") and parsed.path.strip("/"):
            same_as.append(raw)

    is_en = lang == "en"
    schema = {
        "@context": "https://schema.org",
        "@type": "NGO",
        "@id": org_id,
        "name": b.get("brandName", "HolaRise") if is_en else b["fullName"],
        "alternateName": (
            [
                b.get("brandName", "HolaRise"),
                "HolaRise Hoa Lac",
                b.get("englishName", "HolaRise – Youth Community & Social Impact Initiative"),
            ]
            if is_en
            else [
                b.get("brandName", "HolaRise"),
                b["shortName"],
                "Cộng đồng Thanh niên Hòa Lạc",
                b.get("englishName", "HolaRise – Youth Community & Social Impact Initiative"),
            ]
        ),
        "slogan": b["tagline"],
        "url": b["siteUrl"],
        "logo": {
            "@type": "ImageObject",
            "url": abs_url(b["siteUrl"], "/assets/images/pwa/icon-512.png"),
            "width": 512,
            "height": 512,
        },
        "image": abs_url(b["siteUrl"], b["ogImage"]),
        "description": (
            "Originating in Hoa Lac, Hanoi, HolaRise is an independent non-profit youth community uniting young people through HolaHeart, HolaGreen, and HolaConnect aligned with UN SDGs."
            if is_en
            else site["seo"]["defaultDescription"]
        ),
        "email": c["email"],
        "telephone": c["phoneDisplay"],
        "areaServed": {
            "@type": "Place",
            "name": "Hoa Lac, Hanoi, Vietnam" if is_en else "Hòa Lạc, Hà Nội, Việt Nam",
        },
        "address": {
            "@type": "PostalAddress",
            "streetAddress": "Tan Xa, Hoa Lac" if is_en else "Tân Xã, Hòa Lạc",
            "addressLocality": "Hoa Lac" if is_en else "Hòa Lạc",
            "addressRegion": "Hanoi" if is_en else "Hà Nội",
            "addressCountry": "VN",
        },
    }
    if same_as:
        schema["sameAs"] = same_as
    return schema


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


def events_schema(site: dict, upcoming: list, lang: str = "vi") -> list:
    is_en = lang == "en"
    b = site["brand"]
    org_id = f"{b['siteUrl'].rstrip('/')}/#organization"
    schemas = []
    for ws in upcoming:
        landing = ws.get("landing") if isinstance(ws.get("landing"), dict) else {}
        start_date = landing.get("startIso") or ws["date"]
        end_date = landing.get("endIso") or ""
        vi_href = resolve_event_href(ws)
        event_href = (ws.get("hrefEn") or (f"/en/events/{resolve_event_slug(ws)}/" if vi_href else "")) if is_en else vi_href
        fallback_schedule = "/en/schedule/" if is_en else "/lich-hoat-dong/"
        event_url = abs_url(b["siteUrl"], event_href) if event_href else abs_url(b["siteUrl"], fallback_schedule)
        ev_name = (ws.get("titleEn") if is_en else None) or ws["title"]
        ev_desc = (ws.get("summaryEn") if is_en else None) or ws["summary"]
        ev_loc = (ws.get("locationEn") if is_en else None) or ws["location"]
        schema_item = {
            "@context": "https://schema.org",
            "@type": "Event",
            "name": ev_name,
            "startDate": start_date,
            "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
            "eventStatus": "https://schema.org/EventScheduled",
            "isAccessibleForFree": True,
            "image": [abs_url(b["siteUrl"], landing.get("ogImage") or ws["image"])],
            "description": ev_desc,
            "location": {
                "@type": "Place",
                "name": ev_loc,
                "address": {
                    "@type": "PostalAddress",
                    "addressLocality": "Hoa Lac, Thach That" if is_en else "Hòa Lạc, Thạch Thất",
                    "addressRegion": "Hanoi" if is_en else "Hà Nội",
                    "addressCountry": "VN",
                },
            },
            "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "VND",
                "availability": "https://schema.org/InStock",
                "url": event_url,
            },
            "organizer": {
                "@type": "NGO",
                "@id": org_id,
                "name": b.get("englishName", "HolaRise") if is_en else b["fullName"],
                "url": b["siteUrl"],
            },
        }
        if end_date:
            schema_item["endDate"] = end_date
        if event_href:
            schema_item["url"] = event_url
        schemas.append(schema_item)
    return schemas


def render_invitation_letter_body(landing: dict, lang: str = "vi") -> str:
    is_en = lang == "en"
    paras = (landing.get("letterParagraphsEn") if is_en else None) or landing.get("letterParagraphs", [])
    pull = ((landing.get("letterPullQuoteEn") if is_en else None) or landing.get("letterPullQuote") or "").strip()
    closing = ((landing.get("letterClosingEn") if is_en else None) or landing.get("letterClosing") or "").strip()
    blocks = []
    for idx, raw_p in enumerate(paras):
        lines_html = "<br>".join(esc(ln.strip()) for ln in str(raw_p).split("\n") if ln.strip())
        cls = ' class="invite-lead-p"' if idx == 0 else ""
        blocks.append(f"<p{cls}>{lines_html}</p>")
        if idx == 1 and pull:
            blocks.append(f'<blockquote class="invite-pullquote">“{esc(pull)}”</blockquote>')
    if closing:
        blocks.append(f'<p class="invite-closing-p">{esc(closing)}</p>')
    return "\n      ".join(blocks)


def build_google_calendar_url(ws: dict, landing: dict, canonical_url: str, lang: str = "vi") -> str:
    is_en = lang == "en"
    summary = (ws.get("summaryEn") if is_en else None) or ws["summary"]
    title = (ws.get("titleEn") if is_en else None) or ws["title"]
    location = (ws.get("locationEn") if is_en else None) or ws["location"]
    cta_line = f"Invitation & RSVP: {canonical_url}" if is_en else f"Xem thư mời & giữ chỗ: {canonical_url}"
    details = f"{summary}\n\n{cta_line}"
    query = urlencode(
        {
            "action": "TEMPLATE",
            "text": title,
            "dates": f"{landing['icsStartUtc']}/{landing['icsEndUtc']}",
            "details": details,
            "location": location,
            "ctz": "Asia/Ho_Chi_Minh",
        }
    )
    return f"https://calendar.google.com/calendar/render?{query}"


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
    preload_image: str = None,
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
    verification_tags = []
    g_verify = (site.get("seo", {}).get("googleSiteVerification") or "").strip()
    b_verify = (site.get("seo", {}).get("bingSiteVerification") or "").strip()
    if g_verify:
        verification_tags.append(f'\n  <meta name="google-site-verification" content="{esc(g_verify)}">')
    if b_verify:
        verification_tags.append(f'\n  <meta name="msvalidate.01" content="{esc(b_verify)}">')

    is_en_page = url_path == "/en/" or url_path.startswith("/en/")
    html_lang = "en" if is_en_page else "vi"
    og_locale = "en_US" if is_en_page else "vi_VN"
    og_site_name = b.get("brandName", "HolaRise")
    social_icons = {
        "youtube": (
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<rect x="2.5" y="5.5" width="19" height="13" rx="4"></rect>'
            '<path d="M10 9.4 15.2 12 10 14.6z" fill="currentColor" stroke="none"></path>'
            "</svg>"
        ),
        "instagram": (
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<rect x="3" y="3" width="18" height="18" rx="5"></rect>'
            '<circle cx="12" cy="12" r="4"></circle>'
            '<circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"></circle>'
            "</svg>"
        ),
        "facebook": (
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<path d="M14 9h3V5h-3a4 4 0 0 0-4 4v3H7v4h3v5h4v-5h3l1-4h-4V9a1 1 0 0 1 1-1z"></path>'
            "</svg>"
        ),
    }
    social_link_parts = []
    for s_key, s_label in (("youtube", "YouTube"), ("instagram", "Instagram"), ("facebook", "Facebook")):
        s_url = (c.get(s_key) or "").strip()
        if s_url and urlparse(s_url).scheme in ("http", "https"):
            aria_label = f"HolaRise on {s_label}" if is_en_page else f"{s_label} chính thức của HolaRise"
            social_link_parts.append(
                f'<a class="footer-social-link" href="{esc(s_url)}" target="_blank" '
                f'rel="noopener noreferrer me" aria-label="{esc(aria_label)}" title="{esc(s_label)}">'
                f'{social_icons[s_key]}'
                f'<span class="footer-social-label">{esc(s_label)}</span></a>'
            )
    if social_link_parts:
        nav_label = "Official channels" if is_en_page else "Kênh chính thức"
        footer_social_html = (
            f'\n          <div class="footer-social" role="group" aria-label="{esc(nav_label)}">'
            + "".join(social_link_parts)
            + "</div>"
        )
    else:
        footer_social_html = ""

    vi_pair, en_pair = resolve_lang_pair(url_path)
    hreflang_links = ""
    if vi_pair and en_pair:
        vi_url = abs_url(b["siteUrl"], vi_pair)
        en_url = abs_url(b["siteUrl"], en_pair)
        hreflang_links = (
            f'\n  <link rel="alternate" hreflang="vi" href="{esc(vi_url)}">'
            f'\n  <link rel="alternate" hreflang="en" href="{esc(en_url)}">'
            f'\n  <link rel="alternate" hreflang="x-default" href="{esc(vi_url)}">'
        )
    if is_en_page:
        lang_switch_href = vi_pair or "/"
        lang_switch_label = "VN"
        lang_switch_aria = "Switch to Vietnamese version"
    else:
        lang_switch_href = en_pair or "/en/"
        lang_switch_label = "EN"
        lang_switch_aria = "Switch to English version"

    page_keywords = (site["seo"].get("keywordsEn") if is_en_page else None) or site["seo"]["keywords"]
    default_og_alt = (b.get("ogImageAltEn") if is_en_page else None) or b.get("ogImageAlt", title)
    brand_en_name = b.get("englishName", "HolaRise – Youth Community & Social Impact Initiative")
    contact_address_en = c.get("addressEn") or "Tan Xa, Hoa Lac, Thach That, Hanoi, Vietnam"

    resolved_cache_bust = esc(cache_bust or CURRENT_BUILD_HASH)
    gsap_body_classes = {"page-home", "page-about", "page-news", "page-journey"}
    body_tokens = set(str(body_class or "").split())
    if body_tokens & gsap_body_classes:
        gsap_scripts = (
            f'  <script src="/assets/vendor/gsap.min.js?v={resolved_cache_bust}" defer></script>\n'
            f'  <script src="/assets/vendor/ScrollTrigger.min.js?v={resolved_cache_bust}" defer></script>\n'
        )
    else:
        gsap_scripts = ""

    extra_head_parts = []
    if preload_image:
        extra_head_parts.append(
            f'\n  <link rel="preload" as="image" href="{esc(preload_image)}" fetchpriority="high">'
        )
    turnstile_sitekey = (site.get("seo", {}).get("turnstileSiteKey") or "").strip()
    if turnstile_sitekey:
        extra_head_parts.append(
            f'\n  <meta name="holarise-turnstile-sitekey" content="{esc(turnstile_sitekey)}">'
        )
    extra_head_html = "".join(extra_head_parts)

    rendered = render_template(
        base_tpl,
        {
            "HTML_LANG": html_lang,
            "PAGE_TITLE": esc(title),
            "PAGE_DESCRIPTION": esc(description),
            "PAGE_KEYWORDS": esc(page_keywords),
            "ROBOTS_CONTENT": esc(robots),
            "VERIFICATION_META": "".join(verification_tags),
            "CANONICAL_URL": esc(canonical),
            "HREFLANG_LINKS": hreflang_links,
            "OG_TYPE": esc(og_type),
            "OG_LOCALE": og_locale,
            "OG_SITE_NAME": esc(og_site_name),
            "OG_IMAGE_URL": esc(og_img_url),
            "OG_IMAGE_ALT": esc(title if og_image else default_og_alt),
            "BODY_CLASS": esc(body_class),
            "BRAND_FULL_NAME": esc(b["fullName"]),
            "BRAND_EN_NAME": esc(brand_en_name),
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "BRAND_SUBTITLE": format_inline_pillar_tags(b["subtitle"]),
            "BRAND_TAGLINE": esc(b["tagline"]),
            "LOGO_DARK": esc(b["logoDark"]),
            "LOGO_LIGHT": esc(b["logoLight"]),
            "LOGO_MARK": esc(b.get("logoMark", "/assets/images/logo-mark.png")),
            "NAV_LINKS": build_nav_links(url_path),
            "MOBILE_NAV_LINKS": build_mobile_nav_links(url_path),
            "LANG_SWITCH_HREF": esc(lang_switch_href),
            "LANG_SWITCH_LABEL": esc(lang_switch_label),
            "LANG_SWITCH_ARIA": esc(lang_switch_aria),
            "MOBILE_DOCK": build_mobile_dock(url_path),
            "MAIN_CONTENT": main_content,
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_ADDRESS_EN": esc(contact_address_en),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(phone_raw),
            "CONTACT_ZALO": esc(c.get("zalo", "")),
            "CONTACT_ZALO_GROUP": esc(c.get("zaloGroup") or c.get("zalo", "")),
            "CONTACT_MEETING": esc(c.get("meetingTimeEn") if is_en_page else c["meetingTime"]),
            "FOOTER_SOCIAL_HTML": footer_social_html,
            "FORM_ENDPOINT": esc(c.get("formEndpoint", "")),
            "CURRENT_YEAR": str(datetime.date.today().year),
            "CACHE_BUST": resolved_cache_bust,
            "EXTRA_HEAD_HTML": extra_head_html,
            "GSAP_SCRIPTS": gsap_scripts,
            "JSON_LD_SCRIPTS": json_ld_html,
        },
    )

    out_path = DIST_DIR / out_rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(rendered, encoding="utf-8")


def collect_precache_urls(*hero_srcsets: str) -> list:
    """Collect canonical routes and versioned core assets actually used by generated pages."""
    urls = {url for srcset in hero_srcsets for url in srcset_urls(srcset)}
    excluded_prefixes = (
        "/assets/images/events/",
        "/assets/images/illustrations/",
        "/assets/images/musicspace-archive/",
        "/assets/images/pwa/screenshot-",
        "/assets/images/og-cover.jpg",
        "/assets/images/hero-holarise-",
        "/assets/images/holarise-binh-minh-og.jpg",
    )

    for html_file in sorted(DIST_DIR.rglob("*.html")):
        rel = html_file.relative_to(DIST_DIR).as_posix()
        if rel == "404.html" or rel.startswith("admin/") or rel.startswith("media/") or rel.startswith("_templates/"):
            continue
        if rel == "index.html":
            urls.add("/")
        elif rel.endswith("/index.html"):
            urls.add("/" + rel[: -len("index.html")])

        text = html_file.read_text(encoding="utf-8")
        for target in re.findall(r'\s(?:href|src)="(/assets/[^"]+)"', text):
            target_no_hash = target.split("#")[0]
            clean = target_no_hash.split("?")[0]
            if any(clean.startswith(prefix) for prefix in excluded_prefixes):
                continue
            if (DIST_DIR / clean.lstrip("/")).is_file():
                urls.add(target_no_hash)
                urls.update(image_variant(clean, width) for width in image_widths().get(clean, ()))

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
      url.pathname.startsWith("/media") ||
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

/admin-manifest.webmanifest
  Content-Type: application/manifest+json; charset=utf-8
  Cache-Control: public, max-age=3600, must-revalidate
  X-Robots-Tag: noindex, nofollow

/media-manifest.webmanifest
  Content-Type: application/manifest+json; charset=utf-8
  Cache-Control: public, max-age=3600, must-revalidate
  X-Robots-Tag: noindex, nofollow

/favicon.ico
  Content-Type: image/x-icon
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800

/llms.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=3600, must-revalidate

/404.html
  X-Robots-Tag: noindex, follow
  Cache-Control: public, max-age=0, must-revalidate

/
  Cache-Control: public, max-age=0, must-revalidate

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/gioi-thieu/*
  Cache-Control: public, max-age=0, must-revalidate

/lich-hoat-dong/*
  Cache-Control: public, max-age=0, must-revalidate

/su-kien/*
  Cache-Control: public, max-age=0, must-revalidate

/hanh-trinh/*
  Cache-Control: public, max-age=0, must-revalidate

/tham-gia/*
  Cache-Control: public, max-age=0, must-revalidate

/chinh-sach/*
  Cache-Control: public, max-age=0, must-revalidate

/offline/*
  Cache-Control: public, max-age=0, must-revalidate

/admin/*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow

/media/*
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


def generate_llms_txt(site: dict, activities: dict, workshops: dict, news: list) -> str:
    """Generate dist/llms.txt from canonical JSON sources (Single Source of Truth)."""
    b = site["brand"]
    c = site["contact"]

    pillars_lines = [
        f"- **{p['badge']} ({p['title']})**: {p['summary']}"
        for p in activities.get("pillars", [])
    ]
    upcoming_lines = []
    for ws in workshops.get("upcoming", []):
        ev_href = resolve_event_href(ws)
        title_md = f"[{ws['title']}]({abs_url(b['siteUrl'], ev_href)})" if ev_href else ws["title"]
        meta_parts = [part.strip() for part in (ws.get("fee", ""), ws.get("seats", "")) if str(part or "").strip()]
        meta_suffix = f" ({', '.join(meta_parts)})" if meta_parts else ""
        upcoming_lines.append(
            f"- {ws['dateDisplay']} ({ws['time']}): {title_md} — {ws['location']}{meta_suffix}"
        )
    if not upcoming_lines:
        upcoming_lines = [
            f"- Nhịp hoạt động định kỳ 1–2 buổi/tuần tại Hòa Lạc. Theo dõi lịch cập nhật tại {abs_url(b['siteUrl'], '/lich-hoat-dong/')}."
        ]

    past_lines = []
    for item in workshops.get("pastTopics", []):
        href = item.get("href")
        if href:
            past_lines.append(
                f"- {item['date']} ({item['time']}): [{item['title']}]({abs_url(b['siteUrl'], href)}) — {item['location']}"
            )
        else:
            past_lines.append(f"- {item['date']} ({item['time']}): {item['title']} — {item['location']}")

    news_lines = []
    for a in news:
        slug_url = abs_url(b["siteUrl"], f"/hanh-trinh/{a['slug']}/")
        news_lines.append(f"- [{a['title']}]({slug_url}): {a['excerpt']} ({a['dateDisplay']})")

    faq_lines = [f"- **{f['question']}** {f['answer']}" for f in site.get("faqs", [])]
    faq_section = ""
    if faq_lines:
        faq_section = "\n## Câu hỏi thường gặp (FAQ)\n" + "\n".join(faq_lines) + "\n"

    past_section = ""
    if past_lines:
        past_section = "\n## Dấu mốc đã tổ chức\n" + "\n".join(past_lines) + "\n"

    social_entries = []
    for s_key, s_label in (("youtube", "YouTube"), ("facebook", "Facebook"), ("instagram", "Instagram")):
        s_url = (c.get(s_key) or "").strip()
        if s_url and urlparse(s_url).scheme in ("http", "https"):
            social_entries.append(f"{s_label}: {s_url}")
    social_line = f"\n- Kênh chính thức: {' | '.join(social_entries)}" if social_entries else ""

    return f"""# {b['fullName']}

> {b['subtitle']}

- Website: {b['siteUrl']}
- Địa bàn khởi nguồn: {b['location']}
- Văn phòng liên hệ: {c['address']}
- Nhịp sinh hoạt: {c['meetingTime']}
- Liên hệ: {c['email']} | Hotline/Zalo: {c['phoneDisplay']}{social_line}
- Nguyên tắc: Cộng đồng phi lợi nhuận, công khai minh bạch chi phí (nếu phát sinh) trước mỗi hoạt động.

## Các trang chính (Flagship 3+1)
- [Trang chủ]({abs_url(b['siteUrl'], '/')}): Tuyên ngôn, khoảnh khắc gặp gỡ tại Hòa Lạc và mô hình Tạo Tác Động 3 trụ cột.
- [Về HolaRise]({abs_url(b['siteUrl'], '/gioi-thieu/')}): Câu chuyện khởi nguồn tại Hòa Lạc, 3 trụ cột, 4 chuẩn mực, 5 nguyên tắc minh bạch và 6 UN SDGs.
- [Lịch hoạt động]({abs_url(b['siteUrl'], '/lich-hoat-dong/')}): Lịch 1–2 buổi/tuần lọc theo HolaHeart, HolaGreen, HolaConnect.
- [Hành trình]({abs_url(b['siteUrl'], '/hanh-trinh/')}): Tường thuật sự kiện, lưu bút cảm nhận thành viên và triển lãm khoảnh khắc tại Hòa Lạc.
- [Tham gia & Thẻ Thành Viên]({abs_url(b['siteUrl'], '/tham-gia/')}): Tạo Thẻ Thành Viên Hola (giữ chỗ 1 chạm, viết lưu bút) và cổng kết nối đối tác, nhà trường, CLB.
- [Chuẩn mực Minh bạch & An toàn]({abs_url(b['siteUrl'], '/chinh-sach/')}): Quy tắc cộng đồng và quyền riêng tư dữ liệu, hình ảnh.

## English Experience (`/en/*`)
- [Home (English)]({abs_url(b['siteUrl'], '/en/')}): Non-profit youth community in Hoa Lac, 3 impact pillars, upcoming gatherings, and photo moments.
- [About HolaRise (English)]({abs_url(b['siteUrl'], '/en/about/')}): Origin story, mission & vision, 3 pillars, 4 values, 5 transparency principles, and 6 UN SDGs.
- [Schedule (English)]({abs_url(b['siteUrl'], '/en/schedule/')}): Live weekly gatherings with 15-second RSVP and language policy.
- [Journey (English)]({abs_url(b['siteUrl'], '/en/journey/')}): Past gathering stories, photo archives, and participant guestbook.
- [Join & Partner (English)]({abs_url(b['siteUrl'], '/en/join/')}): Member Pass sign-in, institutional partnerships, and FAQs.
- [Transparency & Privacy (English)]({abs_url(b['siteUrl'], '/en/privacy/')}): NGO safeguarding standards and Decree 13/2023/ND-CP data privacy.

## Mô hình Tạo Tác Động (Heart → Green → Connect)
{chr(10).join(pillars_lines)}

## Lịch hoạt động sắp tới
{chr(10).join(upcoming_lines)}
{past_section}
## Dấu mốc & Tường thuật mới nhất
{chr(10).join(news_lines)}
{faq_section}"""


def build_site() -> list:
    global CURRENT_BUILD_HASH
    CURRENT_BUILD_HASH = compute_build_hash()

    site = load_json("site.json")
    activities = load_json("activities.json")
    workshops = load_json("workshops.json")
    heart_photo_wall = load_json("musicspace-photo-wall.json")
    news = load_json("news.json")

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ASSETS_DIR, DIST_DIR / "assets")
    for css_file in (DIST_DIR / "assets" / "css").glob("*.css"):
        raw_css = css_file.read_text(encoding="utf-8")
        css_file.write_text(minify_css(raw_css), encoding="utf-8")
    favicon_ico_src = ASSETS_DIR / "images" / "favicon.ico"
    if favicon_ico_src.is_file():
        shutil.copy2(favicon_ico_src, DIST_DIR / "favicon.ico")

    base_tpl = load_template("base.html")
    b = site["brand"]
    h = site["hero"]
    p = site["philosophy"]
    org_ld = organization_schema(site)

    sitemap_urls = []

    # Combine top 5 HolaHeart 15/11 + top 5 HolaHeart x MusicSpace for Homepage runway
    home_gallery_mix = list(activities["gallery"][:5]) + list(heart_photo_wall[:5])

    # 1. Home page
    hero_orient_chip = (
        '<span class="visual-orientation-chip">Ảnh định hướng</span>'
        if h.get("imageIsIllustration")
        else ""
    )
    hero_srcset = f' srcset="{esc(h["imageSrcset"])}" sizes="(min-width: 1280px) 1240px, calc(100vw - 40px)"' if h.get("imageSrcset") else ""
    hero_mobile_src = (
        f'<source media="(max-width: 640px)" type="image/webp" srcset="{esc(h["mobileImageSrcset"])}" sizes="calc(100vw - 40px)" width="1024" height="1536">'
        if h.get("mobileImageSrcset")
        else ""
    )
    hero_media_html = f'<picture class="hero-card-picture">{hero_mobile_src}<img class="hero-card-img" src="{esc(h["image"])}"{hero_srcset} alt="{esc(h["imageAlt"])}" width="1671" height="941" fetchpriority="high" decoding="async" data-cinema-img></picture>{hero_orient_chip}'

    home_main = render_template(
        load_template("home.html"),
        {
            "HERO_MEDIA_HTML": hero_media_html,
            "HERO_BADGE": esc(h["badge"]),
            "HERO_HEADLINE_LINES": render_hero_headline_lines(h["headline"]),
            "HERO_QUICK_PILLS": render_hero_quick_pills(h.get("quickPills", [])),
            "HERO_DESCRIPTION": esc(h["description"]),
            "HERO_PRIMARY_HREF": esc(h["primaryCta"]["href"]),
            "HERO_PRIMARY_LABEL": esc(h["primaryCta"]["label"]),
            "HERO_SECONDARY_HREF": esc(h["secondaryCta"]["href"]),
            "HERO_SECONDARY_LABEL": esc(h["secondaryCta"]["label"]),
            "HOME_UPCOMING_SECTION": f"<!-- CMS:HOME_UPCOMING_SECTION:START -->\n{render_home_upcoming_section(workshops['upcoming'])}\n<!-- CMS:HOME_UPCOMING_SECTION:END -->",
            "PHILOSOPHY_QUOTE": esc(p["quote"]),
            "PHILOSOPHY_MOTTO": esc(p["motto"]),
            "PILLARS_EDITORIAL_HTML": render_home_pillars_grid(activities["pillars"]),
            "HORIZONTAL_GALLERY_HTML": f"<!-- CMS:HORIZONTAL_GALLERY:START -->\n{render_horizontal_gallery(home_gallery_mix)}\n<!-- CMS:HORIZONTAL_GALLERY:END -->",
            "PARTNERS_STRIP": f"<!-- CMS:PARTNERS_STRIP:START -->\n{render_partners_strip(site.get('partners', []))}\n<!-- CMS:PARTNERS_STRIP:END -->",
            "TESTIMONIALS_SECTION": render_testimonials_section(site.get("testimonials", [])),
        },
    )
    org_id = f"{b['siteUrl'].rstrip('/')}/#organization"
    sitelink_nav = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "@id": f"{b['siteUrl'].rstrip('/')}/#navigation",
        "name": "Điều hướng chính HolaRise",
        "itemListElement": [
            {
                "@type": "SiteNavigationElement",
                "position": 1,
                "name": "Về HolaRise",
                "description": "Câu chuyện khởi nguồn tại Hòa Lạc, mô hình 3 trụ cột HolaHeart · HolaGreen · HolaConnect, 5 nguyên tắc minh bạch và 6 UN SDGs.",
                "url": abs_url(b["siteUrl"], "/gioi-thieu/"),
            },
            {
                "@type": "SiteNavigationElement",
                "position": 2,
                "name": "Lịch hoạt động",
                "description": "Lịch sinh hoạt định kỳ 1–2 buổi mỗi tuần của HolaHeart, HolaGreen và HolaConnect tại Hòa Lạc. Giữ chỗ nhanh không cần mật khẩu.",
                "url": abs_url(b["siteUrl"], "/lich-hoat-dong/"),
            },
            {
                "@type": "SiteNavigationElement",
                "position": 3,
                "name": "Hành trình",
                "description": "Tường thuật các buổi đối thoại, hoạt động cộng đồng, lưu bút thành viên và tư liệu hình ảnh thực tế của HolaRise.",
                "url": abs_url(b["siteUrl"], "/hanh-trinh/"),
            },
            {
                "@type": "SiteNavigationElement",
                "position": 4,
                "name": "Tham gia & Đồng hành",
                "description": "Giữ chỗ tham dự trong 15 giây, mở Thẻ Thành Viên Hola hoặc gửi đề xuất hợp tác cùng nhà trường, câu lạc bộ và đối tác.",
                "url": abs_url(b["siteUrl"], "/tham-gia/"),
            },
            {
                "@type": "SiteNavigationElement",
                "position": 5,
                "name": "Minh bạch & Quy tắc",
                "description": "Chuẩn mực phi lợi nhuận, minh bạch chi phí từng con số, quy tắc an toàn cộng đồng và bảo vệ dữ liệu cá nhân tại HolaRise.",
                "url": abs_url(b["siteUrl"], "/chinh-sach/"),
            },
        ],
    }
    home_schemas = [
        org_ld,
        {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": f"{b['siteUrl'].rstrip('/')}/#website",
            "name": b.get("brandName", "HolaRise"),
            "alternateName": [
                b["fullName"],
                b["shortName"],
                "Cộng đồng Thanh niên Hòa Lạc",
                b.get("englishName", "HolaRise – Youth Community & Social Impact Initiative"),
            ],
            "url": abs_url(b["siteUrl"], "/"),
            "inLanguage": "vi-VN",
            "publisher": {"@id": org_id},
        },
        sitelink_nav,
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

    # 2. About page (/gioi-thieu/ — Về HolaRise)
    about_media = site.get("about", {})
    about_img_src = about_media.get("image") or h["image"]
    about_img_alt = about_media.get("imageAlt") or h["imageAlt"]
    about_orient_chip = (
        '<span class="visual-orientation-chip">Ảnh định hướng</span>'
        if about_media.get("imageIsIllustration")
        else ""
    )
    about_media_html = f'<img {image_attrs(about_img_src, "(min-width: 1280px) 1240px, calc(100vw - 40px)")} alt="{esc(about_img_alt)}" width="1280" height="714" fetchpriority="high" decoding="async">{about_orient_chip}'

    about_main = render_template(
        load_template("about.html"),
        {
            "BRAND_FULL_NAME": esc(b["fullName"]),
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "BRAND_SUBTITLE": format_inline_pillar_tags(b["subtitle"]),
            "ABOUT_MEDIA_HTML": about_media_html,
            "PHILOSOPHY_QUOTE": esc(p["quote"]),
            "PHILOSOPHY_MOTTO": esc(p["motto"]),
            "PHILOSOPHY_MISSION": format_inline_pillar_tags(p["mission"]),
            "PHILOSOPHY_VISION": esc(p["vision"]),
            "PILLARS_DETAIL_HTML": render_pillars(activities["pillars"], detailed=True),
            "CORE_VALUES_HTML": render_editorial_values(p["coreValues"]),
            "SDGS_HTML": render_sdgs(site["sdgs"]),
            "PRINCIPLES_HTML": render_principles_list(site["principles"]),
            "TESTIMONIALS_SECTION": render_testimonials_section(site.get("testimonials", [])),
        },
    )
    write_page(
        base_tpl,
        site,
        "gioi-thieu/index.html",
        "/gioi-thieu/",
        "Về HolaRise – Sứ mệnh & 3 Trụ cột",
        "Câu chuyện khởi nguồn tại Hòa Lạc, mô hình 3 trụ cột HolaHeart · HolaGreen · HolaConnect, 5 nguyên tắc minh bạch và 6 UN SDGs.",
        about_main,
        [org_ld, breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Về HolaRise", "/gioi-thieu/")])],
    )
    sitemap_urls.append(("/gioi-thieu/", "0.9", "monthly"))

    # 3. Schedule page (/lich-hoat-dong/)
    ws_main = render_template(
        load_template("workshops.html"),
        {
            "WORKSHOP_INTRO_TITLE": esc(workshops["intro"]["title"]),
            "WORKSHOP_INTRO_DESC": esc(workshops["intro"]["description"]),
            "SCHEDULE_UPCOMING_HTML": render_schedule_upcoming_content(workshops["upcoming"]),
            "PAST_WORKSHOPS_HTML": render_past_workshops(workshops["pastTopics"]),
        },
    )
    write_page(
        base_tpl,
        site,
        "lich-hoat-dong/index.html",
        "/lich-hoat-dong/",
        f"Lịch hoạt động | {b['brandName']}",
        "Lịch sinh hoạt định kỳ 1–2 buổi mỗi tuần của HolaHeart, HolaGreen và HolaConnect tại Hòa Lạc. Giữ chỗ nhanh không cần mật khẩu.",
        ws_main,
        [
            org_ld,
            breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Lịch hoạt động", "/lich-hoat-dong/")]),
        ],
        event_schemas=events_schema(site, workshops["upcoming"]),
    )
    sitemap_urls.append(("/lich-hoat-dong/", "0.9", "weekly"))

    # 3b. Dynamic Editorial Event Invitation Pages (/su-kien/<slug>/) for EVERY upcoming event
    invite_tpl = load_template("event_invitation.html")
    invite_phone_raw = re.sub(r"[^0-9+]", "", site["contact"]["phoneDisplay"])
    default_zalo_group = site["contact"].get("zaloGroup") or site["contact"].get("zalo", "")

    def derive_event_pillar(ws: dict) -> tuple[str, str]:
        raw_type = (ws.get("type") or "").lower()
        filters = [str(f).lower() for f in (ws.get("filters") or [])]
        if "holagreen" in raw_type or "holagreen" in filters:
            return ("holagreen", "HolaGreen")
        if "holaconnect" in raw_type or "holaconnect" in filters:
            return ("holaconnect", "HolaConnect")
        return ("holaheart", "HolaHeart")

    def format_event_share_title(ws: dict, brand_name: str) -> str:
        _, pillar_label = derive_event_pillar(ws)
        raw_title = (ws.get("shortTitle") or ws.get("title") or "").strip()
        clean_title = re.sub(rf"^{re.escape(pillar_label)}\s*[·\-–—:]\s*", "", raw_title, flags=re.IGNORECASE).strip() or raw_title
        clean_title = re.sub(r'^Workshop\s+["“](.+?)["”]$', r"\1", clean_title, flags=re.IGNORECASE).strip()
        iso_date = (ws.get("date") or "").strip()
        short_date = ""
        m_date = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso_date)
        if m_date:
            short_date = f" | {m_date.group(3)}/{m_date.group(2)}"
        return f"{pillar_label} · {clean_title}{short_date}"

    def build_default_landing(ws: dict) -> dict:
        slug = resolve_event_slug(ws)
        raw_date = str(ws.get("date") or "2026-11-29").strip()
        raw_time = str(ws.get("time") or "19:00").strip()
        m_start = re.search(r"(\d{1,2})[:h](\d{2})", raw_time)
        hh, mm = (int(m_start.group(1)), int(m_start.group(2))) if m_start else (19, 0)
        start_iso = f"{raw_date}T{hh:02d}:{mm:02d}:00+07:00"
        end_hh = min(23, hh + 2)
        end_iso = f"{raw_date}T{end_hh:02d}:{mm:02d}:00+07:00"
        ymd = raw_date.replace("-", "")
        utc_start_h = max(0, hh - 7)
        utc_end_h = max(0, end_hh - 7)
        ics_start = f"{ymd}T{utc_start_h:02d}{mm:02d}00Z"
        ics_end = f"{ymd}T{utc_end_h:02d}{mm:02d}00Z"
        highlights = ws.get("highlights") or []
        paragraphs = [ws.get("summary") or ""]
        if highlights:
            paragraphs.append("Điểm nhấn buổi gặp: " + " · ".join(highlights) + ".")
        return {
            "slug": slug,
            "urlPath": f"/su-kien/{slug}/",
            "ogImage": ws.get("image") or b["ogImage"],
            "seoTitle": format_event_share_title(ws, b["brandName"]),
            "seoDescription": ws.get("summary") or b["subtitle"],
            "headline": ws["title"],
            "startIso": start_iso,
            "endIso": end_iso,
            "icsStartUtc": ics_start,
            "icsEndUtc": ics_end,
            "timeLabel": f"{ws.get('time', '')}, {ws.get('dateDisplay', '')}".strip(", "),
            "venueName": ws.get("location") or "Hòa Lạc",
            "letterParagraphs": [p for p in paragraphs if p],
            "letterPullQuote": "",
            "letterClosing": "Mời bạn giữ chỗ trước để chúng mình sắp xếp chu đáo và gửi định vị chi tiết trong Nhóm Zalo buổi gặp.",
            "letterSignoff": "Trân trọng mời bạn đồng hành,",
        }

    for ws in workshops.get("upcoming", []):
        base_landing = build_default_landing(ws)
        custom_landing = ws.get("landing") if isinstance(ws.get("landing"), dict) else {}
        landing = {**base_landing, **custom_landing}
        slug = landing["slug"]
        if not slug:
            continue
        url_path = landing.get("urlPath") or f"/su-kien/{slug}/"
        canonical_ev_url = abs_url(b["siteUrl"], url_path)
        gcal_url = build_google_calendar_url(ws, landing, canonical_ev_url)
        ev_zalo = landing.get("zaloGroup") or ws.get("zaloGroup") or default_zalo_group
        ev_pillar_key, ev_pillar_label = derive_event_pillar(ws)
        ev_share_title = landing.get("seoTitle") or format_event_share_title(ws, b["brandName"])
        invite_main = render_template(
            invite_tpl,
            {
                "BRAND_SHORT_NAME": esc(b["shortName"]),
                "EVENT_ID": esc(ws["id"]),
                "EVENT_SLUG": esc(slug),
                "EVENT_PILLAR": esc(ev_pillar_key),
                "EVENT_PILLAR_LABEL": esc(ev_pillar_label),
                "EVENT_SHARE_TITLE": esc(ev_share_title),
                "EVENT_KICKER": esc(ws.get("type") or "HolaRise · Thư mời tham dự"),
                "EVENT_TITLE": esc(ws["title"]),
                "EVENT_DATE_DISPLAY": esc(ws["dateDisplay"]),
                "EVENT_LOCATION": esc(ws["location"]),
                "EVENT_FEE": esc(ws["fee"]),
                "EVENT_SEATS": esc(ws.get("seats", "")),
                "EVENT_SEAT_BAR_HTML": "",
                "EVENT_IMAGE": esc(ws["image"]),
                "EVENT_IMAGE_ALT": esc(ws["imageAlt"]),
                "EVENT_ZALO_GROUP": esc(ev_zalo),
                "EVENT_HOST_SIGNATURE": esc(landing.get("hostSignature") or f"{ws.get('type', 'HolaRise').split('·')[0].strip()} · {b['shortName']}"),
                "EVENT_RSVP_HEADING": esc(landing.get("rsvpHeading") or f"Giữ chỗ cho {ws['dateDisplay']}"),
                "EVENT_NOTE_SUMMARY": esc(landing.get("noteSummary") or "+ Gửi đôi dòng chia sẻ hoặc lời nhắn cho người điều phối (tùy chọn)"),
                "EVENT_NOTE_PLACEHOLDER": esc(landing.get("notePlaceholder") or "Điều bạn muốn chia sẻ trước buổi gặp, hoặc để trống nếu chỉ muốn đến lắng nghe..."),
                "INVITE_HEADLINE": esc(landing["headline"]),
                "INVITE_START_ISO": esc(landing["startIso"]),
                "INVITE_END_ISO": esc(landing["endIso"]),
                "INVITE_ICS_START": esc(landing["icsStartUtc"]),
                "INVITE_ICS_END": esc(landing["icsEndUtc"]),
                "INVITE_TIME_LABEL": esc(landing["timeLabel"]),
                "INVITE_VENUE_NAME": esc(landing["venueName"]),
                "EVENT_VENUE_URL": esc(ws.get("venueUrl", "")),
                "INVITE_VENUE_HTML": (
                    f'<a class="invite-venue-link" href="{esc(ws["venueUrl"])}" target="_blank" rel="noopener noreferrer">{esc(landing["venueName"].split("·")[0].strip())} ↗</a>'
                    if ws.get("venueUrl")
                    else esc(landing["venueName"].split("·")[0].strip())
                ),
                "LETTER_BODY_HTML": render_invitation_letter_body(landing),
                "LETTER_SIGNOFF": esc(landing["letterSignoff"]),
                "GOOGLE_CAL_URL": esc(gcal_url),
                "CANONICAL_EVENT_URL": esc(canonical_ev_url),
                "FORM_ENDPOINT": esc(site["contact"].get("formEndpoint", "")),
                "CONTACT_PHONE": esc(site["contact"]["phoneDisplay"]),
                "CONTACT_PHONE_RAW": esc(invite_phone_raw),
                "CONTACT_ZALO": esc(site["contact"].get("zalo", "")),
            },
        )
        write_page(
            base_tpl,
            site,
            f"su-kien/{slug}/index.html",
            url_path,
            landing.get("seoTitle") or f"{ws['title']} | {b['brandName']}",
            landing.get("seoDescription") or ws["summary"],
            invite_main,
            [
                org_ld,
                events_schema(site, [ws])[0],
                breadcrumb_schema(
                    b["siteUrl"],
                    [("Trang chủ", "/"), ("Lịch hoạt động", "/lich-hoat-dong/"), (ws["title"], url_path)],
                ),
            ],
            og_image=landing.get("ogImage") or ws["image"],
            body_class="is-father-invite",
        )
        sitemap_urls.append((url_path, "0.9", "weekly"))

    # 3c. SSR shell template for dynamic CMS Event Invitations (/su-kien/<any-slug>/)
    ssr_invite_main = render_template(
        invite_tpl,
        {
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "EVENT_ID": "__SSR_EVENT_ID__",
            "EVENT_SLUG": "__SSR_EVENT_SLUG__",
            "EVENT_PILLAR": "__SSR_EVENT_PILLAR__",
            "EVENT_PILLAR_LABEL": "__SSR_EVENT_PILLAR_LABEL__",
            "EVENT_SHARE_TITLE": "__SSR_EVENT_SHARE_TITLE__",
            "EVENT_KICKER": "__SSR_EVENT_KICKER__",
            "EVENT_TITLE": "__SSR_EVENT_TITLE__",
            "EVENT_DATE_DISPLAY": "__SSR_EVENT_DATE_DISPLAY__",
            "EVENT_LOCATION": "__SSR_EVENT_LOCATION__",
            "EVENT_FEE": "__SSR_EVENT_FEE__",
            "EVENT_SEATS": "__SSR_EVENT_SEATS__",
            "EVENT_SEAT_BAR_HTML": "__SSR_EVENT_SEAT_BAR_HTML__",
            "EVENT_IMAGE": "__SSR_EVENT_IMAGE__",
            "EVENT_IMAGE_ALT": "__SSR_EVENT_IMAGE_ALT__",
            "EVENT_ZALO_GROUP": "__SSR_EVENT_ZALO_GROUP__",
            "EVENT_HOST_SIGNATURE": "__SSR_EVENT_HOST_SIGNATURE__",
            "EVENT_RSVP_HEADING": "__SSR_EVENT_RSVP_HEADING__",
            "EVENT_NOTE_SUMMARY": "+ Gửi đôi dòng chia sẻ hoặc lời nhắn cho người điều phối (tùy chọn)",
            "EVENT_NOTE_PLACEHOLDER": "Điều bạn muốn chia sẻ trước buổi gặp, hoặc để trống nếu chỉ muốn đến lắng nghe...",
            "INVITE_HEADLINE": "__SSR_INVITE_HEADLINE__",
            "INVITE_START_ISO": "__SSR_INVITE_START_ISO__",
            "INVITE_END_ISO": "__SSR_INVITE_END_ISO__",
            "INVITE_ICS_START": "__SSR_INVITE_ICS_START__",
            "INVITE_ICS_END": "__SSR_INVITE_ICS_END__",
            "INVITE_TIME_LABEL": "__SSR_INVITE_TIME_LABEL__",
            "INVITE_VENUE_NAME": "__SSR_INVITE_VENUE_NAME__",
            "EVENT_VENUE_URL": "",
            "INVITE_VENUE_HTML": "__SSR_INVITE_VENUE_NAME__",
            "LETTER_BODY_HTML": "__SSR_LETTER_BODY_HTML__",
            "LETTER_SIGNOFF": "Trân trọng mời bạn đồng hành,",
            "GOOGLE_CAL_URL": "__SSR_GOOGLE_CAL_URL__",
            "CANONICAL_EVENT_URL": "__SSR_CANONICAL_URL__",
            "FORM_ENDPOINT": esc(site["contact"].get("formEndpoint", "")),
            "CONTACT_PHONE": esc(site["contact"]["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(invite_phone_raw),
            "CONTACT_ZALO": esc(site["contact"].get("zalo", "")),
        },
    )
    write_page(
        base_tpl,
        site,
        "_templates/event-invitation-shell.tpl",
        "/su-kien/__SSR_SLUG__/",
        "__SSR_PAGE_TITLE__",
        "__SSR_PAGE_DESCRIPTION__",
        ssr_invite_main,
        [org_ld],
        og_image="/__SSR_OG_IMAGE_PATH__",
        body_class="is-father-invite",
    )
    ev_shell_path = DIST_DIR / "_templates" / "event-invitation-shell.tpl"
    ev_shell_txt = ev_shell_path.read_text(encoding="utf-8")
    ev_shell_txt = ev_shell_txt.replace(
        abs_url(b["siteUrl"], "/__SSR_OG_IMAGE_PATH__"), "__SSR_OG_IMAGE_URL__"
    ).replace(
        abs_url(b["siteUrl"], "/su-kien/__SSR_SLUG__/"), "__SSR_CANONICAL_URL__"
    ).replace(
        "__SSR_SLUG__", "__SSR_EVENT_SLUG__"
    ).replace(
        "</head>", "  __SSR_EXTRA_JSON_LD__\n</head>", 1
    )
    ev_shell_path.write_text(ev_shell_txt, encoding="utf-8")

    # 3c. Post-Event Memory Stage SSR Shell (_templates/event-memory-shell.tpl)
    memory_tpl = load_template("event_memory_stage.html")
    ssr_memory_main = render_template(
        memory_tpl,
        {
            "EVENT_ID": "__SSR_EVENT_ID__",
            "EVENT_SLUG": "__SSR_EVENT_SLUG__",
            "EVENT_PILLAR": "__SSR_EVENT_PILLAR__",
            "EVENT_PILLAR_LABEL": "__SSR_EVENT_PILLAR_LABEL__",
            "EVENT_TITLE": "__SSR_EVENT_TITLE__",
            "EVENT_DATE": "__SSR_EVENT_DATE__",
            "EVENT_DATE_DISPLAY": "__SSR_EVENT_DATE_DISPLAY__",
            "EVENT_LOCATION": "__SSR_EVENT_LOCATION__",
            "EVENT_SUMMARY": "__SSR_EVENT_SUMMARY__",
            "MEMORY_ALBUM_ID": "__SSR_MEMORY_ALBUM_ID__",
            "MEMORY_COVER_IMAGE": "__SSR_MEMORY_COVER_IMAGE__",
            "MEMORY_STATS_INLINE_HTML": "__SSR_MEMORY_STATS_INLINE_HTML__",
            "MEMORY_GALLERY_HTML": "__SSR_MEMORY_GALLERY_HTML__",
            "MEMORY_REEL_AUDIO_URL": "__SSR_MEMORY_REEL_AUDIO_URL__",
            "MEMORY_REEL_AUDIO_TITLE": "__SSR_MEMORY_REEL_AUDIO_TITLE__",
        },
    )
    write_page(
        base_tpl,
        site,
        "_templates/event-memory-shell.tpl",
        "/su-kien/__SSR_SLUG__/",
        "__SSR_PAGE_TITLE__",
        "__SSR_PAGE_DESCRIPTION__",
        ssr_memory_main,
        [org_ld],
        og_image="/__SSR_OG_IMAGE_PATH__",
        body_class="is-memory-stage",
    )
    mem_shell_path = DIST_DIR / "_templates" / "event-memory-shell.tpl"
    mem_shell_txt = mem_shell_path.read_text(encoding="utf-8")
    mem_shell_txt = mem_shell_txt.replace(
        abs_url(b["siteUrl"], "/__SSR_OG_IMAGE_PATH__"), "__SSR_OG_IMAGE_URL__"
    ).replace(
        abs_url(b["siteUrl"], "/su-kien/__SSR_SLUG__/"), "__SSR_CANONICAL_URL__"
    ).replace(
        "__SSR_SLUG__", "__SSR_EVENT_SLUG__"
    ).replace(
        "</head>", "  __SSR_EXTRA_JSON_LD__\n</head>", 1
    )
    mem_shell_path.write_text(mem_shell_txt, encoding="utf-8")

    # 4. Journey & Photo Archive page (/hanh-trinh/)
    c = site["contact"]
    news_list_main = render_template(
        load_template("news_list.html"),
        {
            "NEWS_LIST_HTML": render_news_cards(news, filterable=True),
            "GALLERY_HTML": render_archive_drawer(
                activities["gallery"],
                title="HolaHeart: Tình yêu thương của Mẹ trong thời đại AI",
                meta="15/11/2026 · Mây Lang Thang Cafe, Hòa Lạc",
                pillar="holaheart",
                default_label="HolaHeart · 15/11/2026",
                story_href="/hanh-trinh/tinh-yeu-thuong-cua-me/",
            ),
            "MUSICSPACE_GALLERY_HTML": render_archive_drawer(
                heart_photo_wall,
                title="HolaHeart × MusicSpace tại Hòa Lạc",
                meta="2025 – 2026 · Chuỗi âm nhạc & đối thoại",
                pillar="holaheart",
                default_label="HolaHeart × MusicSpace",
                desc="Những khoảnh khắc tuyển chọn từ chuỗi đêm nhạc mộc và giao lưu kết nối của người trẻ Hòa Lạc.",
                story_href="/hanh-trinh/holaheart-musicspace/",
                drawer_id="musicspace-chapter",
            ),
            "CONTACT_EMAIL": esc(c["email"]),
        },
    )
    write_page(
        base_tpl,
        site,
        "hanh-trinh/index.html",
        "/hanh-trinh/",
        f"Hành trình | {b['brandName']}",
        "Tường thuật các buổi đối thoại, hoạt động cộng đồng, lưu bút thành viên và tư liệu hình ảnh thực tế của HolaRise.",
        news_list_main,
        [org_ld, breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Hành trình", "/hanh-trinh/")])],
    )
    sitemap_urls.append(("/hanh-trinh/", "0.9", "weekly"))

    # 5. Individual Journey detail pages (/hanh-trinh/<slug>/)
    news_detail_tpl = load_template("news_detail.html")
    for article in news:
        related = [a for a in news if a["slug"] != article["slug"]][:2]
        paragraphs = render_article_body(article["content"])
        slug_path = f"/hanh-trinh/{article['slug']}/"
        detail_main = render_template(
            news_detail_tpl,
            {
                "BRAND_SHORT_NAME": esc(b["shortName"]),
                "ARTICLE_SLUG": esc(article["slug"]),
                "ARTICLE_CATEGORY": esc(article["category"]),
                "ARTICLE_TITLE": esc(article["title"]),
                "ARTICLE_DATE": esc(article["date"]),
                "ARTICLE_DATE_DISPLAY": esc(article["dateDisplay"]),
                "ARTICLE_READ_TIME": esc(article["readTime"]),
                "ARTICLE_AUTHOR": esc(article["author"]),
                "ARTICLE_IMAGE_ATTRS": image_attrs(
                    article["image"], "(min-width: 1280px) 1240px, calc(100vw - 40px)"
                ),
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
            "inLanguage": "vi-VN",
            "author": {"@type": "Organization", "@id": org_id, "name": article["author"]},
            "publisher": {
                "@type": "Organization",
                "@id": org_id,
                "name": b["fullName"],
                "logo": {
                    "@type": "ImageObject",
                    "url": abs_url(b["siteUrl"], "/assets/images/pwa/icon-512.png"),
                    "width": 512,
                    "height": 512,
                },
            },
            "mainEntityOfPage": abs_url(b["siteUrl"], slug_path),
        }
        article_seo_title = (article.get("seoTitle") or "").strip() or f"{article['title']} | {b['brandName']}"
        write_page(
            base_tpl,
            site,
            f"hanh-trinh/{article['slug']}/index.html",
            slug_path,
            article_seo_title,
            article["excerpt"],
            detail_main,
            [
                org_ld,
                article_schema,
                breadcrumb_schema(
                    b["siteUrl"],
                    [("Trang chủ", "/"), ("Hành trình", "/hanh-trinh/"), (article["title"], slug_path)],
                ),
            ],
            og_type="article",
            og_image=article["image"],
        )
        sitemap_urls.append((slug_path, "0.7", "monthly"))

    # 5b. SSR shell template for dynamic CMS articles (/hanh-trinh/<new-slug>/)
    ssr_detail_main = render_template(
        news_detail_tpl,
        {
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "ARTICLE_SLUG": "__SSR_ARTICLE_SLUG__",
            "ARTICLE_CATEGORY": "__SSR_ARTICLE_CATEGORY__",
            "ARTICLE_TITLE": "__SSR_ARTICLE_TITLE__",
            "ARTICLE_DATE": "__SSR_ARTICLE_DATE__",
            "ARTICLE_DATE_DISPLAY": "__SSR_ARTICLE_DATE_DISPLAY__",
            "ARTICLE_READ_TIME": "__SSR_ARTICLE_READ_TIME__",
            "ARTICLE_AUTHOR": "__SSR_ARTICLE_AUTHOR__",
            "ARTICLE_IMAGE_ATTRS": "__SSR_ARTICLE_IMAGE_ATTRS__",
            "ARTICLE_IMAGE_ALT": "__SSR_ARTICLE_IMAGE_ALT__",
            "ARTICLE_PARAGRAPHS": "__SSR_ARTICLE_BODY__",
            "RELATED_NEWS_HTML": "__SSR_RELATED_NEWS__",
        },
    )
    write_page(
        base_tpl,
        site,
        "_templates/news-detail-shell.tpl",
        "/hanh-trinh/__SSR_SLUG__/",
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
        abs_url(b["siteUrl"], "/hanh-trinh/__SSR_SLUG__/"), "__SSR_CANONICAL_URL__"
    ).replace(
        "__SSR_SLUG__", "__SSR_ARTICLE_SLUG__"
    ).replace(
        "</head>", "  __SSR_EXTRA_JSON_LD__\n</head>", 1
    )
    shell_path.write_text(shell_txt, encoding="utf-8")

    # 6. Join & Contact page (/tham-gia/)
    join_phone_raw = re.sub(r"[^0-9+]", "", c["phoneDisplay"])
    join_main = render_template(
        load_template("join.html"),
        {
            "BRAND_NAME": esc(b["brandName"]),
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "FORM_ENDPOINT": esc(c.get("formEndpoint", "")),
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_MEETING": esc(c["meetingTime"]),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(join_phone_raw),
            "CONTACT_ZALO": esc(c.get("zalo", "")),
            "CONTACT_ZALO_GROUP": esc(c.get("zaloGroup") or c.get("zalo", "")),
            "JOIN_EVENTS_SECTION_HTML": render_join_events_section(workshops["upcoming"]),
            "FAQ_HTML": render_faqs(site["faqs"]),
        },
    )
    write_page(
        base_tpl,
        site,
        "tham-gia/index.html",
        "/tham-gia/",
        f"Tham gia & Đồng hành | {b['brandName']}",
        "Giữ chỗ tham dự trong 15 giây, mở Thẻ Thành Viên Hola hoặc gửi đề xuất hợp tác cùng nhà trường, câu lạc bộ và đối tác.",
        join_main,
        [
            org_ld,
            faq_schema(site["faqs"]),
            breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Tham gia", "/tham-gia/")]),
        ],
    )
    sitemap_urls.append(("/tham-gia/", "0.9", "monthly"))

    # 6b. Full 100% English Mirror (/en/*) for International Visitors & Partners
    base_en_tpl = load_template("base_en.html")
    en_site = site.get("en", {})
    en_h = en_site.get("hero", {})
    en_p = en_site.get("philosophy", {})
    org_ld_en = organization_schema(site, lang="en")
    brand_en_name = b.get("englishName", "HolaRise – Youth Community & Social Impact Initiative")
    contact_address_en = c.get("addressEn") or "Tan Xa, Hoa Lac, Thach That, Hanoi, Vietnam"

    # 6b-1. English Home (/en/)
    en_hero_orient_chip = (
        '<span class="visual-orientation-chip">Concept Visual</span>'
        if h.get("imageIsIllustration")
        else ""
    )
    en_hero_img_alt = en_h.get("imageAlt") or "HolaRise young people welcoming sunrise on the hills of Hoa Lac."
    en_hero_media_html = f'<picture class="hero-card-picture">{hero_mobile_src}<img class="hero-card-img" src="{esc(h["image"])}"{hero_srcset} alt="{esc(en_hero_img_alt)}" width="1671" height="941" fetchpriority="high" decoding="async" data-cinema-img></picture>{en_hero_orient_chip}'
    en_home_main = render_template(
        load_template("en_home.html"),
        {
            "HERO_MEDIA_HTML": en_hero_media_html,
            "HERO_HEADLINE_LINES": render_hero_headline_lines(en_h.get("headline", "Stillness within,\nAction from Hoa Lac.")),
            "HERO_DESCRIPTION": esc(en_h.get("description", "")),
            "HERO_PRIMARY_LABEL": esc(en_h.get("primaryCta", {}).get("label", "Join HolaRise")),
            "HERO_PRIMARY_HREF": esc(en_h.get("primaryCta", {}).get("href", "/en/join/")),
            "HERO_SECONDARY_LABEL": esc(en_h.get("secondaryCta", {}).get("label", "Explore our journey")),
            "HERO_SECONDARY_HREF": esc(en_h.get("secondaryCta", {}).get("href", "#journey-gallery")),
            "PILLARS_EDITORIAL_HTML": render_home_pillars_grid(activities["pillars"], lang="en"),
            "HOME_UPCOMING_SECTION": f"<!-- CMS:HOME_UPCOMING_SECTION:START -->\n{render_home_upcoming_section(workshops['upcoming'], lang='en')}\n<!-- CMS:HOME_UPCOMING_SECTION:END -->",
            "HORIZONTAL_GALLERY_HTML": f"<!-- CMS:HORIZONTAL_GALLERY:START -->\n        {render_horizontal_gallery(home_gallery_mix, lang='en')}\n        <!-- CMS:HORIZONTAL_GALLERY:END -->",
            "PHILOSOPHY_QUOTE": esc(en_p.get("quote", "")),
            "PHILOSOPHY_MOTTO": esc(en_p.get("motto", p["motto"])),
            "PARTNERS_STRIP": f"<!-- CMS:PARTNERS_STRIP:START -->\n{render_partners_strip(site.get('partners', []), lang='en')}\n<!-- CMS:PARTNERS_STRIP:END -->",
            "TESTIMONIALS_SECTION": "",
        },
    )
    en_home_schemas = [
        org_ld_en,
        {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": f"{b['siteUrl'].rstrip('/')}/en/#website",
            "name": b.get("brandName", "HolaRise"),
            "alternateName": [b.get("brandName", "HolaRise"), brand_en_name],
            "url": abs_url(b["siteUrl"], "/en/"),
            "inLanguage": "en",
            "publisher": {"@id": org_id},
        },
    ]
    write_page(
        base_en_tpl,
        site,
        "en/index.html",
        "/en/",
        "HolaRise — Non-Profit Youth Community in Hoa Lac, Hanoi",
        "Originating in Hoa Lac, Hanoi, HolaRise unites students, young professionals, and international friends through HolaHeart, HolaGreen, and HolaConnect (UN SDGs).",
        en_home_main,
        en_home_schemas,
        body_class="is-home",
        event_schemas=events_schema(site, workshops["upcoming"][:1], lang="en"),
    )
    sitemap_urls.append(("/en/", "0.9", "weekly"))

    # 6b-2. English About (/en/about/)
    en_about_img_alt = en_site.get("about", {}).get("imageAlt") or "Morning sunrise over the hills of Hoa Lac — HolaRise origin visual."
    en_about_orient_chip = (
        '<span class="visual-orientation-chip">Concept Visual</span>'
        if about_media.get("imageIsIllustration")
        else ""
    )
    en_about_media_html = f'<img {image_attrs(about_img_src, "(min-width: 1280px) 1240px, calc(100vw - 40px)")} alt="{esc(en_about_img_alt)}" width="1280" height="714" fetchpriority="high" decoding="async">{en_about_orient_chip}'
    en_about_main = render_template(
        load_template("en_about.html"),
        {
            "BRAND_EN_NAME": esc(brand_en_name),
            "ABOUT_MEDIA_HTML": en_about_media_html,
            "PHILOSOPHY_QUOTE": esc(en_p.get("quote", "")),
            "PHILOSOPHY_MOTTO": esc(en_p.get("motto", p["motto"])),
            "PHILOSOPHY_MISSION": format_inline_pillar_tags(en_p.get("mission", ""), lang="en"),
            "PHILOSOPHY_VISION": esc(en_p.get("vision", "")),
            "PILLARS_DETAIL_HTML": render_pillars(activities["pillars"], detailed=True, lang="en"),
            "CORE_VALUES_HTML": render_editorial_values(en_p.get("coreValues", [])),
            "SDGS_HTML": render_sdgs(en_site.get("sdgs", [])),
            "PRINCIPLES_HTML": render_principles_list(en_site.get("principles", [])),
            "TESTIMONIALS_SECTION": "",
        },
    )
    write_page(
        base_en_tpl,
        site,
        "en/about/index.html",
        "/en/about/",
        "About HolaRise — Mission, 3 Pillars & UN SDGs",
        "HolaRise's origin in Hoa Lac, three impact pillars (HolaHeart, HolaGreen, HolaConnect), 5 transparency principles, and alignment with 6 UN SDGs.",
        en_about_main,
        [org_ld_en, breadcrumb_schema(b["siteUrl"], [("Home", "/en/"), ("About", "/en/about/")])],
    )
    sitemap_urls.append(("/en/about/", "0.8", "monthly"))

    # 6b-3. English Schedule (/en/schedule/)
    en_ws_main = render_template(
        load_template("en_schedule.html"),
        {
            "WORKSHOP_INTRO_TITLE": esc(workshops["intro"].get("titleEn") or "Upcoming Gatherings"),
            "WORKSHOP_INTRO_DESC": esc(workshops["intro"].get("descriptionEn") or ""),
            "SCHEDULE_UPCOMING_HTML": render_schedule_upcoming_content(workshops["upcoming"], lang="en"),
            "PAST_WORKSHOPS_HTML": render_past_workshops(workshops["pastTopics"], lang="en"),
        },
    )
    write_page(
        base_en_tpl,
        site,
        "en/schedule/index.html",
        "/en/schedule/",
        f"Schedule & Gatherings | {b['brandName']}",
        "Weekly non-profit gatherings across HolaHeart, HolaGreen, and HolaConnect in Hoa Lac. Reserve your seat in 15 seconds without a password.",
        en_ws_main,
        [org_ld_en, breadcrumb_schema(b["siteUrl"], [("Home", "/en/"), ("Schedule", "/en/schedule/")])],
        event_schemas=events_schema(site, workshops["upcoming"], lang="en"),
    )
    sitemap_urls.append(("/en/schedule/", "0.9", "weekly"))

    # 6b-4. English Event Invitation Pages (/en/events/<slug>/) + EN SSR Shell
    en_invite_tpl = load_template("en_event_invitation.html")
    for ws in workshops.get("upcoming", []):
        base_landing = build_default_landing(ws)
        custom_landing = ws.get("landing") if isinstance(ws.get("landing"), dict) else {}
        landing = {**base_landing, **custom_landing}
        slug = landing["slug"]
        if not slug:
            continue
        url_path = landing.get("urlPathEn") or f"/en/events/{slug}/"
        canonical_ev_url = abs_url(b["siteUrl"], url_path)
        gcal_url = build_google_calendar_url(ws, landing, canonical_ev_url, lang="en")
        ev_zalo = landing.get("zaloGroup") or ws.get("zaloGroup") or default_zalo_group
        ev_pillar_key, ev_pillar_label = derive_event_pillar(ws)
        ev_title_en = ws.get("titleEn") or ws["title"]
        ev_headline_en = landing.get("headlineEn") or ev_title_en
        ev_time_en = landing.get("timeLabelEn") or f"{ws.get('time', '')}, {ws.get('dateDisplayEn') or ws.get('dateDisplay', '')}".strip(", ")
        ev_venue_en = landing.get("venueNameEn") or ws.get("locationEn") or ws.get("location", "Hoa Lac")
        ev_share_title_en = landing.get("seoTitleEn") or f"{ev_pillar_label} · {ws.get('shortTitleEn') or ev_title_en}"
        ev_lang_badge = ws.get("languageLabelEn") or "Vietnamese Gathering"
        en_invite_main = render_template(
            en_invite_tpl,
            {
                "EVENT_ID": esc(ws["id"]),
                "EVENT_SLUG": esc(slug),
                "EVENT_PILLAR": esc(ev_pillar_key),
                "EVENT_PILLAR_LABEL": esc(ev_pillar_label),
                "EVENT_SHARE_TITLE": esc(ev_share_title_en),
                "EVENT_KICKER": esc(ws.get("typeEn") or "HolaRise · Invitation"),
                "EVENT_LANG_BADGE": esc(ev_lang_badge),
                "EVENT_TITLE": esc(ev_title_en),
                "EVENT_DATE_DISPLAY": esc(ws.get("dateDisplayEn") or ws["dateDisplay"]),
                "EVENT_LOCATION": esc(ws.get("locationEn") or ws["location"]),
                "EVENT_FEE": esc(ws.get("feeEn") or "Free admission"),
                "EVENT_SEATS": esc(ws.get("seats", "")),
                "EVENT_SEAT_BAR_HTML": "",
                "EVENT_IMAGE": esc(ws["image"]),
                "EVENT_IMAGE_ALT": esc(ws.get("imageAltEn") or ws["imageAlt"]),
                "EVENT_ZALO_GROUP": esc(ev_zalo),
                "EVENT_HOST_SIGNATURE": esc(f"{ev_pillar_label} · HolaRise Community"),
                "EVENT_RSVP_HEADING": esc(landing.get("rsvpHeadingEn") or f"Reserve your seat for {ws.get('dateDisplayEn') or ws['dateDisplay']}"),
                "EVENT_NOTE_SUMMARY": esc(landing.get("noteSummaryEn") or "+ Add a note for coordinators (optional)"),
                "EVENT_NOTE_PLACEHOLDER": esc(landing.get("notePlaceholderEn") or "Share a note ahead of time, or leave blank if you prefer simply to listen..."),
                "INVITE_HEADLINE": esc(ev_headline_en),
                "INVITE_START_ISO": esc(landing["startIso"]),
                "INVITE_END_ISO": esc(landing["endIso"]),
                "INVITE_ICS_START": esc(landing["icsStartUtc"]),
                "INVITE_ICS_END": esc(landing["icsEndUtc"]),
                "INVITE_TIME_LABEL": esc(ev_time_en),
                "INVITE_VENUE_NAME": esc(ev_venue_en),
                "EVENT_VENUE_URL": esc(ws.get("venueUrl", "")),
                "INVITE_VENUE_HTML": (
                    f'<a class="invite-venue-link" href="{esc(ws["venueUrl"])}" target="_blank" rel="noopener noreferrer">{esc(ev_venue_en.split("·")[0].strip())} ↗</a>'
                    if ws.get("venueUrl")
                    else esc(ev_venue_en.split("·")[0].strip())
                ),
                "LETTER_BODY_HTML": render_invitation_letter_body(landing, lang="en"),
                "LETTER_SIGNOFF": esc(landing.get("letterSignoffEn") or "Warmly invited,"),
                "GOOGLE_CAL_URL": esc(gcal_url),
                "CANONICAL_EVENT_URL": esc(canonical_ev_url),
            },
        )
        write_page(
            base_en_tpl,
            site,
            f"en/events/{slug}/index.html",
            url_path,
            landing.get("seoTitleEn") or f"{ev_title_en} | {b['brandName']}",
            landing.get("seoDescriptionEn") or ws.get("summaryEn") or ws["summary"],
            en_invite_main,
            [
                org_ld_en,
                events_schema(site, [ws], lang="en")[0],
                breadcrumb_schema(
                    b["siteUrl"],
                    [("Home", "/en/"), ("Schedule", "/en/schedule/"), (ev_title_en, url_path)],
                ),
            ],
            og_image=landing.get("ogImage") or ws["image"],
            body_class="is-father-invite",
        )
        sitemap_urls.append((url_path, "0.8", "weekly"))

    en_ssr_invite_main = render_template(
        en_invite_tpl,
        {
            "EVENT_ID": "__SSR_EVENT_ID__",
            "EVENT_SLUG": "__SSR_EVENT_SLUG__",
            "EVENT_PILLAR": "__SSR_EVENT_PILLAR__",
            "EVENT_PILLAR_LABEL": "__SSR_EVENT_PILLAR_LABEL__",
            "EVENT_SHARE_TITLE": "__SSR_EVENT_SHARE_TITLE__",
            "EVENT_KICKER": "__SSR_EVENT_KICKER__",
            "EVENT_LANG_BADGE": "__SSR_EVENT_LANG_BADGE__",
            "EVENT_TITLE": "__SSR_EVENT_TITLE__",
            "EVENT_DATE_DISPLAY": "__SSR_EVENT_DATE_DISPLAY__",
            "EVENT_LOCATION": "__SSR_EVENT_LOCATION__",
            "EVENT_FEE": "__SSR_EVENT_FEE__",
            "EVENT_SEATS": "__SSR_EVENT_SEATS__",
            "EVENT_SEAT_BAR_HTML": "__SSR_EVENT_SEAT_BAR_HTML__",
            "EVENT_IMAGE": "__SSR_EVENT_IMAGE__",
            "EVENT_IMAGE_ALT": "__SSR_EVENT_IMAGE_ALT__",
            "EVENT_ZALO_GROUP": "__SSR_EVENT_ZALO_GROUP__",
            "EVENT_HOST_SIGNATURE": "__SSR_EVENT_HOST_SIGNATURE__",
            "EVENT_RSVP_HEADING": "__SSR_EVENT_RSVP_HEADING__",
            "EVENT_NOTE_SUMMARY": "+ Add a note for coordinators (optional)",
            "EVENT_NOTE_PLACEHOLDER": "Share a note ahead of time, or leave blank if you prefer simply to listen...",
            "INVITE_HEADLINE": "__SSR_INVITE_HEADLINE__",
            "INVITE_START_ISO": "__SSR_INVITE_START_ISO__",
            "INVITE_END_ISO": "__SSR_INVITE_END_ISO__",
            "INVITE_ICS_START": "__SSR_INVITE_ICS_START__",
            "INVITE_ICS_END": "__SSR_INVITE_ICS_END__",
            "INVITE_TIME_LABEL": "__SSR_INVITE_TIME_LABEL__",
            "INVITE_VENUE_NAME": "__SSR_INVITE_VENUE_NAME__",
            "EVENT_VENUE_URL": "",
            "INVITE_VENUE_HTML": "__SSR_INVITE_VENUE_NAME__",
            "LETTER_BODY_HTML": "__SSR_LETTER_BODY_HTML__",
            "LETTER_SIGNOFF": "Warmly invited,",
            "GOOGLE_CAL_URL": "__SSR_GOOGLE_CAL_URL__",
            "CANONICAL_EVENT_URL": "__SSR_CANONICAL_URL__",
        },
    )
    write_page(
        base_en_tpl,
        site,
        "_templates/en-event-invitation-shell.tpl",
        "/en/events/__SSR_SLUG__/",
        "__SSR_PAGE_TITLE__",
        "__SSR_PAGE_DESCRIPTION__",
        en_ssr_invite_main,
        [org_ld_en],
        og_image="/__SSR_OG_IMAGE_PATH__",
        body_class="is-father-invite",
    )
    en_ev_shell_path = DIST_DIR / "_templates" / "en-event-invitation-shell.tpl"
    en_ev_shell_txt = en_ev_shell_path.read_text(encoding="utf-8")
    en_ev_shell_txt = en_ev_shell_txt.replace(
        abs_url(b["siteUrl"], "/__SSR_OG_IMAGE_PATH__"), "__SSR_OG_IMAGE_URL__"
    ).replace(
        abs_url(b["siteUrl"], "/en/events/__SSR_SLUG__/"), "__SSR_CANONICAL_URL__"
    ).replace(
        "__SSR_SLUG__", "__SSR_EVENT_SLUG__"
    ).replace(
        "</head>", "  __SSR_EXTRA_JSON_LD__\n</head>", 1
    )
    en_ev_shell_path.write_text(en_ev_shell_txt, encoding="utf-8")

    # 6b-4b. English Post-Event Memory Stage SSR Shell (_templates/en-event-memory-shell.tpl)
    en_memory_tpl = load_template("en_event_memory_stage.html")
    en_ssr_memory_main = render_template(
        en_memory_tpl,
        {
            "EVENT_ID": "__SSR_EVENT_ID__",
            "EVENT_SLUG": "__SSR_EVENT_SLUG__",
            "EVENT_PILLAR": "__SSR_EVENT_PILLAR__",
            "EVENT_PILLAR_LABEL": "__SSR_EVENT_PILLAR_LABEL__",
            "EVENT_TITLE": "__SSR_EVENT_TITLE__",
            "EVENT_DATE": "__SSR_EVENT_DATE__",
            "EVENT_DATE_DISPLAY": "__SSR_EVENT_DATE_DISPLAY__",
            "EVENT_LOCATION": "__SSR_EVENT_LOCATION__",
            "EVENT_SUMMARY": "__SSR_EVENT_SUMMARY__",
            "MEMORY_ALBUM_ID": "__SSR_MEMORY_ALBUM_ID__",
            "MEMORY_COVER_IMAGE": "__SSR_MEMORY_COVER_IMAGE__",
            "MEMORY_STATS_INLINE_HTML": "__SSR_MEMORY_STATS_INLINE_HTML__",
            "MEMORY_GALLERY_HTML": "__SSR_MEMORY_GALLERY_HTML__",
            "MEMORY_REEL_AUDIO_URL": "__SSR_MEMORY_REEL_AUDIO_URL__",
            "MEMORY_REEL_AUDIO_TITLE": "__SSR_MEMORY_REEL_AUDIO_TITLE__",
        },
    )
    write_page(
        base_en_tpl,
        site,
        "_templates/en-event-memory-shell.tpl",
        "/en/events/__SSR_SLUG__/",
        "__SSR_PAGE_TITLE__",
        "__SSR_PAGE_DESCRIPTION__",
        en_ssr_memory_main,
        [org_ld_en],
        og_image="/__SSR_OG_IMAGE_PATH__",
        body_class="is-memory-stage",
    )
    en_mem_shell_path = DIST_DIR / "_templates" / "en-event-memory-shell.tpl"
    en_mem_shell_txt = en_mem_shell_path.read_text(encoding="utf-8")
    en_mem_shell_txt = en_mem_shell_txt.replace(
        abs_url(b["siteUrl"], "/__SSR_OG_IMAGE_PATH__"), "__SSR_OG_IMAGE_URL__"
    ).replace(
        abs_url(b["siteUrl"], "/en/events/__SSR_SLUG__/"), "__SSR_CANONICAL_URL__"
    ).replace(
        "__SSR_SLUG__", "__SSR_EVENT_SLUG__"
    ).replace(
        "</head>", "  __SSR_EXTRA_JSON_LD__\n</head>", 1
    )
    en_mem_shell_path.write_text(en_mem_shell_txt, encoding="utf-8")

    # 6b-5. English Journey & Photo Archive (/en/journey/)
    en_journey_main = render_template(
        load_template("en_journey_list.html"),
        {
            "NEWS_LIST_HTML": render_news_cards(news, filterable=True, lang="en"),
            "GALLERY_HTML": render_archive_drawer(
                activities["gallery"],
                title="HolaHeart: A Mother's Love in the Age of AI",
                meta="15 Nov 2026 · May Lang Thang Cafe, Hoa Lac",
                pillar="holaheart",
                default_label="HolaHeart · 15 Nov 2026",
                story_href="/en/journey/tinh-yeu-thuong-cua-me/",
                story_label="Read story &amp; Write a reflection →",
                lang="en",
            ),
            "MUSICSPACE_GALLERY_HTML": render_archive_drawer(
                heart_photo_wall,
                title="HolaHeart × MusicSpace in Hoa Lac",
                meta="2025 – 2026 · Acoustic & Dialogue Series",
                pillar="holaheart",
                default_label="HolaHeart × MusicSpace",
                desc="Selected moments from our weekend acoustic nights and youth dialogues in Hoa Lac.",
                story_href="/en/journey/holaheart-musicspace/",
                story_label="Read story &amp; Write a reflection →",
                drawer_id="musicspace-chapter",
                lang="en",
            ),
            "CONTACT_EMAIL": esc(c["email"]),
        },
    )
    write_page(
        base_en_tpl,
        site,
        "en/journey/index.html",
        "/en/journey/",
        f"Journey & Photo Archive | {b['brandName']}",
        "Stories from past HolaRise gatherings, verified photo archives, and community reflections in Hoa Lac.",
        en_journey_main,
        [org_ld_en, breadcrumb_schema(b["siteUrl"], [("Home", "/en/"), ("Journey", "/en/journey/")])],
    )
    sitemap_urls.append(("/en/journey/", "0.8", "weekly"))

    # 6b-6. English Journey Detail Pages (/en/journey/<slug>/) + EN SSR Shell
    en_news_detail_tpl = load_template("en_journey_detail.html")
    for article in news:
        related = [a for a in news if a["slug"] != article["slug"]][:2]
        en_paragraphs = render_article_body(article.get("contentEn") or article["content"])
        slug_path = f"/en/journey/{article['slug']}/"
        en_title = article.get("titleEn") or article["title"]
        en_cat = article.get("categoryEn") or article["category"]
        en_excerpt = article.get("excerptEn") or article["excerpt"]
        en_author = article.get("authorEn") or "HolaRise Coordinating Team"
        en_detail_main = render_template(
            en_news_detail_tpl,
            {
                "ARTICLE_SLUG": esc(article["slug"]),
                "ARTICLE_CATEGORY": esc(en_cat),
                "ARTICLE_TITLE": esc(en_title),
                "ARTICLE_DATE": esc(article["date"]),
                "ARTICLE_DATE_DISPLAY": esc(article.get("dateDisplayEn") or article["dateDisplay"]),
                "ARTICLE_READ_TIME": esc(article.get("readTimeEn") or "2 min read"),
                "ARTICLE_AUTHOR": esc(en_author),
                "ARTICLE_IMAGE_ATTRS": image_attrs(
                    article["image"], "(min-width: 1280px) 1240px, calc(100vw - 40px)"
                ),
                "ARTICLE_IMAGE_ALT": esc(article.get("imageAltEn") or article["imageAlt"]),
                "ARTICLE_PARAGRAPHS": en_paragraphs,
                "RELATED_NEWS_HTML": render_news_cards(related, filterable=False, lang="en"),
            },
        )
        en_article_schema = {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": en_title,
            "description": en_excerpt,
            "image": [abs_url(b["siteUrl"], article["image"])],
            "datePublished": article["date"],
            "dateModified": article["date"],
            "inLanguage": "en",
            "author": {"@type": "Organization", "@id": org_id, "name": en_author},
            "publisher": {
                "@type": "Organization",
                "@id": org_id,
                "name": brand_en_name,
                "logo": {
                    "@type": "ImageObject",
                    "url": abs_url(b["siteUrl"], "/assets/images/pwa/icon-512.png"),
                    "width": 512,
                    "height": 512,
                },
            },
            "mainEntityOfPage": abs_url(b["siteUrl"], slug_path),
        }
        en_seo_title = (article.get("seoTitleEn") or "").strip() or f"{en_title} | {b['brandName']}"
        write_page(
            base_en_tpl,
            site,
            f"en/journey/{article['slug']}/index.html",
            slug_path,
            en_seo_title,
            en_excerpt,
            en_detail_main,
            [
                org_ld_en,
                en_article_schema,
                breadcrumb_schema(
                    b["siteUrl"],
                    [("Home", "/en/"), ("Journey", "/en/journey/"), (en_title, slug_path)],
                ),
            ],
            og_type="article",
            og_image=article["image"],
        )
        sitemap_urls.append((slug_path, "0.7", "monthly"))

    en_ssr_detail_main = render_template(
        en_news_detail_tpl,
        {
            "ARTICLE_SLUG": "__SSR_ARTICLE_SLUG__",
            "ARTICLE_CATEGORY": "__SSR_ARTICLE_CATEGORY__",
            "ARTICLE_TITLE": "__SSR_ARTICLE_TITLE__",
            "ARTICLE_DATE": "__SSR_ARTICLE_DATE__",
            "ARTICLE_DATE_DISPLAY": "__SSR_ARTICLE_DATE_DISPLAY__",
            "ARTICLE_READ_TIME": "__SSR_ARTICLE_READ_TIME__",
            "ARTICLE_AUTHOR": "__SSR_ARTICLE_AUTHOR__",
            "ARTICLE_IMAGE_ATTRS": "__SSR_ARTICLE_IMAGE_ATTRS__",
            "ARTICLE_IMAGE_ALT": "__SSR_ARTICLE_IMAGE_ALT__",
            "ARTICLE_PARAGRAPHS": "__SSR_ARTICLE_BODY__",
            "RELATED_NEWS_HTML": "__SSR_RELATED_NEWS__",
        },
    )
    write_page(
        base_en_tpl,
        site,
        "_templates/en-news-detail-shell.tpl",
        "/en/journey/__SSR_SLUG__/",
        "__SSR_PAGE_TITLE__",
        "__SSR_PAGE_DESCRIPTION__",
        en_ssr_detail_main,
        [org_ld_en],
        og_type="article",
        og_image="/__SSR_OG_IMAGE_PATH__",
    )
    en_news_shell_path = DIST_DIR / "_templates" / "en-news-detail-shell.tpl"
    en_news_shell_txt = en_news_shell_path.read_text(encoding="utf-8")
    en_news_shell_txt = en_news_shell_txt.replace(
        abs_url(b["siteUrl"], "/__SSR_OG_IMAGE_PATH__"), "__SSR_OG_IMAGE_URL__"
    ).replace(
        abs_url(b["siteUrl"], "/en/journey/__SSR_SLUG__/"), "__SSR_CANONICAL_URL__"
    ).replace(
        "__SSR_SLUG__", "__SSR_ARTICLE_SLUG__"
    ).replace(
        "</head>", "  __SSR_EXTRA_JSON_LD__\n</head>", 1
    )
    en_news_shell_path.write_text(en_news_shell_txt, encoding="utf-8")

    # 6b-7. English Join & Partner (/en/join/)
    en_faqs = en_site.get("faqs", [])
    en_join_main = render_template(
        load_template("en_join.html"),
        {
            "BRAND_NAME": esc(b["brandName"]),
            "FORM_ENDPOINT": esc(c.get("formEndpoint", "")),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(join_phone_raw),
            "CONTACT_ZALO": esc(c.get("zalo", "")),
            "JOIN_EVENTS_SECTION_HTML": render_join_events_section(workshops["upcoming"], lang="en"),
            "FAQ_HTML": render_faqs(en_faqs, lang="en"),
        },
    )
    write_page(
        base_en_tpl,
        site,
        "en/join/index.html",
        "/en/join/",
        f"Join & Partner | {b['brandName']}",
        "Activate your HolaRise Member Pass for 1-tap RSVP, propose a university or NGO partnership, or read our FAQs.",
        en_join_main,
        [
            org_ld_en,
            faq_schema(en_faqs),
            breadcrumb_schema(b["siteUrl"], [("Home", "/en/"), ("Join & Partner", "/en/join/")]),
        ],
    )
    sitemap_urls.append(("/en/join/", "0.8", "monthly"))

    # 6b-8. English Privacy & Safeguarding (/en/privacy/)
    en_privacy_main = render_template(
        load_template("en_privacy.html"),
        {
            "BRAND_EN_NAME": esc(brand_en_name),
            "CONTACT_ADDRESS_EN": esc(contact_address_en),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(join_phone_raw),
        },
    )
    write_page(
        base_en_tpl,
        site,
        "en/privacy/index.html",
        "/en/privacy/",
        f"Transparency & Privacy Standards | {b['brandName']}",
        "HolaRise non-profit principles, ethical storytelling, child safeguarding, and Vietnam Decree 13/2023/ND-CP data privacy standards.",
        en_privacy_main,
        [
            org_ld_en,
            breadcrumb_schema(b["siteUrl"], [("Home", "/en/"), ("Transparency & Privacy", "/en/privacy/")]),
        ],
    )
    sitemap_urls.append(("/en/privacy/", "0.5", "yearly"))

    # 7a-2. Privacy Policy & Community Rules (/chinh-sach/)
    privacy_main = render_template(
        load_template("privacy.html"),
        {
            "BRAND_SHORT_NAME": esc(b["shortName"]),
            "BRAND_FULL_NAME": esc(b["fullName"]),
            "CONTACT_ADDRESS": esc(c["address"]),
            "CONTACT_MEETING": esc(c["meetingTime"]),
            "CONTACT_EMAIL": esc(c["email"]),
            "CONTACT_PHONE": esc(c["phoneDisplay"]),
            "CONTACT_PHONE_RAW": esc(join_phone_raw),
        },
    )
    write_page(
        base_tpl,
        site,
        "chinh-sach/index.html",
        "/chinh-sach/",
        f"Minh bạch & Quy tắc | {b['brandName']}",
        "Chuẩn mực phi lợi nhuận, minh bạch chi phí từng con số, quy tắc an toàn cộng đồng và bảo vệ dữ liệu cá nhân tại HolaRise.",
        privacy_main,
        [
            org_ld,
            breadcrumb_schema(b["siteUrl"], [("Trang chủ", "/"), ("Minh bạch & Quy tắc", "/chinh-sach/")]),
        ],
    )
    sitemap_urls.append(("/chinh-sach/", "0.5", "yearly"))

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

    # 7b-2. Cloudflare Pages native 404 page (eliminates catch-all Soft 404; excluded from sitemap & SW precache)
    not_found_main = render_template(
        load_template("404.html"),
        {
            "BRAND_SHORT_NAME": esc(b["shortName"]),
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
        "404.html",
        "/404.html",
        f"Không tìm thấy trang (404) | {b['brandName']}",
        f"Trang bạn tìm không tồn tại hoặc đã được di chuyển. Khám phá Lịch hoạt động, Hành trình và 3 trụ cột của {b['brandName']}.",
        not_found_main,
        [org_ld],
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

    # 7d. Media Team Portal (/media/index.html — noindex, excluded from sitemap & SW precache)
    media_html = render_template(
        load_template("media.html"),
        {"CACHE_BUST": CURRENT_BUILD_HASH},
    )
    media_out = DIST_DIR / "media" / "index.html"
    media_out.parent.mkdir(parents=True, exist_ok=True)
    media_out.write_text(media_html, encoding="utf-8")

    # 8. Technical SEO & PWA files: sitemap.xml, robots.txt, site.webmanifest, sw.js, _headers
    today = datetime.date.today().isoformat()
    sitemap_url_blocks = []
    for path, prio, freq in sitemap_urls:
        vi_pair, en_pair = resolve_lang_pair(path)
        alt_lines = ""
        if vi_pair and en_pair:
            vi_loc = esc(abs_url(b["siteUrl"], vi_pair))
            en_loc = esc(abs_url(b["siteUrl"], en_pair))
            alt_lines = (
                f'\n    <xhtml:link rel="alternate" hreflang="vi" href="{vi_loc}"/>'
                f'\n    <xhtml:link rel="alternate" hreflang="en" href="{en_loc}"/>'
                f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{vi_loc}"/>'
            )
        sitemap_url_blocks.append(
            f"""  <url>
    <loc>{esc(abs_url(b['siteUrl'], path))}</loc>{alt_lines}
    <lastmod>{today}</lastmod>
    <changefreq>{freq}</changefreq>
    <priority>{prio}</priority>
  </url>"""
        )
    url_entries = "\n".join(sitemap_url_blocks)
    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
{url_entries}
</urlset>
"""
    (DIST_DIR / "sitemap.xml").write_text(sitemap_xml, encoding="utf-8")

    robots_txt = f"""User-agent: *
Allow: /
Disallow: /admin/
Disallow: /media/
Disallow: /api/
Disallow: /_templates/
Disallow: /tv/

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
                "name": "Lịch hoạt động",
                "short_name": "Lịch",
                "description": "Xem lịch hoạt động hằng tuần của HolaHeart, HolaGreen, HolaConnect",
                "url": "/lich-hoat-dong/?source=pwa-shortcut",
                "icons": [
                    {
                        "src": "/assets/images/pwa/icon-192.png",
                        "sizes": "192x192",
                        "type": "image/png",
                    }
                ],
            },
            {
                "name": "Hành trình & Kho ảnh",
                "short_name": "Hành trình",
                "description": "Xem tường thuật và triển lãm ảnh thật của HolaRise",
                "url": "/hanh-trinh/?source=pwa-shortcut",
                "icons": [
                    {
                        "src": "/assets/images/pwa/icon-192.png",
                        "sizes": "192x192",
                        "type": "image/png",
                    }
                ],
            },
            {
                "name": "Tham gia & Hợp tác",
                "short_name": "Tham gia",
                "description": "Nhận Thẻ Gieo Mầm hoặc kết nối hợp tác cùng HolaRise",
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

    pwa_icons = manifest["icons"]
    admin_manifest = {
        "id": "/admin/",
        "name": "HolaRise CMS – Cổng Điều Phối",
        "short_name": "Hola CMS",
        "description": "Điều phối sự kiện, đơn đăng ký, lưu bút và giao diện dành cho Ban Điều Phối HolaRise.",
        "lang": "vi-VN",
        "dir": "ltr",
        "start_url": "/admin/?source=pwa",
        "scope": "/admin/",
        "display": "standalone",
        "display_override": ["standalone", "minimal-ui"],
        "orientation": "any",
        "background_color": "#F7F7F5",
        "theme_color": "#0B110F",
        "categories": ["productivity", "utilities"],
        "prefer_related_applications": False,
        "icons": pwa_icons,
    }
    (DIST_DIR / "admin-manifest.webmanifest").write_text(
        json.dumps(admin_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    media_manifest = {
        "id": "/media/",
        "name": "HolaRise Media – Kho Hình Ảnh",
        "short_name": "Hola Media",
        "description": "Tải ảnh gốc lên Google Drive, duyệt nén WebP và quản lý album sự kiện HolaRise.",
        "lang": "vi-VN",
        "dir": "ltr",
        "start_url": "/media/?source=pwa",
        "scope": "/media/",
        "display": "standalone",
        "display_override": ["standalone", "minimal-ui"],
        "orientation": "any",
        "background_color": "#F7F7F5",
        "theme_color": "#0B110F",
        "categories": ["photo", "productivity"],
        "prefer_related_applications": False,
        "icons": pwa_icons,
    }
    (DIST_DIR / "media-manifest.webmanifest").write_text(
        json.dumps(media_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    precache_urls = collect_precache_urls(h["imageSrcset"], h["mobileImageSrcset"])
    (DIST_DIR / "sw.js").write_text(
        generate_service_worker(CURRENT_BUILD_HASH, precache_urls), encoding="utf-8"
    )
    (DIST_DIR / "_headers").write_text(generate_cloudflare_headers(), encoding="utf-8")
    (DIST_DIR / "llms.txt").write_text(
        generate_llms_txt(site, activities, workshops, news), encoding="utf-8"
    )

    indexnow_key = (site.get("seo", {}).get("indexNowKey") or "").strip()
    if indexnow_key and re.fullmatch(r"[A-Za-z0-9-]{8,128}", indexnow_key):
        (DIST_DIR / f"{indexnow_key}.txt").write_text(indexnow_key + "\n", encoding="utf-8")

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
        if re.search(r'\bhref="#"', text):
            errors.append(f"[{rel}] Dead placeholder link href=\"#\" found")

        is_internal_portal = rel in (Path("admin/index.html"), Path("media/index.html"))
        if is_internal_portal:
            if 'content="noindex, nofollow"' not in text:
                errors.append(f"[{rel}] Internal portal page must declare robots noindex, nofollow")
            expected_manifest = "/admin-manifest.webmanifest" if rel == Path("admin/index.html") else "/media-manifest.webmanifest"
            if f'href="{expected_manifest}"' not in text:
                errors.append(f"[{rel}] Internal portal page must link manifest {expected_manifest}")
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

        if "https://holarise.org/" not in text:
            errors.append(f"[{rel}] Canonical or OG URL does not point to https://holarise.org/")

        ld_blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
        if not ld_blocks:
            errors.append(f"[{rel}] Missing JSON-LD structured data")
        for idx, block in enumerate(ld_blocks):
            try:
                parsed_ld = json.loads(block)
                for same_url in (parsed_ld.get("sameAs") or []) if isinstance(parsed_ld, dict) else []:
                    if not urlparse(same_url).path.strip("/"):
                        errors.append(f"[{rel}] Placeholder sameAs root URL in JSON-LD: {same_url}")
            except json.JSONDecodeError as exc:
                errors.append(f"[{rel}] Invalid JSON-LD #{idx + 1}: {exc}")

        for attr, target in re.findall(r'\b(href|src)="(/[^"]*)"', text):
            clean = target.split("#")[0].split("?")[0]
            if not clean or clean == "/":
                continue
            if clean.startswith("/api/"):
                continue
            target_path = DIST_DIR / clean.lstrip("/")
            if clean.endswith("/"):
                if not (target_path / "index.html").exists():
                    errors.append(f"[{rel}] Broken internal route {attr}=\"{target}\"")
            elif not target_path.exists():
                errors.append(f"[{rel}] Missing asset {attr}=\"{target}\"")

        for srcset in re.findall(r'<(?:img|source)\b[^>]*\ssrcset="([^"]+)"', text):
            for url in srcset_urls(srcset):
                if url.startswith("/assets/") and not (DIST_DIR / url.lstrip("/")).is_file():
                    errors.append(f"[{rel}] Missing image variant: {url}")

        for img_tag in re.findall(r"<img\b[^>]*>", text):
            if re.search(r'\bsrc=""', img_tag):
                errors.append(f"[{rel}] Empty img src attribute: {img_tag[:80]}")
            if 'id="float-preview-img"' in img_tag or 'id="lightbox-img"' in img_tag or 'class="brand-part' in img_tag:
                continue
            if 'alt=""' in img_tag or "alt=" not in img_tag:
                errors.append(f"[{rel}] Image missing descriptive alt: {img_tag[:80]}")

    og_url = load_json("site.json")["brand"]["ogImage"]
    og_cover = DIST_DIR / urlparse(og_url).path.lstrip("/")
    if not og_cover.is_file() or read_jpeg_dimensions(og_cover) != (1200, 630):
        errors.append(f"Default sharing image must be a 1200×630 JPEG: {og_url}")

    for required_file in ["favicon.ico", "sitemap.xml", "robots.txt", "llms.txt", "404.html", "chinh-sach/index.html", "site.webmanifest", "admin-manifest.webmanifest", "media-manifest.webmanifest", "sw.js", "_headers", "offline/index.html"]:
        if not (DIST_DIR / required_file).exists():
            errors.append(f"Missing technical SEO/PWA file: {required_file}")

    # Verify offline & 404 pages have noindex and are excluded from sitemap.xml
    for noindex_rel in ("offline/index.html", "404.html"):
        noindex_path = DIST_DIR / noindex_rel
        if noindex_path.exists() and "noindex" not in noindex_path.read_text(encoding="utf-8"):
            errors.append(f"[{noindex_rel}] Fallback page must declare robots noindex")

    sitemap_path = DIST_DIR / "sitemap.xml"
    if sitemap_path.exists():
        sm_txt = sitemap_path.read_text(encoding="utf-8")
        if "/offline/" in sm_txt:
            errors.append("[sitemap.xml] Offline fallback route must not be included in sitemap.xml")
        if "/admin/" in sm_txt:
            errors.append("[sitemap.xml] Admin route must not be included in sitemap.xml")
        if "/media/" in sm_txt:
            errors.append("[sitemap.xml] Media portal route must not be included in sitemap.xml")
        if "/404.html" in sm_txt:
            errors.append("[sitemap.xml] 404 page must not be included in sitemap.xml")
        if "/chinh-sach/" not in sm_txt:
            errors.append("[sitemap.xml] Privacy route /chinh-sach/ must be included in sitemap.xml")

    # Verify llms.txt reflects canonical routes
    llms_path = DIST_DIR / "llms.txt"
    if llms_path.exists():
        llms_txt = llms_path.read_text(encoding="utf-8")
        for req_route in ("/lich-hoat-dong/", "/hanh-trinh/", "/gioi-thieu/", "/tham-gia/"):
            if req_route not in llms_txt:
                errors.append(f"[llms.txt] Missing canonical route: {req_route}")

    # Verify Web App Manifest contract & actual icon/screenshot pixel sizes
    for manifest_name in ("site.webmanifest", "admin-manifest.webmanifest", "media-manifest.webmanifest"):
        manifest_path = DIST_DIR / manifest_name
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"[{manifest_name}] Invalid JSON: {exc}")
            manifest = None

        if isinstance(manifest, dict):
            for field in ("id", "name", "short_name", "start_url", "scope", "display"):
                if not manifest.get(field):
                    errors.append(f"[{manifest_name}] Missing required field: {field}")
            if manifest.get("display") != "standalone":
                errors.append(f"[{manifest_name}] Expected display='standalone'")

            icons = manifest.get("icons", [])
            found_icon_pairs = set()
            for ic in icons:
                src = ic.get("src", "")
                sizes = ic.get("sizes", "")
                purpose = ic.get("purpose", "any")
                ic_path = DIST_DIR / src.lstrip("/")
                if not ic_path.is_file():
                    errors.append(f"[{manifest_name}] Missing icon file: {src}")
                    continue
                dims = read_png_dimensions(ic_path)
                if not dims:
                    errors.append(f"[{manifest_name}] Icon is not a valid PNG: {src}")
                elif f"{dims[0]}x{dims[1]}" != sizes:
                    errors.append(f"[{manifest_name}] Icon {src} actual size {dims[0]}x{dims[1]} != declared {sizes}")
                found_icon_pairs.add((sizes, purpose))

            for req_pair in (("192x192", "any"), ("512x512", "any"), ("192x192", "maskable"), ("512x512", "maskable")):
                if req_pair not in found_icon_pairs:
                    errors.append(f"[{manifest_name}] Missing required icon {req_pair[0]} purpose='{req_pair[1]}'")

            for sc in manifest.get("screenshots", []):
                sc_path = DIST_DIR / sc.get("src", "").lstrip("/")
                if not sc_path.is_file():
                    errors.append(f"[{manifest_name}] Missing screenshot: {sc.get('src')}")
                    continue
                dims = read_jpeg_dimensions(sc_path) if sc_path.suffix.lower() in (".jpg", ".jpeg") else read_png_dimensions(sc_path)
                if dims and f"{dims[0]}x{dims[1]}" != sc.get("sizes"):
                    errors.append(
                        f"[{manifest_name}] Screenshot {sc.get('src')} actual {dims[0]}x{dims[1]} != declared {sc.get('sizes')}"
                    )

            for sh in manifest.get("shortcuts", []):
                sh_url = sh.get("url", "").split("?")[0].split("#")[0]
                sh_target = DIST_DIR / sh_url.lstrip("/") / "index.html"
                if sh_url != "/" and not sh_target.is_file():
                    errors.append(f"[{manifest_name}] Shortcut points to missing route: {sh.get('url')}")

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
                    if clean.startswith("/admin") or clean.startswith("/media") or clean == "/404.html" or "admin.css" in clean or "admin.js" in clean or "media.css" in clean or "media-portal.js" in clean:
                        errors.append(f"[sw.js] Non-precachable route/asset must not be precached: {u}")
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

    # EN Purity Gate: verify complete /en/* mirror with 0 leaked Vietnamese diacritics & valid hreflang
    vn_diacritic_re = re.compile(
        r"[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ"
        r"ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]"
    )
    required_en_files = [
        "en/index.html",
        "en/about/index.html",
        "en/schedule/index.html",
        "en/journey/index.html",
        "en/join/index.html",
        "en/privacy/index.html",
        "_templates/en-event-invitation-shell.tpl",
        "_templates/en-event-memory-shell.tpl",
        "_templates/en-news-detail-shell.tpl",
    ]
    for req_en in required_en_files:
        if not (DIST_DIR / req_en).is_file():
            errors.append(f"[EN-GATE] Missing required EN file: {req_en}")

    en_targets = sorted(
        list((DIST_DIR / "en").rglob("*.html")) + list((DIST_DIR / "_templates").glob("en-*.tpl"))
    )
    for en_file in en_targets:
        rel_en = en_file.relative_to(DIST_DIR)
        raw_en = en_file.read_text(encoding="utf-8")
        if '<html lang="en" data-lang="en">' not in raw_en:
            errors.append(f"[EN-GATE] [{rel_en}] Must declare <html lang=\"en\" data-lang=\"en\">")
        if 'property="og:locale" content="en_US"' not in raw_en:
            errors.append(f"[EN-GATE] [{rel_en}] Must declare og:locale=en_US")
        if not str(rel_en).startswith("_templates/"):
            if 'hreflang="vi"' not in raw_en or 'hreflang="en"' not in raw_en:
                errors.append(f"[EN-GATE] [{rel_en}] Missing bi-directional hreflang links")
        leaked_lines = [
            idx
            for idx, ln in enumerate(raw_en.splitlines(), 1)
            if vn_diacritic_re.search(ln)
        ]
        if leaked_lines:
            sample = ", ".join(f"L{n}" for n in leaked_lines[:5])
            errors.append(
                f"[EN-GATE] [{rel_en}] Found {len(leaked_lines)} line(s) with Vietnamese diacritics ({sample})"
            )
        # Ensure EN pages never link inside <main>/<footer> to VI routes (only header .lang-switch may switch to VI)
        main_and_footer = raw_en.split("<main", 1)[1] if "<main" in raw_en else ""
        vi_route_leak = re.findall(r'href="(/(?:gioi-thieu|lich-hoat-dong|hanh-trinh|tham-gia|chinh-sach|su-kien)/[^"]*)"', main_and_footer)
        if vi_route_leak:
            errors.append(
                f"[EN-GATE] [{rel_en}] Main/Footer links point to Vietnamese route(s): {', '.join(vi_route_leak[:4])}"
            )

    return errors


FORBIDDEN_PUBLIC_COPY_PATTERNS = (
    ("giữa nhịp sống số", "Văn sáo rỗng kiểu AI (AGENTS.md Tầng 2 - Cổng 1)"),
    ("giữa nhịp sống hối hả", "Văn sáo rỗng kiểu AI (AGENTS.md Tầng 2 - Cổng 1)"),
    ("khoảng lặng cần thiết", "Văn sáo rỗng kiểu AI (AGENTS.md Tầng 2 - Cổng 1)"),
    ("điểm tựa cảm xúc", "Văn sáo rỗng kiểu AI (AGENTS.md Tầng 2 - Cổng 1)"),
    ("cùng tần số", "Cụm từ sáo mòn (AGENTS.md Tầng 2 - Cổng 1)"),
    ("không bán khóa học ẩn", "Câu tự thanh minh yếu thế (AGENTS.md Tầng 2 - Cổng 1)"),
    ("không giáo điều", "Câu tự thanh minh yếu thế (AGENTS.md Tầng 2 - Cổng 1)"),
    ("không thương mại hóa niềm tin", "Câu tự thanh minh yếu thế (AGENTS.md Tầng 2 - Cổng 1)"),
    ("che chở, chở che", "Điệp từ sến / lỗi biên tập (AGENTS.md Tầng 2 - Cổng 2)"),
    ("pbkdf2-sha256", "Lộ thuật ngữ kỹ thuật ra trang công khai (AGENTS.md Tầng 2 - Cổng 1)"),
    ("localstorage", "Lộ thuật ngữ kỹ thuật ra trang công khai (AGENTS.md Tầng 2 - Cổng 1)"),
)


def audit_public_copy() -> list:
    """Scan visible public HTML text in dist/ against AGENTS.md Tầng 2 forbidden copy patterns."""
    warnings = []
    for f in sorted(DIST_DIR.rglob("*.html")):
        rel = f.relative_to(DIST_DIR)
        if rel in (Path("admin/index.html"), Path("media/index.html")):
            continue
        raw = f.read_text(encoding="utf-8")
        cleaned = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", raw, flags=re.I | re.S)
        visible = html.unescape(re.sub(r"<[^>]+>", " ", cleaned))
        normalized = re.sub(r"\s+", " ", visible).lower()
        for phrase, reason in FORBIDDEN_PUBLIC_COPY_PATTERNS:
            if phrase in normalized:
                warnings.append(f"[{rel}] \"{phrase}\" -> {reason}")
    return warnings


def main():
    parser = argparse.ArgumentParser(description="Build HolaRise static website")
    parser.add_argument("--check", action="store_true", help="Run automated SEO, link & copy verification after build")
    parser.add_argument("--strict-copy", action="store_true", help="Fail with exit code 1 if any AGENTS.md copy violation is found")
    args = parser.parse_args()

    urls = build_site()
    print(f"Built {len(urls)} pages successfully into {DIST_DIR}")

    if args.check or args.strict_copy:
        errors = verify_dist()
        copy_warnings = audit_public_copy()
        if copy_warnings:
            print(f"[COPY-FAIL] Found {len(copy_warnings)} public copy violation(s) against AGENTS.md Tầng 2:")
            for cw in copy_warnings:
                print("  -", cw)
            errors.extend(f"[COPY] {cw}" for cw in copy_warnings)
        if errors:
            print("Verification FAILED:")
            for err in errors:
                print("  -", err)
            sys.exit(1)
        print("Verification PASSED: All HTML pages, SEO tags, JSON-LD schemas, alt texts, internal links, and AGENTS.md copy gates are valid.")


if __name__ == "__main__":
    main()
