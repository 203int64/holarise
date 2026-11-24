# UI/UX SPEC: HolaRise Dual-Tier Editorial Craft (Mobile Nhẹ 60fps · Desktop Đỉnh)

## 1. Bối Cảnh & Mục Tiêu
- **Vấn đề gốc:**
  1. Dải **2 dòng chữ chạy ngược chiều khi vuốt** (`.kinetic-band` / `[data-kinetic-dir]`) và khối **Obsidian Word-Scrub Manifesto** (`[data-scrub-words]`) bị gỡ khỏi `templates/home.html` dù CSS/JS vẫn tồn tại trong codebase.
  2. Toàn bộ Public Site đang thiếu nhịp nghỉ tương phản (White → Mist → Obsidian → White), thiếu màu nhấn thương hiệu Sunrise Amber (`#D97948`) từ logo `HR`, dùng emoji làm icon ở thanh lọc 4 chữ, thiếu Empty State khi lọc 0 kết quả, và còn tải thừa `lenis.min.js`.
- **Phạm vi:** Toàn bộ 6 trang Public (`/`, `/gioi-thieu/`, `/hoat-dong/`, `/workshop/`, `/tin-tuc/`, `/tin-tuc/[slug]/`, `/tham-gia/`). **Không chỉnh sửa `/admin` hay API CMS.**
- **Chiến lược hiệu năng 2 tầng:**
  - **Mobile (`< 1024px`):** 100% Native Scroll 60fps, bỏ hoàn toàn `lenis.min.js`, dùng CSS Scroll-Driven Animations (`animation-timeline: view()`) trên compositor cho Kinetic Band (có GSAP fallback), `overflow-x: clip` chống tràn ngang tuyệt đối.
  - **Desktop (`>= 1024px` & `pointer: fine`):** Bật đầy đủ tầng tương tác chiều sâu (Velocity-Skew Kinetic Band, Obsidian Word-by-Word Scrub, Floating Velocity-Tilted Photo Preview, Pointer Hairline Spotlight, Orbital Back-to-Top Ring, Exhibition Controls).

## 2. Yêu Cầu Chức Năng & Tiêu Chí Nghiệm Thu
1. **Opposing Kinetic Typography Band v2:** Hiển thị 2 dòng chữ chạy ngược chiều nhau theo nhịp vuốt trên trang chủ (dòng 1 solid mực + dòng 2 editorial stroke/emerald tint + sunrise dot `#D97948`). Không gây tràn ngang tại `375px` và `1440px`.
2. **Obsidian Manifesto Chapter:** Chương nền tối `#0B110F` trên trang chủ với typography `Lora` sáng từng chữ theo cuộn (và hiển thị `opacity: 1` ngay khi `prefers-reduced-motion: reduce` hoặc tắt JS).
3. **Typography & Brand Accent:** Tải `Be Vietnam Pro` (UI/Display chuẩn dấu tiếng Việt) + `Lora` (Editorial Serif cho Tuyên ngôn/Trích dẫn), thêm token `--sunrise: #D97948` hài hòa với `--accent: #0B6E4F`.
4. **Desktop Showcase & Lightbox v2:**
   - Lightbox hỗ trợ Prev/Next, phím `←`/`→`, vuốt ngang trên mobile, và bộ đếm `01 / 04`.
   - Floating Photo Preview hoạt động thật trên danh sách Past Workshops (`/workshop/`).
   - Pointer Hairline Spotlight trên thẻ Metrics, Event Cards, Core Values (Desktop `pointer: fine` only).
   - Orbital Reading Progress + Back-to-Top nút tròn góc phải dưới trên Desktop.
5. **Anti-Slop & SSR Parity:**
   - Thay toàn bộ emoji ở thanh lọc 4 chữ bằng bộ SVG 16px đồng bộ.
   - Bổ sung bộ đếm kết quả lọc + Empty State có nút đặt lại `Xem tất cả`.
   - Form validation tuân thủ `:user-invalid` + đồng bộ `aria-invalid` & micro-feedback nút gửi.
   - Giữ nguyên 100% `<!-- CMS:*:START/END -->` markers và đồng bộ tuyệt đối giữa `build.py` và `functions/_lib/render.js`.
