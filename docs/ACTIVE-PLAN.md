# Active Plan — Phân tích, Chân dung Người xem, Tốc độ & SEO API Hub (`/admin/`)

**Trạng thái:** Hoàn thành 4/4 Phases

## Nguyên tắc khóa (`AGENTS.md`)
- Đồng bộ 3 tầng: `Static Build (build.py)` ↔ `Edge SSR / Middleware (functions/_middleware.js)` ↔ `D1 Production (migrations/0029_analytics_seo_hub.sql)`.
- Quyền riêng tư chuẩn Nghị định 13/2023/NĐ-CP: không đặt tracking cookie, không lưu địa chỉ IP thô, ẩn hoàn toàn API secrets sau khi lưu.
- Phân quyền fail-closed: toàn bộ tab `Phân tích & SEO` và nhóm API `/api/admin/analytics/*` khóa cứng `superAdminOnly: true` (chỉ duy nhất `203int64`).

## Atomic Phases
- [x] **Phase 1 — Schema `0029`, Telemetry Collector & Edge SEO Injection** (`migrations/0029_analytics_seo_hub.sql`, `functions/_lib/analytics.js`, `functions/api/telemetry.js`, `functions/_middleware.js`)
- [x] **Phase 2 — Super-Admin Analytics, Check-in Funnel, PageSpeed v5, IndexNow 1 chạm & GSC JWT APIs** (`functions/api/admin/analytics/index.js`, `config.js`, `pagespeed.js`, `indexnow.js`, `gsc.js`)
- [x] **Phase 3 — Client Tracker `< 3KB` & Giao diện 1 Tab `Phân tích & SEO`** (`assets/js/telemetry.js`, `templates/base.html`, `templates/base_en.html`, `templates/admin.html`, `assets/js/admin-analytics.js`, `assets/js/admin.js`, `assets/js/admin-manager.js`, `assets/css/admin.css`)
- [x] **Phase 4 — Kiểm thử End-to-End, Đồng bộ Static Build & Nghiệm thu 3 Cổng** (`tests/analytics-seo-hub.test.mjs`, `python3 build.py --check --strict-copy`, `node --test tests/*.test.mjs`)
