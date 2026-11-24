-- Migration 0010: Admin/Media Passkeys (Face ID / Touch ID) & Verified Uploader Profile
ALTER TABLE admin_users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_users ADD COLUMN department TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS admin_passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key_spki TEXT NOT NULL,
  algorithm INTEGER NOT NULL DEFAULT -7,
  sign_count INTEGER NOT NULL DEFAULT 0,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_passkeys_user
  ON admin_passkeys (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_passkey_challenges (
  challenge TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('register', 'login')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_passkey_challenges_expires
  ON admin_passkey_challenges (expires_at);
