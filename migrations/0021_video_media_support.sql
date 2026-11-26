-- Migration 0021: Video media support for event albums, member contributions, and reflections.
-- Backwards-compatible: existing rows default to media_type = 'image'.

ALTER TABLE media_photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image';
