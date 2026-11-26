-- Migration 0018: Optional per-event Zalo group link for /su-kien/<slug>/ & /en/events/<slug>/
-- Safe, backward-compatible column addition with empty-string fallback to default community group.

ALTER TABLE events ADD COLUMN zalo_group_url TEXT NOT NULL DEFAULT '';
