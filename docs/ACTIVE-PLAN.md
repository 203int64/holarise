# Active Plan — Can Thiệp Sâu Thành Viên, Cấp Quyền Xem Media & Trung Tâm Điều Hành Sự Kiện

**Trạng thái:** Đang triển khai (Đã duyệt Option B)

## Mục tiêu & Quy tắc khóa
- **Hồ sơ Thành viên 360°:** Xem lịch sử tham dự, lưu bút, ảnh đóng góp, phiên/passkey; đăng xuất cưỡng bức toàn bộ thiết bị; gán/chấm công sự kiện thủ công; cấp/thu hồi quyền xem Media (từng Album, toàn bộ Album riêng tư, và quyền xem cổng `/media/` ở chế độ chỉ-xem `media_viewer`).
- **Phân quyền xem Media thực ở Edge:** `media_albums.visibility` (`public` | `members_only` | `attendees_only` | `private`) + bảng `member_album_grants`. Ảnh thuộc Album `public` giữ nguyên Edge Cache `immutable`; ảnh thuộc Album giới hạn kiểm tra quyền thực tại `/api/media/drive/:id`, `/api/media/:id`, `/hanh-trinh/`, `/su-kien/<slug>/`, và `/api/member/albums`.
- **Trung tâm điều hành Sự kiện (Event Command Center):** Bấm `Điều hành` trên 1 sự kiện để kiểm soát trọn bộ: Khách đăng ký + Check-in tại cửa + Thêm khách thủ công + Xuất CSV riêng sự kiện, Vòng đời (`stage_override`: `auto`/`invite`/`memory`) & Khóa giữ chỗ (`rsvp_closed`), Kho ảnh & Quyền xem Album sự kiện, và Hộp thư Góp ý sau sự kiện (`event_feedbacks`).

## Atomic Phases
- [x] **Phase 1 — Migration `0020`, `media-access.js`, Khóa Media Proxy/SSR, `rsvp_closed`/`stage_override` & `/media/` Viewer Mode**
- [ ] **Phase 2 — API Hồ sơ Thành viên 360° (`members/[id]` + `actions.js`), Event Command Center (`events/[id]/command.js`) & Góp ý sự kiện**
- [ ] **Phase 3 — Giao diện Hồ sơ Thành viên 360°, Trung tâm Điều hành Sự kiện & Góp ý sự kiện trong `/admin/`**
- [ ] **Phase 4 — Tests, Rebuild `dist/` (`python3 build.py --check`) & Reality Verification Gate**
