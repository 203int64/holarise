# PLAN: Tối Ưu Giao Diện Điện Thoại Visual-First, Logo HR Thu Gọn & Ảnh Chia Sẻ OG

## Atomic Phases

### [x] Phase 1: Xử lý Logo Hình `HR` & Thiết kế Banner Chia sẻ `og-cover.jpg` (`1200x630`)
- **Goal:** Tạo bộ icon chuẩn từ ảnh Logo `HR` người dùng cung cấp (`logo-mark.png`, `apple-touch-icon.png`, `favicon.svg`) và kết xuất banner Open Graph `assets/images/og-cover.jpg` (`1200x630px`) sắc nét có ảnh hoạt động Hòa Lạc + Logo `HR`/`HolaRise` + Tiêu đề & 3 trụ cột.
- **Target Files:**
  - `assets/images/logo-mark.png`
  - `assets/images/apple-touch-icon.png`
  - `assets/images/favicon.svg`
  - `assets/images/og-cover.jpg`

### [x] Phase 2: Biên tập lại Toàn bộ Dữ liệu Ngắn gọn – Nhiều Ảnh – Dễ hiểu trong 3 giây (`data/*.json`)
- **Goal:** Đổi `siteUrl` thành `https://holarise.pages.dev`; cắt 70% chữ dài dòng trong `site.json`, `activities.json`, `workshops.json`, `news.json` sang văn phong súc tích, dễ quét mắt trên điện thoại.
- **Target Files:**
  - `data/site.json`
  - `data/activities.json`
  - `data/workshops.json`
  - `data/news.json`

### [x] Phase 3: Cập nhật `build.py` & Templates (`base.html`, `home.html`, `about.html`, `activities.html`, `workshops.html`)
- **Goal:**
  - Bổ sung meta `og:image:width`, `og:image:height`, `og:image:type`, cache-buster `?v=2` và nút huy hiệu nổi **Logo hình `HR`** góc trái trong `base.html`.
  - Tái cấu trúc `home.html` còn đúng 5 phần Visual-First; đưa 4 Cam kết & UN SDGs sang `about.html` dưới dạng thẻ gọn.
  - Render thẻ sự kiện & chương trình theo cấu trúc Visual Card (Ảnh lớn + 1 câu ngắn + Pills trực quan).
- **Target Files:**
  - `build.py`
  - `templates/base.html`, `templates/home.html`, `templates/about.html`, `templates/activities.html`, `templates/workshops.html`

### [x] Phase 4: CSS & JS cho Smart Compact Header (Logo `HR` góc trái khi vuốt xuống) & Mobile Visual Layout
- **Goal:**
  - Khi vuốt xuống trên điện thoại, ẩn thanh nav dài và hiện huy hiệu nổi **Logo `HR`** tinh tế ở góc trái; vuốt lên hiện lại thanh nav.
  - Bật Tabs chuyển nhanh cho 3 Chương trình trên điện thoại (kèm ảnh lớn trong mỗi tab), lưới Metrics 2x2 trên điện thoại, và thẻ sự kiện gọn gàng.
- **Target Files:**
  - `assets/css/styles.css`
  - `assets/js/main.js`
  - `assets/js/motion.js`

### [x] Phase 5: Kiểm chứng `build.py --check` & Trình duyệt Thực tế (Mobile `375px` + Desktop)
- **Goal:** Đảm bảo 0 lỗi build/SEO, kiểm tra trực quan giao diện điện thoại, hiệu ứng thu nhỏ Logo `HR` khi vuốt xuống và thẻ Open Graph.
