/**
 * HolaRise – Hòa Lạc | v8 Awwwards Editorial Motion Engine
 * - Desktop Velvety Wheel Inertia synced 1:1 with GSAP Ticker & ScrollTrigger (0% idle CPU, native modal/anchor safe)
 * - Cross-Document Directional View Transitions (`pagereveal` progressive enhancement)
 * - 3-Pillar Story Stage Clip-Path Curtain Wipes + 90/10 Tonal Aura Shift (`holaheart` -> `holagreen` -> `holaconnect`)
 * - 340vh Horizontal Exhibition Runway + Active Center Focus + Contextual Cursor Pill (`pointer: fine`)
 * - Hero Optical Depth + Velocity-Reactive Kinetic Band + Obsidian Word-by-Word Illumination + 3D Member Pass Tilt
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  var isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var desktopMq = window.matchMedia("(min-width: 1024px)");

  /* 0. Cross-Document Directional View Transitions (modern-web-guidance: cross-document-transitions) */
  if (!prefersReduced && "onpagereveal" in window) {
    var ROUTE_ORDER = {
      "/": 0,
      "/gioi-thieu/": 1,
      "/lich-hoat-dong/": 2,
      "/hanh-trinh/": 3,
      "/tham-gia/": 4,
      "/chinh-sach/": 5,
    };
    var rankPath = function (pathname) {
      var p = String(pathname || "/");
      if (ROUTE_ORDER[p] !== undefined) return ROUTE_ORDER[p];
      if (p.indexOf("/su-kien/") === 0) return 2.5;
      if (p.indexOf("/hanh-trinh/") === 0) return 3.5;
      return 4;
    };
    window.addEventListener("pagereveal", function (e) {
      if (!e.viewTransition || !window.navigation || !window.navigation.activation) return;
      try {
        var fromEntry = window.navigation.activation.from;
        var toEntry = window.navigation.activation.entry;
        if (!fromEntry || !toEntry || !fromEntry.url || !toEntry.url) return;
        var fromPath = new URL(fromEntry.url).pathname;
        var toPath = new URL(toEntry.url).pathname;
        if (fromPath === toPath) return;
        var dir = rankPath(toPath) >= rankPath(fromPath) ? "forward" : "back";
        e.viewTransition.types.add(dir);
      } catch (_err) {}
    });
  }

  /* 1. Native CSS Scroll Progress fallback ONLY when animation-timeline: scroll() is unsupported */
  var progressBar = document.getElementById("scroll-progress");
  if (
    progressBar &&
    !prefersReduced &&
    !(window.CSS && CSS.supports && CSS.supports("(animation-timeline: scroll()) and (animation-range: 0% 100%)"))
  ) {
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

  /* 2. 3-Pillar Story Stage + Tonal Aura Shift + Curtain Wipe + Swipe */
  var storySection = document.querySelector("[data-story-section]");
  var storyStage = document.querySelector("[data-story-stage]");
  var storyTablist = storyStage ? storyStage.querySelector("[data-story-tablist]") : null;
  var storyGlider = storyStage ? storyStage.querySelector("[data-story-glider]") : null;
  var storyTabs = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-tab]")) : [];
  var storyPanels = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-panel]")) : [];
  var storySlides = storyStage ? Array.prototype.slice.call(storyStage.querySelectorAll("[data-story-slide]")) : [];
  var odometerDrum = storyStage ? storyStage.querySelector("[data-odometer-drum]") : null;
  var activeStoryIndex = 0;

  function setStoryStep(index, animateWipe, force) {
    if (!storyPanels.length) return;
    var clamped = Math.max(0, Math.min(index, storyPanels.length - 1));
    if (!force && storyStage.classList.contains("is-enhanced") && clamped === activeStoryIndex) return;
    var prevIdx = activeStoryIndex;
    var dir = clamped >= prevIdx ? 1 : -1;

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

    var activeTab = storyTabs[clamped];
    var pillarKey = (activeTab && activeTab.getAttribute("data-pillar")) || "holaheart";
    if (storySection) {
      storySection.setAttribute("data-pillar", pillarKey);
    }
    if (storyStage) {
      storyStage.setAttribute("data-pillar", pillarKey);
    }

    activeStoryIndex = clamped;

    storyTabs.forEach(function (tab, i) {
      var on = i === clamped;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("tabindex", on ? "0" : "-1");
    });

    storyPanels.forEach(function (panel, i) {
      var on = i === clamped;
      panel.classList.toggle("is-active", on);
      panel.setAttribute("aria-hidden", String(!on));
      if (hasGsap) {
        window.gsap.killTweensOf(panel);
      }
      if (on && animateWipe && hasGsap && !prefersReduced) {
        window.gsap.fromTo(
          panel,
          { y: dir * 14, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.56,
            ease: "power3.out",
            clearProps: "opacity,transform",
            overwrite: "auto",
          }
        );
      } else {
        panel.style.removeProperty("opacity");
        panel.style.removeProperty("transform");
      }
    });

    storySlides.forEach(function (slide) {
      var slideIdx = parseInt(slide.getAttribute("data-story-slide"), 10);
      var isActiveSlide = slideIdx === clamped;
      var wasActive = slideIdx === prevIdx && prevIdx !== clamped;
      slide.classList.toggle("is-active", isActiveSlide);
      slide.classList.toggle("is-prev", wasActive);
      slide.setAttribute("tabindex", isActiveSlide ? "0" : "-1");

      if (!isActiveSlide) {
        if (hasGsap) {
          window.gsap.killTweensOf(slide);
        }
        slide.style.removeProperty("opacity");
        slide.style.removeProperty("clip-path");
      }

      if (isActiveSlide && animateWipe && hasGsap && !prefersReduced) {
        var img = slide.querySelector("img");
        var startClip = dir > 0 ? "inset(100% 0% 0% 0%)" : "inset(0% 0% 100% 0%)";
        window.gsap.fromTo(
          slide,
          { clipPath: startClip, opacity: 1 },
          {
            clipPath: "inset(0% 0% 0% 0%)",
            duration: 0.78,
            ease: "power4.out",
            clearProps: "clipPath,opacity",
            overwrite: "auto",
          }
        );
        if (img) {
          window.gsap.fromTo(
            img,
            { scale: 1.13 },
            { scale: 1, duration: 1.05, ease: "power3.out", clearProps: "transform", overwrite: "auto" }
          );
        }
      }
    });
  }

  if (storyStage && storyPanels.length) {
    setStoryStep(0, false, true);
    storyStage.classList.add("is-enhanced");

    storyTabs.forEach(function (tab, idx) {
      tab.addEventListener("click", function () {
        setStoryStep(idx, true, false);
      });
      tab.addEventListener("keydown", function (e) {
        var nextIdx = null;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % storyTabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + storyTabs.length) % storyTabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = storyTabs.length - 1;
        if (nextIdx !== null) {
          e.preventDefault();
          setStoryStep(nextIdx, true, false);
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
            setStoryStep(activeStoryIndex + 1, true, false);
          } else if (dx > 0 && activeStoryIndex > 0) {
            setStoryStep(activeStoryIndex - 1, true, false);
          }
        }
      },
      { passive: true }
    );

    /* Horizontal two-finger trackpad swipe support */
    var lastWheelSwitch = 0;
    storyStage.addEventListener(
      "wheel",
      function (e) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.4 && Math.abs(e.deltaX) > 22) {
          var now = Date.now();
          if (now - lastWheelSwitch < 480) return;
          if (e.deltaX > 0 && activeStoryIndex < storyPanels.length - 1) {
            lastWheelSwitch = now;
            setStoryStep(activeStoryIndex + 1, true, false);
          } else if (e.deltaX < 0 && activeStoryIndex > 0) {
            lastWheelSwitch = now;
            setStoryStep(activeStoryIndex - 1, true, false);
          }
        }
      },
      { passive: true }
    );
  }

  /* 2B. Mobile Horizontal Photo Exhibition Sync */
  var hSectionEl = document.querySelector("[data-horizontal-section]");
  var hWrap = document.querySelector(".horizontal-track-wrap");
  var hFillMobile = document.querySelector("[data-exhibition-fill]");
  var hCountMobile = document.querySelector("[data-exhibition-count]");
  var hPrevBtn = document.querySelector("[data-exhibition-prev]");
  var hNextBtn = document.querySelector("[data-exhibition-next]");
  if (hWrap && hFillMobile) {
    var getTotalGalleryCards = function () {
      return hWrap.querySelectorAll(".horizontal-card").length || 1;
    };
    var galleryRafPending = false;
    var updateMobileGalleryProgress = function () {
      if (desktopMq.matches && hasGsap && !prefersReduced) return;
      var totalGalleryCards = getTotalGalleryCards();
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
      var totalGalleryCards = getTotalGalleryCards();
      if (desktopMq.matches && hasGsap && !prefersReduced && hSectionEl) {
        var rect = hSectionEl.getBoundingClientRect();
        var sectionTop = window.scrollY + rect.top;
        var runway = Math.max(1, hSectionEl.offsetHeight - window.innerHeight);
        var curProg = Math.min(1, Math.max(0, (window.scrollY - sectionTop) / runway));
        var curIdx = Math.round(curProg * (totalGalleryCards - 1));
        var nextIdx = Math.max(0, Math.min(totalGalleryCards - 1, curIdx + dir));
        var targetProg = totalGalleryCards > 1 ? nextIdx / (totalGalleryCards - 1) : 0;
        var targetTop = sectionTop + targetProg * runway;
        if (window.HolaSmoothScroll && window.HolaSmoothScroll.scrollTo) {
          window.HolaSmoothScroll.scrollTo(targetTop);
        } else {
          window.scrollTo({ top: targetTop, behavior: "smooth" });
        }
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

  /* 2C. Desktop Orbital Reading Progress + Back-to-Top Ring */
  var orbitalBtn = document.getElementById("orbital-top-btn");
  if (orbitalBtn && desktopMq.matches) {
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
      if (window.HolaSmoothScroll && window.HolaSmoothScroll.scrollTo && !prefersReduced) {
        window.HolaSmoothScroll.scrollTo(0);
      } else {
        window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
      }
    });
  }

  if (prefersReduced || !hasGsap) {
    return;
  }

  document.documentElement.classList.add("has-motion");
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  gsap.ticker.lagSmoothing(0);

  /* 2D. Native Scroll Shim (Zero wheel/trackpad hijacking — smooth 120fps native inertia) */
  window.HolaSmoothScroll = {
    setLocked: function () {},
    scrollTo: function (destY) {
      window.scrollTo({
        top: Math.max(0, Number(destY) || 0),
        behavior: prefersReduced ? "auto" : "smooth",
      });
    },
  };

  /* 3. Clean Fade-Up Kicker Badges */
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
        once: true,
      },
    });
  });

  /* 4. Chapter 1: Immersive Hero Card Entrance + Multi-Layer Optical Depth */
  var heroCard = document.querySelector("[data-hero-card]");
  if (heroCard) {
    var heroLines = heroCard.querySelectorAll(".split-line-inner");
    var heroFadeEls = heroCard.querySelectorAll("[data-hero-stagger]");
    var heroBottom = heroCard.querySelector(".hero-card-bottom");
    var heroTag = heroCard.querySelector(".hero-glass-tag");
    var cinemaImg = heroCard.querySelector("[data-cinema-img]");

    var heroTl = gsap.timeline({ defaults: { ease: "power4.out" } });
    heroTl.fromTo(
      heroCard,
      { clipPath: "inset(4% 2% 4% 2% round 34px)", scale: 0.965, opacity: 0 },
      { clipPath: "inset(0% 0% 0% 0% round 26px)", scale: 1, opacity: 1, duration: 0.98, clearProps: "clipPath" },
      0
    );
    if (cinemaImg) {
      heroTl.fromTo(cinemaImg, { scale: 1.18 }, { scale: 1.04, duration: 1.3 }, 0);
    }
    if (heroLines.length) {
      heroTl.from(heroLines, { yPercent: 112, duration: 0.92, stagger: 0.09 }, 0.14);
    }
    if (heroFadeEls.length) {
      heroTl.from(heroFadeEls, { y: 18, opacity: 0, duration: 0.74, stagger: 0.08 }, 0.24);
    }

    var heroMm = gsap.matchMedia();

    heroMm.add("(max-width: 1023px)", function () {
      if (cinemaImg) {
        gsap.fromTo(
          cinemaImg,
          { yPercent: -4 },
          {
            yPercent: 9,
            ease: "none",
            scrollTrigger: {
              trigger: heroCard,
              start: "top top",
              end: "bottom top",
              scrub: 0.4,
              invalidateOnRefresh: true,
            },
          }
        );
      }
      gsap.to(heroCard, {
        scale: 0.968,
        ease: "none",
        scrollTrigger: {
          trigger: heroCard,
          start: "top 15%",
          end: "bottom top",
          scrub: 0.4,
        },
      });
    });

    heroMm.add("(min-width: 1024px)", function () {
      gsap.fromTo(
        heroCard,
        { scale: 1 },
        {
          scale: 0.935,
          ease: "none",
          scrollTrigger: {
            trigger: heroCard,
            start: "top top",
            end: "bottom top",
            scrub: 0.5,
            invalidateOnRefresh: true,
          },
        }
      );

      if (cinemaImg) {
        gsap.fromTo(
          cinemaImg,
          { yPercent: -6, scale: 1.04 },
          {
            yPercent: 15,
            scale: 1.16,
            ease: "none",
            scrollTrigger: {
              trigger: heroCard,
              start: "top top",
              end: "bottom top",
              scrub: 0.5,
              invalidateOnRefresh: true,
            },
          }
        );
      }

      if (heroBottom) {
        gsap.fromTo(
          heroBottom,
          { y: 0, opacity: 1 },
          {
            y: -48,
            opacity: 0.22,
            ease: "none",
            scrollTrigger: {
              trigger: heroCard,
              start: "top top",
              end: "bottom top",
              scrub: 0.5,
              invalidateOnRefresh: true,
            },
          }
        );
      }

      if (isFinePointer && cinemaImg) {
        var imgX = gsap.quickTo(cinemaImg, "x", { duration: 0.55, ease: "power3.out" });
        var imgY = gsap.quickTo(cinemaImg, "y", { duration: 0.55, ease: "power3.out" });
        var tagX = heroTag ? gsap.quickTo(heroTag, "x", { duration: 0.45, ease: "power3.out" }) : null;
        var tagY = heroTag ? gsap.quickTo(heroTag, "y", { duration: 0.45, ease: "power3.out" }) : null;

        heroCard.addEventListener("pointermove", function (e) {
          var rect = heroCard.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          var nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
          var ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
          imgX(-nx * 14);
          imgY(-ny * 10);
          if (tagX && tagY) {
            tagX(nx * 7);
            tagY(ny * 5);
          }
        });

        heroCard.addEventListener("pointerleave", function () {
          imgX(0);
          imgY(0);
          if (tagX && tagY) {
            tagX(0);
            tagY(0);
          }
        });
      }
    });
  }

  /* 4B. Smooth Scroll Reveal for Section Headers & Editorial Blocks */
  document.querySelectorAll("[data-reveal]").forEach(function (el) {
    gsap.from(el, {
      y: 26,
      opacity: 0,
      duration: 0.82,
      ease: "power3.out",
      clearProps: "transform",
      scrollTrigger: {
        trigger: el,
        start: "top 90%",
        once: true,
      },
    });
  });

  /* 5. Opposing Kinetic Scroll-Driven Typography Band v2 */
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
          { x: 0, xPercent: dir > 0 ? -26 : 2 },
          {
            x: 0,
            xPercent: dir > 0 ? 2 : -26,
            ease: "none",
            scrollTrigger: {
              trigger: kineticBand || line,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.6,
              invalidateOnRefresh: true,
            },
          }
        );
        skewSetters.push({
          dir: dir,
          set: gsap.quickTo(line, "skewX", { duration: 0.5, ease: "power3.out" }),
        });
      });

      var skewResetTimer = null;
      ScrollTrigger.create({
        trigger: kineticBand || kineticLines[0],
        start: "top bottom",
        end: "bottom top",
        onUpdate: function (self) {
          var velocity = self.getVelocity();
          var clamped = Math.max(-7, Math.min(7, velocity / 260));
          skewSetters.forEach(function (item) {
            item.set(clamped * (item.dir > 0 ? -1 : 1));
          });
          if (skewResetTimer) clearTimeout(skewResetTimer);
          skewResetTimer = setTimeout(function () {
            skewSetters.forEach(function (item) {
              item.set(0);
            });
          }, 140);
        },
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
                scrub: 0.35,
              },
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
          once: true,
        },
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
          },
        });
      },
    });
  });

  /* 8. Obsidian Manifesto Word-by-Word Kinetic Lift & Ambient Light Sweep */
  var manifestoEl = document.querySelector("[data-scrub-words]");
  var manifestoGlow = document.querySelector("[data-manifesto-glow]");
  if (manifestoEl) {
    var rawText = manifestoEl.textContent.trim();
    var words = rawText.split(/\s+/);
    var sunriseWords = {
      "vươn": true,
      "xa": true,
      "nhân": true,
      "cách": true,
      "sẻ": true,
      "chia": true,
      "bên": true,
      "trong": true,
    };
    var emeraldWords = {
      "hola": true,
      "hòa": true,
      "lạc": true,
      "xanh": true,
      "bền": true,
      "vững": true,
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
          scrub: 0.35,
        },
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
          start: "top 74%",
          end: "bottom 42%",
          scrub: 0.6,
        },
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
              scrub: 0.85,
            },
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
      { clipPath: "inset(14% 3% 14% 3% round 22px)" },
      {
        clipPath: "inset(0% 0% 0% 0% round 16px)",
        duration: 0.98,
        ease: "power4.out",
        clearProps: "clipPath",
        scrollTrigger: {
          trigger: wrap,
          start: "top 88%",
          once: true,
        },
      }
    );
    if (img) {
      gsap.fromTo(
        img,
        { scale: 1.18 },
        {
          scale: 1,
          duration: 1.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: wrap,
            start: "top 88%",
            once: true,
          },
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
      duration: 0.74,
      stagger: 0.065,
      ease: "power3.out",
      clearProps: "transform",
      scrollTrigger: {
        trigger: group,
        start: "top 88%",
        once: true,
      },
    });
  });

  /* 11. Desktop 340vh Exhibition Runway + Active Center Focus + Contextual Cursor Pill + 3D Pass Tilt */
  var mm = gsap.matchMedia();

  mm.add("(min-width: 1024px)", function () {
    var hSection = document.querySelector("[data-horizontal-section]");
    var hTrack = document.querySelector("[data-horizontal-track]");
    var hCards = hTrack ? Array.prototype.slice.call(hTrack.querySelectorAll(".horizontal-card")) : [];
    var hImages = hTrack ? Array.prototype.slice.call(hTrack.querySelectorAll(".horizontal-frame img")) : [];
    var cursorPill = document.getElementById("exhibition-cursor-pill");
    var cursorPillText = cursorPill ? cursorPill.querySelector("[data-cursor-pill-text]") : null;
    var totalDeskCards = hCards.length || 1;

    /* Scroll-jacking disabled per AGENTS.md Tầng 1: native CSS scroll-snap handles smooth horizontal gallery on both desktop & mobile */
    if (false && hSection && hTrack) {
      var getMaxShift = function () {
        return Math.max(0, hTrack.scrollWidth - window.innerWidth + 96);
      };

      var syncRunwayHeight = function () {
        var shift = getMaxShift();
        var idealPx = Math.max(window.innerHeight * 3.35, shift * 1.15 + window.innerHeight);
        var cappedPx = Math.min(window.innerHeight * 4.0, idealPx);
        hSection.style.height = Math.round(cappedPx) + "px";
      };
      syncRunwayHeight();
      ScrollTrigger.addEventListener("refreshInit", syncRunwayHeight);

      var cardSkewSetters = hCards.map(function (c) {
        return gsap.quickTo(c, "skewX", { duration: 0.45, ease: "power3.out" });
      });
      var cardSkewReset = null;

      var updateCenterCard = function (progress) {
        var focusFloat = progress * (totalDeskCards - 1);
        hCards.forEach(function (card, idx) {
          var dist = Math.abs(idx - focusFloat);
          card.classList.toggle("is-center-card", dist < 0.58);
        });
      };
      updateCenterCard(0);

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
            scrub: 0.72,
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

              updateCenterCard(self.progress);

              var skew = Math.max(-3, Math.min(3, -(self.getVelocity() / 560)));
              cardSkewSetters.forEach(function (set) {
                set(skew);
              });
              if (cardSkewReset) clearTimeout(cardSkewReset);
              cardSkewReset = setTimeout(function () {
                cardSkewSetters.forEach(function (set) {
                  set(0);
                });
              }, 140);
            },
          },
        }
      );

      if (hImages.length) {
        gsap.fromTo(
          hImages,
          { xPercent: -9 },
          {
            xPercent: 9,
            ease: "none",
            scrollTrigger: {
              trigger: hSection,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.72,
              invalidateOnRefresh: true,
            },
          }
        );
      }

      /* Contextual Cursor Pill over Horizontal Exhibition Cards (pointer: fine only) */
      if (isFinePointer && cursorPill) {
        var pillX = gsap.quickTo(cursorPill, "x", { duration: 0.22, ease: "power3.out" });
        var pillY = gsap.quickTo(cursorPill, "y", { duration: 0.22, ease: "power3.out" });

        hCards.forEach(function (card, idx) {
          card.addEventListener("pointerenter", function (e) {
            var lang = document.documentElement.lang || document.documentElement.getAttribute("data-lang") || "vi";
            var prefix = lang.toLowerCase().indexOf("en") === 0 ? "VIEW" : "XEM ẢNH";
            var badgeIdx =
              card.getAttribute("data-card-index") ||
              (idx + 1 < 10 ? "0" + (idx + 1) : String(idx + 1)) +
                " / " +
                (totalDeskCards < 10 ? "0" + totalDeskCards : String(totalDeskCards));
            if (cursorPillText) {
              cursorPillText.textContent = prefix + " · " + badgeIdx;
            }
            pillX(e.clientX + 16);
            pillY(e.clientY + 16);
            cursorPill.classList.add("is-visible");
          });

          card.addEventListener("pointermove", function (e) {
            pillX(e.clientX + 16);
            pillY(e.clientY + 16);
          });

          card.addEventListener("pointerleave", function () {
            cursorPill.classList.remove("is-visible");
          });
        });
      }

      return function () {
        ScrollTrigger.removeEventListener("refreshInit", syncRunwayHeight);
        hSection.style.height = "";
      };
    }
  });

  mm.add("(min-width: 1024px)", function () {
    if (!isFinePointer) return;

    /* Desktop Pointer Hairline Spotlight on Architectural Cards */
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

    /* Optical Specular Glare + Subtle 3D Perspective Tilt on Photo Plates & Hola Member Pass */
    document
      .querySelectorAll(".plate-media, .event-card-media, .horizontal-frame, [data-sunrise-pass], [data-ws-pass]")
      .forEach(function (plate) {
        var maxDeg = plate.hasAttribute("data-sunrise-pass") || plate.hasAttribute("data-ws-pass") ? 6.5 : 4.5;
        var rX = gsap.quickTo(plate, "rotateX", { duration: 0.32, ease: "power3.out" });
        var rY = gsap.quickTo(plate, "rotateY", { duration: 0.32, ease: "power3.out" });
        gsap.set(plate, { transformPerspective: 960 });

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
          rY(((xPct - 50) / 50) * maxDeg);
          rX(((50 - yPct) / 50) * maxDeg);
        });

        plate.addEventListener("pointerleave", function () {
          plate.style.setProperty("--glare-opacity", "0");
          rX(0);
          rY(0);
        });
      });

    /* Floating Spring Photo Preview on Past Gathering Rows */
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

    /* Tactile Feather-Light Magnetic Pull on Primary CTA Buttons */
    document.querySelectorAll("[data-magnetic]").forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        var rect = btn.getBoundingClientRect();
        var x = Math.max(-9, Math.min(9, (e.clientX - rect.left - rect.width / 2) * 0.22));
        var y = Math.max(-7, Math.min(7, (e.clientY - rect.top - rect.height / 2) * 0.22));
        gsap.to(btn, { x: x, y: y, duration: 0.24, ease: "power3.out" });
      });
      btn.addEventListener("mouseleave", function () {
        gsap.to(btn, { x: 0, y: 0, duration: 0.46, ease: "power3.out" });
      });
    });
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      ScrollTrigger.refresh();
    });
  }
})();
