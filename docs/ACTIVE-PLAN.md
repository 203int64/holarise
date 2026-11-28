# Active Plan — HolaRise Manager (RBAC, Timeline, Nhiệm vụ & Audit Log)

**Trạng thái:** Đang triển khai (Phương án A đã duyệt — nâng cấp `/admin/` thành `HolaRise Manager` + alias `/manager/`)

## Nguyên tắc khóa (`AGENTS.md`)
- Đồng bộ 3 tầng: `Static Build (build.py)` ↔ `Edge SSR (functions/_lib/render.js)` ↔ `D1 Production` (cấm sửa tay `dist/*`, cấm sửa lùi `migrations/0001..0025`).
- Bảo vệ bất biến `super_admin` duy nhất (`203int64`) và nguyên tắc fail-closed: mọi endpoint không khai báo `permission` rõ ràng mặc định chỉ mở cho `super_admin`.
- Nghị định 13/2023 & Safeguarding: tách biệt xuất CSV SĐT gốc (chỉ `super_admin`), áp dụng Maker–Checker cho bài viết (`pending_review` → `published`) và ảnh (`pending` → `approved` kèm checklist Safeguarding), ghi `admin_audit_logs` cho mọi thao tác trọng yếu.
- Cổng nghiệm thu sau mọi phase: `python3 build.py --check --strict-copy` + `node --test tests/*.test.mjs`.

## Atomic Phases
- [ ] **Phase 1 — Schema `0026` & Core RBAC / Tasks / Audit Engine** (`migrations/0026_holarise_manager_rbac_tasks_audit.sql`, `functions/_lib/rbac.js`, `functions/_lib/security.js`, `functions/_lib/validation.js`, `functions/_lib/capabilities.js`)
- [ ] **Phase 2 — API RBAC Guards, Tasks CRUD, 1-Click Event Playbook, Unified Timeline, Audit Log & CTV Desk Bridge** (`functions/api/admin/*`, `functions/api/auth/*`, `functions/api/member/tasks.js`, `functions/_middleware.js`)
- [ ] **Phase 3 — Giao diện `HolaRise Manager` (`/admin/` + `/manager/`), `/media/` & `/tham-gia/` + Static Sync** (`templates/admin.html`, `templates/media.html`, `templates/join.html`, `assets/js/admin-manager.js`, `assets/js/admin.js`, `assets/js/media-portal.js`, `assets/js/member-desk.js`, `assets/css/*`, `build.py`)
- [ ] **Phase 4 — Kiểm thử Ma trận Quyền, Playbook, Timeline & Nghiệm thu 3 Cổng** (`tests/holarise-manager.test.mjs`, `python3 build.py --check --strict-copy`, `node --test tests/*.test.mjs`)
