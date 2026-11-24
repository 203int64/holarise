# SPEC: Cổng Quản Trị Hình Ảnh (`/media`) & Thư Viện Album Công Khai — HolaRise

## 1. Tổng quan & Bài toán (Overview & Problem Statement)
- **Mục tiêu:** Xây dựng cổng nội bộ **`/media`** dành riêng cho **Ban Hình Ảnh** (và Ban Điều Phối) để tạo Album sự kiện, kéo-thả upload hàng loạt ảnh đã tự nén trên trình duyệt lên `MEDIA_KV`, quản lý chú thích/nhiếp ảnh gia, ghim ảnh nổi bật lên Trang chủ `/` và xuất bản tức thì (`< 1s`) ra mục **Thư viện hình ảnh** tại `/hoat-dong/`.
- **Ràng buộc thực tế (0đ/tháng):**
  - Không dùng R2. Lưu metadata Album & Ảnh trong **Cloudflare D1 (`DB`)** và ảnh đã nén JPEG (`<= 1280px`, ~150 KB/ảnh) trong **Workers KV (`MEDIA_KV`, 1 GB free, edge-cached)**.
  - Ảnh gốc dung lượng lớn (RAW/full-res) của Ban Hình Ảnh lưu trên Google Drive / Google Photos của CLB và gắn link trực tiếp vào từng Album (`drive_url`).

## 2. Giới hạn & Non-Goals
- **Trong phạm vi (In-Scope):**
  - Mở rộng phân quyền tài khoản trong `admin_users` thêm role **`media`** (Ban Hình Ảnh):
    - `media`: chỉ được truy cập `/media` và các API quản lý Album/Ảnh/Upload media; bị chặn HTTP `403` ở mọi API Bài viết, Sự kiện, Đơn đăng ký, Tài khoản, Cài đặt.
    - `super_admin` và `editor`: vẫn truy cập được `/media` bình thường; `super_admin` tạo/đổi quyền tài khoản `media` trong `/admin`.
  - Cổng nội bộ `/media` (`noindex, nofollow`, `Disallow: /media/` trong `robots.txt`):
    - Đăng nhập dùng chung cookie `holarise_session` (`/api/auth/*`).
    - CRUD **Album sự kiện** (tiêu đề, mô tả, ngày diễn ra, địa điểm, bộ lọc 4 chữ `sach` | `biet-on` | `tu-te` | `se-chia`, link Google Drive ảnh gốc `https://`, trạng thái `published` | `draft`, thứ tự sắp xếp).
    - **Kéo-thả upload hàng loạt** (tối đa 30 ảnh/lượt, tự nén Canvas `<= 1280px` JPEG, hàng đợi concurrency = 2, tiến độ từng ảnh, báo lỗi & cho phép thử lại riêng ảnh lỗi).
    - Quản lý từng ảnh trong Album: sửa chú thích (`caption`), `alt`, tên nhiếp ảnh gia (`photographer`), đặt làm ảnh bìa Album, bật/tắt **Ghim lên Trang chủ (`is_featured_home`)**, xóa ảnh (xóa D1 + dọn byte rác trên `MEDIA_KV`).
  - Hiển thị công khai qua SSR Edge trên Cloudflare Pages Functions (fallback sạch về HTML tĩnh `data/activities.json` khi chạy cục bộ):
    - **`/hoat-dong/` (`functions/hoat-dong/index.js`)**: Thư viện Album sự kiện có bộ lọc 4 chữ, badge số ảnh, bấm mở **Album Lightbox** xem toàn bộ ảnh trong album, tải từng ảnh hoặc mở **link Google Drive ảnh gốc**.
    - **Trang chủ `/` (`functions/index.js`)**: Dải *"Khoảnh khắc tuổi trẻ tại Hòa Lạc"* tự động lấy các ảnh được ghim `is_featured_home = 1` từ các Album `published` (nếu chưa ghim ảnh nào thì lấy ảnh mới nhất).
- **Ngoài phạm vi (Non-Goals):**
  - Không tạo trang công khai riêng tại `/media` (đường dẫn `/media` là cổng nội bộ).
  - Không lưu ảnh RAW/video lên `MEDIA_KV`.
  - Không tạo hệ thống watermark hoặc chỉnh sửa ảnh nâng cao trên trình duyệt.

## 3. Mô hình Dữ liệu D1 (`migrations/0003_media_portal.sql`)
- Cập nhật `admin_users.role`: `CHECK(role IN ('super_admin', 'editor', 'media'))` (table-swap an toàn giữ nguyên dữ liệu & `sessions`).
- Bảng `media_albums`:
  - `id` TEXT PK, `slug` TEXT UNIQUE NOT NULL, `title` TEXT NOT NULL, `description` TEXT, `event_date` TEXT, `date_display` TEXT, `location` TEXT, `filters_json` TEXT DEFAULT `'[]'`, `drive_url` TEXT DEFAULT `''`, `cover_url` TEXT DEFAULT `''`, `status` TEXT CHECK(`'published'`, `'draft'`), `sort_order` INTEGER DEFAULT 0, `created_by` TEXT, `created_at` TEXT, `updated_at` TEXT.
- Bảng `media_photos`:
  - `id` TEXT PK, `album_id` TEXT NOT NULL FK → `media_albums(id)` ON DELETE CASCADE, `media_key` TEXT DEFAULT `''` (KV key id để xóa sạch KV), `url` TEXT NOT NULL, `caption` TEXT DEFAULT `''`, `alt` TEXT DEFAULT `''`, `photographer` TEXT DEFAULT `''`, `is_featured_home` INTEGER DEFAULT 0, `sort_order` INTEGER DEFAULT 0, `uploaded_by` TEXT, `created_at` TEXT, `updated_at` TEXT.
- Seed sẵn 1 Album mặc định từ 12 ảnh trong `data/activities.json` (ghim sẵn 6 ảnh đầu lên Trang chủ) để khi bật D1 không bị trống trang công khai.

## 4. Hợp đồng API & Bảo mật
- **Auth & RBAC (`functions/_lib/security.js`):**
  - `requireAdmin(context, { allowedRoles })`:
    - Mặc định cho `/api/admin/posts/*`, `/api/admin/events/*`, `/api/admin/registrations/*`: `allowedRoles: ['super_admin', 'editor']`.
    - `/api/admin/users/*`, `/api/admin/settings/*`: `super_admin` only.
    - `/api/admin/media`, `/api/admin/albums/*`, `/api/admin/photos/*`: `allowedRoles: ['super_admin', 'editor', 'media']`.
- **Media & Album API:**
  - `GET /api/admin/albums`: Danh sách album kèm `photo_count` và `featured_count`.
  - `POST /api/admin/albums`: Tạo album mới (tự sinh slug tiếng Việt chống trùng, validate `drive_url` chỉ chấp nhận `https://`).
  - `GET /api/admin/albums/:id`: Chi tiết album + danh sách ảnh đã sắp xếp.
  - `PATCH /api/admin/albums/:id`: Cập nhật thông tin album / trạng thái / ảnh bìa / link Drive.
  - `DELETE /api/admin/albums/:id`: Xóa album khỏi D1 và dọn toàn bộ `media:<media_key>` thuộc album trong `MEDIA_KV`.
  - `POST /api/admin/albums/:id/photos`: Gắn 1 hoặc nhiều ảnh vừa upload (`/api/media/<id>`) vào album, tự gán làm `cover_url` nếu album chưa có ảnh bìa.
  - `PATCH /api/admin/photos/:id`: Cập nhật `caption`, `alt`, `photographer`, `is_featured_home`, `sort_order`, hoặc `setAsCover: true`.
  - `DELETE /api/admin/photos/:id`: Xóa ảnh khỏi D1 + xóa `media:<media_key>` trên `MEDIA_KV` + tự cập nhật `cover_url` album nếu vừa xóa ảnh bìa.

## 5. Tiêu chí Nghiệm thu (Acceptance Criteria)
1. `python3 build.py --check` đạt 0 lỗi SEO/link; sinh đủ `dist/media/index.html` và `robots.txt` có `Disallow: /media/`.
2. `node --test tests/cms.test.mjs tests/media.test.mjs` đạt 100% PASS (bao gồm RBAC chặn role `media` ở endpoint nhạy cảm, CRUD album/photo, dọn KV khi xóa, chặn XSS `javascript:` ở `drive_url`, SSR HTML injection cho `/` và `/hoat-dong/`).
3. Kiểm tra giao diện thực tế trên trình duyệt (`375px` & `1440px`) cho `/media/`, `/hoat-dong/` và `/`.
