# Active Plan — Lưu Bút Thành Viên (Tối đa 7 Ảnh) & Đóng Góp Kho Ảnh Sự Kiện

**Trạng thái:** Hoàn tất & đã nghiệm thu (29/29 Tests PASS · JS Syntax OK · `dist/` đồng bộ)

## Mục tiêu & Quy tắc khóa
- **Chỉ Thành viên đã đăng nhập** mới có quyền viết Lưu bút (cmt) và Góp ảnh vào Kho ảnh sự kiện.
- **Lưu bút (Cmt):** Hỗ trợ tối đa **7 ảnh kỷ niệm** mỗi lưu bút (nén gọn trên `MEDIA_KV`, tất cả qua duyệt Admin trước khi hiển thị).
- **Kho ảnh sự kiện (Album):** Không giới hạn số ảnh trong 1 album; ảnh gốc không nén (`<= 25 MB/tấm`) đẩy thẳng vào Google Drive `<ROOT>/album/<YYYY-MM-DD - Tên sự kiện>/dong-gop/<Tên Thành viên - Mã TV>/` và vào hàng chờ duyệt `approval_status = 'pending'` tại `/media/` (van an toàn rate-limit `60 ảnh/giờ/thành viên`).

## Atomic Phases
- [x] **Phase 1 — Schema D1 (`0017`), Drive Nested Subfolders & Member-only Backend APIs**
- [x] **Phase 2 — Giao diện Lưu bút 7 ảnh, Hộp thoại `<dialog>` Góp ảnh Kho chung & Duyệt ảnh trên Admin**
- [x] **Phase 3 — Build Sync (`python3 build.py --check`), Tests (`node --test tests/*.test.mjs`) & Reality Verification Gate**
