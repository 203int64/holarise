-- Migration 0022: Transactional Email Delivery Logs & Idempotency Tracking
-- Supports Dual-Mode sending (Cloudflare Email Sending binding + Resend REST API fallback).

CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL DEFAULT '',
  registration_id TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  template_type TEXT NOT NULL CHECK(template_type IN ('rsvp_confirm', 'event_reminder', 'event_thankyou', 'test_preview')),
  lang TEXT NOT NULL DEFAULT 'vi' CHECK(lang IN ('vi', 'en')),
  subject TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'skipped')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  sent_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_logs_event_type
  ON email_logs(event_id, template_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_dedup
  ON email_logs(event_id, registration_id, template_type, status);

CREATE INDEX IF NOT EXISTS idx_email_logs_recipient
  ON email_logs(recipient_email, created_at DESC);
