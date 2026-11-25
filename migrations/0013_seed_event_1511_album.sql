-- Migration 0013: Provision media album folder for HolaHeart 15/11/2026 event
-- so members/media team can immediately upload photos via /media/.
-- Google Drive subfolder is auto-provisioned on first /api/admin/albums listing or upload.

INSERT OR IGNORE INTO media_albums (
  id,
  slug,
  title,
  description,
  event_date,
  date_display,
  location,
  filters_json,
  drive_url,
  cover_url,
  status,
  sort_order,
  created_by,
  created_at,
  updated_at
) VALUES (
  'alb-holaheart-2026-11-15',
  'holaheart-tinh-yeu-thuong-cua-me-2026-11-15',
  'HolaHeart: Tình yêu thương của Mẹ trong thời đại AI',
  'Kho lưu ảnh gốc và khoảnh khắc từ buổi đối thoại HolaHeart ngày 15/11/2026 tại Mây Lang Thang Cafe, Hòa Lạc.',
  '2026-11-15',
  '15/11/2026',
  'Mây Lang Thang Cafe, Hòa Lạc',
  '["holaheart"]',
  '',
  '/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg',
  'published',
  1,
  'system',
  '2026-11-25T02:37:00.000Z',
  '2026-11-25T02:37:00.000Z'
);
