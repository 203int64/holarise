---
name: awwwards-motion-editorial
description: >-
  Craft rules and choreography playbook for Awwwards-grade editorial web design
  and scroll-driven motion storytelling tailored to prestigious youth, NGO, and
  environmental community websites. Use before designing or refining landing
  pages, hero sections, scroll choreography, typography scales, or interactive
  micro-interactions.
---

# Awwwards Motion & Editorial Craft Skill

## 1. Visual & Editorial Philosophy
- **Institutional Prestige meets Emotional Warmth:** Avoid generic SaaS templates or repetitive equal-height card stacks. Alternate spatial rhythm between full-bleed atmospheric imagery, generous whitespace, high-contrast editorial typography, and deep dark-canvas manifesto chapters.
- **Scale Contrast:** Display headlines must command attention (`clamp(2.4rem, 5.2vw, 4.4rem)`, tight tracking `-0.03em`, tight leading `1.08–1.14`) contrasted against crisp micro-eyebrows (`12px`, uppercase, `0.12em` tracking) and comfortable body copy (`16–18px`, `1.7` leading).
- **Vietnamese Typography Perfection:** Always use Vietnamese-native display/sans families (`Be Vietnam Pro`) paired with refined editorial serif (`Lora`) for mission quotes and human stories. Never clip Vietnamese diacritics inside `overflow: hidden` line masks — add generous vertical padding (`padding-block: 0.08em`) on split-line masks.

## 2. Motion Choreography Grammar (Lenis + GSAP ScrollTrigger)
- **Single Physics Engine:** Synchronize `Lenis` smooth momentum scroll 1:1 with `GSAP ScrollTrigger`:
  ```js
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  ```
- **Easing Hierarchy:**
  - Hero & Curtain Reveals: `power4.out` (`0.85s–1.15s`) — swift departure, dignified settle.
  - Micro-interactions & Magnetic Pull: `power3.out` (`0.35s–0.5s`) — tactile, never bouncy/cartoonish.
  - Scroll-Scrubbed Storytelling: `scrub: 0.6` to `scrub: 1` for silky physical inertia.
- **Signature Storytelling Patterns:**
  1. **Kinetic Split-Line Opening:** Wrap display lines in overflow masks and slide upward on initial paint (`yPercent: 105 -> 0`) while hero media settles (`scale: 1.12 -> 1.0`).
  2. **Velocity-Reactive Marquee:** Subtle infinite editorial band whose speed responds gently to scroll velocity without distracting from main content.
  3. **Pinned Scrollytelling Chapter (Desktop only):** Pin the narrative stage (`pin: true`) as chapters (`01/03`–`03/03`) crossfade text and wipe framed photographs via `clip-path: inset(...)`.
  4. **Word-by-Word Scrubbed Manifesto:** Dark-forest full-bleed section where each word lights up from muted opacity (`0.22`) to full luminance (`1.0`) directly tied to scroll progress.
  5. **Clip-Path Curtain Reveals + Inner Parallax:** Reveal editorial photography via `clip-path: inset(12% 0% 12% 0% round 20px)` → `inset(0% 0% 0% 0% round 20px)` paired with subtle inner image `scale(1.14 -> 1.0)`.
  6. **Horizontal Scroll Track (Desktop only):** Convert vertical scroll cleanly into horizontal glide for visual galleries, always paired with `invalidateOnRefresh: true`.
  7. **Tactile Micro-Interactions:** Subtle magnetic buttons (`max ±10px` displacement) and contextual cursor pill (`pointer: fine` only).

## 3. Non-Negotiable Engineering Guardrails
- **100% Static SEO First:** Every heading, paragraph, link, image `alt`, and JSON-LD schema MUST live in pre-rendered static HTML. Motion is strictly progressive enhancement.
- **GPU-Composited Properties Only:** Animate `transform`, `opacity`, and `clip-path`. Never animate `width`, `height`, `top`, `left`, or `margin` during scroll.
- **Mobile Protection via `gsap.matchMedia()`:** Restrict heavy pinning, horizontal scroll locking, magnetic cursors, and custom cursor pills strictly to `(min-width: 1024px) and (prefers-reduced-motion: no-preference)`. Mobile devices must scroll natively at 60fps with lightweight reveals.
- **Accessibility (`prefers-reduced-motion`):** When reduced motion is requested, bypass Lenis and GSAP triggers completely and guarantee all content renders at `opacity: 1` immediately.
- **Modal / Lightbox Lock Sync:** Always call `lenis.stop()` when a modal or `<dialog>` opens and `lenis.start()` when it closes.

## 4. Anti-Patterns to Reject
- Blocking page entry with long fake splash preloaders (> 400ms).
- Hiding content permanently at `opacity: 0` if JS fails or loads late (use a JS-added root class like `html.has-motion` before setting initial hidden states).
- Over-animating every paragraph or adding jarring bounce/wobble effects that undermine NGO trustworthiness.
- Measuring animated elements directly for layout math — always measure static wrapper containers and set `invalidateOnRefresh: true`.
