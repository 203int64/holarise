# Active Plan — HolaRise Manager Pro (Invites, Review Loop, QR Door Check-in & Transparency Ledger)

**Trạng thái:** Hoàn thành 4/4 Phases

## Nguyên tắc khóa (`AGENTS.md`)
- Đồng bộ 3 tầng: `Static Build (build.py)` ↔ `Edge SSR (functions/_lib/render.js)` ↔ `D1 Production` (cấm sửa tay `dist/*`, cấm sửa lùi `migrations/0001..0026`).
- Zero-friction onboarding: Link mời 48h dùng 1 lần (SHA-256 hash), bắt buộc xác nhận Cam kết bảo mật Nghị định 13/2023 & Safeguarding trước khi kích hoạt.
- Chuẩn NGO Minh bạch & Thực chứng: Sổ Hiện vật/Nguồn lực gắn sự kiện + Hồ sơ Phụng sự CTV tự cộng từ dữ liệu thật + Quét QR Thẻ Thành Viên bằng chuẩn gốc trình duyệt (`BarcodeDetector`).

## Atomic Phases
- [x] **Phase 1 — Schema `0027`, Invite Engine & Notification Helper** (`migrations/0027_manager_pro_invites_review_resources.sql`, `functions/_lib/manager-notify.js`, `functions/_lib/rbac.js`, `functions/_lib/validation.js`, `functions/_lib/render.js`)
- [x] **Phase 2 — Invites, Editorial Review Notes, QR Door Check-in, Event Resource Ledger & CTV Service Record APIs** (`functions/api/admin/invites/*`, `functions/api/auth/invite.js`, `functions/api/admin/posts/*`, `functions/api/admin/tasks/index.js`, `functions/api/admin/events/[id]/resources.js`, `functions/api/member/checkin.js`, `functions/api/member/tasks.js`)
- [x] **Phase 3 — Giao diện `HolaRise Manager Pro` + QR Scanner & Hồ sơ Phụng sự CTV + Static Sync** (`templates/admin.html`, `templates/join.html`, `templates/en_join.html`, `assets/js/admin-manager.js`, `assets/js/admin.js`, `assets/js/member-desk.js`)
- [x] **Phase 4 — Kiểm thử End-to-End, Nghiệm thu 3 Cổng & Push Production** (`tests/manager-pro-workflows.test.mjs`, `python3 build.py --check --strict-copy`, `node --test tests/*.test.mjs`)
