-- Migration 0014: Seed the 8 real photographs of HolaHeart 15/11/2026
-- into media_photos under alb-holaheart-2026-11-15 so they are immediately
-- viewable and manageable inside /media/ and served from D1 on /hanh-trinh/.

INSERT OR IGNORE INTO media_photos (
  id, album_id, media_key, url, caption, alt, photographer,
  is_featured_home, sort_order, uploaded_by, created_at, updated_at
) VALUES
  (
    'pho-1511-01', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/05-listening-moment.jpg',
    'Đối thoại HolaHeart · 15/11/2026',
    'Những người trẻ chăm chú lắng nghe trong buổi đối thoại HolaHeart ngày 15/11/2026.',
    'Ban Hình Ảnh HolaRise', 1, 1, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  ),
  (
    'pho-1511-02', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg',
    'Chia sẻ giữa vòng tròn · 15/11/2026',
    'Người dẫn chuyện chia sẻ cùng các bạn trẻ tại Mây Lang Thang Cafe, Hòa Lạc.',
    'Ban Hình Ảnh HolaRise', 1, 2, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  ),
  (
    'pho-1511-03', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/02-conversation.jpg',
    'Trò chuyện ngoài trời · 15/11/2026',
    'Các bạn trẻ trò chuyện cởi mở giữa không gian xanh tại Hòa Lạc.',
    'Ban Hình Ảnh HolaRise', 1, 3, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  ),
  (
    'pho-1511-04', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/04-wide-venue.jpg',
    'Không gian gặp gỡ · Mây Lang Thang',
    'Toàn cảnh không gian ấm áp tại Mây Lang Thang Cafe, Hòa Lạc.',
    'Ban Hình Ảnh HolaRise', 1, 4, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  ),
  (
    'pho-1511-05', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/06-app-activity.jpg',
    'Ghi lại điều muốn nói · 15/11/2026',
    'Người tham dự ghi lại những suy ngẫm cá nhân trong chương trình.',
    'Ban Hình Ảnh HolaRise', 0, 5, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  ),
  (
    'pho-1511-06', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/03-group-women.jpg',
    'Nụ cười sau buổi đối thoại',
    'Nụ cười của các bạn nữ tham dự sau buổi đối thoại HolaHeart.',
    'Ban Hình Ảnh HolaRise', 0, 6, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  ),
  (
    'pho-1511-07', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/01-group-men.jpg',
    'Khoảnh khắc cuối buổi · 15/11/2026',
    'Nhóm bạn trẻ lưu lại khoảnh khắc cuối chương trình HolaHeart.',
    'Ban Hình Ảnh HolaRise', 0, 7, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  ),
  (
    'pho-1511-08', 'alb-holaheart-2026-11-15', '',
    '/assets/images/events/holaheart-2026-11-15/08-pair-at-event.jpg',
    'Kết nối cuối buổi · 15/11/2026',
    'Hai thành viên lưu lại khoảnh khắc kết nối tại sự kiện HolaHeart.',
    'Ban Hình Ảnh HolaRise', 0, 8, 'system',
    '2026-11-25T02:45:00.000Z', '2026-11-25T02:45:00.000Z'
  );
