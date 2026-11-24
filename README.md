# HolaRise — Cộng đồng Thanh niên Khởi nguồn từ Hòa Lạc

> **Nguồn sự thật tối cao của dự án:** Xem [AGENTS.md](./AGENTS.md) trước khi chỉnh sửa bất kỳ mã nguồn, nội dung hay schema nào.

Website chính thức tại **`https://holarise.org`** — xây dựng bằng Python 3 stdlib (`build.py`) kết hợp Cloudflare Pages Functions (`functions/`), cơ sở dữ liệu **Cloudflare D1 (`DB`)** và **Workers KV (`MEDIA_KV`)** với chi phí vận hành `0đ/tháng`.

---

## 1. Cấu trúc Các Trang Chính

- `/` — Trang chủ giới thiệu HolaRise, lịch hoạt động sắp mở, khoảnh khắc thực tế và 3 trụ cột (`HolaHeart`, `HolaGreen`, `HolaConnect`).
- `/gioi-thieu/` — Triết lý, đội ngũ điều phối, chuẩn mực minh bạch và 6 mục tiêu phát triển bền vững (UN SDGs).
- `/lich-hoat-dong/` — Lịch sự kiện sắp mở và dấu mốc đã tổ chức.
- `/su-kien/<slug>/` — Trang Thư mời sự kiện tự động (hỗ trợ cả build tĩnh lẫn Edge SSR từ `/admin`), giữ chỗ 15 giây không mật khẩu và kết nối thẳng vào Nhóm Zalo buổi gặp.
- `/hanh-trinh/` & `/hanh-trinh/<slug>/` — Bài tường thuật, thư viện ảnh và cảm nhận người tham dự không cần tài khoản.
- `/tham-gia/` — Giữ chỗ nhanh không mật khẩu và cổng đề xuất hợp tác Nhà trường / CLB / Không gian.
- `/en/` — Trang Hồ sơ Đối ngoại Quốc tế hoàn chỉnh 100% tiếng Anh.
- `/chinh-sach/` — Chuẩn mực Minh bạch, Đạo đức Kể chuyện, An toàn Tâm lý – Trẻ em và Bảo vệ Dữ liệu Cá nhân.
- `/admin/` & `/media/` — Cổng quản trị nội bộ (Đơn đăng ký, Sự kiện, Bài viết, Cắt khung ảnh `<canvas>`, Thành viên & Đội ngũ, Cảm nhận, Đối tác, Cài đặt).

---

## 2. Chạy Cục Bộ & Kiểm Định Bắt Buộc

```bash
# 1. Build toàn bộ website ra dist/ kèm kiểm định SEO, liên kết và Bộ lọc Câu từ AGENTS.md
python3 build.py --check

# 2. Chạy toàn bộ bộ test API, bảo mật, migration & SSR
node --test tests/*.test.mjs

# 3. Xem trước cục bộ tại http://localhost:8080
python3 -m http.server 8080 --directory dist
```

## 3. Áp dụng Migration D1 lên Production (Cloudflare)

```bash
npx wrangler d1 migrations apply holarise-db --remote
```
