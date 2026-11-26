# Active Plan — Sân Khấu Kỷ Niệm Sau Sự Kiện, Đóng Góp 2 Phần & Kiểm Duyệt `/media/`

**Trạng thái:** Hoàn tất & đã nghiệm thu (32/32 Tests PASS · JS Syntax OK · `dist/` đồng bộ)

## Quyết định kiến trúc đã chốt
- **Tự động chuyển hóa `/su-kien/<slug>/`:** Khi sự kiện kết thúc (`kind = 'past'` hoặc `date < todayVn`), chính đường link `/su-kien/<slug>/` tự chuyển sang **Sân khấu Kỷ niệm** (Triển lãm khoảnh khắc đã duyệt + Sân khấu Lưu bút sinh động có thẻ cảm xúc, tối đa 7 ảnh & 3 phản ứng + Nút Đóng góp).
- **Nút Đóng góp 2 phần:**
  - *Đóng góp bằng lời* (Cần cải thiện / Động viên / Đề xuất): mở cho cả khách chưa đăng nhập & Thành viên, hỗ trợ gửi ẩn danh tách sạch danh tính; xem và lọc theo sự kiện tại `/admin/` (chỉ `super_admin` & `editor`).
  - *Đóng góp ảnh gốc* (không giới hạn số ảnh, `<= 25 MB/tấm`): bắt buộc Thành viên đăng nhập; ảnh gốc đẩy thẳng vào thư mục Drive chuẩn hóa riêng biệt `album/<YYYY-MM-DD - Tên sự kiện>/dong-gop/<YYYYMMDD>_<Mã TV>_<Tên-slug>/<slug>_<YYYYMMDD>_<Mã TV>_<STT>.<ext>` và vào hàng chờ `approval_status = 'pending'`.
- **Kiểm duyệt Media luôn bật mặc định:** Mọi vai trò có quyền trong `/media/` (`super_admin`, `editor`, `media`) đều xem được ảnh đóng góp + bộ lọc riêng; chỉ `super_admin` & `editor` bấm Duyệt / Ẩn.

## Atomic Phases
- [x] **Phase 1 — Migration `0019`, Schema Guards & Backend APIs (Reactions, Mood, Event Feedback, Standardized Drive Naming)**
- [x] **Phase 2 — Sân khấu Kỷ niệm tại `/su-kien/<slug>/` + Hộp thoại Đóng góp 2 phần**
- [x] **Phase 3 — Nâng cấp Cổng Kiểm duyệt `/media/` & Mục Góp ý Sự kiện tại `/admin/`**
- [x] **Phase 4 — Test tự động, Đồng bộ `dist/` & Reality Verification Gate**
