# UI/UX PLAN: Triển Khai Nâng Cấp Siêu UI/UX (Option B)

## Atomic Phases

### [x] Phase 1: Living Docs, Typography (`Be Vietnam Pro` + `Lora`), Sunrise Token & Bỏ `lenis.min.js`
- **Target Files:** `docs/UIUX-SPEC.md`, `docs/UIUX-DESIGN.md`, `docs/UIUX-PLAN.md`, `templates/base.html`, `assets/css/styles.css`
- **Verify:** `python3 build.py --check`

### [x] Phase 2: Opposing Kinetic Band v2 + Obsidian Word-Scrub Manifesto trên Trang Chủ
- **Target Files:** `templates/home.html`, `build.py`, `assets/css/styles.css`, `assets/js/motion.js`
- **Verify:** `python3 build.py --check && node --test tests/cms.test.mjs`

### [x] Phase 3: Desktop Showcase Interactions, Lightbox v2 & Story Keyboard Nav
- **Target Files:** `templates/base.html`, `templates/home.html`, `assets/css/styles.css`, `assets/js/motion.js`, `assets/js/main.js`
- **Verify:** `python3 build.py --check`

### [x] Phase 4: Subpages Editorial Polish, Anti-Slop SVG Filters, Empty States, Form UX & SSR Parity
- **Target Files:** `templates/about.html`, `templates/activities.html`, `templates/workshops.html`, `templates/news_list.html`, `templates/news_detail.html`, `templates/join.html`, `build.py`, `functions/_lib/render.js`, `assets/js/main.js`, `assets/css/styles.css`
- **Verify:** `python3 build.py --check && node --test tests/cms.test.mjs`

### [x] Phase 5: Kiểm Chứng Thực Tế Toàn Diện (Mobile `375px` + Desktop `1440px` Browser Audit)
- **Target Files:** `dist/` (fresh rebuild), cập nhật dấu `[x]` sau khi PASS.
- **Verify:** `python3 build.py --check`, `node --test tests/cms.test.mjs`, kiểm duyệt trên trình duyệt thật ở `375px` & `1440px` (0 console/network errors, 0 horizontal overflow, kiểm thử Kinetic Band, Obsidian Manifesto, Lightbox, Filter Empty State, Desktop hover preview).
