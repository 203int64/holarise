-- Migration 0017: Member-only multi-photo reflections (up to 7 photos) & member album contributions.
-- Backwards-compatible with existing single-photo reflections and admin media albums.

ALTER TABLE activity_reflections ADD COLUMN photos_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE media_photos ADD COLUMN contributor_member_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_media_photos_contributor
  ON media_photos(contributor_member_id, created_at DESC);
