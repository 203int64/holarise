-- HolaRise CMS & Registration Database Schema (Cloudflare D1 / SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('super_admin', 'editor')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT 'cong-dong',
  filters_json TEXT NOT NULL DEFAULT '[]',
  date TEXT NOT NULL,
  date_display TEXT NOT NULL,
  read_time TEXT NOT NULL DEFAULT '2 phút đọc',
  author TEXT NOT NULL DEFAULT 'Ban Điều Phối HolaRise',
  image TEXT NOT NULL,
  image_alt TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'upcoming' CHECK(kind IN ('upcoming', 'past')),
  type TEXT NOT NULL DEFAULT 'HolaHeart · Biết ơn & Tử tế',
  filters_json TEXT NOT NULL DEFAULT '[]',
  date TEXT NOT NULL,
  date_display TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT 'Tân Xã, Hòa Lạc',
  fee TEXT NOT NULL DEFAULT 'Miễn phí',
  seats TEXT NOT NULL DEFAULT 'Mở đăng ký',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  highlights_json TEXT NOT NULL DEFAULT '[]',
  participants TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '/assets/images/activity-workshop.jpg',
  image_alt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'join_page' CHECK(source IN ('join_page', 'event_modal')),
  event_id TEXT NOT NULL DEFAULT '',
  activity_title TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'contacted', 'attended', 'cancelled')),
  admin_note TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'skipped' CHECK(sync_status IN ('pending', 'synced', 'failed', 'skipped')),
  sync_error TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_posts_status_date ON posts(status, date DESC);
CREATE INDEX IF NOT EXISTS idx_events_kind_status_sort ON events(kind, status, sort_order ASC, date ASC);
CREATE INDEX IF NOT EXISTS idx_registrations_created ON registrations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_activity ON registrations(activity_title, created_at DESC);
