# DESIGN: Hệ Thống Thiết Kế HolaRise (Visual-First Mobile & Smart Compact Nav)

## 1. Visual Archetype & Mood
- **Archetype:** *Visual-First Editorial Community* — Nhiều hình ảnh thực tế, chữ cô đọng, thoáng đãng.
- **3 tính từ mô tả cảm giác:** **Trực quan (Visual)** – **Gọn gàng (Effortless)** – **Ấm áp (Warm)**.

## 2. Nhận diện Thương hiệu & Logo Hierarchy
- **Logo Đầy đủ (`logo-holarise.png`):** Hiển thị khi thanh Header ở đỉnh trang.
- **Logo Hình Biểu tượng `HR` (`logo-mark.png`):** Chữ `HR` xanh rừng đậm (`#1C3A2B`) kết hợp dải lượn cam bình minh (`#D97948`) trên nền kem ấm bo góc squircle.
  - Dùng làm **Floating Corner Badge** (`42x42px`) ở góc trên bên trái màn hình khi người dùng vuốt xuống trên điện thoại.
  - Dùng làm `apple-touch-icon`, `favicon` và điểm nhấn thương hiệu trên `og-cover.jpg`.

## 3. Hành vi Thanh Điều Hướng Thông Minh Trên Điện Thoại (Smart Mobile Header)
- **Trạng thái 1 — Ở đầu trang (`scrollY <= 48px`) hoặc khi đang mở Menu:**
  - Hiện thanh Header đầy đủ: Logo `HolaRise` + Nút `Tham gia` nhỏ gọn + Nút mở Menu.
- **Trạng thái 2 — Khi vuốt xuống (`scrollY > 48px`, hướng cuộn xuống):**
  - Thanh Header dài tự động trượt ẩn nhẹ lên trên (`pointer-events: none`), đồng thời **thu gọn về góc trái** thành huy hiệu nổi **Logo hình `HR`** (`42x42px`, bo góc squircle, đổ bóng nhẹ tinh tế).
  - Người dùng có toàn bộ màn hình điện thoại để xem ảnh và nội dung mà không bị thanh nav che khuất.
- **Trạng thái 3 — Khi vuốt ngược lên (`deltaY < -8px`):**
  - Thanh Header đầy đủ trượt mượt trở lại để người dùng chuyển trang hoặc bấm Menu ngay lập tức.

## 4. Quy Tắc Visual-First Chống Rối Chữ Trên Điện Thoại
1. **Trang chủ tối đa 5 Phần Trực Quan:**
   - **Phần 1 (Hero Visual-First):** Tiêu đề ngắn (8–10 chữ) + 1 câu mô tả (tối đa 22 chữ) + 3 chip trực quan (`🌱 Làm sạch Hòa Lạc`, `💛 Workshop Giá trị sống`, `🤝 Phụng sự xã hội`) + Khung ảnh lớn ngay trong màn hình đầu tiên + Thanh sự kiện sắp tới.
   - **Phần 2 (3 Chương trình Trọng tâm - Interactive Visual Tabs):** Hiển thị 3 nút Tab (`01 · Môi trường`, `02 · Workshop`, `03 · Cộng đồng`) trên cả điện thoại lẫn máy tính. Mỗi Tab có **1 ảnh lớn + Tiêu đề ngắn + 1 câu mô tả + 3 chip hoạt động ngắn**. Không xếp chồng 3 khối văn bản dài trên mobile.
   - **Phần 3 (4 Con số Thực tế - Bento 2x2):** Luôn giữ lưới `2 cột x 2 hàng` trên điện thoại để gói gọn trong nửa màn hình, không trải dọc 4 hàng rời rạc.
   - **Phần 4 (Lịch Sự kiện Sắp tới & Khoảnh khắc Hiện trường):** Mỗi thẻ sự kiện có ảnh lớn + 3 pill thông tin (`📅 Ngày giờ`, `📍 Địa điểm`, `✨ Miễn phí`) + 1 câu tóm tắt ngắn + Nút đăng ký. Kế tiếp là dải ảnh hiện trường vuốt ngang.
   - **Phần 5 (FAQ Ngắn gọn & CTA Đăng ký):** Mỗi câu trả lời FAQ chỉ 1–2 câu súc tích.
2. **Định mức chữ (Copy Budget):**
   - Mô tả Hero: `<= 25 chữ`.
   - Mô tả mỗi Chương trình / Sự kiện: `<= 24 chữ` (1 câu duy nhất).
   - Điểm nhấn (Highlights): Chuyển từ câu văn dài thành **Tag / Chip ngắn 3–6 chữ**.
