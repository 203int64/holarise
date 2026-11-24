# SPEC: Hệ Thống CMS & Tiếp Nhận Đăng Ký — HolaRise (Cloudflare Native)

## 1. Tổng quan & Bài toán (Overview & Problem Statement)
- **Mục tiêu:** Cung cấp trang quản trị tập trung tại `/admin` (mượt trên cả điện thoại và máy tính) cho 2–10 thành viên Ban Điều Phối (BĐP) không rành code, giải quyết triệt để 2 điểm nghẽn hiện tại:
  1. Đăng/sửa/ẩn **Bài viết (Tin tức)** và **Sự kiện/Workshop** kèm **tải ảnh trực tiếp từ máy/điện thoại**, xuất bản **tức thì (`< 1s`)** mà vẫn giữ nguyên **100% SEO & Open Graph** khi chia sẻ link lên Zalo/Facebook.
  2. Tiếp nhận **Đơn đăng ký** thực tế từ `/tham-gia/` và modal đăng ký nhanh — lưu tập trung vào `/admin` (lọc theo sự kiện/trạng thái, cập nhật tiến độ, xuất CSV tiếng Việt mở chuẩn Excel), đồng thời tự động **đồng bộ Google Sheets**, **báo email về BĐP**, và **gửi email xác nhận cho người đăng ký**.
- **Ràng buộc thực tế (0đ/tháng):**
  - Không dùng R2 (chưa kích hoạt / cần thẻ). Dùng **Cloudflare D1** (500 MB free) cho dữ liệu quan hệ + **Workers KV** (1 GB free, edge-cached) cho ảnh đã nén JPEG `<= 1280px`.
  - Không có tên miền riêng trên Cloudflare (`holarise.pages.dev`). Dùng **Google Apps Script Web App** miễn phí gắn trực tiếp vào Google Sheet & Gmail của CLB để đồng bộ Sheet + gửi 2 chiều Email không rơi spam.

## 2. Giới hạn & Non-Goals
- **Trong phạm vi (In-Scope):**
  - Xác thực BĐP tại `/admin` bằng Email + Mật khẩu (`PBKDF2-SHA256`, cookie `HttpOnly; Secure; SameSite=Lax`), không cần GitHub. Hỗ trợ khởi tạo tài khoản Admin đầu tiên 1 lần duy nhất khi bảng `admin_users` rỗng, sau đó Admin quản lý danh sách tài khoản BĐP.
  - CRUD **Bài viết (Tin tức)** (Nháp / Công khai, tự tạo slug tiếng Việt, nội dung nhiều đoạn + tiêu đề phụ + trích dẫn an toàn chống XSS, ảnh bìa tự nén).
  - CRUD **Sự kiện/Workshop** (Sắp tới / Đã diễn ra / Ẩn, bộ lọc 4 chữ `sach`, `biet-on`, `tu-te`, `se-chia`, ảnh bìa tự nén).
  - Hộp thư **Đơn đăng ký** (`new` / `contacted` / `attended` / `cancelled`), tìm kiếm, lọc theo sự kiện & trạng thái, ghi chú nội bộ BĐP, xuất CSV (UTF-8 BOM), theo dõi trạng thái đồng bộ Sheets/Email + nút *Đồng bộ lại*.
  - Cài đặt tích hợp ngay trong `/admin`: URL Webhook Google Apps Script, mã bí mật webhook, email nhận thông báo BĐP, nút *Gửi thử kiểm tra kết nối*.
  - Nâng cấp form công khai (`templates/join.html`, modal trong `templates/base.html`): tách rõ ô `Số điện thoại / Zalo *` và ô `Email nhận xác nhận`, thêm honeypot chống spam.
  - SSR Edge trên Cloudflare Pages Functions cho `/`, `/workshop/`, `/tin-tuc/`, `/tin-tuc/[slug]`, `/sitemap.xml` (vẫn fallback sạch về HTML tĩnh build bởi `build.py` khi chạy cục bộ).
- **Ngoài phạm vi (Non-Goals):**
  - Chưa chỉnh sửa cấu hình toàn trang (`site.json`, FAQ, 4 con số tác động, gallery) qua CMS.
  - Chưa tự động khóa form theo số ghế còn lại.
  - Chưa phân quyền RBAC phức tạp (chỉ phân `super_admin` quản lý user/settings và `editor` quản lý bài/sự kiện/đơn).

## 3. Mô hình Dữ liệu D1 (Relational Schema)
- `admin_users`: `id`, `email` (UNIQUE), `name`, `role` (`super_admin` | `editor`), `password_hash`, `password_salt`, `is_active`, `created_at`, `last_login_at`.
- `sessions`: `id` (hashed token), `user_id` (FK), `expires_at`, `created_at`.
- `posts`: `id`, `slug` (UNIQUE), `title`, `category`, `category_slug`, `filters_json`, `date`, `date_display`, `read_time`, `author`, `image`, `image_alt`, `excerpt`, `content_json`, `status` (`published` | `draft`), `created_at`, `updated_at`.
- `events`: `id` (slug/UUID), `kind` (`upcoming` | `past`), `type`, `filters_json`, `date`, `date_display`, `time`, `location`, `fee`, `seats`, `title`, `summary`, `highlights_json`, `participants`, `image`, `image_alt`, `status` (`published` | `draft`), `sort_order`, `created_at`, `updated_at`.
- `registrations`: `id`, `source` (`join_page` | `event_modal`), `event_id`, `activity_title`, `full_name`, `phone`, `email`, `role`, `organization`, `note`, `status` (`new` | `contacted` | `attended` | `cancelled`), `admin_note`, `sync_status` (`pending` | `synced` | `failed` | `skipped`), `sync_error`, `ip_hash`, `created_at`, `updated_at`.
- `settings`: `key` (PK), `value`, `updated_at` (`gas_webhook_url`, `gas_webhook_secret`, `notify_email`, `club_name`).
- `rate_limits`: `key` (PK), `count`, `window_start`.

## 4. Hợp đồng API & Bảo mật
- **Public API:**
  - `POST /api/registrations`: Validate schema, check honeypot, rate limit (`<= 6 req / 15 phút / IP`), ghi D1 trước → `context.waitUntil()` gọi Google Apps Script webhook và cập nhật `sync_status`.
  - `GET /api/media/[id]`: Trả byte ảnh từ `MEDIA_KV` với `Cache-Control: public, max-age=31536000, immutable` + Edge Cache (`caches.default`).
- **Auth API (`/api/auth/*`):**
  - `GET /api/auth/status`: Trả `{ initialized, authenticated, user }` (không lộ danh sách user).
  - `POST /api/auth/bootstrap`: Chỉ hoạt động khi `COUNT(admin_users) = 0`; tạo tài khoản `super_admin` đầu tiên và đăng nhập ngay.
  - `POST /api/auth/login` (rate-limit 10 lần/15 phút/IP), `POST /api/auth/logout`, `POST /api/auth/change-password`.
- **Admin API (`/api/admin/*`):**
  - Mọi endpoint xác thực session cookie từ D1 ở tầng handler + kiểm tra header `Origin` chống CSRF cho mọi phương thức ghi (`POST`, `PUT`, `PATCH`, `DELETE`).
  - `/api/admin/posts`, `/api/admin/posts/[id]`
  - `/api/admin/events`, `/api/admin/events/[id]`
  - `/api/admin/registrations`, `/api/admin/registrations/[id]`, `/api/admin/registrations/[id]/resync`, `/api/admin/registrations/export` (CSV UTF-8 BOM)
  - `/api/admin/media` (Upload ảnh đã nén `<= 1.5 MB`, kiểm tra magic bytes JPEG/PNG/WebP, trả `/api/media/<id>`)
  - `/api/admin/users`, `/api/admin/users/[id]` (`super_admin` only)
  - `/api/admin/settings`, `/api/admin/settings/test-webhook` (`super_admin` only)

## 5. Tiêu chí Nghiệm thu (Acceptance Criteria)
1. `python3 build.py --check` đạt 0 lỗi SEO/link; các trang tĩnh cục bộ vẫn chạy bình thường.
2. Bộ unit & integration tests (Node test runner) đạt 100% PASS cho validation, auth PBKDF2, slug tiếng Việt, XSS escape, CSV BOM, CRUD API, rate-limit và SSR HTML injection.
3. Trên `https://holarise.pages.dev`:
   - Tạo tài khoản / đăng nhập `/admin` hoạt động mượt trên cả `375px` & `1440px`.
   - Upload ảnh từ trình duyệt → lưu `MEDIA_KV` → mở trực tiếp `/api/media/<id>` trả HTTP 200.
   - Tạo sự kiện & bài viết mới → xuất hiện ngay (`< 1s`) tại `/`, `/workshop/`, `/tin-tuc/`, `/tin-tuc/<slug>/` kèm đủ `og:title`, `og:image` JPEG, JSON-LD & `/sitemap.xml`.
   - Gửi form ở `/tham-gia/` và modal sự kiện → bản ghi xuất hiện ngay trong `/admin`, lọc/đổi trạng thái/xuất CSV hoạt động, trạng thái đồng bộ Sheets hiển thị rõ ràng.
