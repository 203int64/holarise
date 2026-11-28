-- Migration 0026: HolaRise Manager — Multi-Role RBAC, Editorial Maker-Checker, Ops Tasks/Timeline & Audit Logs
-- Backward-compatible with legacy roles ('editor' -> content_editor, 'media' -> media_ctv).
PRAGMA defer_foreign_keys = ON;

-- 1. Safely rebuild admin_users to widen role CHECK while preserving sessions & admin_passkeys
CREATE TABLE _backup_sessions_0026 AS SELECT * FROM sessions;
CREATE TABLE _backup_admin_passkeys_0026 AS SELECT * FROM admin_passkeys;

CREATE TABLE admin_users_v3 (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'content_ctv' CHECK(role IN (
    'super_admin',
    'event_ops',
    'content_editor',
    'content_ctv',
    'media_manager',
    'media_ctv',
    'editor',
    'media'
  )),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  phone TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT ''
);

INSERT INTO admin_users_v3 (
  id, email, name, role, password_hash, password_salt,
  is_active, created_at, last_login_at, phone, department
)
SELECT
  id, email, name, role, password_hash, password_salt,
  is_active, created_at, last_login_at, phone, department
FROM admin_users;

DROP TABLE admin_users;
ALTER TABLE admin_users_v3 RENAME TO admin_users;

INSERT OR IGNORE INTO sessions SELECT * FROM _backup_sessions_0026;
INSERT OR IGNORE INTO admin_passkeys SELECT * FROM _backup_admin_passkeys_0026;
DROP TABLE _backup_sessions_0026;
DROP TABLE _backup_admin_passkeys_0026;

-- 2. Rebuild posts table to support 'pending_review' Maker-Checker status & review metadata
CREATE TABLE posts_v2 (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT 'cong-dong',
  filters_json TEXT NOT NULL DEFAULT '[]',
  date TEXT NOT NULL,
  date_display TEXT NOT NULL,
  read_time TEXT NOT NULL DEFAULT '2 phút đọc',
  author TEXT NOT NULL DEFAULT 'Ban Điều Phối HolaRise',
  image TEXT NOT NULL,
  image_alt TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft', 'pending_review')),
  submitted_by TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO posts_v2 (
  id, slug, title, category, category_slug, filters_json, date, date_display,
  read_time, author, image, image_alt, excerpt, content_json, status,
  submitted_by, reviewed_by, reviewed_at, created_at, updated_at
)
SELECT
  id, slug, title, category, category_slug, filters_json, date, date_display,
  read_time, author, image, image_alt, excerpt, content_json, status,
  '', '', '', created_at, updated_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_v2 RENAME TO posts;

CREATE INDEX IF NOT EXISTS idx_posts_status_date ON posts(status, date DESC);

-- 3. Ops Tasks & Event Timeline Playbooks (attached to real events, departments & staff/CTV assignees)
CREATE TABLE IF NOT EXISTS ops_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_id TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'before' CHECK(phase IN ('before', 'during', 'after', 'general')),
  department TEXT NOT NULL DEFAULT 'Ban Sự Kiện',
  assignee_type TEXT NOT NULL DEFAULT 'unassigned' CHECK(assignee_type IN ('unassigned', 'staff', 'member')),
  assignee_id TEXT NOT NULL DEFAULT '',
  assignee_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'review', 'done')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
  due_at TEXT NOT NULL DEFAULT '',
  zalo_url TEXT NOT NULL DEFAULT '',
  playbook_key TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_tasks_event ON ops_tasks(event_id, phase, status);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_assignee ON ops_tasks(assignee_type, assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_due ON ops_tasks(due_at, status);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_dept ON ops_tasks(department, status);

-- 4. Administrative Audit Logs (accountability for multi-role operations)
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON admin_audit_logs(action, created_at DESC);
