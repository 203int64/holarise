# SPEC: Dự Án Cộng Đồng HolaRise – Hòa Lạc (Visual-First & Mobile-Clarity Edition)

## 1. Tổng quan & Bài toán (Overview & Problem Statement)
- **Tên dự án:** **HolaRise** (*Hola* = Hòa Lạc & lời chào mở lòng; *Rise* = Bình minh nâng đỡ nhau cùng vươn lên).
- **Tên đầy đủ:** Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên (`HolaRise – Hoa Lac Youth Empowerment Community`).
- **Domain chính thức:** `https://holarise.pages.dev`
- **Bài toán cần giải quyết:**
  1. **Chia sẻ mạng xã hội (Open Graph):** Trước đây `siteUrl` trỏ sang `https://holarise.org` chưa hoạt động khiến Zalo, Facebook, Messenger không tải được ảnh preview khi chia sẻ `https://holarise.pages.dev/`.
  2. **Quá tải thông tin trên Điện thoại:** Trang chủ và các thẻ nội dung quá nhiều chữ, ít hình ảnh trực quan, thanh điều hướng chiếm chỗ khi cuộn xuống khiến người dùng đọc mỏi mắt mà không hiểu ngay HolaRise làm gì.
- **Định vị cốt lõi (3-second Visual Clarity):** Mở điện thoại lên thấy ngay **Hình ảnh hoạt động thật tại Hòa Lạc + 3 trụ cột ngắn gọn (`🌱 Môi trường` · `💛 Giá trị sống` · `🤝 Cộng đồng`) + Lịch sự kiện sắp tới**.

## 2. Mục tiêu & Giới hạn (Goals & Non-Goals)
- **Goals:**
  - Khắc phục 100% ảnh chia sẻ Open Graph (`1200x630px`, URL tuyệt đối `https://holarise.pages.dev/assets/images/og-cover.jpg?v=2`, có đủ `og:image:width`, `og:image:height`, `og:image:type`) với thiết kế Banner có Ảnh hoạt động + Logo HR / HolaRise + Tiêu đề rõ nét.
  - **Mobile Smart Header & Logo Hình `HR`:** Khi ở đầu trang hiện thanh Header đầy đủ; khi cuộn xuống trên điện thoại, ẩn thanh nav dài và thu gọn thành huy hiệu nổi **Logo hình `HR`** tinh tế ở góc trên bên trái (vuốt ngược lên thanh nav mới hiện lại).
  - **Visual-First Homepage (5 phần cốt lõi):**
    1. Hero Visual-First (Ảnh lớn + Tiêu đề ngắn + 3 chip định vị + Thanh sự kiện sắp tới).
    2. 3 Chương trình Trọng tâm (`HolaGreen`, `HolaHeart`, `HolaConnect`) với **Tabs chuyển nhanh có ảnh lớn ngay trên cả điện thoại**, mỗi mục chỉ 1 câu mô tả + 3 điểm nhấn ngắn gọn.
    3. 4 Con số Thực tế (Bento 2x2 gọn trong 1 màn hình điện thoại).
    4. Lịch Sự kiện Sắp tới (Thẻ ảnh lớn + 3 pill Thời gian/Địa điểm/Chi phí + 1 câu tóm tắt) & Dải ảnh hoạt động thực tế.
    5. Giải đáp nhanh (FAQ 1–2 câu ngắn) & Banner Đăng ký.
  - Chuyển các nội dung lý thuyết dài (Tuyên ngôn, 4 Cam kết minh bạch, 5 mục UN SDGs) sang trang `/gioi-thieu/` và biên tập lại ngắn gọn, dễ quét mắt.
- **Non-Goals:**
  - Không nhồi nhét các đoạn văn dài 50–80 chữ hay danh sách gạch đầu dòng rườm rà trên thẻ sự kiện/chương trình.

## 3. Hợp đồng Dữ liệu & Kỹ thuật
- Dữ liệu tĩnh trong `data/site.json`, `data/activities.json`, `data/workshops.json`, `data/news.json`.
- Bộ nhận diện logo:
  - Logo chữ ngang: `/assets/images/logo-holarise.png`
  - Logo hình biểu tượng `HR`: `/assets/images/logo-mark.png` (dùng cho thu gọn góc trái khi cuộn, Apple Touch Icon và Favicon).
  - Ảnh Open Graph: `/assets/images/og-cover.jpg` (`1200x630px`).
- Trình biên dịch `build.py` (Python 3 stdlib) sinh HTML tĩnh ra `dist/` và kiểm định tự động qua `python3 build.py --check`.

## 4. Tiêu chí Nghiệm thu (Acceptance Criteria)
- **Given** chia sẻ `https://holarise.pages.dev/` lên Zalo/Facebook/Messenger **When** crawler đọc thẻ meta **Then** thấy `og:image` trỏ đúng `https://holarise.pages.dev/assets/images/og-cover.jpg?v=2` (`1200x630`) có Logo + Hình ảnh + Tên cộng đồng.
- **Given** mở trang trên điện thoại (`375px`) **When** cuộn xuống **Then** thanh nav ẩn gọn và thu nhỏ thành huy hiệu Logo `HR` góc trái; khi cuộn lên nhẹ thanh nav hiện lại.
- **Given** xem Trang chủ và các trang con trên điện thoại **When** lướt qua **Then** thấy nhiều ảnh trực quan, chữ ngắn gọn dễ hiểu trong 3 giây, 3 chương trình bấm chuyển Tab mượt mà, không bị ngợp chữ.
