#!/usr/bin/env python3
"""Submit HolaRise sitemap URLs to IndexNow (Bing, Yandex, Naver, ChatGPT/Copilot/DuckDuckGo feed).

Usage:
  1. Generate a 32-char hex key:
       python3 -c "import secrets; print(secrets.token_hex(16))"
  2. Put it in data/site.json under seo.indexNowKey, run `python3 build.py`, and deploy.
     (build.py automatically creates dist/<key>.txt so https://holarise.org/<key>.txt is reachable.)
  3. Ping IndexNow after deploy:
       python3 scripts/ping_indexnow.py
     Or preview payload without sending:
       python3 scripts/ping_indexnow.py --dry-run
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE_JSON = ROOT / "data" / "site.json"
DIST_SITEMAP = ROOT / "dist" / "sitemap.xml"
INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"


def load_urls_from_sitemap(xml_text: str) -> list[str]:
    root = ET.fromstring(xml_text)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [el.text.strip() for el in root.findall("sm:url/sm:loc", ns) if el.text and el.text.strip()]
    if not urls:
        urls = [el.text.strip() for el in root.findall(".//loc") if el.text and el.text.strip()]
    return sorted(set(urls))


def main() -> int:
    parser = argparse.ArgumentParser(description="Ping IndexNow with HolaRise sitemap URLs")
    parser.add_argument("--key", default="", help="IndexNow key (overrides data/site.json and INDEXNOW_KEY)")
    parser.add_argument("--sitemap-url", default="", help="Fetch live sitemap URL instead of dist/sitemap.xml")
    parser.add_argument("--dry-run", action="store_true", help="Print payload without calling api.indexnow.org")
    args = parser.parse_args()

    site = json.loads(SITE_JSON.read_text(encoding="utf-8"))
    site_url = site["brand"]["siteUrl"].rstrip("/")
    host = urlparse(site_url).netloc

    key = (args.key or os.environ.get("INDEXNOW_KEY") or site.get("seo", {}).get("indexNowKey") or "").strip()
    if not key and not args.dry_run:
        print("Error: Missing IndexNow key. Set seo.indexNowKey in data/site.json or pass --key <KEY>.", file=sys.stderr)
        return 1
    if key and not re.fullmatch(r"[A-Za-z0-9-]{8,128}", key):
        print("Error: IndexNow key must be 8-128 characters [A-Za-z0-9-].", file=sys.stderr)
        return 1

    if args.sitemap_url:
        with urllib.request.urlopen(args.sitemap_url, timeout=15) as resp:
            xml_text = resp.read().decode("utf-8")
    else:
        if not DIST_SITEMAP.is_file():
            print(f"Error: {DIST_SITEMAP} not found. Run `python3 build.py` first.", file=sys.stderr)
            return 1
        xml_text = DIST_SITEMAP.read_text(encoding="utf-8")

    urls = load_urls_from_sitemap(xml_text)
    if not urls:
        print("Error: No URLs found in sitemap.", file=sys.stderr)
        return 1

    effective_key = key or "<YOUR_INDEXNOW_KEY>"
    payload = {
        "host": host,
        "key": effective_key,
        "keyLocation": f"{site_url}/{effective_key}.txt",
        "urlList": urls,
    }

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    req = urllib.request.Request(
        INDEXNOW_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            print(f"IndexNow accepted ({resp.status}): submitted {len(urls)} URLs for {host}")
            return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"IndexNow HTTP {exc.code}: {body}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
