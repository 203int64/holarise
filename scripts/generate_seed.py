#!/usr/bin/env python3
"""Generate idempotent SQLite/D1 seed SQL from data/news.json and data/workshops.json."""

import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def sql_str(val) -> str:
    return "'" + str(val if val is not None else "").replace("'", "''") + "'"


def generate_seed_sql() -> str:
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    news = json.loads((DATA_DIR / "news.json").read_text(encoding="utf-8"))
    workshops = json.loads((DATA_DIR / "workshops.json").read_text(encoding="utf-8"))
    site = json.loads((DATA_DIR / "site.json").read_text(encoding="utf-8"))

    stmts = ["-- Idempotent seed from data/news.json, data/workshops.json, data/site.json"]

    for item in news:
        post_id = f"post-{item['slug']}"
        stmts.append(
            "INSERT OR IGNORE INTO posts "
            "(id, slug, title, category, category_slug, filters_json, date, date_display, read_time, author, image, image_alt, excerpt, content_json, status, created_at, updated_at) "
            f"VALUES ({sql_str(post_id)}, {sql_str(item['slug'])}, {sql_str(item['title'])}, "
            f"{sql_str(item.get('category', ''))}, {sql_str(item.get('categorySlug', 'cong-dong'))}, "
            f"{sql_str(json.dumps(item.get('filters', []), ensure_ascii=False))}, "
            f"{sql_str(item.get('date', ''))}, {sql_str(item.get('dateDisplay', ''))}, "
            f"{sql_str(item.get('readTime', '2 phút đọc'))}, {sql_str(item.get('author', 'Ban Điều Phối HolaRise'))}, "
            f"{sql_str(item.get('image', ''))}, {sql_str(item.get('imageAlt', ''))}, "
            f"{sql_str(item.get('excerpt', ''))}, {sql_str(json.dumps(item.get('content', []), ensure_ascii=False))}, "
            f"'published', {sql_str(now)}, {sql_str(now)});"
        )

    for idx, ws in enumerate(workshops.get("upcoming", [])):
        stmts.append(
            "INSERT OR IGNORE INTO events "
            "(id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at) "
            f"VALUES ({sql_str(ws['id'])}, 'upcoming', {sql_str(ws.get('type', ''))}, "
            f"{sql_str(json.dumps(ws.get('filters', []), ensure_ascii=False))}, "
            f"{sql_str(ws.get('date', ''))}, {sql_str(ws.get('dateDisplay', ''))}, "
            f"{sql_str(ws.get('time', ''))}, {sql_str(ws.get('location', ''))}, "
            f"{sql_str(ws.get('fee', 'Miễn phí'))}, {sql_str(ws.get('seats', 'Mở đăng ký'))}, "
            f"{sql_str(ws['title'])}, {sql_str(ws.get('summary', ''))}, "
            f"{sql_str(json.dumps(ws.get('highlights', []), ensure_ascii=False))}, '', "
            f"{sql_str(ws.get('image', '/assets/images/activity-workshop.jpg'))}, {sql_str(ws.get('imageAlt', ''))}, "
            f"'published', {idx}, {sql_str(now)}, {sql_str(now)});"
        )

    for idx, past in enumerate(workshops.get("pastTopics", [])):
        ev_id = f"past-topic-{idx + 1}"
        stmts.append(
            "INSERT OR IGNORE INTO events "
            "(id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at) "
            f"VALUES ({sql_str(ev_id)}, 'past', 'Chuyên đề đã tổ chức', '[]', "
            f"{sql_str(past.get('date', ''))}, {sql_str(past.get('date', ''))}, '', 'Tân Xã, Hòa Lạc', 'Miễn phí', '', "
            f"{sql_str(past['title'])}, '', '[]', {sql_str(past.get('participants', ''))}, "
            f"'/assets/images/activity-workshop.jpg', {sql_str(past['title'])}, 'published', {idx}, {sql_str(now)}, {sql_str(now)});"
        )

    default_settings = {
        "notify_email": site.get("contact", {}).get("email", "phungsu@holarise.org"),
        "gas_webhook_url": "",
        "gas_webhook_secret": "",
        "club_name": site.get("brand", {}).get("fullName", "Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên"),
    }
    for key, val in default_settings.items():
        stmts.append(
            f"INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ({sql_str(key)}, {sql_str(val)}, {sql_str(now)});"
        )

    return "\n".join(stmts) + "\n"


if __name__ == "__main__":
    out = ROOT / "migrations" / "0002_seed.sql"
    out.write_text(generate_seed_sql(), encoding="utf-8")
    print(f"Generated {out}")
