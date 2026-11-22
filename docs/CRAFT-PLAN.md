# CRAFT PLAN: HolaRise Craft Upgrade & Skill Guardrails (Option B)

> Nguyên tắc: **Giữ nguyên những gì HolaRise đã làm tốt** (Bình minh Hòa Lạc Design System, `Be Vietnam Pro` + `Lora`, Obsidian Manifesto, Kinetic Band, Story Stage, PWA, SEO/JSON-LD, Cloudflare Pages SSR + D1), chỉ sửa những điểm yếu và đồng bộ chuẩn mới vào skill dự án. Không bịa thêm số liệu hay thay thông tin liên hệ placeholder có sẵn.

## Atomic Phases

### [x] Phase 1: Codify Distilled Craft Guardrails into Project Skill
- **Target Files:** `.agents/skills/awwwards-motion-editorial/SKILL.md`
- **Verify:** Nội dung Section 5 đồng bộ Luật số 0 (giữ `Be Vietnam Pro` + `Lora` & bảng màu Hòa Lạc), Conversion Copy, Content Realism, Nested Geometry, States & Ship Gate.

### [x] Phase 2: Visual Micro-Craft, Motion Hygiene & Accessible Inline Form Validation
- **Target Files:** `assets/css/styles.css`, `assets/js/main.js`, `assets/js/motion.js`, `templates/base.html`, `templates/join.html`
- **Verify:** `python3 build.py --check`

### [x] Phase 3: Conversion Copy, Risk Reversal, FAQ & Contact Link Hygiene
- **Target Files:** `templates/home.html`, `templates/about.html`, `templates/join.html`, `templates/base.html`, `data/site.json`
- **Verify:** Thực hiện cùng Phase 4 trước khi chạy `python3 build.py --check` để đường dẫn `/chinh-sach/` hợp lệ.

### [x] Phase 4: Ship Requirements (`404.html`, `/chinh-sach/`), `build.py` Verifier & End-to-End Verification
- **Target Files:** `templates/404.html`, `templates/privacy.html`, `build.py`, `functions/sitemap.xml.js`, `functions/tin-tuc/[slug].js`, `docs/CRAFT-PLAN.md`
- **Verify:** `python3 build.py --check`, `node --test tests/cms.test.mjs`, kiểm thử thực tế trên trình duyệt (`browser` subagent) ở `390x844` và `1440x900` (không tràn ngang, inline form error + `aria-describedby`, `tel:` chuẩn, `/chinh-sach/`, `/404.html`, 0 console/network errors).
