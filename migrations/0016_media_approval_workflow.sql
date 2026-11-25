-- Migration 0016: Media approval & post-event auto-album workflow.
-- Existing photos default to 'approved' for full backwards compatibility.

ALTER TABLE media_albums ADD COLUMN event_id TEXT NOT NULL DEFAULT '';

ALTER TABLE media_photos ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE media_photos ADD COLUMN web_url TEXT NOT NULL DEFAULT '';
ALTER TABLE media_photos ADD COLUMN web_media_key TEXT NOT NULL DEFAULT '';
ALTER TABLE media_photos ADD COLUMN approved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE media_photos ADD COLUMN approved_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_media_albums_event_id
  ON media_albums(event_id);
CREATE INDEX IF NOT EXISTS idx_media_photos_approval
  ON media_photos(album_id, approval_status, sort_order ASC, created_at DESC);
