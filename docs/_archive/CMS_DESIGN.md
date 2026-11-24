# DESIGN: Trang Quản Trị `/admin` — HolaRise CMS

## 1. Tuân thủ Design System Hiện Hữu (Luật số 0)
- Tái sử dụng đúng hệ tokens của `assets/css/styles.css` (*Bình minh Hòa Lạc* / Editorial Gallery Light):
  - **Surfaces:** `#FFFFFF` (`--bg`), `#F6F7F6` (`--surface`), `#EEF1EF` (`--surface-hover`)
  - **Ink:** `#0E1512` (`--ink`), `#4C5853` (`--ink-secondary`), `#76837D` (`--ink-muted`)
  - **Borders:** `1px solid #E4E8E6` (`--line`), `#CDD4D0` (`--line-strong`)
  - **Accent chính:** Emerald `#0B6E4F` (`--accent`), Hover `#08553D`, Soft `#EDF6F2`
  - **Semantic badges:**
    - `Mới`: `#EDF6F2` nền / `#0B6E4F` chữ
    - `Đã liên hệ`: `#FEF5E7` nền / `#9A5B13` chữ
    - `Đã tham gia`: `#EAF2FF` nền / `#1D4ED8` chữ
    - `Đã hủy` / `Lỗi đồng bộ`: `#FEF2F2` nền / `#B91C1C` chữ
  - **Typography:** `Inter` (`400`, `500`, `600`), tight tracking `-0.02em` cho heading, `font-variant-numeric: tabular-nums` cho ngày tháng, số đơn, thống kê.
  - **Spacing:** Thang chuẩn `4 / 8 / 12 / 16 / 20 / 24 / 32px`. Không card-in-card lồng nhau rườm rà; tách khối bằng hairline `1px` và khoảng trắng rõ ràng.

## 2. Kiến trúc Bố cục Mobile-First & Desktop
- **Desktop (`>= 960px`):** Sidebar mảnh bên trái (`232px`, dính cố định) chứa logo `HolaRise`, 4 mục điều hướng chính (kèm badge số đơn mới), thông tin tài khoản & nút đăng xuất. Vùng làm việc chính rộng tối đa `1120px`, thanh tiêu đề cố định nút hành động chính (Primary CTA) dễ thấy trong 3 giây.
- **Mobile (`375px` – `959px`):**
  - Top bar tối giản: Logo `HR` + tiêu đề tab hiện tại + nút mở nhanh (Tạo mới / Đăng xuất).
  - Bottom Navigation Bar cố định 4 mục chạm lớn (`>= 48px`, `padding-bottom: env(safe-area-inset-bottom)`): **Đơn đăng ký**, **Sự kiện**, **Bài viết**, **Cài đặt**.
  - Bảng đơn đăng ký tự chuyển sang **danh sách thẻ hành động gọn** (không tràn ngang `overflow-x`), kèm nút chạm gọi điện / mở Zalo / đổi trạng thái ngay 1 tay.

## 3. Tương tác & 4 Trạng thái Bắt buộc
- **Skeleton Loading:** Hiện khung mờ đúng tỉ lệ dòng/thẻ trong khi tải dữ liệu; cấm spinner xoay trơ trọi.
- **Empty State:** Minh họa icon SVG mảnh + mô tả rõ + 1 nút CTA trực tiếp (ví dụ: *"Chưa có sự kiện nào — Tạo sự kiện đầu tiên"*).
- **Error State:** Banner lỗi rõ nguyên nhân + nút *Thử lại*.
- **Editor Modal / Drawer (`<dialog closedby="any">`):** Dùng thẻ `<dialog>` native kèm fallback Safari cho light-dismiss và nút đóng rõ ràng; preview ảnh bìa ngay sau khi nén JPEG từ thiết bị, hiển thị dung lượng sau nén (VD: `142 KB · 1200×800`).
- **Accessibility & Clean Craft:** Không lạm dụng emoji làm icon hệ thống (dùng bộ SVG stroke `1.75px` đồng nhất), vùng chạm tối thiểu `44×44px`, `focus-visible` ring xanh `#0B6E4F`, nút có trạng thái `disabled` + nhãn tiến trình chống bấm đúp, và `<meta name="robots" content="noindex, nofollow">`.
