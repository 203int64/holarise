# Active Plan — HolaRise Full-Stack Hardening, Speed, AI Photo Retouch, UX & SEO (Option A)

**Trạng thái:** Hoàn thành toàn bộ 6/6 Phases (`python3 build.py --check --strict-copy` + `node --test tests/*.test.mjs` PASS)

## Quy tắc khóa bắt buộc (`AGENTS.md`)
- Đồng bộ 3 tầng: `Static Build (build.py)` ↔ `Edge SSR (functions/_lib/render.js)` ↔ `D1 Production` (cấm sửa lùi `migrations/0001..0021`; cấm sửa tay `dist/*`).
- AI Photo Retouch: **chỉ xử lý trên ảnh thật & ảnh editorial sẵn có** (kéo ánh sáng/màu phim tự nhiên, khử nhiễu, mở rộng nền nhẹ, Safeguarding làm mờ mặt nếu cần); **tuyệt đối không bịa người/cảnh giả tư liệu sự kiện chưa diễn ra**. Phải duyệt 2–3 ảnh mẫu trước khi chạy hàng loạt.
- Cổng nghiệm thu sau MỌI phase: `python3 build.py --check --strict-copy` + `node --test tests/*.test.mjs` + đối chiếu Tầng 1–2–3 của `AGENTS.md`.

## Atomic Phases
- [x] **Phase 1 — Chốt nền & Xanh 100% test** (Archive plan cũ, xác nhận `38/38` tests pass + `build.py --check --strict-copy` PASS)
- [x] **Phase 2 — Audit & Vá Bảo mật + Nghị định 13/2023** (Account Enumeration, CSRF/Origin, SSR XSS, quyền xem ảnh riêng tư & tâm sự ẩn danh + regression tests)
- [x] **Phase 3 — Tốc độ Zalo In-App WebView (< 60s) & Cloudflare Turnstile** (LCP/INP/CLS, Web API gốc, cache `MEDIA_KV`, Turnstile Managed/Invisible cho form công khai)
- [x] **Phase 4 — AI Photo Retouch phong cách phim thật** (3 ảnh mẫu duyệt tone + xây studio 1-click `✦ AI 3 mẫu` ngay trong `/media/` lightbox qua Gemini Interactions API, bảo toàn bản gốc Drive)
- [x] **Phase 5 — Nâng cấp UX Trang Sự kiện & `/admin/` / `/media/`** (1-click 3 mẫu AI + đối chiếu Before/After + phím tắt `←`/`→`/`A`/`R` duyệt nhanh ảnh)
- [x] **Phase 6 — Technical SEO VN/EN & Copy 30/70** (Bổ sung `xmlns:xhtml` + `hreflang` 2 chiều vào static & SSR `sitemap.xml`, đưa sự kiện quá khứ Memory Stage vào sitemap, rà copy vượt `--strict-copy`)
