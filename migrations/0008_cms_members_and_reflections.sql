-- Migration 0008: CMS Direct Member/Core Team Profiles + Passwordless Participant Testimonials
-- Backward-compatible with existing members & activity_reflections tables.

ALTER TABLE members ADD COLUMN role_title TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN is_public_team INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS community_testimonials (
  id TEXT PRIMARY KEY,
  activity_slug TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'Thành viên tham dự',
  author_org TEXT NOT NULL DEFAULT '',
  pull_quote TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  photo_url TEXT NOT NULL DEFAULT '',
  photo_media_key TEXT NOT NULL DEFAULT '',
  is_featured_home INTEGER NOT NULL DEFAULT 0,
  heart_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  source TEXT NOT NULL DEFAULT 'public' CHECK(source IN ('public', 'admin')),
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_test_slug_status
  ON community_testimonials(activity_slug, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comm_test_featured
  ON community_testimonials(is_featured_home, status, created_at DESC);
