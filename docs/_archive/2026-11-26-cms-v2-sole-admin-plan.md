# Active Plan — Làm lại CMS Admin (`/admin/`) Chuẩn Production (1 Admin Duy Nhất `203int64`)

**Trạng thái:** Hoàn tất & đã nghiệm thu (34/34 Tests PASS · `python3 build.py --check` PASS · Kiểm tra trực quan Desktop `1440px` & Mobile `375px` sạch 0 lỗi Console / 0 tràn ngang)

## Atomic Phases
- [x] **Phase 1 — Auth 1-Admin (`203int64`), Migration `0018_event_zalo_url.sql`, API `/api/admin/overview` & Nâng cấp Events/Registrations/Users**
- [x] **Phase 2 — Thiết kế lại `templates/admin.html` & `assets/css/admin.css` (Editorial Calm + Mobile-First + `<dialog>` Confirm)**
- [x] **Phase 3 — Viết lại `assets/js/admin.js` thống nhất & Xóa `assets/js/admin-studio.js`**
- [x] **Phase 4 — Cập nhật Tests, Rebuild `dist/` (`python3 build.py --check`) & Reality Verification Gate**
