# ACTIVE-PLAN: Đại Phẫu Chuẩn Hiến Pháp `AGENTS.md` — HolaRise

**Nguồn sự thật:** [AGENTS.md](../AGENTS.md)
**Liên kết Nhóm Zalo Cộng đồng:** `https://zalo.me/g/7fock88aizzrdkmr9ggf`

## Tiến Độ 4 Phase Nguyên Tử

- [x] **Phase 1 — Cứu luồng Giữ chỗ 15s, Nối Nhóm Zalo, Động hóa Thư mời `/su-kien/<slug>/` & Khóa lỗ hổng Auth**
  - Lưu trữ 20 file tài liệu cũ vào `docs/_archive/`, duy trì 1 kế hoạch `docs/ACTIVE-PLAN.md`.
  - Gỡ tường Đăng nhập Google / Passkey / Email Password / Account Enumeration (`lookup.js`, `google.js`, `passkey/*`) khỏi giao diện công khai; đồng nhất `/tham-gia/` & `/su-kien/<slug>/` về **Giữ chỗ 15 giây không mật khẩu (`Tên + SĐT/Zalo + Số chỗ`)**.
  - Gắn nút **Tham gia Nhóm Zalo (`https://zalo.me/g/7fock88aizzrdkmr9ggf`)** ngay trên màn hình xác nhận giữ chỗ & thư mời sự kiện; tách rõ cờ tâm sự ẩn danh khi lưu đăng ký.
  - Khử fix cứng `cuoc-doi-cua-cha` / `data-father-studio` trên 7 file → sinh trang `/su-kien/<slug>/` tự động cho **mọi** sự kiện (cả tĩnh lẫn Edge SSR `functions/su-kien/[slug].js`).
- [x] **Phase 2 — Nâng cấp CMS `/admin` (Căn cắt Ảnh `<canvas>` + Nhập Thành viên/Đội ngũ + Nhập & Duyệt Cảm nhận) & Migration D1 `0008`**
  - Tích hợp công cụ cắt khung (`16:9`, `4:3`, `1:1`), xoay `90°`, căn tâm điểm & sửa `alt` bằng `<canvas>` thuần ngay trong `/admin`, đưa mục *Hình ảnh Giao diện* lên thanh điều hướng dễ thấy.
  - Mở CRUD Thành viên (`POST/PATCH/DELETE /api/admin/members`), nút 1 chạm lưu người *Đã tham gia* từ Đơn đăng ký sang Thành viên, và công tắc *Hiển thị trong Đội ngũ Điều phối công khai* (chỉ xuất Tên + Vai trò + Ảnh + Giới thiệu ngắn lên `/gioi-thieu/`, tuyệt đối giấu SĐT/Email).
  - Mở CRUD Cảm nhận (`POST/PATCH/DELETE /api/admin/reflections`) + form gửi cảm nhận không mật khẩu ngoài `/hanh-trinh/<slug>/` (chảy về hàng đợi duyệt) + SSR mục *Tiếng nói người tham dự* ra Trang chủ & Giới thiệu.
- [x] **Phase 3 — Biên tập Toàn diện Bút pháp ("Sang Thật · Giàu Hình Ảnh · Sứ mệnh Mở rộng") & Trang Quốc tế `/en/`**
  - Viết lại toàn bộ `data/*.json`, `templates/*.html` và đồng bộ D1 theo đúng hệ thẩm mỹ `30/70` và tầm vóc *Khởi nguồn Hòa Lạc · Sứ mệnh Mở rộng*.
  - Gỡ ảnh AI đóng giả tư liệu thực tế ở `HolaGreen` & `HolaConnect`, bổ sung ranh giới chia sẻ đồng đẳng `HolaHeart`, bật khóa chặn cứng `--strict-copy` mặc định trong `build.py --check`.
  - Gỡ `i18n.js` dịch nửa vời khỏi các trang tiếng Việt; xuất bản trang Hồ sơ Đối ngoại Quốc tế `/en/` hoàn chỉnh `100%` tiếng Anh.
- [x] **Phase 4 — Tối ưu Tốc độ Zalo Mobile & Dọn sạch Rác Repo**
  - Thay cuộn ngang cưỡng bức `340vh` bằng dải ảnh `scroll-snap` mượt tự nhiên; chuyển `sw.js` sang chế độ tự dọn cache an toàn (gỡ PWA precache nặng).
  - Xóa `16` ảnh nháp `hero-holarise-binh-minh-v2..v9.webp`, `review-images/`, template mồ côi `templates/activities.html` và cập nhật lại `README.md`.

## Cổng Nghiệm Thu Sau Mỗi Phase
1. `python3 build.py --check`
2. `node --test tests/*.test.mjs`
3. Đối chiếu Tầng 1, Tầng 2 & Tầng 3 trong `AGENTS.md`.
