-- Migration 0007: WebAuthn Passkeys (Face ID / Touch ID / Windows Hello) for Members
CREATE TABLE IF NOT EXISTS member_passkeys (
  credential_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  public_key_spki TEXT NOT NULL,
  algorithm INTEGER NOT NULL DEFAULT -7,
  sign_count INTEGER NOT NULL DEFAULT 0,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_passkeys_member
  ON member_passkeys (member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  challenge TEXT PRIMARY KEY,
  member_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('register', 'login')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires
  ON passkey_challenges (expires_at);
