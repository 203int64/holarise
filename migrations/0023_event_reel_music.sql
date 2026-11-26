-- Migration 0023: Per-event custom soundtrack for Post-Event Memory Stage Reel
-- Supports built-in presets (preset:holaheart | preset:holagreen | preset:holaconnect | preset:silent)
-- or custom uploaded/hosted audio URLs (/api/media/drive/..., /api/media/..., https://...).

ALTER TABLE events ADD COLUMN reel_audio_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN reel_audio_title TEXT NOT NULL DEFAULT '';
