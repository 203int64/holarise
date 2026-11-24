-- HolaRise v8 Migration 0006:
-- 1. Clean seeded AI media album/photos in D1 so Edge SSR never overwrites real exhibition photos (BP-02, BP-03)
-- 2. Extend events (title_en, summary_en) and registrations (member_id)
-- 3. Create isolated Member Auth (members, member_sessions) & Editorial Guestbook (activity_reflections, reflection_hearts)

-- Ensure media tables exist even on environments that skipped 0003
CREATE TABLE IF NOT EXISTS media_albums (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  date_display TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT 'Hòa Lạc, Hà Nội',
  filters_json TEXT NOT NULL DEFAULT '[]',
  drive_url TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_photos (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  media_key TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  alt TEXT NOT NULL DEFAULT '',
  photographer TEXT NOT NULL DEFAULT '',
  is_featured_home INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (album_id) REFERENCES media_albums(id) ON DELETE CASCADE
);

-- Unpublish seeded placeholder AI album & strip single-girl photo from D1
UPDATE media_albums
SET status = 'draft', updated_at = '2026-11-24T00:00:00.000Z'
WHERE id = 'album-khoanh-khac-hoa-lac';

UPDATE media_photos
SET is_featured_home = 0, updated_at = '2026-11-24T00:00:00.000Z'
WHERE id LIKE 'photo-seed-%' OR url LIKE '%14-669789766%';

DELETE FROM media_photos
WHERE url LIKE '%14-669789766%';

-- Clean legacy /hoat-dong/ link and defensive "thật" wording in D1 posts, and seed MusicSpace series post for Guestbook
UPDATE posts
SET
  content_json = '["Ngày 15/11/2026, HolaHeart tổ chức buổi đối thoại đầu tiên với chủ đề **Tình yêu thương của Mẹ trong thời đại AI** tại Mây Lang Thang Cafe, Hòa Lạc (14:00–16:50).","Buổi gặp gỡ mở ra không gian lắng nghe gần gũi, nơi người trẻ cùng nhìn lại sự kết nối với gia đình giữa nhịp sống công nghệ hối hả.","Xem thông tin sự kiện trên [MusicSpace](https://musicspace.edu.vn/love/event/tinh-yeu-thuong-cua-me-thoi-dai-ai).","Xem [bộ ảnh kỷ niệm của chương trình tại Hành trình](/hanh-trinh/#thu-vien-anh)."]',
  updated_at = '2026-11-24T00:00:00.000Z'
WHERE id = 'post-holaheart-first-event-2026';

INSERT INTO posts (
  id, slug, title, category, category_slug, filters_json, date, date_display,
  read_time, author, image, image_alt, excerpt, content_json, status,
  created_at, updated_at
) VALUES (
  'post-holaheart-musicspace-series',
  'chuoi-am-nhac-ket-noi-holaheart-musicspace',
  'Chuỗi Đêm Nhạc Mộc & Đối Thoại: HolaHeart × MusicSpace tại Hòa Lạc',
  'HolaHeart · Nội lực & Lắng nghe',
  'workshop',
  '["holaheart", "biet-on", "tu-te"]',
  '2026-10-20',
  '2025 – 2026',
  '3 phút đọc',
  'Ban Điều Phối HolaRise',
  '/assets/images/musicspace-archive/15-671661990_1333975782086922_4394124200415584759_n.jpg',
  'Vòng tròn chia sẻ và âm nhạc ngoài trời của người trẻ tại Hòa Lạc.',
  'Những buổi tối ngồi lại bên ánh đèn ấm, tiếng đàn mộc và những cuộc trò chuyện chân thành giữa người trẻ Hòa Lạc.',
  '["Khởi nguồn từ những buổi tối cuối tuần tại Hòa Lạc, chuỗi đêm nhạc mộc và đối thoại **HolaHeart × MusicSpace** mở ra khoảng lặng ấm áp để sinh viên và người trẻ tạm gác nhịp học tập hối hả.","Không sân khấu cách biệt, mỗi đêm nhạc là một vòng tròn mở: cùng hát mộc, lắng nghe những câu chuyện trưởng thành và tìm thấy những người bạn đồng hành cùng tần số sống tử tế.","Mời bạn lưu lại đôi dòng cảm nhận hoặc kỷ niệm của riêng mình ở phần Lưu bút bên dưới."]',
  'published',
  '2026-11-24T00:00:00.000Z',
  '2026-11-24T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  title = excluded.title,
  category = excluded.category,
  filters_json = excluded.filters_json,
  image = excluded.image,
  image_alt = excluded.image_alt,
  excerpt = excluded.excerpt,
  content_json = excluded.content_json,
  status = excluded.status,
  updated_at = excluded.updated_at;

-- Extend events with bilingual fields & clean wrong FPT concrete campus photo on Núi Luốt trek
ALTER TABLE events ADD COLUMN title_en TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN summary_en TEXT NOT NULL DEFAULT '';

UPDATE events
SET
  title_en = 'Workshop "My Father''s Life"',
  summary_en = 'Some love is never spoken aloud. Spend a quiet Sunday evening in Hoa Lac listening, reflecting, and honoring our fathers'' silent devotion.',
  location = 'Quán Cafe Mây Lang Thang, Hòa Lạc',
  updated_at = '2026-11-24T00:00:00.000Z'
WHERE id = 'holaheart-cuoc-doi-cua-cha-2026-11-29';

UPDATE events
SET
  image = '/assets/images/illustrations/holagreen/G03.jpg',
  image_alt = 'Hoạt động dã ngoại và gắn kết thiên nhiên của người trẻ HolaRise.',
  location = 'Núi Luốt – ĐH Lâm Nghiệp (Xuân Mai)',
  title_en = 'HolaConnect · Pine Hill Trek & Afternoon Circle',
  summary_en = 'Step away from screens for a refreshing afternoon trek up Nui Luot pine hill and an open connection circle with fellow youth.',
  updated_at = '2026-11-24T00:00:00.000Z'
WHERE id = 'holaconnect-leo-nui-lam-nghiep-2026-11-26';

UPDATE events
SET
  title_en = 'A Mother''s Love in the Age of AI',
  summary_en = 'HolaHeart''s inaugural dialogue on family gratitude and human warmth in Hoa Lac.',
  updated_at = '2026-11-24T00:00:00.000Z'
WHERE id = 'holaheart-first-event-2026';

-- Link registrations to Member accounts for 1-tap RSVP & booking history
ALTER TABLE registrations ADD COLUMN member_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_registrations_member
  ON registrations(member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registrations_member_event
  ON registrations(member_id, event_id);

-- Isolated Community Member Accounts (strictly separated from admin_users)
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  member_code TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  phone_norm TEXT UNIQUE,
  phone_display TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  pillar_choice TEXT NOT NULL DEFAULT 'holaheart' CHECK(pillar_choice IN ('holaheart', 'holagreen', 'holaconnect')),
  avatar_url TEXT NOT NULL DEFAULT '',
  avatar_media_key TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_members_created
  ON members(created_at DESC);

CREATE TABLE IF NOT EXISTS member_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_sessions_member
  ON member_sessions(member_id, expires_at);

-- Moderated Editorial Guestbook Reflections & Heart Reactions
CREATE TABLE IF NOT EXISTS activity_reflections (
  id TEXT PRIMARY KEY,
  activity_slug TEXT NOT NULL,
  member_id TEXT NOT NULL,
  participant_role TEXT NOT NULL DEFAULT 'member' CHECK(participant_role IN ('member', 'volunteer', 'speaker')),
  pull_quote TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  photo_url TEXT NOT NULL DEFAULT '',
  photo_media_key TEXT NOT NULL DEFAULT '',
  heart_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(activity_slug, member_id),
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reflections_slug_status
  ON activity_reflections(activity_slug, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflections_status_created
  ON activity_reflections(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflections_member
  ON activity_reflections(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reflection_hearts (
  reflection_id TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (reflection_id, actor_key),
  FOREIGN KEY (reflection_id) REFERENCES activity_reflections(id) ON DELETE CASCADE
);


-- 7. Seed 2nd upcoming schedule into D1 so both schedules appear live and can be edited in /admin/
INSERT OR IGNORE INTO events (
  id, kind, type, filters_json, date, date_display, time, location, fee, seats,
  title, title_en, summary, summary_en, highlights_json, participants,
  image, image_alt, status, sort_order, created_at, updated_at
) VALUES (
  'holaconnect-leo-nui-lam-nghiep-2026-11-26',
  'upcoming',
  'HolaConnect · Gắn kết & Thể chất',
  '["holaconnect","tu-te","se-chia"]',
  '2026-11-26',
  'Thứ Năm, 26/11/2026',
  '14:30 – 17:30',
  'Núi Luốt – ĐH Lâm Nghiệp (Xuân Mai)',
  'Miễn phí',
  'Mở đăng ký · 25 chỗ',
  'HolaConnect · Chiều Leo Núi & Kết Nối Giữa Rừng Thông',
  'HolaConnect · Pine Hill Trek & Afternoon Circle',
  'Tạm rời màn hình máy tính để cùng bạn bè người trẻ Hòa Lạc trekking cung đồi rừng thông Núi Luốt, hít thở không khí chiều thu và trò chuyện kết nối.',
  'Step away from screens for a refreshing afternoon trek up Nui Luot pine hill and an open connection circle with fellow youth.',
  '["Trekking nhẹ nhàng rừng thông Núi Luốt","Vòng tròn làm quen & sẻ chia trên đồi","Rèn luyện sức bền & gắn kết bạn đồng hành"]',
  '',
  '/assets/images/illustrations/holagreen/G03.jpg',
  'Ảnh định hướng hoạt động dã ngoại và gắn kết thiên nhiên của người trẻ HolaRise.',
  'published',
  2,
  '2026-11-24T00:00:00.000Z',
  '2026-11-24T00:00:00.000Z'
);
