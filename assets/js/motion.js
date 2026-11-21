/**
 * HolaRise – Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên | v5+ 2026 Awwwards Motion Engine
 * 100% GPU-composited (transform / opacity / clip-path) — 60fps silky physics:
 * - Lenis Inertial Smooth Scroll synced 1:1 with GSAP 3 + ScrollTrigger
 * - Pure White Hero Split-Line Reveal + Apple Scale-to-Fullbleed Cinema Frame
 * - Kinetic Text Decode / Scramble on Kicker Badges
 * - Scroll-Velocity Reactive Display Typography Skew
 * - Floating Spring Documentary Photo Preview on Blueprint Rows (velocity tilt!)
 * - Opposing Kinetic Scroll-Driven Watermark Band
 * - Mechanical Luxury Odometer (01 -> 02 -> 03) + Live Tab Scrub Progress Fill
 * - Optical Specular Glass Glare + 3D Perspective Plate Tilt on Documentary Photos
 * - Velocity Squash-and-Stretch Circular Cursor Tag
 * - Live Tân Xã, Hòa Lạc GMT+7 Clock
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  var hasLenis = typeof window.Lenis !== "undefined";
  var isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* 0. Live Tân Xã, Hòa Lạc GMT+7 Clock (tabular-nums) */
  var clockEls = document.querySelectorAll("[data-live-clock]");
  if (clockEls.length) {
    var updateClock = function () {
      try {
        var now = new Date();
        var fmt = new Intl.DateTimeFormat("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        }).format(now);
        clockEls.forEach(function (el) {
          el.textContent = fmt;
        });
      } catch (e) {}
    };
    updateClock();
    setInterval(updateClock, 1000);
  }

  /* 1. Native CSS Scroll Progress fallback ONLY when animation-timeline: scroll() is unsupported */
  var progressBar = document.getElementById("scroll-progress");
  if (progressBar && !prefersReduced && !(window.CSS && CSS.supports("animation-timeline", "scroll()"))) {
    var updateProgress = function () {
      var scrollable = document.documentElement.scrollHeight - window.innerHeight;
      var pct = scrollable > 0 ? Math.min(Math.max(window.scrollY / scrollable, 0), 1) : 0;
      progressBar.style.transform = "scaleX(" + pct + ")";
    };
    window.addEventListener("scroll", updateProgress, { passive: true });
    updateProgress();
  }

  /* 2. Story Stage + Mechanical Odometer + Live Tab Progress Controls */
  var storyStage = document.querySelector("[data-story-stage]");
  var storyTabs = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-tab]")) : [];
  var storyPanels = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-panel]")) : [];
  var storySlides = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-slide]")) : [];
  var odometerDrum = storyStage ? storyStage.querySelector("[data-odometer-drum]") : null;
  var activeStoryIndex = 0;
  var storyTrigger = null;

  function setTabProgress(activeIndex, localProgress) {
    storyTabs.forEach(function (tab, i) {
      var p = i < activeIndex ? 1 : i === activeIndex ? localProgress : 0;
      tab.style.setProperty("--tab-progress", p.toFixed(3));
    });
  }

  function setStoryStep(index, localProgress) {
    if (!storyPanels.length) return;
    var clamped = Math.max(0, Math.min(index, storyPanels.length - 1));
    var pct = typeof localProgress === "number" ? Math.max(0.15, Math.min(1, localProgress)) : 1;
    setTabProgress(clamped, pct);

    if (clamped === activeStoryIndex && storyPanels[clamped].classList.contains("is-active")) return;
    activeStoryIndex = clamped;

    storyTabs.forEach(function (tab, i) {
      var on = i === clamped;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
    });
    storyPanels.forEach(function (panel, i) {
      panel.classList.toggle("is-active", i === clamped);
    });
    storySlides.forEach(function (slide, i) {
      slide.classList.toggle("is-active", i === clamped);
    });
    if (odometerDrum) {
      odometerDrum.style.transform = "translateY(" + -clamped * 100 + "%)";
    }
  }

  if (storyStage && storyPanels.length) {
    storyStage.classList.add("is-enhanced");
    setStoryStep(0, 1);
    storyTabs.forEach(function (tab, idx) {
      tab.addEventListener("click", function () {
        setStoryStep(idx, 1);
        if (storyTrigger) {
          var targetScroll =
            storyTrigger.start +
            ((idx + 0.35) / storyPanels.length) * (storyTrigger.end - storyTrigger.start);
          if (window.__lacXanhLenis) {
            window.__lacXanhLenis.scrollTo(targetScroll, { duration: 0.72 });
          } else {
            window.scrollTo({ top: targetScroll, behavior: "smooth" });
          }
        }
      });
    });
  }

  if (prefersReduced || !hasGsap) {
    return;
  }

  document.documentElement.classList.add("has-motion");
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);

  /* 3. Lenis Inertial Smooth Scroll synced 1:1 with GSAP ScrollTrigger */
  var isDesktopPointer = window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches;
  if (hasLenis && isDesktopPointer) {
    var lenis = new window.Lenis({
      duration: 1.05,
      easing: function (t) {
        return Math.min(1, 1.001 - Math.pow(2, -10 * t));
      },
      smoothWheel: true,
      wheelMultiplier: 0.98
    });

    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (time) {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
    window.__lacXanhLenis = lenis;
  }

  /* 4. Kinetic Text Decode / Scramble on Kicker Badges */
  var glyphs = "0123456789·/HOLARISECOMMUNITY";
  function scrambleText(el) {
    if (el.dataset.scrambled === "1") return;
    el.dataset.scrambled = "1";
    var original = el.textContent;
    var len = original.length;
    var start = performance.now();
    var duration = 460;

    function tick(now) {
      var p = Math.min(1, (now - start) / duration);
      var revealCount = Math.floor(p * len);
      var out = "";
      for (var i = 0; i < len; i++) {
        var ch = original[i];
        if (i < revealCount || ch === " " || ch === "·" || ch === "•") {
          out += ch;
        } else {
          out += glyphs[(i + Math.floor(now / 35)) % glyphs.length];
        }
      }
      el.textContent = out;
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = original;
      }
    }
    requestAnimationFrame(tick);
  }

  document.querySelectorAll(".kicker").forEach(function (kicker) {
    ScrollTrigger.create({
      trigger: kicker,
      start: "top 90%",
      once: true,
      onEnter: function () {
        scrambleText(kicker);
      }
    });
  });

  /* 5. Chapter 1: Hero Buoyant Split-Line Reveal + Apple Scale-to-Fullbleed Cinema Frame */
  var heroSection = document.querySelector(".hero-editorial");
  if (heroSection) {
    var heroLines = heroSection.querySelectorAll(".split-line-inner");
    var heroFadeEls = heroSection.querySelectorAll("[data-hero-stagger]");
    var cinemaFrame = heroSection.querySelector("[data-cinema-frame]");
    var cinemaImg = heroSection.querySelector("[data-cinema-img]");

    var heroTl = gsap.timeline({ defaults: { ease: "power4.out" } });
    if (heroLines.length) {
      heroTl.from(heroLines, { yPercent: 112, duration: 0.92, stagger: 0.085 }, 0.04);
    }
    if (heroFadeEls.length) {
      heroTl.from(heroFadeEls, { y: 18, opacity: 0, duration: 0.78, stagger: 0.065 }, 0.14);
    }
    if (cinemaFrame) {
      heroTl.from(
        cinemaFrame,
        { clipPath: "inset(8% 4% 0% 4% round 24px)", y: 26, opacity: 0, duration: 1.05 },
        0.2
      );
    }

    if (cinemaFrame && window.innerWidth >= 900) {
      gsap.to(cinemaFrame, {
        width: "100%",
        borderRadius: "0px",
        ease: "none",
        scrollTrigger: {
          trigger: cinemaFrame,
          start: "top 82%",
          end: "top 14%",
          scrub: 0.55,
          invalidateOnRefresh: true
        }
      });
    }

    if (cinemaImg) {
      gsap.fromTo(
        cinemaImg,
        { yPercent: -7, scale: 1.1 },
        {
          yPercent: 7,
          scale: 1.0,
          ease: "none",
          scrollTrigger: {
            trigger: cinemaFrame || heroSection,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
            invalidateOnRefresh: true
          }
        }
      );
    }
  }

  /* 6. Opposing Kinetic Scroll-Driven Watermark Band + Velocity Skew */
  var kineticLines = document.querySelectorAll("[data-kinetic-dir]");
  kineticLines.forEach(function (line) {
    var dir = parseFloat(line.getAttribute("data-kinetic-dir")) || 1;
    gsap.fromTo(
      line,
      { xPercent: dir > 0 ? -12 : 4 },
      {
        xPercent: dir > 0 ? 4 : -14,
        ease: "none",
        scrollTrigger: {
          trigger: line.closest(".kinetic-band") || line,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.65
        }
      }
    );
  });

  if (kineticLines.length) {
    var skewKinetic = gsap.quickTo(kineticLines, "skewX", { duration: 0.35, ease: "power3.out" });
    ScrollTrigger.create({
      onUpdate: function (self) {
        var v = self.getVelocity();
        var s = Math.max(-6, Math.min(6, v / 360));
        skewKinetic(s);
      }
    });
  }

  /* 7. Architectural 1px Hairline Draw */
  document.querySelectorAll("[data-hairline]").forEach(function (line) {
    gsap.fromTo(
      line,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: 0.95,
        ease: "power3.out",
        scrollTrigger: {
          trigger: line,
          start: "top 88%",
          once: true
        }
      }
    );
  });

  /* 8. Tabular Metric Counters */
  document.querySelectorAll("[data-counter]").forEach(function (el) {
    var target = parseInt(el.getAttribute("data-counter"), 10) || 0;
    if (!target) return;
    var obj = { val: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: "top 88%",
      once: true,
      onEnter: function () {
        gsap.to(obj, {
          val: target,
          duration: 1.25,
          ease: "power3.out",
          onUpdate: function () {
            el.textContent = Math.round(obj.val).toLocaleString("vi-VN");
          }
        });
      }
    });
  });

  /* 9. Obsidian Manifesto Word-by-Word Kinetic Lift & Illumination */
  var manifestoEl = document.querySelector("[data-scrub-words]");
  if (manifestoEl) {
    var rawText = manifestoEl.textContent.trim();
    var words = rawText.split(/\s+/);
    manifestoEl.innerHTML = words
      .map(function (w) {
        return '<span class="scrub-word">' + w + "</span>";
      })
      .join(" ");

    var wordSpans = manifestoEl.querySelectorAll(".scrub-word");
    gsap.to(wordSpans, {
      opacity: 1,
      y: 0,
      stagger: 0.055,
      ease: "none",
      scrollTrigger: {
        trigger: manifestoEl,
        start: "top 80%",
        end: "bottom 42%",
        scrub: 0.55
      }
    });
  }

  /* 10. Frameless Image Plate Clip-Path Wipes */
  document.querySelectorAll("[data-curtain]").forEach(function (wrap) {
    var img = wrap.querySelector("img");
    gsap.fromTo(
      wrap,
      { clipPath: "inset(14% 0% 0% 0% round 12px)" },
      {
        clipPath: "inset(0% 0% 0% 0% round 12px)",
        duration: 0.92,
        ease: "power4.out",
        scrollTrigger: {
          trigger: wrap,
          start: "top 86%",
          once: true
        }
      }
    );
    if (img) {
      gsap.fromTo(
        img,
        { scale: 1.13 },
        {
          scale: 1,
          duration: 1.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: wrap,
            start: "top 86%",
            once: true
          }
        }
      );
    }
  });

  /* 11. Buoyant Staggered Reveals */
  document.querySelectorAll("[data-stagger-group]").forEach(function (group) {
    var items = group.querySelectorAll("[data-stagger-item]");
    if (!items.length) return;
    gsap.from(items, {
      y: 26,
      opacity: 0,
      duration: 0.78,
      stagger: 0.07,
      ease: "power3.out",
      clearProps: "transform",
      scrollTrigger: {
        trigger: group,
        start: "top 86%",
        once: true
      }
    });
  });

  /* 12. Desktop-Only Choreography via gsap.matchMedia() */
  var mm = gsap.matchMedia();

  mm.add("(min-width: 1024px)", function () {
    /* Pinned Scrollytelling 03 Core Programs + Live Tab Scrub Progress */
    var storySection = document.querySelector("[data-story-section]");
    if (storySection && storyStage && storyPanels.length > 1) {
      storyTrigger = ScrollTrigger.create({
        trigger: storySection,
        start: "top 72px",
        end: "+=" + storyPanels.length * 440,
        pin: true,
        scrub: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: function (self) {
          var scaled = self.progress * storyPanels.length;
          var idx = Math.min(storyPanels.length - 1, Math.floor(scaled));
          var localProg = idx === storyPanels.length - 1 && self.progress >= 0.99 ? 1 : scaled - idx;
          setStoryStep(idx, localProg);
        }
      });
    }

    /* Museum Horizontal Exhibition + Live Progress Rail + Counter-Parallax */
    var hSection = document.querySelector("[data-horizontal-section]");
    var hTrack = document.querySelector("[data-horizontal-track]");
    var hFill = document.querySelector("[data-exhibition-fill]");
    var hCount = document.querySelector("[data-exhibition-count]");

    if (hSection && hTrack) {
      var hCards = hTrack.querySelectorAll(".horizontal-card");
      var hImgs = hTrack.querySelectorAll(".horizontal-frame img");
      var totalCards = hCards.length || 1;
      var getScrollAmount = function () {
        return Math.max(0, hTrack.scrollWidth - window.innerWidth + 48);
      };

      var setSkew = gsap.quickTo(hCards, "skewX", { duration: 0.34, ease: "power3.out" });

      gsap.to(hTrack, {
        x: function () {
          return -getScrollAmount();
        },
        ease: "none",
        scrollTrigger: {
          trigger: hSection,
          start: "top 64px",
          end: function () {
            return "+=" + getScrollAmount();
          },
          pin: true,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: function (self) {
            var v = self.getVelocity();
            var skew = Math.max(-3.6, Math.min(3.6, -v / 480));
            setSkew(skew);
            if (hFill) {
              var pct = Math.max(1 / totalCards, self.progress);
              hFill.style.transform = "scaleX(" + pct.toFixed(4) + ")";
            }
            if (hCount) {
              var cur = Math.min(totalCards, Math.max(1, Math.round(self.progress * (totalCards - 1)) + 1));
              hCount.textContent = "0" + cur + " / 0" + totalCards;
            }
          },
          onScrubComplete: function () {
            setSkew(0);
          }
        }
      });

      if (hImgs.length) {
        gsap.fromTo(
          hImgs,
          { xPercent: -6 },
          {
            xPercent: 6,
            ease: "none",
            scrollTrigger: {
              trigger: hSection,
              start: "top 64px",
              end: function () {
                return "+=" + getScrollAmount();
              },
              scrub: true,
              invalidateOnRefresh: true
            }
          }
        );
      }
    }

    /* Fine-Pointer Interactive Magic */
    if (isFinePointer) {
      /* 12A. Optical Glass Specular Glare + Subtle 3D Perspective Tilt on Photo Plates */
      document.querySelectorAll(".plate-media, .story-media-frame").forEach(function (plate) {
        var rX = gsap.quickTo(plate, "rotateX", { duration: 0.35, ease: "power3.out" });
        var rY = gsap.quickTo(plate, "rotateY", { duration: 0.35, ease: "power3.out" });
        gsap.set(plate, { transformPerspective: 1000 });

        plate.addEventListener("pointerenter", function () {
          plate.style.setProperty("--glare-opacity", "1");
        });

        plate.addEventListener("pointermove", function (e) {
          var rect = plate.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          var xPct = ((e.clientX - rect.left) / rect.width) * 100;
          var yPct = ((e.clientY - rect.top) / rect.height) * 100;
          plate.style.setProperty("--glare-x", xPct.toFixed(1) + "%");
          plate.style.setProperty("--glare-y", yPct.toFixed(1) + "%");
          rY(((xPct - 50) / 50) * 3.2);
          rX(((50 - yPct) / 50) * 3.2);
        });

        plate.addEventListener("pointerleave", function () {
          plate.style.setProperty("--glare-opacity", "0");
          rX(0);
          rY(0);
        });
      });

      /* 12B. Floating Spring Photo Preview on Blueprint Rows */
      var floatBox = document.getElementById("float-preview");
      var floatImg = document.getElementById("float-preview-img");
      if (floatBox && floatImg) {
        var fx = gsap.quickTo(floatBox, "x", { duration: 0.34, ease: "power3.out" });
        var fy = gsap.quickTo(floatBox, "y", { duration: 0.34, ease: "power3.out" });
        var frot = gsap.quickTo(floatBox, "rotation", { duration: 0.42, ease: "power3.out" });
        var lastX = 0;

        document.querySelectorAll("[data-hover-photo]").forEach(function (row) {
          row.addEventListener("pointerenter", function (e) {
            var src = row.getAttribute("data-hover-photo");
            var alt = row.getAttribute("data-hover-alt") || "";
            if (src && floatImg.getAttribute("src") !== src) {
              floatImg.src = src;
              floatImg.alt = alt;
            }
            lastX = e.clientX;
            fx(e.clientX + 26);
            fy(e.clientY - 120);
            floatBox.classList.add("is-visible");
            gsap.to(floatBox, { scale: 1, duration: 0.34, ease: "power3.out" });
          });

          row.addEventListener("pointermove", function (e) {
            var dx = e.clientX - lastX;
            lastX = e.clientX;
            var tilt = Math.max(-5, Math.min(5, dx * 0.32));
            fx(e.clientX + 26);
            fy(e.clientY - 120);
            frot(tilt);
          });

          row.addEventListener("pointerleave", function () {
            floatBox.classList.remove("is-visible");
            frot(0);
            gsap.to(floatBox, { scale: 0.86, duration: 0.24, ease: "power2.out" });
          });
        });
      }

      /* 12C. Velocity Squash-and-Stretch Circular Cursor Tag */
      var cursorTag = document.getElementById("cursor-tag");
      if (cursorTag) {
        var xTo = gsap.quickTo(cursorTag, "x", { duration: 0.18, ease: "power3.out" });
        var yTo = gsap.quickTo(cursorTag, "y", { duration: 0.18, ease: "power3.out" });
        var prevX = 0;
        var prevY = 0;

        window.addEventListener("pointermove", function (e) {
          var vx = e.clientX - prevX;
          var vy = e.clientY - prevY;
          prevX = e.clientX;
          prevY = e.clientY;
          xTo(e.clientX);
          yTo(e.clientY);

          if (cursorTag.classList.contains("is-active")) {
            var speed = Math.min(Math.hypot(vx, vy), 45);
            var stretch = 1 + (speed / 45) * 0.16;
            var squash = 1 - (speed / 45) * 0.08;
            gsap.to(cursorTag, {
              scaleX: stretch,
              scaleY: squash,
              duration: 0.18,
              overwrite: "auto",
              onComplete: function () {
                gsap.to(cursorTag, { scaleX: 1, scaleY: 1, duration: 0.25, overwrite: "auto" });
              }
            });
          }
        });

        document.querySelectorAll("[data-cursor-label]").forEach(function (target) {
          target.addEventListener("pointerenter", function () {
            cursorTag.textContent = target.getAttribute("data-cursor-label") || "Xem";
            cursorTag.classList.add("is-active");
          });
          target.addEventListener("pointerleave", function () {
            cursorTag.classList.remove("is-active");
          });
        });
      }

      /* 12D. Elastic Feather-Light Magnetic Pull on Primary CTA Buttons */
      document.querySelectorAll("[data-magnetic]").forEach(function (btn) {
        btn.addEventListener("mousemove", function (e) {
          var rect = btn.getBoundingClientRect();
          var x = (e.clientX - rect.left - rect.width / 2) * 0.24;
          var y = (e.clientY - rect.top - rect.height / 2) * 0.24;
          gsap.to(btn, { x: x, y: y, duration: 0.26, ease: "power3.out" });
        });
        btn.addEventListener("mouseleave", function () {
          gsap.to(btn, { x: 0, y: 0, duration: 0.55, ease: "elastic.out(1, 0.55)" });
        });
      });
    }

    return function () {
      storyTrigger = null;
    };
  });
})();
