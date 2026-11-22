# JOIN EXPERIENCE PLAN — "Ngày đầu của tuần - Chủ nhật" & HolaRise Sunrise Pass Studio (Option B)

> **Nguyên tắc:** Giữ nguyên Design System Bình minh Hòa Lạc (`Be Vietnam Pro` + `Lora`, `#FFFFFF / #F6F7F6 / #0B110F / #0B6E4F / #D97948`), giữ nguyên toàn bộ schema D1 / API `/api/registrations` / Google Sheets / Admin CMS và bảo toàn các nâng cấp `/chinh-sach/`, `404.html`, `tel:` và accessible inline form validation hiện có.

## Atomic Phases

### [x] Phase 1: Standardize "Thời gian hoạt động: Ngày đầu của tuần - Chủ nhật" & SSR `/tham-gia/`
- **Target Files:** `data/site.json`, `templates/base.html`, `build.py`, `functions/_lib/render.js`, `functions/tham-gia/index.js`
- **Verify:**
  - `contact.meetingTime` cập nhật thành `"Ngày đầu của tuần - Chủ nhật"`, không còn `"Thứ Bảy"`.
  - Footer và `/tham-gia/` hiển thị nhãn `Thời gian hoạt động: Ngày đầu của tuần - Chủ nhật`.
  - `functions/tham-gia/index.js` render live sự kiện Chủ nhật từ D1 vào marker `JOIN_EVENTS` (có fallback an toàn).
  - Các nút `[data-register-event]` có đầy đủ `data-event-date`, `data-event-time`, `data-event-location`, `data-event-fee`, `data-event-type`.

### [x] Phase 2: Interactive Join Studio Markup, Live Sunrise Pass & Quick-Register Modal
- **Target Files:** `templates/join.html`, `templates/base.html`
- **Verify:**
  - `/tham-gia/` dùng `<fieldset>` + `<legend>` + radio cards 5 hành trình + bộ chọn buổi Chủ nhật + chip chạm nhanh Trường/Đơn vị & Phong cách đi + dải chào bạn bè `?ru=`.
  - Cột phải hiển thị thanh độ sẵn sàng thẻ + Live Sunrise Pass + nút Tải ảnh thẻ (PNG), Rủ bạn cùng đi, Sao chép lời mời (`command="--copy"`).
  - `#event-register-modal` nâng cấp thẻ thông tin sự kiện Chủ nhật, chip chạm nhanh và trạng thái xác nhận vé thành công.
  - Gắn `<script src="/assets/js/join-pass.js?v={{CACHE_BUST}}" defer></script>` trong `templates/base.html`.

### [x] Phase 3: CSS Craft & Interactive JS Engine
- **Target Files:** `assets/css/styles.css`, `assets/js/main.js`, `assets/js/join-pass.js`
- **Verify:**
  - Touch target `>= 48px`, `font-size >= 1rem` chống zoom iOS, `:has()` parent error styling + `.has-error-fallback`, `.visually-hidden`, hiệu ứng 3D tilt & con dấu tôn trọng `prefers-reduced-motion`.
  - `main.js` lưu/khôi phục đúng radio groups (`role`, `eventChoice`), chip (`vibe`, `skills`), đóng gói payload an toàn vào `eventId`, `activity`, `note` (không đổi schema D1) và phát sự kiện `holarise:registration-success`.
  - `join-pass.js` xử lý URL `?ru=&event=&chuong-trinh=` an toàn qua `textContent`, đồng bộ Sunrise Pass live, xuất PNG Canvas 2x (`1080×1350`) sau `document.fonts.ready`, hỗ trợ Invoker Commands `--copy` + fallback + VoiceOver repeat protection.

### [x] Phase 4: Unit Tests, Build Check & Real Browser End-to-End Verification
- **Target Files:** `tests/cms.test.mjs`, `docs/JOIN-EXPERIENCE-PLAN.md`, `dist/` (rebuild)
- **Verify:**
  - `python3 build.py --check` đạt PASS.
  - `node --test tests/cms.test.mjs` pass 100% (bao gồm test SSR `/tham-gia/` và payload đóng gói).
  - Kiểm thử trình duyệt thật ở `390×844` và `1440×900` (không tràn ngang, 0 console/network error, xác nhận đầy đủ flow `/tham-gia/` & Modal).
