-- HolaRise Media Portal & Photo Albums Schema (Cloudflare D1 / SQLite)
-- 1. Safely widen admin_users.role CHECK constraint to include 'media' (Ban Hình Ảnh)
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS admin_users_next (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('super_admin', 'editor', 'media')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

INSERT INTO admin_users_next (id, email, name, role, password_hash, password_salt, is_active, created_at, last_login_at)
SELECT id, email, name, role, password_hash, password_salt, is_active, created_at, last_login_at
FROM admin_users;

DROP TABLE admin_users;
ALTER TABLE admin_users_next RENAME TO admin_users;

PRAGMA foreign_keys = ON;

-- 2. Photo Albums & Photos managed by Ban Hình Ảnh at /media
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

CREATE INDEX IF NOT EXISTS idx_media_albums_status_sort
  ON media_albums(status, sort_order ASC, event_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_photos_album_sort
  ON media_photos(album_id, sort_order ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_photos_featured
  ON media_photos(is_featured_home, sort_order ASC, created_at DESC);

-- 3. Seed baseline album & photos from existing static gallery so public pages are never empty
INSERT OR IGNORE INTO media_albums (
  id, slug, title, description, event_date, date_display, location,
  filters_json, drive_url, cover_url, status, sort_order, created_by, created_at, updated_at
) VALUES (
  'album-khoanh-khac-hoa-lac',
  'khoanh-khac-hoa-lac',
  'Khoảnh khắc Hòa Lạc — Hành trình 2026',
  'Tổng hợp những khung hình thực tế từ các buổi làm sạch môi trường, trồng cây, workshop tri ân và sẻ chia cùng thiếu nhi tại Hòa Lạc.',
  '2026-11-15',
  'Tháng 11/2026',
  'Hòa Lạc, Hà Nội',
  '["sach","biet-on","tu-te","se-chia"]',
  '',
  '/assets/images/events/activity-tree-planting.jpg',
  'published',
  0,
  'system-seed',
  '2026-11-23T00:00:00.000Z',
  '2026-11-23T00:00:00.000Z'
);

INSERT OR IGNORE INTO media_photos (
  id, album_id, media_key, url, caption, alt, photographer,
  is_featured_home, sort_order, uploaded_by, created_at, updated_at
) VALUES
  ('photo-seed-01', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-tree-planting.jpg', 'Ươm trồng 180 cây xanh bóng mát phủ xanh cung đường Hòa Lạc.', 'Cận cảnh ươm trồng mầm cây xanh bản địa phủ mát các cung đường Hòa Lạc', 'Ban Hình Ảnh HolaRise', 1, 1, 'system-seed', '2026-11-23T00:00:01.000Z', '2026-11-23T00:00:01.000Z'),
  ('photo-seed-02', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-lake-cleanup.jpg', 'Thu gom và phân loại rác nhựa tái chế ven hồ Tân Xã sáng Chủ Nhật.', 'Đôi tay đeo găng bảo hộ nhặt và phân loại rác thải nhựa ven hồ', 'Ban Hình Ảnh HolaRise', 1, 2, 'system-seed', '2026-11-23T00:00:02.000Z', '2026-11-23T00:00:02.000Z'),
  ('photo-seed-03', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-gratitude-workshop.jpg', 'Bàn làm thiệp hoa lá khô thủ công gửi lời tri ân cha mẹ và thầy cô.', 'Bàn làm thiệp hoa lá khô thủ công gửi lời tri ân cha mẹ và thầy cô', 'Ban Hình Ảnh HolaRise', 1, 3, 'system-seed', '2026-11-23T00:00:03.000Z', '2026-11-23T00:00:03.000Z'),
  ('photo-seed-04', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-book-donation.jpg', 'Trao tặng 152 cuốn sách thiếu nhi và quà học tập ý nghĩa.', 'Những chồng sách thiếu nhi chọn lọc chuẩn bị trao tặng các em nhỏ', 'Ban Hình Ảnh HolaRise', 1, 4, 'system-seed', '2026-11-23T00:00:04.000Z', '2026-11-23T00:00:04.000Z'),
  ('photo-seed-05', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-glass-upcycling.jpg', 'Biến chai lọ thủy tinh phế liệu thành chậu sen đá mầm xanh bàn học.', 'Lọ thủy tinh phế liệu tái chế thành chậu sen đá xanh mát góc bàn học', 'Ban Hình Ảnh HolaRise', 1, 5, 'system-seed', '2026-11-23T00:00:05.000Z', '2026-11-23T00:00:05.000Z'),
  ('photo-seed-06', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-tanxa-sunrise.jpg', 'Mặt nước hồ Tân Xã sương sớm – điểm hẹn làm sạch môi trường cuối tuần.', 'Mặt nước hồ Tân Xã sương sớm phản chiếu bóng cây xanh thanh bình', 'Ban Hình Ảnh HolaRise', 1, 6, 'system-seed', '2026-11-23T00:00:06.000Z', '2026-11-23T00:00:06.000Z'),
  ('photo-seed-07', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-workshop-journal.jpg', 'Sổ tay Tử Tế và những trang viết lưu giữ khát vọng tuổi trẻ.', 'Sổ tay Tử Tế và những trang viết lưu giữ khát vọng sống đẹp', 'Ban Hình Ảnh HolaRise', 0, 7, 'system-seed', '2026-11-23T00:00:07.000Z', '2026-11-23T00:00:07.000Z'),
  ('photo-seed-08', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-plastic-sorting.jpg', 'Tách riêng chai nhựa và vỏ lon chuyển giao cho điểm tái chế địa phương.', 'Phân loại chai nhựa và vỏ lon tái chế sau buổi dọn sạch cảnh quan', 'Ban Hình Ảnh HolaRise', 0, 8, 'system-seed', '2026-11-23T00:00:08.000Z', '2026-11-23T00:00:08.000Z'),
  ('photo-seed-09', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-tree-seedlings.jpg', 'Vườn ươm 300 bầu cây non chuẩn bị xuất vườn phủ xanh các tuyến đường.', 'Vườn ươm 300 bầu cây giống non xanh tươi sẵn sàng xuất vườn', 'Ban Hình Ảnh HolaRise', 0, 9, 'system-seed', '2026-11-23T00:00:09.000Z', '2026-11-23T00:00:09.000Z'),
  ('photo-seed-10', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-children-drawings.jpg', 'Những nét vẽ màu sáp hồn nhiên của các em nhỏ về một Hòa Lạc xanh ngát.', 'Bút màu và những bức tranh thiếu nhi vẽ bảo vệ môi trường', 'Ban Hình Ảnh HolaRise', 0, 10, 'system-seed', '2026-11-23T00:00:10.000Z', '2026-11-23T00:00:10.000Z'),
  ('photo-seed-11', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-nature-trail.jpg', 'Tuyến đường rợp bóng cây xanh mát dẫn lối người trẻ hành động vì cộng đồng.', 'Tuyến đường rợp bóng cây xanh mát dẫn lối tình nguyện viên', 'Ban Hình Ảnh HolaRise', 0, 11, 'system-seed', '2026-11-23T00:00:11.000Z', '2026-11-23T00:00:11.000Z'),
  ('photo-seed-12', 'album-khoanh-khac-hoa-lac', '', '/assets/images/events/activity-compost-nursery.jpg', 'Khay ươm mầm sinh thái phối trộn đất dinh dưỡng hữu cơ bảo vệ môi trường.', 'Khay ươm mầm sinh thái phối trộn đất dinh dưỡng hữu cơ', 'Ban Hình Ảnh HolaRise', 0, 12, 'system-seed', '2026-11-23T00:00:12.000Z', '2026-11-23T00:00:12.000Z');
