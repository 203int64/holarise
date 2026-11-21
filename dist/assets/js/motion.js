/**
 * HolaRise – Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên | v6 Native-Scroll Motion Engine
 * ZERO scroll-hijacking (No Lenis wheel block, No ScrollTrigger pin:true traps!):
 * - 100% Native 120Hz OS Trackpad Scrolling (impossible to ever get stuck in a section)
 * - Native CSS position:sticky Split-Scroll for 03 Core Programs + Mechanical Odometer (01 -> 03)
 * - Pure White Hero Split-Line Reveal + Apple Scale-to-Fullbleed Cinema Frame
 * - Kinetic Text Decode / Scramble on Kicker Badges
 * - Floating Spring Documentary Photo Preview on Blueprint Rows (velocity tilt!)
 * - Opposing Kinetic Scroll-Driven Watermark Band
 * - Obsidian Manifesto Word-by-Word Lift & Illumination
 * - Optical Specular Glass Glare + 3D Perspective Plate Tilt on Documentary Photos
 * - Live Tân Xã, Hòa Lạc GMT+7 Clock
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
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

  /* 2. Story Stage + Glider Pill Tabs + Touch/Trackpad Horizontal Swipe (Zero Scroll Traps!) */
  var storyStage = document.querySelector("[data-story-stage]");
  var storyTablist = storyStage ? storyStage.querySelector("[data-story-tablist]") : null;
  var storyGlider = storyStage ? storyStage.querySelector("[data-story-glider]") : null;
  var storyTabs = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-tab]")) : [];
  var storyPanels = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-panel]")) : [];
  var storySlides = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-slide]")) : [];
  var odometerDrum = storyStage ? storyStage.querySelector("[data-odometer-drum]") : null;
  var activeStoryIndex = 0;

  function setTabProgress(activeIndex, localProgress) {
    storyTabs.forEach(function (tab, i) {
      var p = i < activeIndex ? 1 : i === activeIndex ? localProgress : 0;
      tab.style.setProperty("--tab-progress", p.toFixed(3));
    });
  }

  function setStoryStep(index, localProgress) {
    if (!storyPanels.length) return;
    var clamped = Math.max(0, Math.min(index, storyPanels.length - 1));
    var pct = typeof localProgress === "number" ? Math.max(0.2, Math.min(1, localProgress)) : 1;
    setTabProgress(clamped, pct);

    if (storyTablist) {
      storyTablist.style.setProperty("--active-idx", String(clamped));
    }
    if (storyGlider) {
      storyGlider.style.setProperty("--active-idx", String(clamped));
    }

    if (odometerDrum) {
      var stepPct = (clamped * 100) / storyPanels.length;
      odometerDrum.style.transform = "translateY(-" + stepPct.toFixed(4) + "%)";
    }

    activeStoryIndex = clamped;

    storyTabs.forEach(function (tab, i) {
      var on = i === clamped;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
    });
    storyPanels.forEach(function (panel, i) {
      panel.classList.toggle("is-active", i === clamped);
    });
    storySlides.forEach(function (slide) {
      var slideIdx = parseInt(slide.getAttribute("data-story-slide"), 10);
      slide.classList.toggle("is-active", slideIdx === clamped);
    });
  }

  if (storyStage && storyPanels.length) {
    storyStage.classList.add("is-enhanced");
    setStoryStep(0, 1);

    storyTabs.forEach(function (tab, idx) {
      tab.addEventListener("click", function () {
        setStoryStep(idx, 1);
      });
    });

    /* Touch swipe left/right on storyStage (never blocks vertical page scroll) */
    var touchStartX = 0;
    var touchStartY = 0;
    storyStage.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches || !e.touches.length) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      },
      { passive: true }
    );
    storyStage.addEventListener(
      "touchend",
      function (e) {
        if (!e.changedTouches || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.25) {
          if (dx < 0 && activeStoryIndex < storyPanels.length - 1) {
            setStoryStep(activeStoryIndex + 1, 1);
          } else if (dx > 0 && activeStoryIndex > 0) {
            setStoryStep(activeStoryIndex - 1, 1);
          }
        }
      },
      { passive: true }
    );

    /* Horizontal two-finger trackpad swipe support (vertical scroll passes straight through) */
    var lastWheelSwitch = 0;
    storyStage.addEventListener(
      "wheel",
      function (e) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.4 && Math.abs(e.deltaX) > 22) {
          var now = Date.now();
          if (now - lastWheelSwitch < 480) return;
          if (e.deltaX > 0 && activeStoryIndex < storyPanels.length - 1) {
            lastWheelSwitch = now;
            setStoryStep(activeStoryIndex + 1, 1);
          } else if (e.deltaX < 0 && activeStoryIndex > 0) {
            lastWheelSwitch = now;
            setStoryStep(activeStoryIndex - 1, 1);
          }
        }
      },
      { passive: true }
    );
  }

  /* 2B. Mobile Horizontal Photo Exhibition Progress Sync */
  var hWrap = document.querySelector(".horizontal-track-wrap");
  var hFillMobile = document.querySelector("[data-exhibition-fill]");
  var hCountMobile = document.querySelector("[data-exhibition-count]");
  if (hWrap && hFillMobile && window.innerWidth < 1024) {
    var totalMobileCards = hWrap.querySelectorAll(".horizontal-card").length || 1;
    var updateMobileGalleryProgress = function () {
      var maxScroll = Math.max(1, hWrap.scrollWidth - hWrap.clientWidth);
      var prog = Math.min(1, Math.max(0, hWrap.scrollLeft / maxScroll));
      var pct = Math.max(1 / totalMobileCards, prog);
      hFillMobile.style.transform = "scaleX(" + pct.toFixed(4) + ")";
      if (hCountMobile) {
        var cur = Math.min(totalMobileCards, Math.max(1, Math.round(prog * (totalMobileCards - 1)) + 1));
        hCountMobile.textContent = "0" + cur + " / 0" + totalMobileCards;
      }
    };
    hWrap.addEventListener("scroll", updateMobileGalleryProgress, { passive: true });
    updateMobileGalleryProgress();
  }

  if (prefersReduced || !hasGsap) {
    return;
  }

  document.documentElement.classList.add("has-motion");
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);

  /* 3. Clean Fade-Up Kicker Badges (No garbled Vietnamese scramble letters) */
  document.querySelectorAll(".kicker").forEach(function (kicker) {
    gsap.from(kicker, {
      y: 12,
      opacity: 0,
      duration: 0.65,
      ease: "power3.out",
      clearProps: "transform",
      scrollTrigger: {
        trigger: kicker,
        start: "top 92%",
        once: true
      }
    });
  });

  /* 4. Chapter 1: Immersive Hero Card Entrance + Live Scroll Parallax (Mobile & Desktop) */
  var heroCard = document.querySelector("[data-hero-card]");
  if (heroCard) {
    var heroLines = heroCard.querySelectorAll(".split-line-inner");
    var heroFadeEls = heroCard.querySelectorAll("[data-hero-stagger]");
    var cinemaImg = heroCard.querySelector("[data-cinema-img]");

    var heroTl = gsap.timeline({ defaults: { ease: "power4.out" } });
    heroTl.from(heroCard, { scale: 0.96, opacity: 0, duration: 0.85 }, 0);
    if (cinemaImg) {
      heroTl.fromTo(cinemaImg, { scale: 1.15 }, { scale: 1.06, duration: 1.25 }, 0);
    }
    if (heroLines.length) {
      heroTl.from(heroLines, { yPercent: 112, duration: 0.9, stagger: 0.09 }, 0.14);
    }
    if (heroFadeEls.length) {
      heroTl.from(heroFadeEls, { y: 18, opacity: 0, duration: 0.72, stagger: 0.08 }, 0.24);
    }

    if (cinemaImg) {
      gsap.fromTo(
        cinemaImg,
        { yPercent: -5 },
        {
          yPercent: 9,
          ease: "none",
          scrollTrigger: {
            trigger: heroCard,
            start: "top top",
            end: "bottom top",
            scrub: 0.35,
            invalidateOnRefresh: true
          }
        }
      );
    }

    gsap.to(heroCard, {
      scale: 0.965,
      ease: "none",
      scrollTrigger: {
        trigger: heroCard,
        start: "top 15%",
        end: "bottom top",
        scrub: 0.4
      }
    });
  }

  /* 4B. Smooth Scroll Reveal for Section Headers & Editorial Blocks (Mobile & Desktop) */
  document.querySelectorAll("[data-reveal]").forEach(function (el) {
    gsap.from(el, {
      y: 28,
      opacity: 0,
      duration: 0.8,
      ease: "power3.out",
      clearProps: "transform",
      scrollTrigger: {
        trigger: el,
        start: "top 90%",
        once: true
      }
    });
  });

  /* 5. Opposing Kinetic Scroll-Driven Watermark Band */
  var kineticLines = document.querySelectorAll("[data-kinetic-dir]");
  kineticLines.forEach(function (line) {
    var dir = parseFloat(line.getAttribute("data-kinetic-dir")) || 1;
    gsap.fromTo(
      line,
      { xPercent: dir > 0 ? -10 : 3 },
      {
        xPercent: dir > 0 ? 3 : -12,
        ease: "none",
        scrollTrigger: {
          trigger: line.closest(".kinetic-band") || line,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.45
        }
      }
    );
  });

  /* 6. Architectural 1px Hairline Draw */
  document.querySelectorAll("[data-hairline]").forEach(function (line) {
    gsap.fromTo(
      line,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: {
          trigger: line,
          start: "top 88%",
          once: true
        }
      }
    );
  });

  /* 7. Tabular Metric Counters */
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
          duration: 1.2,
          ease: "power3.out",
          onUpdate: function () {
            el.textContent = Math.round(obj.val).toLocaleString("vi-VN");
          }
        });
      }
    });
  });

  /* 8. Obsidian Manifesto Word-by-Word Kinetic Lift & Illumination */
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
      stagger: 0.05,
      ease: "none",
      scrollTrigger: {
        trigger: manifestoEl,
        start: "top 82%",
        end: "bottom 45%",
        scrub: 0.4
      }
    });
  }

  /* 9. Frameless Image Plate Clip-Path Wipes */
  document.querySelectorAll("[data-curtain]").forEach(function (wrap) {
    var img = wrap.querySelector("img");
    gsap.fromTo(
      wrap,
      { clipPath: "inset(12% 0% 0% 0% round 12px)" },
      {
        clipPath: "inset(0% 0% 0% 0% round 12px)",
        duration: 0.88,
        ease: "power4.out",
        scrollTrigger: {
          trigger: wrap,
          start: "top 88%",
          once: true
        }
      }
    );
    if (img) {
      gsap.fromTo(
        img,
        { scale: 1.1 },
        {
          scale: 1,
          duration: 1.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: wrap,
            start: "top 88%",
            once: true
          }
        }
      );
    }
  });

  /* 10. Buoyant Staggered Reveals */
  document.querySelectorAll("[data-stagger-group]").forEach(function (group) {
    var items = group.querySelectorAll("[data-stagger-item]");
    if (!items.length) return;
    gsap.from(items, {
      y: 22,
      opacity: 0,
      duration: 0.72,
      stagger: 0.065,
      ease: "power3.out",
      clearProps: "transform",
      scrollTrigger: {
        trigger: group,
        start: "top 88%",
        once: true
      }
    });
  });

  /* 11. Desktop Scroll-Linked Exhibition & Interactive Physics (ZERO pin:true traps!) */
  var mm = gsap.matchMedia();

  mm.add("(min-width: 1024px)", function () {
    /* Horizontal Exhibition: Gentle Scroll-Linked Glide WITHOUT locking vertical scroll! */
    var hSection = document.querySelector("[data-horizontal-section]");
    var hTrack = document.querySelector("[data-horizontal-track]");
    var hFill = document.querySelector("[data-exhibition-fill]");
    var hCount = document.querySelector("[data-exhibition-count]");

    if (hSection && hTrack) {
      var hCards = hTrack.querySelectorAll(".horizontal-card");
      var totalCards = hCards.length || 1;
      var getGlideAmount = function () {
        return Math.min(360, Math.max(0, hTrack.scrollWidth - window.innerWidth));
      };

      gsap.fromTo(
        hTrack,
        { x: 40 },
        {
          x: function () {
            return -getGlideAmount();
          },
          ease: "none",
          scrollTrigger: {
            trigger: hSection,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.4,
            invalidateOnRefresh: true,
            onUpdate: function (self) {
              if (hFill) {
                var pct = Math.max(1 / totalCards, self.progress);
                hFill.style.transform = "scaleX(" + pct.toFixed(4) + ")";
              }
              if (hCount) {
                var cur = Math.min(totalCards, Math.max(1, Math.round(self.progress * (totalCards - 1)) + 1));
                hCount.textContent = "0" + cur + " / 0" + totalCards;
              }
            }
          }
        }
      );
    }

    /* Fine-Pointer Interactive Magic */
    if (isFinePointer) {
      /* Optical Glass Specular Glare + Subtle 3D Perspective Tilt on Photo Plates */
      document.querySelectorAll(".plate-media, .story-media-frame").forEach(function (plate) {
        var rX = gsap.quickTo(plate, "rotateX", { duration: 0.32, ease: "power3.out" });
        var rY = gsap.quickTo(plate, "rotateY", { duration: 0.32, ease: "power3.out" });
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
          rY(((xPct - 50) / 50) * 2.8);
          rX(((50 - yPct) / 50) * 2.8);
        });

        plate.addEventListener("pointerleave", function () {
          plate.style.setProperty("--glare-opacity", "0");
          rX(0);
          rY(0);
        });
      });

      /* Floating Spring Photo Preview on Blueprint Rows */
      var floatBox = document.getElementById("float-preview");
      var floatImg = document.getElementById("float-preview-img");
      if (floatBox && floatImg) {
        var fx = gsap.quickTo(floatBox, "x", { duration: 0.32, ease: "power3.out" });
        var fy = gsap.quickTo(floatBox, "y", { duration: 0.32, ease: "power3.out" });
        var frot = gsap.quickTo(floatBox, "rotation", { duration: 0.4, ease: "power3.out" });
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
            gsap.to(floatBox, { scale: 1, duration: 0.32, ease: "power3.out" });
          });

          row.addEventListener("pointermove", function (e) {
            var dx = e.clientX - lastX;
            lastX = e.clientX;
            var tilt = Math.max(-4.5, Math.min(4.5, dx * 0.3));
            fx(e.clientX + 26);
            fy(e.clientY - 120);
            frot(tilt);
          });

          row.addEventListener("pointerleave", function () {
            floatBox.classList.remove("is-visible");
            frot(0);
            gsap.to(floatBox, { scale: 0.86, duration: 0.22, ease: "power2.out" });
          });
        });
      }

      /* Velocity Squash-and-Stretch Circular Cursor Tag */
      var cursorTag = document.getElementById("cursor-tag");
      if (cursorTag) {
        var xTo = gsap.quickTo(cursorTag, "x", { duration: 0.16, ease: "power3.out" });
        var yTo = gsap.quickTo(cursorTag, "y", { duration: 0.16, ease: "power3.out" });
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
            var stretch = 1 + (speed / 45) * 0.15;
            var squash = 1 - (speed / 45) * 0.08;
            gsap.to(cursorTag, {
              scaleX: stretch,
              scaleY: squash,
              duration: 0.16,
              overwrite: "auto",
              onComplete: function () {
                gsap.to(cursorTag, { scaleX: 1, scaleY: 1, duration: 0.22, overwrite: "auto" });
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

      /* Elastic Feather-Light Magnetic Pull on Primary CTA Buttons */
      document.querySelectorAll("[data-magnetic]").forEach(function (btn) {
        btn.addEventListener("mousemove", function (e) {
          var rect = btn.getBoundingClientRect();
          var x = (e.clientX - rect.left - rect.width / 2) * 0.22;
          var y = (e.clientY - rect.top - rect.height / 2) * 0.22;
          gsap.to(btn, { x: x, y: y, duration: 0.24, ease: "power3.out" });
        });
        btn.addEventListener("mouseleave", function () {
          gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1, 0.55)" });
        });
      });
    }
  });
})();
