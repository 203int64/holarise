# DESIGN: Hệ thống Giao diện PWA & Standalone App — HolaRise

## 1. Nguyên tắc Đồng nhất (Luật số 0)
Tuân thủ 100% Design System sẵn có trong [assets/css/styles.css](../assets/css/styles.css):
- **Bề mặt:** Pure White `#FFFFFF`, Gallery Mist `#F6F7F6`, Obsidian `#0B110F`, Warm Cream `#FEF7EF` (nền biểu tượng `HR`).
- **Điểm nhấn:** Emerald `#0B6E4F` (hover `#08553D`, soft `#EDF6F2`), đường kẻ mảnh 1px `--line: #e4e8e6`.
- **Typography:** Inter (`300`, `400`, `500`, `600`), không nhồi nhét gradient/glassmorphism lòe loẹt.

## 2. Bộ Icon Ứng dụng & Màu Hệ thống
- **Icon `any` (`192x192`, `512x512`):** Biểu tượng chữ `HR` (xanh rừng `#1F3D2B` + dải cam bình minh `#D77A4A`) trên nền kem ấm `#FEF7EF`, bo góc gọn, rõ nét trên màn hình sáng lẫn tối.
- **Icon `maskable` (`192x192`, `512x512`):** Phủ đầy nền `#FEF7EF` tới sát mép ảnh (không góc trong suốt), chữ `HR` thu gọn trọn trong vòng tròn vùng an toàn trung tâm (~72% chiều rộng) để Android Adaptive Icon cắt tròn/squircle/giọt nước không bao giờ bị xén chữ.
- **Đồng bộ `theme-color`:** Dùng `#FFFFFF` cho cả `<meta name="theme-color">` và `site.webmanifest` để khớp liền mạch với thanh Header trắng của HolaRise trên mobile, và `background_color: "#FEF7EF"` cho màn hình khởi động (splash screen) đồng màu với icon `HR`.

## 3. Luồng UI Cài đặt (Kín đáo, Đúng ngữ cảnh)
- **Điểm kích hoạt:**
  1. Trong **Mobile Menu Drawer** (khi mở menu trên điện thoại): nút nhỏ gọn `Cài ứng dụng HolaRise` dạng outline tinh tế.
  2. Trong **Footer** (cột `Khám phá` hoặc đáy trang): nút/link nhỏ `Cài đặt ứng dụng về máy`.
  - Cả hai điểm mang `data-pwa-install` và thuộc tính `hidden` mặc định; `pwa.js` chỉ bật hiển thị khi thiết bị chưa ở `standalone` VÀ thuộc một trong các nhánh cài đặt khả dụng (`navigator.install`, `beforeinstallprompt`, iOS Safari, hoặc In-App WebView Zalo/FB).
- **Hộp thoại Hướng dẫn (`<dialog id="pwa-install-dialog" class="club-dialog" closedby="any">`):**
  - Tái sử dụng 100% component `<dialog>` hiện có (có sẵn hiệu ứng top-layer và fallback Safari).
  - **Nhánh iOS Safari:** 2 bước trực quan có icon SVG chuẩn iOS: (1) Bấm nút **Chia sẻ** ở thanh dưới cùng Safari → (2) Chọn **"Thêm vào MH chính"** → **Thêm**.
  - **Nhánh Zalo / Facebook / Messenger WebView:** Giải thích ngắn gọn trình duyệt trong app đang chặn cài đặt → hướng dẫn bấm menu `⋯` chọn **Mở bằng Safari / Chrome** + nút **Sao chép đường dẫn** 1 chạm (có trạng thái phản hồi `Đã sao chép`).

## 4. Thanh Điều hướng Đáy (Standalone Bottom Tab Bar)
- **Điều kiện hiển thị:** Chỉ bật trên màn hình `<= 820px` khi `@media (display-mode: standalone)` HOẶC `html.is-standalone` (fallback cho `window.navigator.standalone === true` trên iOS). **Không hiển thị** khi duyệt web thông thường trên Safari/Chrome để tránh rác màn hình.
- **Cấu trúc 5 mục (chạm tối thiểu 48px, 1px hairline top border):**
  1. `Trang chủ` (`/`)
  2. `Hoạt động` (`/hoat-dong/`)
  3. `Workshop` (`/workshop/`)
  4. `Tin tức` (`/tin-tuc/`)
  5. `Tham gia` (`/tham-gia/`)
- **Safe-Area chuẩn iOS/Android:**
  - `padding-bottom: max(8px, env(safe-area-inset-bottom))` cho Bottom Tab Bar.
  - `padding-top: env(safe-area-inset-top)` cho `.site-header` khi `standalone`.
  - Cộng bù `padding-bottom: calc(68px + env(safe-area-inset-bottom))` cho `body` trong chế độ `standalone` để Footer và nút cuối trang không bị thanh tab che.

## 5. Phản hồi Trạng thái (Update Toast & Offline Bar)
- **Update Toast (`#pwa-update-toast`):** Viên thuốc (pill) nền Obsidian `#0B110F`, chữ trắng, nút Emerald sáng `"Cập nhật"` + nút đóng `×`, nổi gọn phía trên Bottom Tab Bar (`role="status" aria-live="polite"`).
- **Offline Pill (`#pwa-offline-bar`):** Dải mảnh tinh tế báo `"Đang xem chế độ ngoại tuyến · Một số dữ liệu có thể chưa mới nhất"`, tự hiện khi mất mạng và biến mất mượt mà khi có mạng trở lại.
