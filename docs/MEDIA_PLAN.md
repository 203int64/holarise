# PLAN: Triển Khai Cổng Ban Hình Ảnh (`/media`) & Thư Viện Album (Option B)

## Atomic Phases

### [x] Phase 1: DB Migration & Phân quyền RBAC `media`
- **Goal:** Mở rộng `admin_users.role` thêm `'media'`, tạo bảng `media_albums` và `media_photos` kèm seed từ `data/activities.json`; cập nhật `requireAdmin` hỗ trợ `allowedRoles` và khóa chặt các API nhạy cảm với role `media`; cập nhật giao diện quản lý thành viên trong `/admin` để tạo/đổi quyền `media`.
- **Target Files:**
  - `migrations/0003_media_portal.sql`
  - `functions/_lib/security.js`
  - `functions/api/admin/users/index.js`, `functions/api/admin/users/[id].js`
  - `functions/api/admin/posts/index.js`, `functions/api/admin/posts/[id].js`
  - `functions/api/admin/events/index.js`, `functions/api/admin/events/[id].js`
  - `functions/api/admin/registrations/index.js`, `[id]/index.js`, `[id]/resync.js`, `export.js`
  - `templates/admin.html`, `assets/js/admin.js`

### [x] Phase 2: Backend API Quản lý Album & Ảnh (D1 + Dọn rác `MEDIA_KV`)
- **Goal:** Cho phép role `media` gọi `/api/admin/media`; bổ sung validation cho Album/Photo/Drive URL; xây dựng đầy đủ CRUD API cho Albums và Photos kèm tự động dọn `MEDIA_KV` khi xóa ảnh hoặc xóa album.
- **Target Files:**
  - `functions/_lib/validation.js`
  - `functions/api/admin/media.js`
  - `functions/api/admin/albums/index.js`
  - `functions/api/admin/albums/[id]/index.js`
  - `functions/api/admin/albums/[id]/photos/index.js`
  - `functions/api/admin/photos/[id].js`

### [x] Phase 3: Cổng nội bộ `/media` cho Ban Hình Ảnh & Tích hợp `build.py`
- **Goal:** Tạo giao diện `/media` (`templates/media.html`, `assets/css/media.css`, `assets/js/media-portal.js`) với đăng nhập chung cookie, CRUD Album, kéo-thả upload hàng loạt tự nén JPEG `<= 1280px` (concurrency = 2, retry từng ảnh), quản lý ảnh (caption, photographer, bìa, ghim Trang chủ, xóa); cập nhật `build.py` xuất `dist/media/index.html`, cập nhật `robots.txt`, và gắn SSR markers cho gallery ở `/` và `/hoat-dong/`.
- **Target Files:**
  - `templates/media.html`
  - `assets/css/media.css`
  - `assets/js/media-portal.js`
  - `build.py`

### [x] Phase 4: SSR Công khai (`/hoat-dong/` & `/`), Album Lightbox & Kiểm chứng (Reality Gate)
- **Goal:** Tạo `functions/hoat-dong/index.js`, cập nhật `functions/index.js` và `functions/_lib/render.js` để SSR Album & ảnh nổi bật từ D1; nâng cấp Lightbox + CSS tại `assets/js/main.js` và `assets/css/styles.css`; viết test suite `tests/media.test.mjs`, chạy `build.py --check`, `node --test`, và kiểm tra UI thực tế trên trình duyệt (`375px` & `1440px`).
- **Target Files:**
  - `functions/_lib/render.js`
  - `functions/hoat-dong/index.js`
  - `functions/index.js`
  - `assets/js/main.js`
  - `assets/css/styles.css`
  - `tests/media.test.mjs`
