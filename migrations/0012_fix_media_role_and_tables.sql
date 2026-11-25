-- Migration 0012: Widen admin_users.role CHECK to include 'media' (preserving phone/department, sessions & passkeys)
-- and ensure media_albums / media_photos tables exist for the /media/ portal.
PRAGMA defer_foreign_keys = ON;

-- Snapshot child tables with ON DELETE CASCADE before rebuilding admin_users
-- (SQLite/D1 fires ON DELETE CASCADE on DROP TABLE even when defer_foreign_keys = ON)
CREATE TABLE _backup_sessions_0012 AS SELECT * FROM sessions;
CREATE TABLE _backup_admin_passkeys_0012 AS SELECT * FROM admin_passkeys;

CREATE TABLE admin_users_v2 (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('super_admin', 'editor', 'media')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  phone TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT ''
);

INSERT INTO admin_users_v2 (
  id, email, name, role, password_hash, password_salt,
  is_active, created_at, last_login_at, phone, department
)
SELECT
  id, email, name, role, password_hash, password_salt,
  is_active, created_at, last_login_at, phone, department
FROM admin_users;

DROP TABLE admin_users;
ALTER TABLE admin_users_v2 RENAME TO admin_users;

INSERT OR IGNORE INTO sessions SELECT * FROM _backup_sessions_0012;
INSERT OR IGNORE INTO admin_passkeys SELECT * FROM _backup_admin_passkeys_0012;
DROP TABLE _backup_sessions_0012;
DROP TABLE _backup_admin_passkeys_0012;

CREATE TABLE IF NOT EXISTS media_albums (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  date_display TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT 'Hòa Lạc, Hà Nội',
  filters_json TEXT NOT NULL DEFAULT '[]',
  drive_url TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_photos (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  media_key TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  alt TEXT NOT NULL DEFAULT '',
  photographer TEXT NOT NULL DEFAULT '',
  is_featured_home INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (album_id) REFERENCES media_albums(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_albums_status_sort
  ON media_albums(status, sort_order ASC, event_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_photos_album_sort
  ON media_photos(album_id, sort_order ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_photos_featured
  ON media_photos(is_featured_home, sort_order ASC, created_at DESC);
