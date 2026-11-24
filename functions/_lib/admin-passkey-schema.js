/**
 * Self-healing schema guard for Admin/Media Passkeys and Verified Uploader Profile columns.
 * Keeps backward compatibility with existing D1 databases & test suites.
 */

export async function ensureAdminPasskeySchema(db) {
  const { results: cols } = await db.prepare("PRAGMA table_info(admin_users)").all();
  const names = new Set((cols || []).map((c) => c.name));
  if (!names.has("phone")) {
    await db.prepare("ALTER TABLE admin_users ADD COLUMN phone TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has("department")) {
    await db.prepare("ALTER TABLE admin_users ADD COLUMN department TEXT NOT NULL DEFAULT ''").run();
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_passkeys (
        credential_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        public_key_spki TEXT NOT NULL,
        algorithm INTEGER NOT NULL DEFAULT -7,
        sign_count INTEGER NOT NULL DEFAULT 0,
        device_label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_passkey_challenges (
        challenge TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL CHECK(kind IN ('register', 'login')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    )
    .run();
}

export async function getAdminUserProfile(db, userId) {
  await ensureAdminPasskeySchema(db);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.phone, u.department, u.role,
              (SELECT COUNT(*) FROM admin_passkeys p WHERE p.user_id = u.id) AS passkey_count
       FROM admin_users u
       WHERE u.id = ? AND u.is_active = 1`
    )
    .bind(userId)
    .first();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone || "",
    department: row.department || "",
    role: row.role,
    hasPasskey: Number(row.passkey_count || 0) > 0,
  };
}
