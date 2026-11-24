-- Migration 0009: Sync refined elevated editorial copy (AGENTS.md Tầng 2) into D1 posts & events
UPDATE posts
SET
  excerpt = 'Chiều 15/11/2026 tại Mây Lang Thang Cafe, những màn hình sáng rực lần lượt được đặt úp xuống mặt bàn gỗ để người trẻ ngồi lại nói về đôi bàn tay tảo tần của Mẹ.',
  content_json = '["Chiều ngày 15/11/2026 (14:00–16:50), trong không gian thoáng sáng tại Mây Lang Thang Cafe (ngõ 2 đường vào TTGDQP, Hòa Lạc), **HolaHeart** tổ chức buổi đối thoại khởi đầu với chủ đề **Tình yêu thương của Mẹ trong thời đại AI**.","Những chiếc điện thoại sáng rực lần lượt được đặt úp xuống mặt bàn gỗ suốt gần ba giờ đồng hồ. Trong kỷ nguyên mà mọi câu hỏi đều có thể nhận lời giải từ trí tuệ nhân tạo trong tích tắc, các bạn trẻ đã chọn ngồi đối diện nhau để chạm vào một mạch nguồn không thuật toán nào thay thế được: đôi bàn tay tảo tần và sự bao dung thầm lặng của Mẹ.","Không sân khấu cách biệt giữa người nói và người nghe, mỗi câu chuyện mộc mạc về bữa cơm quê hay cuộc gọi hỏi thăm cuối ngày đã giúp cả vòng tròn lắng lại, nhẹ nhõm và gần gia đình mình hơn.","Xem thông tin sự kiện trên [MusicSpace](https://musicspace.edu.vn/love/event/tinh-yeu-thuong-cua-me-thoi-dai-ai).","Xem [bộ ảnh kỷ niệm của chương trình tại Hành trình](/hanh-trinh/#thu-vien-anh)."]',
  updated_at = '2026-11-24T18:30:00.000Z'
WHERE id = 'post-holaheart-first-event-2026';

UPDATE posts
SET
  title = 'Chuỗi Đêm Nhạc Mộc & Đối Thoại: HolaHeart × MusicSpace',
  excerpt = 'Những buổi tối ngồi lại bên ánh đèn vàng ấm, tiếng đàn gỗ mộc và những cuộc trò chuyện chân thành khởi nguồn nên hành trình HolaRise.',
  content_json = '["Khởi nguồn từ những buổi tối cuối tuần yên ả tại Hòa Lạc, chuỗi đêm nhạc mộc và đối thoại **HolaHeart × MusicSpace** mở ra một khoảng trời dịu lại sau những tuần học tập và làm việc căng thẳng.","Không bục sân khấu cách biệt, mỗi đêm nhạc là một vòng tròn ngang tầm mắt: tiếng đàn gỗ vang lên chậm rãi, những câu chuyện trưởng thành được lắng nghe trọn vẹn, để rồi từ đó những người bạn xa lạ bắt đầu đồng hành cùng nhau bền bỉ.","Nếu bạn từng góp mặt trong một đêm nhạc hay buổi trò chuyện của chuỗi chương trình này, mời bạn để lại đôi dòng cảm nhận ở khung bên dưới."]',
  updated_at = '2026-11-24T18:30:00.000Z'
WHERE id = 'post-holaheart-musicspace-series';

UPDATE events
SET
  location = 'Mây Lang Thang Cafe (ngõ 2 đường vào TTGDQP, Hòa Lạc)',
  fee = 'Vé 0đ · Đồ uống tự chọn tại quán (35.000đ – 50.000đ)',
  seats = '35 chỗ ngồi vòng tròn',
  summary = 'Tình thương của người cha hiếm khi cất thành lời. Một buổi tối Chủ Nhật dưới ánh đèn vàng ấm để ngồi lại, lắng nghe và nhìn sâu hơn vào dáng lưng trầm mặc của Cha.',
  updated_at = '2026-11-24T18:30:00.000Z'
WHERE id = 'holaheart-cuoc-doi-cua-cha-2026-11-29';

UPDATE events
SET
  title = 'HolaConnect · Chiều Leo Núi & Trò Chuyện Dưới Tán Thông',
  image = '/assets/images/hero-holarise-binh-minh.webp',
  image_alt = 'Khung cảnh sườn đồi buổi sớm — mời bạn tham gia chặng đi bộ rừng thông Núi Luốt ngày 26/11/2026.',
  fee = 'Miễn phí · Tự chuẩn bị nước uống cá nhân',
  seats = '25 người trẻ đồng hành',
  summary = 'Tạm rời màn hình máy tính để sải bước dưới tán thông chiều Núi Luốt, hít thở bầu không khí trong lành và ngồi lại trò chuyện cùng những người bạn mới.',
  updated_at = '2026-11-24T18:30:00.000Z'
WHERE id = 'holaconnect-leo-nui-lam-nghiep-2026-11-26';
