# Active Plan — PWA cho /admin/ & /media/, Tái cấu trúc /media/ kiểu Photos & Dọn #box-visuals

**Trạng thái:** Hoàn tất & đã nghiệm thu (3/3 Atomic Phases)

## Atomic Phases

- [x] **Phase 1 — Đóng gói 2 PWA độc lập cho `/admin/` (`HolaRise CMS`) & `/media/` (`HolaRise Media`)**
  - Sinh `/admin-manifest.webmanifest` & `/media-manifest.webmanifest` trong `build.py` (không SW precache, không xung đột `_headers`).
  - Gắn meta Apple standalone, nút cài đặt `[data-pwa-install]` và `<dialog id="pwa-install-dialog">` cho `/admin/` & `/media/`.
  - Thêm lối tắt mở nhanh `/media/` trên thanh điều hướng mobile của `/admin/`.
- [x] **Phase 2 — Làm lại toàn bộ luồng & giao diện `/media/` kiểu Apple/Google Photos**
  - Topbar 1 dòng gọn + menu tài khoản `<details>`.
  - Danh sách Album sạch (lọc `Có ảnh chờ duyệt`, form tạo Album tối giản + `<details>`).
  - Không gian Album photo-first: nút `+ Tải ảnh` + kéo-thả toàn màn hình, thanh lọc `Chờ duyệt / Đã lên web / Ghim Trang chủ / Tất cả`, lưới ảnh sạch, chọn nhiều + Sticky Batch Bar (Duyệt & nén WebP hàng loạt, Xóa hàng loạt), Lightbox duyệt nhanh `← / →`.
- [x] **Phase 3 — Dọn gọn `#box-visuals` trong `/admin/` + Build & Nghiệm thu**
  - Thẻ ảnh 16:9 trực quan + `Thay ảnh` 1 chạm + `Về mặc định` + `<details>` cho URL/Alt/nhãn.
  - Chạy `python3 build.py --check --strict-copy`, `node --test tests/*.test.mjs`, kiểm chứng giao diện.
