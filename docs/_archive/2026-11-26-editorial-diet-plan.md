# Active Plan — Editorial Diet Toàn Site (Homepage + Toàn bộ Trang Công Khai)

**Trạng thái:** Hoàn tất & đã nghiệm thu (Build + 28/28 Tests PASS) — Đã lưu trữ ngày 26/11/2026

## Kết quả định lượng (phần `<main>`)
- Trang chủ (`/`): `1.456 → 436` từ (-70%); Footer toàn site: `165 → 88` từ (-47%).
- Về HolaRise (`/gioi-thieu/`): `1.203 → 849` từ (-29%, bỏ 15 khung box chồng nhau, chuyển sang hairline columns + numbered index list + compact SDGs).
- Lịch hoạt động (`/lich-hoat-dong/`): `391 → 226` từ (-42%, đồng bộ `.event-card--editorial`).
- Hành trình (`/hanh-trinh/`): `579 → 491` từ (-15%, đồng bộ `.editorial-card--clean`).
- Hồ sơ tiếng Anh (`/en/`): `471 → 313` từ (-34%).

## Atomic Phases
- [x] **Phase 1 — Trang chủ & Footer (Editorial Diet gốc)**
- [x] **Phase 2 — Tinh gọn `/gioi-thieu/` & `/en/`**
- [x] **Phase 3 — Đồng bộ thẻ Editorial cho `/lich-hoat-dong/`, `/hanh-trinh/`, Static ↔ Edge SSR & Nghiệm thu**
