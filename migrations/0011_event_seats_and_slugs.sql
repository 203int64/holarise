-- HolaRise Migration 0011:
-- 1. Add configurable seat bar fields to events (total capacity, external/offline bookings, toggle)
-- 2. Shorten verbose /hanh-trinh/ slugs cleanly (paired with 301 redirects in functions/_middleware.js)
-- 3. Remove "Vé 0đ" and hardcoded "35 chỗ ngồi vòng tròn" wording from active events

ALTER TABLE events ADD COLUMN seat_capacity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN external_booked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN show_seat_bar INTEGER NOT NULL DEFAULT 0;

UPDATE events
SET
  fee = 'Miễn phí tham dự · Tự túc đồ uống tại quán',
  seats = '',
  updated_at = '2026-11-25T00:00:00.000Z'
WHERE id = 'holaheart-cuoc-doi-cua-cha-2026-11-29';

UPDATE events
SET
  fee = 'Miễn phí tham dự · Tự chuẩn bị nước uống cá nhân',
  seats = '',
  updated_at = '2026-11-25T00:00:00.000Z'
WHERE id = 'holaconnect-leo-nui-lam-nghiep-2026-11-26';

UPDATE posts
SET
  slug = 'tinh-yeu-thuong-cua-me',
  updated_at = '2026-11-25T00:00:00.000Z'
WHERE slug = 'tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart';

UPDATE posts
SET
  slug = 'holaheart-musicspace',
  updated_at = '2026-11-25T00:00:00.000Z'
WHERE slug = 'chuoi-am-nhac-ket-noi-holaheart-musicspace';

UPDATE activity_reflections
SET
  activity_slug = 'tinh-yeu-thuong-cua-me',
  updated_at = '2026-11-25T00:00:00.000Z'
WHERE activity_slug = 'tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart';

UPDATE activity_reflections
SET
  activity_slug = 'holaheart-musicspace',
  updated_at = '2026-11-25T00:00:00.000Z'
WHERE activity_slug = 'chuoi-am-nhac-ket-noi-holaheart-musicspace';
