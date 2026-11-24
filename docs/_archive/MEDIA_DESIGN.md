# DESIGN: Cổng Ban Hình Ảnh (`/media`) & Thư Viện Album Công Khai — HolaRise

## 1. Tuân thủ Design System hiện có (Luật số 0)
- Giữ trọn bộ token màu sắc, typography và bo góc của HolaRise (`assets/css/styles.css` & `assets/css/admin.css`):
  - Bề mặt: nền giấy ấm `--bg: #FAFAF7`, thẻ trắng `--surface: #FFFFFF`, đường viền tinh tế `--line`.
  - Màu thương hiệu: `--forest` / `--forest-deep` (xanh lá Hòa Lạc), `--amber` (vàng bình minh cho badge nổi bật / ghim Trang chủ).
  - Font chữ: đồng bộ với `admin.html` và `base.html`, không thêm thư viện UI/CSS ngoài.
- Không AI slop: không neon, không gradient rối, không icon-box trang trí thừa.

## 2. Giao diện Cổng nội bộ `/media` (`templates/media.html`)
- **Màn hình đăng nhập:** Tái sử dụng layout gọn gàng của `/admin`, hiển thị rõ nhãn *"Cổng Ban Hình Ảnh · HolaRise"*, hỗ trợ tự nhận diện phiên đăng nhập sẵn có.
- **Thanh đầu trang (Topbar):**
  - Logo + tên cổng **Ban Hình Ảnh**, hiển thị tên & badge quyền người dùng.
  - Nếu là `super_admin` hoặc `editor`: có link quay nhanh sang `/admin/`.
  - Nút **Xem trang Hoạt động** (`/hoat-dong/#thu-vien-anh`) và nút **Đăng xuất**.
- **Bố cục 2 chế độ (Responsive `375px` → `1440px`):**
  1. **Danh sách Album:** Lưới thẻ Album (ảnh bìa 16:10, tiêu đề, ngày/địa điểm, bộ lọc 4 chữ, số ảnh, trạng thái `Công khai`/`Nháp`, badge `Có link Drive`), nút **+ Tạo Album mới**.
  2. **Không gian Chi tiết Album (Workspace):**
     - Thanh tiêu đề Album (sửa thông tin, đổi trạng thái Công khai/Nháp, dán link Google Drive, xóa Album).
     - **Vùng kéo-thả Upload hàng loạt (Dropzone):** Chọn hoặc kéo nhiều ảnh (tối đa 30 ảnh/lần), tự nén JPEG `<= 1280px` trước khi đẩy lên; hiển thị hàng đợi tiến độ từng file (`Đang nén...` → `Đang tải lên...` → `Hoàn tất` / `Lỗi · Thử lại`).
     - **Lưới ảnh trong Album:** Mỗi thẻ ảnh có xem trước tỉ lệ chuẩn, ô sửa nhanh chú thích & nhiếp ảnh gia, nút **Đặt làm bìa**, công tắc **Ghim Trang chủ**, nút **Xóa**.
- **Đầy đủ 4 trạng thái UI:** Loading Skeleton, Empty State (có CTA tạo Album / chọn ảnh), Error Banner (nút Thử lại), Loaded.

## 3. Giao diện Công khai tại `/hoat-dong/` & Trang chủ `/`
- **Tại `/hoat-dong/` (`#thu-vien-anh`):**
  - Thanh lọc nhanh 4 chữ (`Tất cả`, `Sạch`, `Biết ơn`, `Tử tế`, `Sẻ chia`) cho các Album sự kiện.
  - Thẻ **Album Card**: ảnh bìa 4:3, badge số lượng ảnh (vd `12 ảnh`), nhãn giá trị, tiêu đề Album, ngày & địa điểm, 2 hành động rõ ràng:
    - Bấm thẻ hoặc nút **Xem ảnh** → mở **Album Lightbox** duyệt toàn bộ ảnh trong Album.
    - Nếu Album có `drive_url`: hiện nút phụ **Ảnh gốc (Drive) ↗** mở tab mới (`rel="noopener noreferrer"`).
- **Album Lightbox (`assets/js/main.js`):**
  - Hỗ trợ xem chuỗi ảnh của 1 Album: nút Trước/Sau, phím `←` / `→` / `Esc`, đếm `03 / 12`, hiển thị chú thích + nhiếp ảnh gia, nút **Tải ảnh** và link **Mở toàn bộ ảnh gốc (Drive)** nếu có.
- **Tại Trang chủ `/` (`Khoảnh khắc tuổi trẻ tại Hòa Lạc`):**
  - Giữ nguyên cấu trúc dải ảnh ngang `horizontal-section`, chỉ thay nguồn ảnh động từ D1 (các ảnh `is_featured_home = 1`) và cập nhật chính xác tổng số ảnh `01 / NN`.
