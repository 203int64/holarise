-- Migration 0020: Deep Member Control, Media Visibility/Grants & Event Lifecycle Overrides
-- 100% backward-compatible defaults: albums stay 'public', events stay 'auto' & open.

ALTER TABLE members ADD COLUMN can_view_all_media INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN can_access_media_portal INTEGER NOT NULL DEFAULT 0;

ALTER TABLE media_albums ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK(visibility IN ('public', 'members_only', 'attendees_only', 'private'));

CREATE TABLE IF NOT EXISTS member_album_grants (
  member_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  granted_by TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_id, album_id)
);

CREATE INDEX IF NOT EXISTS idx_member_album_grants_album
  ON member_album_grants(album_id, created_at DESC);

ALTER TABLE events ADD COLUMN rsvp_closed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN stage_override TEXT NOT NULL DEFAULT 'auto'
  CHECK(stage_override IN ('auto', 'invite', 'memory'));
