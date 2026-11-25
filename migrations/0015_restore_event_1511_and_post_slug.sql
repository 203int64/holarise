-- Migration 0015: Restore canonical slug for 15/11 post so
-- /hanh-trinh/tinh-yeu-thuong-cua-me/ resolves 200 OK, and restore
-- the 15/11 past event row in events so all 3 events exist in D1.

UPDATE posts
SET slug = 'tinh-yeu-thuong-cua-me',
    updated_at = '2026-11-25T02:52:00.000Z'
WHERE id = 'post-holaheart-first-event-2026'
  AND slug = 'tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart';

INSERT OR IGNORE INTO events (
  id, pillar, kind, category, filters_json, date, date_display, time_display,
  location, title, summary, highlights_json, spots_text, image, image_alt,
  registration_enabled, status, sort_order, created_at, updated_at
) VALUES (
  'holaheart-tinh-yeu-thuong-cua-me-2026-11-15',
  'holaheart',
  'past',
  'HolaHeart · 15/11/2026',
  '["holaheart"]',
  '2026-11-15',
  'Chủ Nhật, 15/11/2026',
  '14:00–16:50',
  'Mây Lang Thang Cafe, Hòa Lạc',
  'HolaHeart: Tình yêu thương của Mẹ trong thời đại AI',
  'Buổi gặp gỡ và lắng nghe đầu tiên của HolaHeart tại Hòa Lạc về tình yêu thương gia đình trong thời đại công nghệ.',
  '["Vòng tròn lắng nghe đồng đẳng","Đối thoại gia đình & lòng biết ơn","Lưu giữ khoảnh khắc tại Mây Lang Thang Cafe"]',
  'Đã diễn ra',
  '/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg',
  'Người dẫn chuyện chia sẻ cùng các bạn trẻ tại Mây Lang Thang Cafe, Hòa Lạc.',
  0,
  'published',
  10,
  '2026-11-15T07:00:00.000Z',
  '2026-11-25T02:52:00.000Z'
);
