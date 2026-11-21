# Website Cộng Đồng Thanh Niên Lạc Xanh – Hòa Lạc

Website đa trang tĩnh chuẩn SEO (HTML5 + CSS hiện đại + JavaScript thuần + trình build Python 3 không cần cài Node.js), thiết kế theo phong cách **"Bình minh Hòa Lạc"** kết hợp độ uy tín chuẩn tổ chức cộng đồng/NGO và sức trẻ gần gũi.

---

## 1. Cách chạy & xem trước trên máy (macOS)

Chỉ cần Python 3 có sẵn trên máy:

```bash
# 1. Build toàn bộ website ra thư mục dist/ kèm kiểm định SEO & liên kết
python3 build.py --check

# 2. Mở server xem trước tại http://localhost:8080
python3 -m http.server 8080 --directory dist
```

---

## 2. Cách cập nhật tên CLB, logo, ảnh sự kiện thật & nội dung

Toàn bộ nội dung website nằm gọn trong 4 tệp JSON của thư mục `data/`:

- **`data/site.json`**: Đổi tên CLB (`shortName`, `fullName`), slogan, domain (`siteUrl`), email/hotline/Fanpage/Zalo, số liệu tác động (`impactMetrics`), UN SDGs, FAQ và đường dẫn nhận form (`formEndpoint`).
- **`data/activities.json`**: Cập nhật 3 trụ cột hoạt động, danh sách chiến dịch và thư viện ảnh (`gallery`).
- **`data/workshops.json`**: Thêm/sửa lịch Workshop & chiến dịch sắp tới.
- **`data/news.json`**: Thêm bài viết nhật ký sự kiện mới — mỗi bài sẽ tự động sinh 1 trang chuẩn SEO tại `/tin-tuc/<slug>/` và tự động cập nhật vào `sitemap.xml`.

### Thay ảnh thật của CLB
1. Chép ảnh thật của CLB vào thư mục `assets/images/events/` (ví dụ `su-kien-ho-tan-xa.jpg`).
2. Trỏ đường dẫn trong file JSON tương ứng thành `"/assets/images/events/su-kien-ho-tan-xa.jpg"`.
3. Chạy lại `python3 build.py --check`.

### Kết nối Form đăng ký về Email hoặc Google Sheets
- **Cách nhanh nhất (miễn phí, 2 phút):** Tạo form miễn phí tại [Formspree](https://formspree.io/), lấy đường dẫn endpoint dạng `https://formspree.io/f/xxxxxxx` rồi dán vào trường `"formEndpoint"` trong `data/site.json`, sau đó chạy lại `python3 build.py`.
- Hoặc dùng **Google Apps Script Web App** ghi thẳng dữ liệu đăng ký vào Google Sheets rồi dán URL Web App vào `"formEndpoint"`.

---

## 3. Hướng dẫn đưa lên mạng miễn phí & lên Top tìm kiếm Google

### Deploy miễn phí với Cloudflare Pages (khuyên dùng)
1. Đẩy thư mục dự án này lên một kho GitHub.
2. Đăng nhập [Cloudflare Pages](https://pages.cloudflare.com/) → **Create a project** → kết nối repo GitHub.
3. Cấu hình build:
   - **Build command:** `python3 build.py --check`
   - **Build output directory:** `dist`
4. Gắn tên miền riêng (nếu có) — Cloudflare tự cấp chứng chỉ bảo mật HTTPS miễn phí và tốc độ tải cực nhanh tại Việt Nam.

### Giúp người dùng tìm Google thấy ngay và uy tín
1. Cập nhật đúng tên miền thật vào trường `"siteUrl"` trong `data/site.json` rồi build lại.
2. Đăng ký tên miền tại [Google Search Console](https://search.google.com/search-console).
3. Gửi đường dẫn sơ đồ trang `https://<ten-mien-cua-ban>/sitemap.xml` để Google lập chỉ mục tất cả các trang (Trang chủ, Giới thiệu, Hoạt động, Workshop, Tin tức, Tham gia) cùng đầy đủ dữ liệu có cấu trúc NGO & Event.
