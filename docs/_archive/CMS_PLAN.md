# PLAN: Triển Khai HolaRise CMS & Tiếp Nhận Đăng Ký (Option B)

## Atomic Phases

### [x] Phase 1: Hạ tầng Cloudflare (D1 + KV) & Schema + Seed Dữ liệu
- **Goal:** Tạo Cloudflare D1 `holarise-db` và KV `holarise-media`, bind `DB` và `MEDIA_KV` vào Cloudflare Pages project `holarise`; viết migration SQL chuẩn + script sinh SQL seed từ `data/news.json` và `data/workshops.json`; chạy migration & seed trực tiếp lên D1.
- **Target Files:**
  - `migrations/0001_init.sql`
  - `scripts/generate_seed.py`
  - `wrangler.toml`

### [x] Phase 2: Backend API Bảo mật, Auth, CRUD, Media & Đăng ký (`functions/`)
- **Goal:** Xây dựng toàn bộ helper bảo mật (`crypto` PBKDF2, session cookie, CSRF Origin guard, validation, slug tiếng Việt, XSS-safe markdown/paragraphs, CSV BOM, Google Apps Script sync) và tất cả endpoint `/api/auth/*`, `/api/admin/*`, `/api/registrations`, `/api/media/[id]`. Viết và chạy bộ Node test suite kiểm chứng toàn bộ logic + edge cases.
- **Target Files:**
  - `functions/_lib/db.js`
  - `functions/_lib/security.js`
  - `functions/_lib/validation.js`
  - `functions/_lib/render.js`
  - `functions/_lib/gas.js`
  - `functions/api/auth/status.js`, `bootstrap.js`, `login.js`, `logout.js`, `change-password.js`
  - `functions/api/registrations.js`
  - `functions/api/media/[id].js`
  - `functions/api/admin/media.js`
  - `functions/api/admin/posts/index.js`, `[id].js`
  - `functions/api/admin/events/index.js`, `[id].js`
  - `functions/api/admin/registrations/index.js`, `[id].js`, `export.js`
  - `functions/api/admin/users/index.js`, `[id].js`
  - `functions/api/admin/settings/index.js`, `test-webhook.js`
  - `tests/cms.test.mjs`

### [x] Phase 3: SSR Tức thì cho Bài viết, Sự kiện & Sitemap (Giữ 100% SEO & OG)
- **Goal:** Bổ sung HTML injection markers không phá vỡ giao diện trong `build.py` và tạo template shell `dist/_templates/news-detail-shell.tpl` (được bảo vệ bởi middleware không cho truy cập trực tiếp); thêm Cloudflare Pages Functions SSR cho `/`, `/workshop/`, `/tin-tuc/`, `/tin-tuc/[slug]`, `/sitemap.xml` và chặn `/_templates/*`.
- **Target Files:**
  - `build.py`
  - `functions/_middleware.js`
  - `functions/index.js`
  - `functions/workshop/index.js`
  - `functions/tin-tuc/index.js`
  - `functions/tin-tuc/[slug].js`
  - `functions/sitemap.xml.js`

### [x] Phase 4: Nâng cấp Form Đăng ký Công khai & Google Apps Script Bridge
- **Goal:** Cập nhật form tại `templates/join.html` và modal đăng ký nhanh trong `templates/base.html` để có ô `Email nhận xác nhận` riêng + trường honeypot ẩn; cập nhật `assets/js/main.js` gọi `/api/registrations` (fallback nếu chạy file tĩnh cục bộ); viết sẵn mã `docs/google-apps-script.gs` + hướng dẫn setup 2 phút.
- **Target Files:**
  - `templates/join.html`
  - `templates/base.html`
  - `assets/js/main.js`
  - `data/site.json`
  - `docs/google-apps-script.gs`

### [x] Phase 5: Giao diện Quản trị `/admin` (Mobile-First, Design System HolaRise)
- **Goal:** Xây dựng `/admin` (`templates/admin.html`, `assets/css/admin.css`, `assets/js/admin.js`) với đầy đủ 4 tab (Đơn đăng ký, Sự kiện, Bài viết, Đội ngũ & Cài đặt), nén ảnh JPEG client-side `<canvas>`, 4 trạng thái (Skeleton / Empty / Error / Loaded), modal `<dialog closedby="any">` chuẩn accessibility, tích hợp vào `build.py` + `robots.txt` (`Disallow: /admin/`).
- **Target Files:**
  - `templates/admin.html`
  - `assets/css/admin.css`
  - `assets/js/admin.js`
  - `build.py`

### [x] Phase 6: Triển khai Production & Kiểm chứng Thực tế (Reality Gate)
- **Goal:** Build `python3 build.py --check`, chạy full `node --test`, triển khai lên Cloudflare Pages `holarise`, và chạy kiểm thử thực tế End-to-End bằng cả API + `browser` subagent trên `375px` & `1440px` (rồi dọn sạch bản ghi test).
