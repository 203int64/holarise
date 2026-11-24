# SPEC: Chuyển đổi HolaRise thành Progressive Web App (PWA)

## 1. Tổng quan & Bài toán
- **Mục tiêu cốt lõi:** Cho phép học sinh, sinh viên và thanh niên tại Hòa Lạc cài đặt `https://holarise.pages.dev` về màn hình chính (Android, iOS, Desktop) như một ứng dụng nhẹ, hoạt động mượt cả khi mất mạng/sóng yếu (ví dụ ven hồ Tân Xã), và luôn tự động nhận lịch Workshop/Chiến dịch mới nhất khi deploy lên Cloudflare Pages.
- **Ràng buộc kiến trúc (Workspace Coexistence):** Giữ nguyên 100% trình build tĩnh Python 3 stdlib ([build.py](../build.py)) — **0 Node.js dependency**, deploy tĩnh trực tiếp lên Cloudflare Pages (`dist/`).

## 2. Phạm vi & Non-Goals
- **In-Scope:**
  1. **Installability đầy đủ:** Bộ icon PNG chuẩn (`192x192`, `512x512` cho cả `any` và `maskable` vùng an toàn 80%), `apple-touch-icon` (`180x180`), `screenshots` (`narrow` + `wide` cho Richer Install UI), `shortcuts`, `site.webmanifest` có `id` ổn định (`"/"`).
  2. **Content-Hashed Build & Service Worker (`/sw.js`):** Thay `CACHE_BUST` timestamp bằng SHA-256 hash tất định (tính 1 lần/build). Precache toàn bộ HTML + CSS + JS + ảnh lõi (~2.2 MB, ngân sách tối đa 4 MB); Runtime Cache (LRU tối đa 40 mục) cho ảnh sự kiện tương lai trong `assets/images/events/` và Google Fonts.
  3. **Cloudflare Pages `_headers`:** Khóa `Cache-Control: no-cache, no-store, must-revalidate` cho `/sw.js`, khai báo `Content-Type: application/manifest+json` cho `/site.webmanifest`, `max-age=0, must-revalidate` cho HTML.
  4. **Trang `/offline/`:** Trang dự phòng đẹp chuẩn Design System HolaRise có danh sách lối tắt trang đã lưu offline, nút thử tải lại và Hotline/Zalo khẩn cấp.
  5. **Luồng Cài đặt Thông minh (`pwa.js`):**
     - Nút kín đáo **"Cài ứng dụng"** trong Mobile Menu & Footer (không banner/popup ép buộc, tự ẩn khi đã ở chế độ `standalone`).
     - Phân tầng chuẩn `modern-web-guidance: install-web-app`: ưu tiên `navigator.install()` → fallback `beforeinstallprompt` → hộp thoại `<dialog>` hướng dẫn 2 bước cho iOS Safari → hộp thoại hướng dẫn thoát **Zalo / Facebook / Messenger / Instagram In-App WebView** (kèm nút copy link 1 chạm).
  6. **Update Toast & Offline Form Draft:**
     - Network-First cho HTML; khi có SW mới ở trạng thái `waiting` → hiện Toast nhỏ `"HolaRise vừa có nội dung mới · Cập nhật"` gửi `SKIP_WAITING`.
     - Dải báo trạng thái nhẹ khi mất mạng; tự lưu nháp Form đăng ký vào `localStorage` để không mất dữ liệu khi sóng yếu, kèm lối gọi Hotline / nhắn Zalo.
  7. **Chế độ App Standalone:** Thanh **Bottom Tab Bar** 5 mục (`Trang chủ`, `Hoạt động`, `Workshop`, `Tin tức`, `Tham gia`) **chỉ hiển thị** ở `@media (display-mode: standalone)` (và fallback `.is-standalone` trên iOS) trên màn hình `<= 820px`, xử lý đầy đủ `env(safe-area-inset-*)`.
  8. **Kiểm định tự động:** Mở rộng `python3 build.py --check` xác minh manifest schema, kích thước icon PNG, tính toàn vẹn của mọi URL trong `sw.js`, tồn tại `/offline/index.html` và `_headers`.
- **Non-Goals:**
  - Không triển khai Web Push Notification / Backend (Cloudflare Workers / D1 / KV).
  - Không hiện popup/banner cài đặt tự động khi người dùng mới vào trang.
  - Không thêm Node.js / npm / Workbox vào CI pipeline.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- **AC-1 (Manifest & Icons):** `dist/site.webmanifest` hợp lệ JSON, có `id: "/"`, `scope: "/"`, `start_url: "/"`, `display: "standalone"`, `icons` đủ `192x192` & `512x512` (`any` + `maskable`), `screenshots` (`narrow` + `wide`), `shortcuts`.
- **AC-2 (Service Worker & Cache Coherence):** `dist/sw.js` chứa `BUILD_HASH` khớp 100% với `?v=<BUILD_HASH>` trong toàn bộ HTML; mọi URL trong `PRECACHE_URLS` đều tồn tại vật lý trong `dist/`.
- **AC-3 (Cloudflare Headers):** `dist/_headers` có rule `no-cache, no-store, must-revalidate` cho `/sw.js` và `application/manifest+json` cho `/site.webmanifest`.
- **AC-4 (Install UX):** Bấm nút "Cài ứng dụng" kích hoạt đúng nhánh theo trình duyệt (`navigator.install()` / `beforeinstallprompt` / iOS dialog / In-App WebView dialog); ở chế độ `standalone`, nút cài đặt tự ẩn.
- **AC-5 (Offline & Form Draft):** Khi mất mạng, các trang lõi mở được từ cache; đường dẫn chưa cache rơi về `/offline/`; nhập dở form đăng ký rồi tải lại trang vẫn giữ bản nháp; gửi lúc offline hiển thị thông báo rõ ràng kèm nút gọi/Zalo và giữ nguyên nội dung đã nhập.
- **AC-6 (Standalone Navigation):** Ở `standalone` trên mobile (`375px`), Bottom Tab Bar hiện sắc nét, đánh dấu đúng mục hiện tại (`aria-current="page"`), không che nội dung cuối trang hay bị Home Indicator đè lên.
