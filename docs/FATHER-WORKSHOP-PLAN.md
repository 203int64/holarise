# FATHER WORKSHOP PLAN — Workshop "Cuộc Đời Của Cha" (Editorial Invitation & Sunset Ticket Studio — Option B)

> **Nguyên tắc kiến trúc:** Giữ trọn Design System Bình minh Hòa Lạc (`Be Vietnam Pro` + `Lora`, `#FFFFFF / #F6F7F6 / #0B110F / #0B6E4F / #D97948`) hòa quyện sắc cam hoàng hôn ấm áp từ poster chính thức; giữ nguyên 100% schema D1 (`events`, `registrations`), Admin Portal (`/admin/`), CSV export và đồng bộ Google Sheets (`syncRegistrationToGas`).

## Atomic Phases

### [x] Phase 1: Living Plan, Official Poster / OG Assets, Data & Idempotent D1 Migration
- **Target Files:** `docs/FATHER-WORKSHOP-PLAN.md`, `assets/images/events/cuoc-doi-cua-cha-poster.jpg`, `assets/images/events/cuoc-doi-cua-cha-og.jpg`, `data/workshops.json`, `migrations/0005_cuoc_doi_cua_cha_event.sql`
- **Verify:**
  - Ảnh poster (`1024×576`) và ảnh OpenGraph (`1200×630`) hiển thị trọn vẹn chữ `"WORKSHOP Cuộc đời của Cha — Lắng nghe – Tri ân – Yêu thương"` và hình hai cha con (đọc kiểm tra lại bằng `read_file`).
  - Thay thế hoàn toàn sự kiện tạm `holaheart-ws-nguoi-tre-cung-ngoi-lai-2026-11-29` bằng `holaheart-cuoc-doi-cua-cha-2026-11-29` (`19h15, Chủ Nhật 29/11/2026` · `Quán Cafe Mây Lang Thang, Hòa Lạc` · `Miễn phí tham dự · Tự túc đồ uống` · `35 chỗ ấm cúng`), giữ nguyên buổi Leo núi `26/11/2026`.

### [x] Phase 2: Dedicated Editorial Landing (`/su-kien/cuoc-doi-cua-cha/`), Upgraded Modal & SSR/API Sync
- **Target Files:** `templates/event_invitation.html`, `templates/base.html`, `build.py`, `functions/_lib/render.js`, `functions/sitemap.xml.js`, `functions/api/registrations.js`
- **Verify:**
  - Trang riêng `/su-kien/cuoc-doi-cua-cha/` pre-render 100% HTML tĩnh chuẩn SEO, `og:image` `1200×630`, JSON-LD `Event` + `BreadcrumbList`, lá thư mời nguyên bản đầy cảm xúc, đồng hồ đếm ngược múi giờ Việt Nam và khu vực Form Giữ Chỗ + Thiệp Vé Hoàng Hôn trực tiếp.
  - Thẻ sự kiện trên `/`, `/lich-hoat-dong/`, `/tham-gia/` và Cloudflare SSR (`functions/_lib/render.js`, `functions/sitemap.xml.js`) liên kết đồng nhất tới `/su-kien/cuoc-doi-cua-cha/` kèm nút giữ chỗ nhanh.
  - `#event-register-modal` và `/api/registrations` phân biệt rõ giữ chỗ sự kiện thật (`event_id` có mặt) với để lại thông tin chung.

### [x] Phase 3: Sunset Editorial CSS, Interactive Form Engine, `1080×1350` Ticket PNG & Calendar (`.ics` / Google)
- **Target Files:** `assets/css/styles.css`, `assets/js/main.js`, `assets/js/join-pass.js`
- **Verify:**
  - Tuân thủ `modern-web-guidance` (`forms`, `accessible-error-announcement`, `copy-button`): `<fieldset>` + `<legend>` radio cards chọn số chỗ (`1 chỗ / 2 chỗ / 3+ chỗ`), góc tâm sự `"Điều bạn luôn muốn nói với Cha"` + `<input type="checkbox">` cho phép đọc ẩn danh, `min-height >= 48px`, `font-size >= 1rem`, `aria-invalid="false"` khởi tạo, live region duy nhất.
  - Đóng gói dữ liệu sạch vào `registrations.note` (`<= 1000` ký tự), xuất Thiệp & Vé Giữ Chỗ Hoàng Hôn `1080×1350` PNG (Canvas 2x sau `document.fonts.ready`), thêm lịch 1-click Google Calendar & tải tệp `.ics` (`2026-11-29 19:15–21:30 Asia/Ho_Chi_Minh`), link rủ bạn `?ru=` trực tiếp về `/su-kien/cuoc-doi-cua-cha/`.

### [x] Phase 4: Automated Tests, Static Build Audit & Live Browser Verification (`390×844` & `1440×900`)
- **Target Files:** `tests/cms.test.mjs`, `docs/FATHER-WORKSHOP-PLAN.md`, `dist/`
- **Verify:**
  - `python3 build.py --check` PASS.
  - `node --test tests/cms.test.mjs` & `node --test tests/media.test.mjs` PASS 100%.
  - Kiểm tra thực tế bằng `browser` subagent trên mobile (`390×844`) & desktop (`1440×900`): 0 tràn ngang, 0 lỗi Console/Network, kiểm chứng luồng gửi form & sinh Thiệp Vé Hoàng Hôn.
