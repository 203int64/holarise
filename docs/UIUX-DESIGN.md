# UI/UX DESIGN: HolaRise Dual-Tier Awwwards Editorial System

## 1. Hệ Màu (Extended Apple Gallery + Brand Sunrise)
| Token | Giá trị | Vai trò |
| :--- | :--- | :--- |
| `--bg` | `#FFFFFF` | Bề mặt chính sạch, thoáng |
| `--surface` | `#F6F7F6` | Gallery Mist tách khối nhẹ |
| `--obsidian` | `#0B110F` | Chương Tuyên ngôn & CTA Band tạo tương phản |
| `--ink` | `#0E1512` | Tiêu đề & nội dung chính (WCAG AAA) |
| `--accent` | `#0B6E4F` | Emerald chính cho CTA, active states, links |
| `--sunrise` | `#D97948` | Micro-accent bình minh từ logo `HR`: live dot, chấm phân tách Kinetic Band, gạch nhấn Manifesto, badge nổi bật |
| `--sunrise-soft` | `#FDF3ED` | Nền nhấn nhẹ cho chip/callout ấm |

## 2. Hệ Chữ Tiếng Việt (Editorial Pairing)
- **Display & UI (`--font-sans`):** `"Be Vietnam Pro", "Inter", -apple-system, BlinkMacSystemFont, sans-serif` (weights `300, 400, 500, 600, 700`). Tối ưu tuyệt đối cho dấu tiếng Việt; mọi `split-line-mask` có `padding-block: 0.08em` tránh xén dấu.
- **Editorial Serif (`--font-serif`):** `"Lora", Georgia, serif` (regular `400`, italic `400`, medium `500`) dành riêng cho Obsidian Manifesto Quote, Blockquote bài viết chi tiết, và trích dẫn trang Giới thiệu.

## 3. Nhịp Điệu 6 Chương Trang Chủ (Spatial Rhythm)
1. **Hero Full-Bleed Card** (`#FFFFFF` frame / `#0B110F` card) + **Upcoming Event Strip**
2. **Opposing Kinetic Band v2** (`#FFFFFF`, 2 dòng chữ chạy ngược chiều + Sunrise dots)
3. **03 Chương Trình Trọng Tâm — Story Stage** (`#FFFFFF`, Glider Tabs + Keyboard `←/→` + Swipe)
4. **4 Con Số Thực Tế — Bento Metrics** (`#F6F7F6` Mist, Pointer Spotlight trên Desktop)
5. **Obsidian Manifesto Chapter** (`#0B110F` Dark Canvas, `Lora` Word-by-Word Scrub + tọa độ Hòa Lạc)
6. **Lịch Hẹn Cuối Tuần + Triển Lãm Ảnh Hiện Trường + FAQ + CTA Band** (`#FFFFFF` → `#F6F7F6` → `#FFFFFF` → `#0B110F`)

## 4. Phân Tầng Tương Tác (Mobile vs. Desktop)
- **Mobile (`< 1024px`):** Native scroll 100%, CSS Scroll-Driven `view()` cho Kinetic Band (compositor thread), bỏ `lenis.min.js`, giữ Smart Header morph logo `HR`, Lightbox hỗ trợ vuốt ngang đổi ảnh.
- **Desktop (`>= 1024px` & `pointer: fine`):** GSAP ScrollTrigger Kinetic Band + velocity skew (`max ±3.2deg`), Floating Velocity-Tilted Photo Preview (`#float-preview`), Pointer Hairline Spotlight (`--mx`, `--my`), 3D Plate Tilt + Specular Glare, Orbital Back-to-Top Ring, Exhibition Arrow Navigation.
