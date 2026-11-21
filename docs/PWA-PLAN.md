# PLAN: Triển khai Progressive Web App (PWA) cho HolaRise

## Atomic Phases

### [x] Phase 1: Bộ Icon PWA (`any` + `maskable`), Screenshots & Manifest / iOS Meta
- **Goal:**
  - Xuất bộ icon sắc nét `assets/images/pwa/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` từ nhận diện `HR` (vùng an toàn maskable chuẩn ~72% trên nền `#FEF7EF`) và làm sạch `apple-touch-icon.png` (180×180 full-bleed không viền rác).
  - Tạo ảnh `assets/images/pwa/screenshot-mobile.jpg` (`narrow`) & `screenshot-desktop.jpg` (`wide`) phục vụ Richer Install UI.
  - Nâng cấp `site.webmanifest` trong `build.py` (thêm `id`, `scope`, `lang`, `dir`, `categories`, `shortcuts`, `icons`, `screenshots`) và đồng bộ `theme-color` + meta iOS standalone trong `templates/base.html`.
- **Target Files:**
  - `assets/images/pwa/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`
  - `assets/images/pwa/screenshot-mobile.jpg`, `screenshot-desktop.jpg`
  - `assets/images/apple-touch-icon.png`
  - `templates/base.html`, `build.py`
- **Verify:** `python3 build.py --check` + kiểm tra kích thước pixel từng icon & JSON manifest hợp lệ.

### [x] Phase 2: Build-Time Content-Hash, Service Worker (`/sw.js`), Trang `/offline/` & Cloudflare `_headers`
- **Goal:**
  - Thay `CACHE_BUST` timestamp trong `build.py` bằng SHA-256 content-hash tất định (1 lần/build).
  - Tạo `templates/offline.html` sinh `dist/offline/index.html`.
  - Tự sinh `dist/sw.js` (Network-First cho HTML → Cache → `/offline/`; Precache + Cache-First cho tài nguyên lõi với ngưỡng ngân sách 4 MB; Runtime Cache có giới hạn LRU cho `assets/images/events/` & Google Fonts; kích hoạt bản mới qua `SKIP_WAITING`).
  - Tự sinh `dist/_headers` cho Cloudflare Pages và mở rộng `verify_dist()` kiểm định toàn bộ hợp đồng PWA.
- **Target Files:**
  - `templates/offline.html`
  - `build.py`
  - `dist/sw.js`, `dist/_headers`, `dist/offline/index.html` *(generated)*
- **Verify:** `python3 build.py --check` (chạy 2 lần liên tiếp xác nhận content-hash tất định, 0 lỗi kiểm định PWA).

### [x] Phase 3: Luồng Cài đặt Thông minh, Update Toast & Offline Form Draft (`pwa.js` + `main.js`)
- **Goal:**
  - Tạo `assets/js/pwa.js` tuân thủ `modern-web-guidance: install-web-app` (`navigator.install()` → `beforeinstallprompt` → hướng dẫn iOS Safari & thoát Zalo/FB WebView qua native `<dialog>`).
  - Thêm nút kín đáo `data-pwa-install` trong Mobile Menu & Footer, `<dialog id="pwa-install-dialog">`, `#pwa-update-toast`, `#pwa-offline-bar` trong `templates/base.html`.
  - Nâng cấp `assets/js/main.js` tự lưu/khôi phục nháp Form đăng ký vào `localStorage` và báo rõ trạng thái kèm lối gọi Hotline / nhắn Zalo khi gửi lúc offline.
- **Target Files:**
  - `assets/js/pwa.js`
  - `assets/js/main.js`
  - `templates/base.html`
  - `assets/css/styles.css`
- **Verify:** `python3 build.py --check` + kiểm tra cú pháp JS (`node --check`).

### [x] Phase 4: Standalone App UI (Bottom Tab Bar + Safe-Area) & Kiểm chứng Thực tế Toàn diện
- **Goal:**
  - Thêm Bottom Tab Bar 5 mục (`Trang chủ`, `Hoạt động`, `Workshop`, `Tin tức`, `Tham gia`) trong `templates/base.html` + `build.py` (gắn `aria-current="page"` đúng route hiện tại) và CSS chỉ hiển thị khi `display-mode: standalone` / `.is-standalone` trên mobile `<= 820px`.
  - Xử lý `env(safe-area-inset-*)` đầy đủ cho Header, Bottom Tab Bar, Toast và đệm cuối trang.
  - Chụp/cập nhật `screenshot-mobile.jpg` & `screenshot-desktop.jpg` từ trang chạy thật nếu cần để phản ánh đúng giao diện thực tế.
  - Nghiệm thu toàn diện bằng `build.py --check`, kiểm thử trên trình duyệt thật (Desktop + Mobile `375px`): SW active, Offline mode, Install Dialog (iOS/Zalo), Form Draft offline, Standalone Bottom Tab Bar → chốt `Hana Verdict` + `Evidence Table`.
- **Target Files:**
  - `templates/base.html`, `build.py`, `assets/css/styles.css`, `assets/js/pwa.js`
  - `docs/PWA-PLAN.md`
- **Verify:** `python3 build.py --check` + `vibe-qa-verifier` / browser live inspection.
