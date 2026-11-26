# Active Plan — HolaRise Full-Stack Hardening, Speed, AI Photo Retouch, UX & SEO (Option A)

**Trạng thái:** Đang triển khai (Đã duyệt Option A — 6 Atomic Phases)

## Quy tắc khóa bắt buộc (`AGENTS.md`)
- Đồng bộ 3 tầng: `Static Build (build.py)` ↔ `Edge SSR (functions/_lib/render.js)` ↔ `D1 Production` (cấm sửa lùi `migrations/0001..0021`; cấm sửa tay `dist/*`).
- AI Photo Retouch: **chỉ xử lý trên ảnh thật & ảnh editorial sẵn có** (kéo ánh sáng/màu phim tự nhiên, khử nhiễu, mở rộng nền nhẹ, Safeguarding làm mờ mặt nếu cần); **tuyệt đối không bịa người/cảnh giả tư liệu sự kiện chưa diễn ra**. Phải duyệt 2–3 ảnh mẫu trước khi chạy hàng loạt.
- Cổng nghiệm thu sau MỌI phase: `python3 build.py --check --strict-copy` + `node --test tests/*.test.mjs` + đối chiếu Tầng 1–2–3 của `AGENTS.md`.

## Atomic Phases
- [x] **Phase 1 — Chốt nền & Xanh 100% test** (Archive plan cũ, xác nhận `38/38` tests pass + `build.py --check --strict-copy` PASS)
- [x] **Phase 2 — Audit & Vá Bảo mật + Nghị định 13/2023** (Account Enumeration, CSRF/Origin, SSR XSS, quyền xem ảnh riêng tư & tâm sự ẩn danh + regression tests)
- [x] **Phase 3 — Tốc độ Zalo In-App WebView (< 60s) & Cloudflare Turnstile** (LCP/INP/CLS, Web API gốc, cache `MEDIA_KV`, Turnstile Managed/Invisible cho form công khai)
- [ ] **Phase 4 — AI Photo Retouch phong cách phim thật** (2–3 ảnh mẫu duyệt tone → retouch bộ ảnh thật `assets/images/` + xuất `.webp` đa kích thước + đồng bộ `data/image-widths.js`)
- [ ] **Phase 5 — Nâng cấp UX Trang Sự kiện & `/admin/`** (Tinh gọn giữ chỗ 15s + Memory Stage + tốc độ duyệt đơn/ảnh trong `/admin/`, giữ nguyên neo `CMS:START/END`)
- [ ] **Phase 6 — Technical SEO VN/EN & Copy 30/70** (JSON-LD, `hreflang` 2 chiều, internal links, sitemap, rà copy VN/EN vượt `--strict-copy`)
