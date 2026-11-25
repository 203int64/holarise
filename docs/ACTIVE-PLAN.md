# Active Plan — Nâng cấp Dialog Motion, Linear Feedback Modal & Luma Account Hub

**Trạng thái:** Đang triển khai (Option B đã duyệt)

## Atomic Phases

- [ ] **Phase 1 — Motion mượt cho toàn bộ `<dialog>` (chuẩn Modern Web Guidance `animate-to-from-top-layer`)**
  - CSS `@starting-style` + `transition-behavior: allow-discrete` + `overlay` + `::backdrop` blur mượt + `prefers-reduced-motion`.
  - Helper `closeTopLayer()` với `data-closing` fallback cho Safari/Firefox trong `assets/js/main.js`.
- [ ] **Phase 2 — Tái thiết kế Popup Đóng góp theo chuẩn Linear / Vercel**
  - Progressive Disclosure tại `templates/base.html` (4 pill gọn 1 dòng + textarea hỗ trợ `Cmd/Ctrl+Enter` + toolbar đính kèm mảnh ở đáy, ẩn ngữ cảnh kỹ thuật mặc định).
  - Tự nhận diện người đã đăng nhập tại `assets/js/member.js` & `assets/js/main.js` (hiện 1 dòng avatar+tên, ẩn hoàn toàn 2 ô Tên & Email/Zalo).
- [ ] **Phase 3 — Tái cấu trúc Trang Tài khoản `/tham-gia/` theo chuẩn Luma + Kiểm chứng**
  - Header Hồ sơ gọn + 3 Tab (`Thẻ & Hồ sơ`, `Hoạt động của tôi`, `Bảo mật`).
  - Xóa mã vạch giả trên thẻ, sửa tràn chữ email, đổi châm ngôn mặc định sạch từ `"kiến tạo"`.
  - Chạy `python3 build.py --check` & `node --test tests/*.test.mjs`.
