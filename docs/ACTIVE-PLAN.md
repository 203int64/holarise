# Active Plan — HolaRise Companion Chat & Scoped Capabilities (`HolaRise Desk`)

**Trạng thái:** Hoàn thành toàn bộ 5/5 Phases (`python3 build.py --check --strict-copy` + `61/61` tests PASS)

## Nguyên tắc khóa (`AGENTS.md`)
- Đồng bộ 3 tầng: `Static Build (build.py)` ↔ `Edge SSR (functions/_lib/render.js)` ↔ `D1 Production` (cấm sửa tay `dist/*`, cấm sửa lùi `migrations/0001..0024`).
- Bảo vệ tốc độ Zalo In-App WebView: trang sự kiện công khai tải lazy JS chat khi người dùng bấm mở; không dựng tường đăng nhập cho khách mới.
- Nghị định 13/2023 & Safeguarding: CTV Check-in chỉ xem Tên + 4 số cuối SĐT + trạng thái ghế; tách tuyệt đối tâm sự ẩn danh khỏi luồng chat định danh; quyền trách nhiệm yêu cầu đồng thuận trước khi kích hoạt.
- Cổng nghiệm thu sau mọi phase: `python3 build.py --check --strict-copy` + `node --test tests/*.test.mjs`.

## Atomic Phases
- [x] **Phase 1 — Schema `0025` & Core Capability/Chat Engine** (`migrations/0025_companion_chat_and_capabilities.sql`, `functions/_lib/capabilities.js`, `functions/_lib/chat.js`)
- [x] **Phase 2 — API Chat, Trao quyền & Check-in che PII** (`functions/api/chat/*`, `functions/api/member/checkin.js`, email fallback chống spam, Turnstile/rate-limit cho khách)
- [x] **Phase 3 — Trang Sự kiện SSR "Người đón bạn" & Drawer Chat Lazy (VN/EN)** (`templates/event_invitation.html`, `templates/en_event_invitation.html`, `build.py`, `functions/_lib/render.js`, `functions/su-kien/[slug].js`, `functions/en/events/[slug].js`, `assets/js/event-chat.js`)
- [x] **Phase 4 — Workspace `/tham-gia/` & Hộp thoại `/admin/`** (`templates/join.html`, `templates/en_join.html`, `assets/js/member.js`, `assets/js/member-desk.js`, `templates/admin.html`, `assets/js/admin.js`, `assets/js/admin-desk.js`, `assets/css/*`)
- [x] **Phase 5 — Kiểm thử End-to-End & Nghiệm thu 3 Cổng** (`tests/companion-chat-capabilities.test.mjs`, `python3 build.py --check --strict-copy`, `node --test tests/*.test.mjs`)
