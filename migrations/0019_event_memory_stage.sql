-- Migration 0018: Post-Event Memory Stage (Moods, Multi-Reactions, Event Feedback & Standardized Media Contributions)
-- 100% backwards-compatible with existing reflections, hearts, and media albums.

ALTER TABLE activity_reflections ADD COLUMN mood TEXT NOT NULL DEFAULT '';
ALTER TABLE reflection_hearts ADD COLUMN reaction_type TEXT NOT NULL DEFAULT 'heart';

ALTER TABLE media_photos ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'team';
ALTER TABLE media_photos ADD COLUMN drive_path TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS event_feedbacks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL DEFAULT '',
  event_slug TEXT NOT NULL DEFAULT '',
  event_title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'cai-thien' CHECK(category IN ('cai-thien', 'dong-vien', 'de-xuat', 'khac')),
  content TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT 'Ẩn danh',
  author_contact TEXT NOT NULL DEFAULT '',
  member_id TEXT NOT NULL DEFAULT '',
  is_anonymous INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'resolved')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_feedbacks_event_status
  ON event_feedbacks(event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_feedbacks_created
  ON event_feedbacks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_photos_source_kind
  ON media_photos(album_id, source_kind, approval_status);
