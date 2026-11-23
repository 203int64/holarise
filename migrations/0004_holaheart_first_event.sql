-- HolaHeart: publish the first verified event and recap; hide seeded placeholder records.
-- Idempotent content-only updates for the existing events/posts tables. No schema changes.
-- The 8-photo event album is served from the static gallery in data/activities.json because
-- the current production D1 database does not have the media_albums/media_photos tables.

UPDATE posts
SET status = 'draft', updated_at = '2026-11-23T00:00:00.000Z'
WHERE id IN (
  'post-du-an-mam-cay-thanh-nien-180-cay-xanh-hoa-lac',
  'post-chien-dich-lam-sach-ven-ho-tan-xa-mua-thu-2026',
  'post-workshop-tai-che-thuy-tinh-song-giam-nhua-hoa-lac',
  'post-workshop-gieo-mam-tu-te-lan-toa-loi-song-tich-cuc',
  'post-chuoi-workshop-lang-nghe-va-ket-noi-ban-dong-hanh',
  'post-nhip-cau-yeu-thuong-trao-tu-sach-thach-that',
  'post-cam-nang-di-cuoi-tuan-xanh-lan-dau-cho-sinh-vien',
  'post-ngay-hoi-sach-va-tuoi-tho-nha-van-hoa-thach-that',
  'post-hanh-trinh-uom-mam-xanh-tu-vuon-cay-giong-hoa-lac'
)
AND status = 'published';

UPDATE events
SET status = 'draft', updated_at = '2026-11-23T00:00:00.000Z'
WHERE id IN (
  'ws-long-biet-on-va-song-xanh',
  'cleanup-ho-tan-xa-thang-12',
  'ws-truyen-cam-hung-va-ket-noi',
  'ws-tai-che-sen-da-thang-12',
  'chien-dich-trong-cay-cuoi-nam',
  'past-topic-1', 'past-topic-2', 'past-topic-3', 'past-topic-4', 'past-topic-5'
)
AND status = 'published';

INSERT INTO events (
  id, kind, type, filters_json, date, date_display, time, location, fee, seats,
  title, summary, highlights_json, participants, image, image_alt, status,
  sort_order, created_at, updated_at
) VALUES (
  'holaheart-first-event-2026', 'past', 'HolaHeart · Tình yêu thương & Biết ơn',
  '["biet-on", "tu-te"]', '2026-11-15', '15/11/2026', '14:00–16:50',
  'Mây Lang Thang Cafe, Hòa Lạc', 'Đã tổ chức', '',
  'Tình yêu thương của Mẹ trong thời đại AI',
  'Sự kiện đầu tiên của HolaHeart, diễn ra ngày 15/11/2026 tại Mây Lang Thang Cafe, Hòa Lạc.',
  '[]', '', '/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg',
  'Diễn giả đang chia sẻ với người tham dự tại sự kiện HolaHeart ở Hòa Lạc.',
  'published', 0, '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  type = excluded.type,
  filters_json = excluded.filters_json,
  date = excluded.date,
  date_display = excluded.date_display,
  time = excluded.time,
  location = excluded.location,
  fee = excluded.fee,
  seats = excluded.seats,
  title = excluded.title,
  summary = excluded.summary,
  highlights_json = excluded.highlights_json,
  participants = excluded.participants,
  image = excluded.image,
  image_alt = excluded.image_alt,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = excluded.updated_at;

INSERT INTO posts (
  id, slug, title, category, category_slug, filters_json, date, date_display,
  read_time, author, image, image_alt, excerpt, content_json, status,
  created_at, updated_at
) VALUES (
  'post-holaheart-first-event-2026',
  'tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart',
  'Tình yêu thương của Mẹ trong thời đại AI: Sự kiện đầu tiên của HolaHeart',
  'HolaHeart · Biết ơn & Tử tế', 'workshop', '["biet-on", "tu-te"]',
  '2026-11-15', '15/11/2026', '2 phút đọc', 'Ban Điều Phối HolaRise',
  '/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg',
  'Diễn giả cầm micro chia sẻ với người tham dự tại sự kiện HolaHeart.',
  'Ngày 15/11/2026, HolaHeart tổ chức buổi gặp gỡ đầu tiên tại Mây Lang Thang Cafe, Hòa Lạc, với chủ đề Tình yêu thương của Mẹ trong thời đại AI.',
  '["Ngày 15/11/2026, HolaHeart tổ chức sự kiện đầu tiên với chủ đề **Tình yêu thương của Mẹ trong thời đại AI** tại Mây Lang Thang Cafe, Hòa Lạc. Thời gian: 14:00–16:50.","Buổi gặp gỡ mở ra không gian lắng nghe và trao đổi về tình yêu thương của Mẹ trong bối cảnh AI. Những bức ảnh ghi lại phần chia sẻ, không khí trò chuyện và một khoảnh khắc tương tác trong chương trình.","Xem thông tin sự kiện trên [MusicSpace](https://musicspace.edu.vn/love/event/tinh-yeu-thuong-cua-me-thoi-dai-ai).","Xem [album 8 ảnh thật của sự kiện trên HolaRise](/hoat-dong/#thu-vien-anh)."]',
  'published', '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  title = excluded.title,
  category = excluded.category,
  category_slug = excluded.category_slug,
  filters_json = excluded.filters_json,
  date = excluded.date,
  date_display = excluded.date_display,
  read_time = excluded.read_time,
  author = excluded.author,
  image = excluded.image,
  image_alt = excluded.image_alt,
  excerpt = excluded.excerpt,
  content_json = excluded.content_json,
  status = excluded.status,
  updated_at = excluded.updated_at;
