# SEO Roast Roadmap: holarise.org (2026-11-23)

**Verdict:** `site:holarise.org` hiện có **0 trang trên Google** — không phải vì `robots.txt` chặn bot, mà vì domain mới chưa khai báo Google Search Console/Bing, chưa có tín hiệu entity/backlink ngoài web, và đang có trùng lặp domain (`www` + `pages.dev`) kèm lệch dữ liệu `llms.txt` / D1 live.

## Bảng ưu tiên theo tác động tìm kiếm

| # | Tier | Vấn đề | Tác động tìm kiếm | Cách xử lý | Chủ trách nhiệm | Trạng thái |
|---|---|---|---|---|---|---|
| 1 | FATAL | `www.holarise.org` trả HTTP 200 thay vì 301 về `holarise.org` | Chia đôi tín hiệu canonical giữa 2 host | Thêm 301 redirect trong `functions/_middleware.js` | Agent | Đã sửa trong repo (chờ deploy) |
| 2 | FATAL | `holarise.pages.dev` trả HTTP 200 không có `noindex` | Domain phụ của Cloudflare cạnh tranh trực tiếp với `holarise.org` | Gắn `X-Robots-Tag: noindex, nofollow` cho mọi host `*.pages.dev` trong `functions/_middleware.js` | Agent | Đã sửa trong repo (chờ deploy) |
| 3 | FATAL | Domain `holarise.org` chưa xác minh & nộp sitemap lên Google Search Console / Bing | `site:holarise.org` = 0 kết quả; Googlebot không biết domain mới để ưu tiên crawl | Xác minh DNS TXT trên Cloudflare → nộp `https://holarise.org/sitemap.xml` → Request Indexing 6 URL chính | Chủ dự án | Làm ngay sau khi deploy (5 phút) |
| 4 | FATAL | Production D1 chưa đồng bộ bài mới (`/tin-tuc/tinh-yeu-thuong-cua-me-trong-thoi-dai-ai-holaheart/` trả 404 live) | Sitemap live liệt kê bài cũ/mẫu, bài thật mới nhất bị 404 | Deploy code mới + chạy migration `migrations/0004_holaheart_first_event.sql` lên D1 production | Chủ dự án | Làm khi deploy |
| 5 | REVENUE | `dist/llms.txt` chứa số liệu cũ/mâu thuẫn (`18+ chiến dịch`, `100% miễn phí`) và `WebSite` JSON-LD chưa ưu tiên Site Name ngắn `HolaRise` | AI Search (ChatGPT, Perplexity, Gemini) trích sai sự thật; Google không hiển thị Site Name gọn `HolaRise` | Đồng bộ `generate_llms_txt()` từ `data/site.json`, nâng cấp `WebSite` schema (`name: "HolaRise"` + `alternateName`), rebuild `dist/` | Agent | Đã sửa trong repo |
| 6 | REVENUE | Chưa có IndexNow để đẩy URL tức thì sang Bing / ChatGPT / Copilot / DuckDuckGo | Bing & AI Search phải chờ tự crawl thụ động nhiều tuần | Thêm `seo.indexNowKey` vào `build.py` + script `scripts/ping_indexnow.py` | Agent + Chủ dự án | Sẵn sàng (chỉ cần điền key & ping sau deploy) |
| 7 | COMPOUNDING | 0 backlink sạch & 0 hồ sơ entity (`sameAs` trống) — search `"HolaRise" Hòa Lạc` Google trả nhầm sang BĐS | Google không xác thực được thực thể "HolaRise" là cộng đồng thanh niên tại Hòa Lạc | Tạo Google Business Profile tại Tân Xã/Hòa Lạc + Facebook Page/Instagram/GitHub Org trỏ về `https://holarise.org/` + xin link từ trang đối tác (MusicSpace, CLB ĐH FPT, ĐHQGHN) | Chủ dự án | Tuần 1–2 |
| 8 | COMPOUNDING | Chưa có nội dung nhắm từ khóa tìm kiếm địa phương có volume thực | Chỉ ăn được brand query `HolaRise`, chưa có traffic tự nhiên từ sinh viên Hòa Lạc | Đăng đều bài tổng kết thật sau mỗi buổi (HolaGreen / HolaHeart / HolaConnect) gắn từ khóa: *"tình nguyện Hòa Lạc"*, *"CLB sinh viên Hòa Lạc"*, *"workshop cuối tuần Hòa Lạc"*, *"làm sạch hồ Tân Xã"* | Chủ dự án | Hàng tháng |

---

## Checklist 5 phút để `holarise.org` xuất hiện trên Google & AI Search (Làm ngay sau khi deploy)

### Bước 1: Deploy code + D1 migration lên live
```bash
# Áp dụng dữ liệu sự kiện HolaHeart thật lên D1 production
npx wrangler d1 migrations apply holarise-db --remote

# Deploy (hoặc git push lên main nếu đã nối Cloudflare Pages CI)
```

### Bước 2: Xác minh Google Search Console (nhanh nhất bằng Cloudflare DNS)
1. Mở [Google Search Console](https://search.google.com/search-console) → **Add property** → chọn **Domain** → nhập `holarise.org`.
2. Google hiện mã `TXT` (hoặc cho phép bấm **Verify with Cloudflare** tự động).
   - Nếu thích dùng thẻ `<meta>` thay vì DNS: dán mã vào `data/site.json` → `seo.googleSiteVerification`, chạy `python3 build.py` rồi deploy.
3. Vào mục **Sitemaps** → nhập `sitemap.xml` → bấm **Submit**.
4. Vào ô **URL Inspection** ở trên cùng, dán lần lượt 4 URL quan trọng nhất và bấm **Request Indexing**:
   - `https://holarise.org/`
   - `https://holarise.org/gioi-thieu/`
   - `https://holarise.org/lich-hoat-dong/`
   - `https://holarise.org/hanh-trinh/tinh-yeu-thuong-cua-me/`

*(Thông thường sau 24–72 giờ, `site:holarise.org` sẽ bắt đầu hiện trên Google.)*

### Bước 3: Bật IndexNow (đẩy thẳng lên Bing, DuckDuckGo, ChatGPT Search, Copilot)
```bash
# 1. Tạo key ngẫu nhiên 32 ký tự:
python3 -c "import secrets; print(secrets.token_hex(16))"

# 2. Dán key đó vào data/site.json -> seo.indexNowKey, chạy build & deploy:
python3 build.py --check

# 3. Sau khi deploy xong (kiểm tra https://holarise.org/<KEY>.txt trả 200), ping IndexNow:
python3 scripts/ping_indexnow.py
```

### Bước 4: Xác thực Bing Webmaster Tools (1 phút)
1. Mở [Bing Webmaster Tools](https://www.bing.com/webmasters) → chọn **Import from Google Search Console** (không cần verify lại thủ công).
2. Kiểm tra `https://holarise.org/sitemap.xml` đã vào danh sách.

### Bước 5: Tạo 5 tín hiệu Entity & Backlink sạch đầu tiên (phá thế "0 kết quả ngoài web")
1. **MusicSpace:** Trong bài sự kiện HolaHeart 15/11/2026 trên `musicspace.edu.vn`, nhờ gắn 1 link trỏ về `https://holarise.org/` hoặc bài tổng kết trên HolaRise.
2. **Google Business Profile (Google Maps):** Tạo địa điểm *Cộng đồng Thanh niên Hòa Lạc - HolaRise* tại Tân Xã, Hòa Lạc, gắn website `https://holarise.org` (giúp ăn luôn Local Pack khi tìm *"tình nguyện Hòa Lạc"*).
3. **Facebook Page & Instagram/YouTube chính thức:** Gắn URL `https://holarise.org` trong phần Giới thiệu, sau đó cập nhật ngược vào `data/site.json` (`contact.facebook`, `contact.instagram`, `contact.youtube`) để `build.py` tự sinh schema `sameAs`.
4. **GitHub / Cộng đồng sinh viên Hòa Lạc:** Gắn link `https://holarise.org` vào README/profile nếu có tổ chức hoặc bài giới thiệu CLB tại ĐH FPT / ĐHQGHN.

---

## Fluff (Bỏ qua cho tới khi các dòng trên hoàn tất)
- Không cần tối ưu thêm meta `keywords` (Google đã bỏ dùng thẻ này từ lâu).
- Không cần ép thêm từ khóa vào alt ảnh hay rút ngắn meta description vài ký tự khi domain mới còn chưa được index.
