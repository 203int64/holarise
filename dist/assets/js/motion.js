/**
 * HolaRise – Cộng đồng Thanh niên Hòa Lạc - Cùng Vươn Lên | Native-Scroll Motion Engine
 * ZERO scroll-hijacking:
 * - Native CSS position:sticky Split-Scroll + Mechanical Odometer (01 -> 03)
 * - Editorial Hero Split-Line Reveal + Scale-to-Fullbleed Cinema Frame
 * - Opposing Kinetic Scroll-Driven Band
 * - Obsidian Manifesto Word-by-Word Illumination
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  var isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var desktopMq = window.matchMedia("(min-width: 1024px)");

  /* 1. Native CSS Scroll Progress fallback ONLY when animation-timeline: scroll() is unsupported */
  var progressBar = document.getElementById("scroll-progress");
  if (progressBar && !prefersReduced && !(window.CSS && CSS.supports("animation-timeline", "scroll()"))) {
    var progressRafPending = false;
    var updateProgress = function () {
      var scrollable = document.documentElement.scrollHeight - window.innerHeight;
      var pct = scrollable > 0 ? Math.min(Math.max(window.scrollY / scrollable, 0), 1) : 0;
      progressBar.style.transform = "scaleX(" + pct + ")";
    };
    window.addEventListener(
      "scroll",
      function () {
        if (progressRafPending) return;
        progressRafPending = true;
        window.requestAnimationFrame(function () {
          progressRafPending = false;
          updateProgress();
        });
      },
      { passive: true }
    );
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
  var desktopMediaFrame = storyStage ? storyStage.querySelector(".story-media-frame--desktop") : null;
  var activeStoryIndex = 0;

  function setTabProgress(activeIndex, localProgress) {
    storyTabs.forEach(function (tab, i) {
      var p = i < activeIndex ? 1 : i === activeIndex ? localProgress : 0;
      tab.style.setProperty("--tab-progress", p.toFixed(3));
    });
  }

  function setStoryStep(index, localProgress, force) {
    if (!storyPanels.length) return;
    var clamped = Math.max(0, Math.min(index, storyPanels.length - 1));
    if (!force && storyStage.classList.contains("is-enhanced") && clamped === activeStoryIndex) return;
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

    if (desktopMediaFrame) {
      desktopMediaFrame.setAttribute("data-cursor-label", "0" + (clamped + 1) + " · 0" + storyPanels.length);
    }

    activeStoryIndex = clamped;

    storyTabs.forEach(function (tab, i) {
      var on = i === clamped;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("tabindex", on ? "0" : "-1");
    });
    storyPanels.forEach(function (panel, i) {
      panel.classList.toggle("is-active", i === clamped);
    });
    storySlides.forEach(function (slide) {
      var slideIdx = parseInt(slide.getAttribute("data-story-slide"), 10);
      var isActiveSlide = slideIdx === clamped;
      slide.classList.toggle("is-active", isActiveSlide);
      slide.setAttribute("tabindex", isActiveSlide ? "0" : "-1");
    });
  }

  if (storyStage && storyPanels.length) {
    setStoryStep(0, 1, true);
    storyStage.classList.add("is-enhanced");

    storyTabs.forEach(function (tab, idx) {
      tab.addEventListener("click", function () {
        setStoryStep(idx, 1);
      });
      tab.addEventListener("keydown", function (e) {
        var nextIdx = null;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % storyTabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + storyTabs.length) % storyTabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = storyTabs.length - 1;
        if (nextIdx !== null) {
          e.preventDefault();
          setStoryStep(nextIdx, 1);
          storyTabs[nextIdx].focus();
        }
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

  /* 2B. Mobile Horizontal Photo Exhibition Sync (Desktop uses sticky runway ScrollTrigger) */
  var hSectionEl = document.querySelector("[data-horizontal-section]");
  var hWrap = document.querySelector(".horizontal-track-wrap");
  var hFillMobile = document.querySelector("[data-exhibition-fill]");
  var hCountMobile = document.querySelector("[data-exhibition-count]");
  var hPrevBtn = document.querySelector("[data-exhibition-prev]");
  var hNextBtn = document.querySelector("[data-exhibition-next]");
  if (hWrap && hFillMobile) {
    var totalGalleryCards = hWrap.querySelectorAll(".horizontal-card").length || 1;
    var galleryRafPending = false;
    var updateMobileGalleryProgress = function () {
      if (desktopMq.matches && hasGsap && !prefersReduced) return;
      var maxScroll = Math.max(1, hWrap.scrollWidth - hWrap.clientWidth);
      var prog = Math.min(1, Math.max(0, hWrap.scrollLeft / maxScroll));
      var pct = Math.max(1 / totalGalleryCards, prog);
      hFillMobile.style.transform = "scaleX(" + pct.toFixed(4) + ")";
      if (hCountMobile) {
        var cur = Math.min(totalGalleryCards, Math.max(1, Math.round(prog * (totalGalleryCards - 1)) + 1));
        var pCur = cur < 10 ? "0" + cur : String(cur);
        var pTot = totalGalleryCards < 10 ? "0" + totalGalleryCards : String(totalGalleryCards);
        hCountMobile.textContent = pCur + " / " + pTot;
      }
      if (hPrevBtn) hPrevBtn.disabled = hWrap.scrollLeft <= 4;
      if (hNextBtn) hNextBtn.disabled = hWrap.scrollLeft >= maxScroll - 4;
    };
    hWrap.addEventListener(
      "scroll",
      function () {
        if (galleryRafPending) return;
        galleryRafPending = true;
        window.requestAnimationFrame(function () {
          galleryRafPending = false;
          updateMobileGalleryProgress();
        });
      },
      { passive: true }
    );
    updateMobileGalleryProgress();

    var stepGallery = function (dir) {
      if (desktopMq.matches && hasGsap && !prefersReduced && hSectionEl) {
        var rect = hSectionEl.getBoundingClientRect();
        var sectionTop = window.scrollY + rect.top;
        var runway = Math.max(1, hSectionEl.offsetHeight - window.innerHeight);
        var curProg = Math.min(1, Math.max(0, (window.scrollY - sectionTop) / runway));
        var curIdx = Math.round(curProg * (totalGalleryCards - 1));
        var nextIdx = Math.max(0, Math.min(totalGalleryCards - 1, curIdx + dir));
        var targetProg = totalGalleryCards > 1 ? nextIdx / (totalGalleryCards - 1) : 0;
        window.scrollTo({
          top: sectionTop + targetProg * runway,
          behavior: "smooth"
        });
        return;
      }
      var card = hWrap.querySelector(".horizontal-card");
      var step = card ? card.getBoundingClientRect().width + 24 : 380;
      hWrap.scrollBy({ left: dir * step, behavior: prefersReduced ? "auto" : "smooth" });
    };

    if (hPrevBtn) {
      hPrevBtn.addEventListener("click", function () {
        stepGallery(-1);
      });
    }
    if (hNextBtn) {
      hNextBtn.addEventListener("click", function () {
        stepGallery(1);
      });
    }
  }

  /* 2C. Desktop Orbital Reading Progress + Back-to-Top Ring (Zero work on Mobile < 1024px) */
  var orbitalBtn = document.getElementById("orbital-top-btn");
  if (orbitalBtn && window.matchMedia("(min-width: 1024px)").matches) {
    var orbitalFill = orbitalBtn.querySelector(".orbital-ring-fill");
    var circumference = 2 * Math.PI * 19;
    if (orbitalFill) {
      orbitalFill.style.strokeDasharray = circumference.toFixed(2);
      orbitalFill.style.strokeDashoffset = circumference.toFixed(2);
    }
    var orbitalRafPending = false;
    var syncOrbital = function () {
      var y = window.scrollY || 0;
      var scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      var pct = Math.min(1, Math.max(0, y / scrollable));
      orbitalBtn.classList.toggle("is-visible", y > 440);
      if (orbitalFill) {
        orbitalFill.style.strokeDashoffset = (circumference * (1 - pct)).toFixed(2);
      }
    };
    window.addEventListener(
      "scroll",
      function () {
        if (orbitalRafPending) return;
        orbitalRafPending = true;
        window.requestAnimationFrame(function () {
          orbitalRafPending = false;
          syncOrbital();
        });
      },
      { passive: true }
    );
    syncOrbital();

    orbitalBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
    });
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

  /* 4. Home hero card entrance and scroll motion */
  var heroCard = document.querySelector("[data-hero-card]");
  if (heroCard) {
    var heroLines = heroCard.querySelectorAll(".split-line-inner");
    var heroFadeEls = heroCard.querySelectorAll("[data-hero-stagger]");
    var heroBottom = heroCard.querySelector(".hero-card-bottom");

    var heroTl = gsap.timeline({ defaults: { ease: "power4.out" } });
    heroTl.fromTo(
      heroCard,
      { clipPath: "inset(4% 2% 4% 2% round 34px)", scale: 0.96, opacity: 0 },
      { clipPath: "inset(0% 0% 0% 0% round 26px)", scale: 1, opacity: 1, duration: 0.95, clearProps: "clipPath" },
      0
    );
    if (heroLines.length) {
      heroTl.from(heroLines, { yPercent: 112, duration: 0.9, stagger: 0.09 }, 0.14);
    }
    if (heroFadeEls.length) {
      heroTl.from(heroFadeEls, { y: 18, opacity: 0, duration: 0.72, stagger: 0.08 }, 0.24);
    }

    var heroMm = gsap.matchMedia();

    heroMm.add("(max-width: 1023px)", function () {
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
    });

    heroMm.add("(min-width: 1024px)", function () {
      gsap.fromTo(
        heroCard,
        { scale: 1 },
        {
          scale: 0.92,
          ease: "none",
          scrollTrigger: {
            trigger: heroCard,
            start: "top top",
            end: "bottom top",
            scrub: 0.45,
            invalidateOnRefresh: true
          }
        }
      );

      if (heroBottom) {
        gsap.fromTo(
          heroBottom,
          { y: 0, opacity: 1 },
          {
            y: -56,
            opacity: 0.2,
            ease: "none",
            scrollTrigger: {
              trigger: heroCard,
              start: "top top",
              end: "bottom top",
              scrub: 0.45,
              invalidateOnRefresh: true
            }
          }
        );
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

  /* 5. Opposing Kinetic Scroll-Driven Typography Band v2
     - Mobile (< 1024px): Native CSS animation-timeline: view() runs on compositor thread (zero JS overhead).
       Only falls back to GSAP when view() is unsupported.
     - Desktop (>= 1024px): GSAP ScrollTrigger drives opposing horizontal glide + scroll-velocity skew! */
  var kineticBand = document.querySelector("[data-kinetic-band]");
  var kineticLines = document.querySelectorAll("[data-kinetic-dir]");
  var supportsViewTimeline = Boolean(
    window.CSS && CSS.supports && CSS.supports("(animation-timeline: view()) and (animation-range: entry)")
  );

  if (kineticLines.length) {
    var kineticMm = gsap.matchMedia();

    kineticMm.add("(min-width: 1024px)", function () {
      var skewSetters = [];
      kineticLines.forEach(function (line) {
        var dir = parseFloat(line.getAttribute("data-kinetic-dir")) || 1;
        gsap.fromTo(
          line,
          { x: 0, xPercent: dir > 0 ? -28 : 2 },
          {
            x: 0,
            xPercent: dir > 0 ? 2 : -28,
            ease: "none",
            scrollTrigger: {
              trigger: kineticBand || line,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.55,
              invalidateOnRefresh: true
            }
          }
        );
        skewSetters.push({
          dir: dir,
          set: gsap.quickTo(line, "skewX", { duration: 0.55, ease: "power3.out" })
        });
      });

      var skewResetTimer = null;
      ScrollTrigger.create({
        trigger: kineticBand || kineticLines[0],
        start: "top bottom",
        end: "bottom top",
        onUpdate: function (self) {
          var velocity = self.getVelocity();
          var clamped = Math.max(-8, Math.min(8, velocity / 240));
          skewSetters.forEach(function (item) {
            item.set(clamped * (item.dir > 0 ? -1 : 1));
          });
          if (skewResetTimer) clearTimeout(skewResetTimer);
          skewResetTimer = setTimeout(function () {
            skewSetters.forEach(function (item) {
              item.set(0);
            });
          }, 140);
        }
      });
    });

    if (!supportsViewTimeline) {
      kineticMm.add("(max-width: 1023px)", function () {
        kineticLines.forEach(function (line) {
          var dir = parseFloat(line.getAttribute("data-kinetic-dir")) || 1;
          gsap.fromTo(
            line,
            { x: 0, xPercent: dir > 0 ? -16 : 2 },
            {
              x: 0,
              xPercent: dir > 0 ? 2 : -18,
              ease: "none",
              scrollTrigger: {
                trigger: kineticBand || line,
                start: "top bottom",
                end: "bottom top",
                scrub: 0.35
              }
            }
          );
        });
      });
    }
  }

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

  /* 8. Obsidian Manifesto Word-by-Word Kinetic Lift, Blur-Reveal & Ambient Light Sweep */
  var manifestoEl = document.querySelector("[data-scrub-words]");
  var manifestoGlow = document.querySelector("[data-manifesto-glow]");
  if (manifestoEl) {
    var rawText = manifestoEl.textContent.trim();
    var words = rawText.split(/\s+/);
    var sunriseWords = {
      "vươn": true,
      "xa": true,
      "tử": true,
      "tế": true,
      "nhân": true,
      "cách": true,
      "sẻ": true,
      "chia": true,
      "bên": true,
      "trong": true
    };
    var emeraldWords = {
      "hòa": true,
      "lạc": true,
      "thạch": true,
      "thất": true,
      "xanh": true,
      "cộng": true,
      "đồng": true
    };
    var frag = document.createDocumentFragment();
    words.forEach(function (w, idx) {
      var span = document.createElement("span");
      span.className = "scrub-word";
      var cleanWord = w.replace(/^[\u201C\u201D"'(\[]+|[.,;:!?\u201C\u201D"')\]—–-]+$/g, "").toLowerCase();
      if (sunriseWords[cleanWord]) {
        span.classList.add("scrub-word--highlight");
      } else if (emeraldWords[cleanWord]) {
        span.classList.add("scrub-word--emerald");
      }
      span.textContent = w;
      frag.appendChild(span);
      if (idx < words.length - 1) {
        frag.appendChild(document.createTextNode(" "));
      }
    });
    manifestoEl.textContent = "";
    manifestoEl.appendChild(frag);

    var wordSpans = manifestoEl.querySelectorAll(".scrub-word");
    var manifestoMm = gsap.matchMedia();

    manifestoMm.add("(max-width: 1023px)", function () {
      gsap.to(wordSpans, {
        opacity: 1,
        y: 0,
        stagger: 0.045,
        ease: "none",
        scrollTrigger: {
          trigger: manifestoEl,
          start: "top 85%",
          end: "bottom 48%",
          scrub: 0.35
        }
      });
    });

    manifestoMm.add("(min-width: 1024px)", function () {
      gsap.to(wordSpans, {
        opacity: 1,
        y: 0,
        stagger: 0.055,
        ease: "power1.out",
        scrollTrigger: {
          trigger: manifestoEl,
          start: "top 72%",
          end: "bottom 42%",
          scrub: 0.55
        }
      });

      if (manifestoGlow) {
        gsap.fromTo(
          manifestoGlow,
          { xPercent: -25, yPercent: -15 },
          {
            xPercent: 35,
            yPercent: 20,
            ease: "none",
            scrollTrigger: {
              trigger: manifestoGlow.closest(".manifesto-section") || manifestoEl,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.8
            }
          }
        );
      }
    });
  }

  /* 9. Frameless Image Plate Clip-Path Wipes */
  document.querySelectorAll("[data-curtain]").forEach(function (wrap) {
    var img = wrap.querySelector("img");
    gsap.fromTo(
      wrap,
      { clipPath: "inset(16% 3% 16% 3% round 22px)" },
      {
        clipPath: "inset(0% 0% 0% 0% round 16px)",
        duration: 0.96,
        ease: "power4.out",
        clearProps: "clipPath",
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
        { scale: 1.2 },
        {
          scale: 1,
          duration: 1.15,
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

  /* 11. Desktop Horizontal Exhibition Runway & Tactile Physics (ZERO pin:true traps!) */
  var mm = gsap.matchMedia();

  mm.add("(min-width: 1024px)", function () {
    /* True Scroll-Driven Horizontal Gallery Runway (CSS sticky stage + GSAP travel) */
    var hSection = document.querySelector("[data-horizontal-section]");
    var hTrack = document.querySelector("[data-horizontal-track]");
    var hCards = hTrack ? Array.prototype.slice.call(hTrack.querySelectorAll(".horizontal-card")) : [];
    var hImages = hTrack ? Array.prototype.slice.call(hTrack.querySelectorAll(".horizontal-frame img")) : [];
    var totalDeskCards = hCards.length || 1;

    if (hSection && hTrack) {
      var getMaxShift = function () {
        return Math.max(0, hTrack.scrollWidth - window.innerWidth + 80);
      };
      var cardSkewSetters = hCards.map(function (c) {
        return gsap.quickTo(c, "skewX", { duration: 0.42, ease: "power3.out" });
      });
      var cardSkewReset = null;

      gsap.fromTo(
        hTrack,
        { x: 0 },
        {
          x: function () {
            return -getMaxShift();
          },
          ease: "none",
          scrollTrigger: {
            trigger: hSection,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.65,
            invalidateOnRefresh: true,
            onUpdate: function (self) {
              if (hFillMobile) {
                var pct = Math.max(1 / totalDeskCards, self.progress);
                hFillMobile.style.transform = "scaleX(" + pct.toFixed(4) + ")";
              }
              if (hCountMobile) {
                var cur = Math.min(totalDeskCards, Math.max(1, Math.round(self.progress * (totalDeskCards - 1)) + 1));
                var pCur = cur < 10 ? "0" + cur : String(cur);
                var pTot = totalDeskCards < 10 ? "0" + totalDeskCards : String(totalDeskCards);
                hCountMobile.textContent = pCur + " / " + pTot;
              }
              if (hPrevBtn) hPrevBtn.disabled = self.progress <= 0.02;
              if (hNextBtn) hNextBtn.disabled = self.progress >= 0.98;

              var skew = Math.max(-3.5, Math.min(3.5, -(self.getVelocity() / 520)));
              cardSkewSetters.forEach(function (set) {
                set(skew);
              });
              if (cardSkewReset) clearTimeout(cardSkewReset);
              cardSkewReset = setTimeout(function () {
                cardSkewSetters.forEach(function (set) {
                  set(0);
                });
              }, 130);
            }
          }
        }
      );

      if (hImages.length) {
        gsap.fromTo(
          hImages,
          { xPercent: -6 },
          {
            xPercent: 6,
            ease: "none",
            scrollTrigger: {
              trigger: hSection,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.65,
              invalidateOnRefresh: true
            }
          }
        );
      }
    }

    /* Fine-Pointer Interactive Magic */
    if (isFinePointer) {
      /* Desktop Pointer Hairline Spotlight on Architectural Cards (Zero Mobile Cost) */
      document
        .querySelectorAll(".metric-item, .event-card, .value-col, .sdg-col, .editorial-card")
        .forEach(function (card) {
          card.setAttribute("data-spotlight", "");
          card.addEventListener("pointermove", function (e) {
            var rect = card.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            card.style.setProperty("--mx", x.toFixed(1) + "px");
            card.style.setProperty("--my", y.toFixed(1) + "px");
          });
        });

      /* Optical Glass Specular Glare + Pronounced 3D Perspective Tilt on Photo Plates */
      document
        .querySelectorAll(".plate-media, .event-card-media, .horizontal-frame")
        .forEach(function (plate) {
          var rX = gsap.quickTo(plate, "rotateX", { duration: 0.28, ease: "power3.out" });
          var rY = gsap.quickTo(plate, "rotateY", { duration: 0.28, ease: "power3.out" });
          gsap.set(plate, { transformPerspective: 900 });

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
            rY(((xPct - 50) / 50) * 5.5);
            rX(((50 - yPct) / 50) * 5.5);
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

  /* Recalculate ScrollTrigger geometry cleanly once Be Vietnam Pro & Lora finish loading */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      ScrollTrigger.refresh();
    });
  }
})();
