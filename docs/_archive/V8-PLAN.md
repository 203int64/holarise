# PLAN: HolaRise v8 — Master Execution Blueprint (BP-01 → BP-16)

## 1. Architectural Decisions & Master Breaking-Point Map
- **Selected Architecture:** Dual-Isolation Member Studio (`holarise_member_session` strictly separated from `holarise_session`) + CMS Site Visuals Override (`site_visuals_json` in D1 `settings` + `MEDIA_KV` + Edge SSR markers) + 90/10 Tonal Natural Palette (`#B85D3B` · `#145A40` · `#1F4E5F`) + Single-Line Partner Colophon + Awwwards-Grade Motion Choreography + Instant `VI | EN` Dictionary + Moderated Editorial Guestbook (`pull_quote`, `participant_role`, 1 photo, atomic `♥` reactions).
- **16 Tracked Breaking Points:**
  - `BP-01`: Clean temporary AI visuals (drop `C01.jpg`, `C02.jpg`), transparent Principle #4 wording, and full `/admin/` CMS Site Visuals replacement (`hero`, `about`, `holaheart`, `holagreen`, `holaconnect`).
  - `BP-02`: Unpublish seeded AI album `album-khoanh-khac-hoa-lac` (`photo-seed-01..12`) in D1 so Edge SSR never overwrites real exhibition photos; clean `/hoat-dong/` legacy links in D1 `posts`.
  - `BP-03`: Remove single-girl photo (`14-669789766...jpg`) and remove all public photo download & Google Drive buttons across static HTML, JS, and SSR.
  - `BP-04`: Fix 20 dead `role="button"` traps & hidden Mission/Vision `<h3>` on Desktop `/gioi-thieu/` via semantic HTML + `matchMedia("(max-width: 820px)")`.
  - `BP-05`: Replace bulky neon-blue `.partner-beacon` box & 3 infinite non-GPU animations with a subtle single-line `Partner Colophon` ribbon.
  - `BP-06`: Restore Mobile `HolaRise ↔ HR` mechanical wordmark morph + elevate site-wide Motion Choreography (Desktop smooth inertia synced to `gsap.ticker`, 3-pillar `clip-path` curtain wipes + tonal shifts, `@view-transition`, 3D optical tilt on Member Pass).
  - `BP-07`: Eliminate CTA ↔ Modal UX whiplash with unified real seat reservation (1-tap for logged-in members, 1-step pass creation + booking for guests).
  - `BP-08`: Expand `#hanh-trinh-that` runway to `340vh` (laptop `1366x768` safe framing) + inner counter-parallax + active center focus + contextual cursor pill.
  - `BP-09`: Remove `/admin/` & `/media/` links from public Mobile Drawer & Footer; restore clickable Hotline/Zalo `077.777.1948` in Mobile Drawer.
  - `BP-10`: Crisp `"Hola · Together We Rise, Together We Serve"` badge, zero `"Chapter 01"`, zero defensive `"thật"`, `"Hola"` / `"Hòa Lạc"` everywhere except office address `Tân Xã – Hòa Lạc – Thạch Thất, Hà Nội`.
  - `BP-11`: 90/10 Quiet-Luxury 3-pillar color harmony (`#B85D3B` Terracotta · `#145A40` Deep Forest · `#1F4E5F` Lake Slate).
  - `BP-12`: Zero-FOUC `VI | EN` bilingual switcher + `title_en` / `summary_en` on D1 `events`.
  - `BP-13`: Unified 1-Account, 1-Member-Pass (`HOLA-2026-XXXX`) flow (`Email or Phone` + `Password >= 6 chars`, real Avatar upload, `1080x1350` PNG export, booking history).
  - `BP-14`: Moderated Editorial Guestbook under past activities (`participant_role`, `pull_quote`, `content`, 1 photo in `MEDIA_KV`, Admin moderation, atomic `♥` reactions).
  - `BP-15`: Fix `.testimonial-card` `--line` variables, remove unused `lenis.min.js`, ensure `>= 44px` mobile touch targets.
  - `BP-16`: Sequence new D1 schema migration cleanly as `migrations/0006_member_auth_and_reflections.sql`.

## 2. Atomic Phases

### [x] Phase 1: Migration `0006`, D1 Cleanup, CMS Site Visuals API, Member Auth & Guestbook APIs (TDD)
- **Target Files:**
  - `migrations/0006_member_auth_and_reflections.sql`
  - `functions/_lib/security.js`, `functions/_lib/validation.js`
  - `functions/api/registrations.js`
  - `functions/api/admin/events/{index,[id]}.js`, `functions/api/admin/settings/index.js`, `functions/api/admin/visuals.js`
  - `functions/api/member/auth/{register,login,logout,status}.js`
  - `functions/api/member/{dashboard,profile,media}.js`
  - `functions/api/reflections/index.js`, `functions/api/reflections/[id].js`, `functions/api/reflections/[id]/heart.js`
  - `functions/api/admin/reflections/{index,[id]}.js`, `functions/api/admin/members/{index,[id]}.js`
  - `tests/member-reflections.test.mjs`, `tests/cms.test.mjs`
- **Verify:** `node --test tests/cms.test.mjs tests/media.test.mjs tests/member-reflections.test.mjs`

### [x] Phase 2: Crisp "Hola / Hòa Lạc" Copy, Clean Visual Defaults, Gallery Privacy, Public Nav Fix & VI/EN i18n
- **Target Files:**
  - `data/{site,activities,workshops,news,musicspace-photo-wall}.json`
  - `assets/js/i18n.js`
  - `templates/{base,home,about,workshops,news_list,news_detail,join,privacy,event_invitation,404,offline}.html`
  - `functions/_middleware.js`, `functions/_lib/render.js`, `functions/index.js`, `functions/gioi-thieu/index.js`
  - `build.py`
- **Verify:** `python3 build.py --check && node --test tests/*.test.mjs`

### [x] Phase 3: 90/10 3-Pillar Harmony, 1-Line Partner Colophon, WAI-ARIA Fix & Awwwards Motion Overhaul
- **Target Files:**
  - `assets/css/styles.css`
  - `assets/js/main.js`, `assets/js/motion.js`
  - `templates/home.html`, `templates/about.html`
  - `build.py`, `functions/_lib/render.js`
  - Remove unused `assets/vendor/lenis.min.js`
- **Verify:** `python3 build.py --check && node --test tests/*.test.mjs`

### [x] Phase 4: Unified Member Hub, 1-Tap RSVP, Editorial Guestbook UI & `/admin/` Moderation + Site Visuals UI
- **Target Files:**
  - `assets/js/member.js`, `assets/js/join-pass.js`, `assets/js/admin.js`
  - `templates/join.html`, `templates/base.html`, `templates/news_detail.html`, `templates/event_invitation.html`, `templates/admin.html`
  - `assets/css/styles.css`, `assets/css/admin.css`
  - `functions/hanh-trinh/[slug].js`, `functions/tham-gia/index.js`
- **Verify:** `python3 build.py --check && node --test tests/*.test.mjs`

### [x] Phase 5: End-to-End Automated & Live Browser Verification (`1440x900` & `390x844`)
- **Verify:** Full deterministic checks + Live Browser E2E + `Hana Verdict` & Evidence Table.

## 3. Phase Verification Log
| Phase | `Hana Verdict` | Evidence Summary | Missing Coverage |
| :--- | :--- | :--- | :--- |
| Phase 1 | `PASS` | `node --test tests/*.test.mjs` -> `14/14 passed` (Migration 0006, Member Auth, 1-Tap RSVP, Guestbook, CMS Visuals) | None |
| Phase 2 | `PASS` | `python3 build.py --check` (9 pages, 0 errors) & `14/14 tests passed` | None |
| Phase 3 | `PASS` | `python3 build.py --check` & `14/14 tests passed` (90/10 palette, 1-line colophon, ARIA fix, 340vh + inertia motion) | None |
| Phase 4 | `PASS` | `python3 build.py --check` & `14/14 tests passed` (Unified Member Hub, 1-Tap RSVP, Guestbook, Admin Community & Visuals CMS) | None |
| Phase 5 | `PASS` | Deterministic `dist/` audit (`0` forbidden tokens, `0` static `role="button"`, `0.82 MB` SW precache) + Live Browser E2E (`1440x900` & `390x844`, 0 JS errors) + 2 mobile overlap fixes verified | Production D1 `0006` migration & `wrangler pages deploy` pending user deployment |
