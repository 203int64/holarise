-- Migration 0025: Scoped Event/Media Member Capabilities & Two-Way Companion/BTC Chat Desk
-- 100% backward-compatible with admin_users (0001/0012), members (0006/0008), and member_album_grants (0020).

CREATE TABLE IF NOT EXISTS member_capabilities (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK(capability IN ('event.companion', 'event.checkin', 'album.view_private', 'media.portal')),
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK(scope_type IN ('global', 'event', 'album')),
  scope_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_accept' CHECK(status IN ('pending_accept', 'active', 'revoked', 'expired')),
  greeting TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL DEFAULT '',
  granted_by_name TEXT NOT NULL DEFAULT '',
  grant_message_id TEXT NOT NULL DEFAULT '',
  consent_accepted_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  revoked_by TEXT NOT NULL DEFAULT '',
  revoked_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_capabilities_member
  ON member_capabilities(member_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_capabilities_scope
  ON member_capabilities(capability, scope_type, scope_id, status);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'member_direct' CHECK(kind IN ('event_support', 'member_direct')),
  event_id TEXT NOT NULL DEFAULT '',
  event_title TEXT NOT NULL DEFAULT '',
  member_id TEXT NOT NULL DEFAULT '',
  guest_name TEXT NOT NULL DEFAULT '',
  guest_contact TEXT NOT NULL DEFAULT '',
  guest_contact_norm TEXT NOT NULL DEFAULT '',
  guest_token_hash TEXT NOT NULL DEFAULT '',
  assigned_member_id TEXT NOT NULL DEFAULT '',
  assigned_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'waiting_member', 'resolved')),
  unread_admin INTEGER NOT NULL DEFAULT 0,
  unread_member INTEGER NOT NULL DEFAULT 0,
  last_message_preview TEXT NOT NULL DEFAULT '',
  last_message_at TEXT NOT NULL,
  last_notified_member_at TEXT NOT NULL DEFAULT '',
  last_notified_admin_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_member
  ON chat_threads(member_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_event
  ON chat_threads(event_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_guest_token
  ON chat_threads(guest_token_hash);

CREATE INDEX IF NOT EXISTS idx_chat_threads_updated
  ON chat_threads(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('guest', 'member', 'companion', 'admin', 'system')),
  sender_id TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  msg_kind TEXT NOT NULL DEFAULT 'text' CHECK(msg_kind IN ('text', 'capability_card', 'context_card')),
  body TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON chat_messages(thread_id, created_at ASC);
