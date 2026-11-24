-- HolaHeart Special Workshop: replace placeholder Sunday 29/11 event with "Cuộc Đời Của Cha"
-- Idempotent content-only updates for the existing D1 events table. Zero schema changes.

UPDATE events
SET status = 'draft', updated_at = '2026-11-24T00:00:00.000Z'
WHERE id = 'holaheart-ws-nguoi-tre-cung-ngoi-lai-2026-11-29'
  AND status = 'published';

UPDATE events
SET sort_order = 1, updated_at = '2026-11-24T00:00:00.000Z'
WHERE id = 'holaconnect-leo-nui-lam-nghiep-2026-11-26';

INSERT INTO events (
  id, kind, type, filters_json, date, date_display, time, location, fee, seats,
  title, summary, highlights_json, participants, image, image_alt, status,
  sort_order, created_at, updated_at
) VALUES (
  'holaheart-cuoc-doi-cua-cha-2026-11-29',
  'upcoming',
  'HolaHeart · Lắng nghe – Tri ân – Yêu thương',
  '["holaheart", "biet-on", "tu-te"]',
  '2026-11-29',
  'Chủ Nhật, 29/11/2026',
  '19:15',
  'Quán Cafe Mây Lang Thang, Hòa Lạc',
  'Miễn phí tham dự · Tự túc đồ uống',
  'Mở đăng ký · 35 chỗ ấm cúng',
  'Workshop "Cuộc Đời Của Cha"',
  'Có những tình yêu chẳng bao giờ nói thành lời. Dành một buổi tối Chủ Nhật đặc biệt để lắng nghe, cảm nhận và nhìn lại bóng lưng âm thầm của Cha.',
  '["Lắng nghe những hy sinh chẳng nói thành lời", "Nhìn lại bóng lưng & hành trình của Cha", "Viết tiếp lời yêu thương khi còn kịp lúc"]',
  '',
  '/assets/images/events/cuoc-doi-cua-cha-poster.jpg',
  'Poster Workshop Cuộc Đời Của Cha — hình ảnh người cha khoác vai con ngồi ngắm hoàng hôn ấm áp bên mặt hồ yên bình.',
  'published',
  0,
  '2026-11-24T00:00:00.000Z',
  '2026-11-24T00:00:00.000Z'
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
