-- Migration 0027: HolaRise Manager Pro — 1-Click Staff Invites (48h + Safeguarding Consent),
-- Editorial Review Feedback Loop ('changes_requested' + review_note), Pillar Scope & Event In-Kind Resource Ledger.
PRAGMA defer_foreign_keys = ON;

-- 1. Staff Invitations (Zero-friction onboarding: no manual temporary passwords over Zalo)
CREATE TABLE IF NOT EXISTS staff_invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'content_ctv' CHECK(role IN (
    'event_ops',
    'content_editor',
    'content_ctv',
    'media_manager',
    'media_ctv',
    'media'
  )),
  department TEXT NOT NULL DEFAULT 'Ban Sự Kiện',
  pillar_scope TEXT NOT NULL DEFAULT 'all' CHECK(pillar_scope IN ('all', 'holaheart', 'holagreen', 'holaconnect')),
  token_hash TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by TEXT NOT NULL DEFAULT '',
  invited_by_name TEXT NOT NULL DEFAULT '',
  accepted_user_id TEXT NOT NULL DEFAULT '',
  consent_accepted_at TEXT NOT NULL DEFAULT '',
  accepted_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_invites_email ON staff_invites(email, status);
CREATE INDEX IF NOT EXISTS idx_staff_invites_status ON staff_invites(status, created_at DESC);

-- 2. Add pillar_scope to admin_users (all | holaheart | holagreen | holaconnect)
ALTER TABLE admin_users ADD COLUMN pillar_scope TEXT NOT NULL DEFAULT 'all';

-- 3. Rebuild posts cleanly to widen status CHECK to include 'changes_requested' + review_note & submitted_by_id
CREATE TABLE posts_v3 (
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
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft', 'pending_review', 'changes_requested')),
  submitted_by TEXT NOT NULL DEFAULT '',
  submitted_by_id TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO posts_v3 (
  id, slug, title, category, category_slug, filters_json, date, date_display,
  read_time, author, image, image_alt, excerpt, content_json, status,
  submitted_by, submitted_by_id, reviewed_by, reviewed_at, review_note, created_at, updated_at
)
SELECT
  id, slug, title, category, category_slug, filters_json, date, date_display,
  read_time, author, image, image_alt, excerpt, content_json, status,
  submitted_by, '', reviewed_by, reviewed_at, '', created_at, updated_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_v3 RENAME TO posts;

CREATE INDEX IF NOT EXISTS idx_posts_status_date ON posts(status, date DESC);

-- 4. Event In-Kind Resources & Transparency Ledger (AGENTS.md Layer 3: In-Kind First & Open Traceability)
CREATE TABLE IF NOT EXISTS event_resources (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'space' CHECK(kind IN ('space', 'books', 'plants', 'supplies', 'logistics', 'other')),
  title TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '',
  donor_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pledged' CHECK(status IN ('pledged', 'received', 'delivered')),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_resources_event ON event_resources(event_id, created_at DESC);
