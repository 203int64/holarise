/**
 * HolaRise Bilingual Dictionary Engine (VI | EN)
 * - Instant client-side language toggle with zero page reload and zero FOUC.
 * - Preserves original Vietnamese DOM strings automatically so switching EN -> VI is 100% lossless.
 * - Supports dynamic re-application (`window.HolaI18n.apply()`) after SSR/AJAX updates.
 */
(function () {
  "use strict";

  var DICT_EN = {
    "nav.home": "Home",
    "nav.about": "About Hola",
    "nav.schedule": "Schedule",
    "nav.journey": "Journey",
    "nav.join": "Join / Sign In",
    "nav.memberStudio": "Member Pass & Sign In",

    "brand.fullName": "HolaRise – Hoa Lac Youth Community",
    "brand.subtitle":
      "Born in Hoa Lac — uniting young minds to cultivate inner strength (HolaHeart), care for nature (HolaGreen), and serve the community (HolaConnect).",

    "home.hero.headlineHtml":
      '<span class="split-line-mask"><span class="split-line-inner">Grow from within,</span></span>\n<span class="split-line-mask"><span class="split-line-inner">Act for <span class="accent-word">Hoa Lac</span>.</span></span>',
    "home.hero.lead":
      "Born in Hoa Lac, HolaRise brings together young people choosing deeper reflection, greener daily habits, and lasting community service.",
    "home.hero.primaryCta": "Join Hola",
    "home.hero.secondaryCta": "Explore our journey",

    "kinetic.place": "Hoa Lac",
    "kinetic.rise": "Rise Together",
    "kinetic.serve": "Serve Together",

    "home.upcoming.kicker": "This Week",
    "home.upcoming.title": "Upcoming Gatherings in Hoa Lac",
    "home.upcoming.lead": "Reserve your seat directly on each gathering.",
    "home.upcoming.all": "View full schedule",

    "home.gallery.cursor": "VIEW PHOTO",
    "home.gallery.kicker": "Moments · 2025 – 2026",
    "home.gallery.title": "Gatherings in Hoa Lac",
    "home.gallery.lead":
      "Moments from HolaHeart × MusicSpace acoustic nights and the Nov 15, 2026 dialogue.",
    "home.gallery.all": "Explore full Journey",

    "home.pillars.kicker": "Impact Model",
    "home.pillars.title": "From Inner Strength to Community Service",
    "home.pillars.lead":
      "Three connected pillars: inner reflection (HolaHeart) → local ecology (HolaGreen) → shared learning & care (HolaConnect).",
    "home.pillars.more": "Read our philosophy",

    "pillar.holaheart.title": "Inner Strength, Listening & Life Values",
    "pillar.holaheart.summary":
      "Amid Hoa Lac's fast-paced academic and tech rhythm, HolaHeart hosts intimate circles and acoustic nights for honest dialogue, gratitude, and mental wellbeing.",
    "pillar.holaheart.cta": "Explore HolaHeart schedule",

    "pillar.holagreen.title": "Ecology & Sustainable Landscapes",
    "pillar.holagreen.summary":
      "Growth begins with caring for the land we live on every day. HolaGreen connects youth teams keeping lakesides clean, reducing single-use plastics, and nurturing native greenery.",
    "pillar.holagreen.cta": "Explore HolaGreen schedule",

    "pillar.holaconnect.title": "Shared Knowledge & Community Care",
    "pillar.holaconnect.summary":
      "Bringing knowledge and companionship beyond university campuses through children's bookshelves, weekend reading circles, and outdoor treks.",
    "pillar.holaconnect.cta": "Explore HolaConnect schedule",

    "home.manifesto.kicker": "Our Manifesto",
    "home.manifesto.link": "About HolaRise & Transparency",

    "about.mission.tag": "01 · MISSION",
    "about.mission.title": "Mission",
    "about.mission.heading": "01 · Mission",
    "about.mission.body":
      "Walking alongside young people in Hoa Lac as we nurture inner character (HolaHeart), care for local landscapes (HolaGreen), and serve community life (HolaConnect).",
    "about.vision.tag": "02 · VISION",
    "about.vision.title": "Vision",
    "about.vision.heading": "02 · Vision",
    "about.vision.body":
      "Building a grounded, transparent youth community deeply rooted in Hoa Lac before thoughtfully expanding across new regions.",
    "about.story.title": "Rooted in Hoa Lac, built for the long run",
    "about.story.p1":
      "HolaRise grew naturally from acoustic nights, open circles, and sincere conversations among students and young professionals in Hoa Lac.",
    "about.story.p2":
      "We treat Hoa Lac as our home ground to practice a transparent, non-profit community model with genuine depth before sharing it further.",
    "about.pillars.title": "Three connected pillars of action",
    "about.pillars.lead":
      "Every gathering flows from cultivating inner clarity to caring for our shared environment and community in Hoa Lac.",
    "about.values.kicker": "Guiding Values",
    "about.values.title": "Four standards in every action",
    "about.values.lead":
      "Shared compass keeping coordinators and members grounded across every season.",
    "about.principles.kicker": "Community Trust",
    "about.principles.title": "Five principles of transparency",
    "about.principles.link": "Read Transparency & Safety Rules",
    "about.sdgs.kicker": "Sustainable Impact",
    "about.sdgs.title": "Contributing to 6 UN Sustainable Development Goals",
    "about.cta.title": "Walk alongside Hola in Hoa Lac",
    "about.cta.desc":
      "Create your Hola Member Pass or propose a collaboration for your university club or cultural space.",

    "partner.colophonLabel": "Space Partner",
    "media.orientation": "Concept visual",

    "home.faq.kicker": "Clarity & Trust",
    "home.faq.title": "Frequently Asked Questions",
    "home.cta.title": "Ready to start your journey with Hola in Hoa Lac?",
    "home.cta.desc":
      "Create your Hola Member Pass in 10 seconds for 1-tap event booking and community guestbook reflections.",
    "home.cta.primary": "Get Member Pass",
    "home.cta.secondary": "This week's schedule",

    "cta.viewInvite": "Invitation & RSVP",
    "cta.quickBook": "Quick RSVP",
    "cta.reserveSeat": "Reserve Seat",

    "filter.all": "All",
    "schedule.hero.title": "Schedule in Hoa Lac",
    "schedule.hero.desc":
      "Hola hosts 1–2 weekly dialogues, eco-actions, and community circles rotating across HolaHeart, HolaGreen, and HolaConnect.",
    "schedule.kicker": "Weekly Rhythm · 1–2 gatherings/week",
    "schedule.title": "Upcoming Gatherings & Circles",
    "schedule.lead": "Filter by pillar to find a gathering that fits your week in Hoa Lac.",
    "schedule.memberLink": "Get Member Pass for 1-tap RSVP →",
    "schedule.empty.kicker": "Weekly Rhythm",
    "schedule.empty.title": "Our team is preparing the next gatherings in Hoa Lac",
    "schedule.empty.desc":
      "HolaHeart, HolaGreen, and HolaConnect meet 1–2 times weekly in a non-profit spirit.",
    "schedule.empty.cta": "Get Member Pass for updates →",
    "schedule.empty.secondary": "Explore 3 pillars",
    "schedule.filterEmpty": "No upcoming gatherings in this pillar this week.",
    "schedule.filterReset": "Show all gatherings",
    "schedule.past.kicker": "Past Gatherings",
    "schedule.past.title": "Completed Gatherings",
    "schedule.past.lead":
      "Past dialogues and acoustic nights with member guestbook reflections.",
    "schedule.past.link": "Explore Journey & Guestbook →",
    "schedule.partner.title": "Co-host a gathering at your campus or space?",
    "schedule.partner.desc":
      "Hola welcomes transparent collaborations with student clubs, schools, and cultural venues in Hoa Lac.",
    "schedule.partner.cta": "Propose Collaboration",

    "journey.hero.title": "Journey in Hoa Lac",
    "journey.hero.desc":
      "From HolaHeart × MusicSpace acoustic nights to life-value dialogues — stories and reflections shared by Hola members.",
    "journey.stories.kicker": "Stories & Guestbook",
    "journey.stories.title": "Past Gatherings",
    "journey.stories.scheduleLink": "View this week's schedule →",
    "journey.filterEmpty": "Upcoming recaps for this pillar are being prepared.",
    "journey.filterReset": "View all stories",
    "journey.gallery.kicker": "Photo Exhibition · Click to enlarge",
    "journey.gallery.title": "Moments in Hoa Lac",
    "journey.gallery.lead":
      "Captured directly during dialogues and acoustic gatherings in Hoa Lac.",
    "journey.readAndWrite": "Read story & Write reflection →",
    "journey.musicspaceDesc":
      "13 curated moments from acoustic evenings and connection circles in Hoa Lac.",
    "journey.privacyLabel": "Photo Privacy:",
    "journey.privacyBody":
      "Public bulk downloads are disabled to respect members. To update or remove a photo featuring you, contact",
    "journey.cta.title": "Join our next gathering in Hoa Lac",
    "journey.cta.desc":
      "Create your Hola Member Pass for 1-tap seat reservations and guestbook reflections.",

    "privacy.hero.title": "Community Transparency & Privacy Standards",
    "notFound.title": "Page not found",
    "notFound.desc":
      "This link may have moved. Head back home or choose a section below.",

    "pwa.installApp": "Install HolaRise App",
    "pwa.installShort": "Install App",

    "footer.explore": "Explore",
    "footer.transparency": "Transparency & Safety",
    "footer.pillars": "3 Pillars",
    "footer.pHeart": "HolaHeart · Inner Strength",
    "footer.pGreen": "HolaGreen · Ecology",
    "footer.pConnect": "HolaConnect · Community",
    "footer.pJoin": "Member Pass & Partners",
    "footer.contact": "Office & Contact",
    "footer.officeLabel": "Office:",
    "footer.copyright":
      "© 2026 HolaRise Youth Community. Non-profit community initiative.",
    "footer.privacy": "Privacy & Rules",
    "footer.memberPass": "Hola Member Pass",

    "join.hero.title": "Hola Member Hub & Collaboration",
    "join.hero.desc":
      "One unified Hola Member Pass (HOLA-2026-XXXX) — 10-second sign-up, 1-tap event RSVP, real avatar card export, and activity guestbook.",
    "join.tab.register": "Create Member Pass",
    "join.tab.login": "Sign In",
    "join.tab.partner": "Partner Inquiry",

    "guestbook.kicker": "Member Guestbook",
    "guestbook.title": "Reflections from Participants",
    "guestbook.lead":
      "Sign in with your Hola Member Pass to share your thoughts and one memory photo from this gathering (moderated by coordinators).",
    "guestbook.signInBtn": "Sign in to write a reflection",
    "guestbook.submitBtn": "Submit reflection for review",
    "guestbook.empty":
      "Be the first participant to leave a reflection for this gathering."
  };

  function getLang() {
    var attr = document.documentElement.getAttribute("data-lang");
    if (attr === "en" || attr === "vi") return attr;
    try {
      var saved = localStorage.getItem("holarise_lang");
      if (saved === "en") return "en";
    } catch (_e) {}
    return "vi";
  }

  function syncLangButtons(lang) {
    document.querySelectorAll("[data-lang-opt]").forEach(function (el) {
      var isMatch = el.getAttribute("data-lang-opt") === lang;
      el.classList.toggle("is-active", isMatch);
    });
    document.querySelectorAll("[data-lang-toggle]").forEach(function (btn) {
      btn.setAttribute("data-current-lang", lang);
      btn.setAttribute(
        "aria-label",
        lang === "en" ? "Switch language to Vietnamese" : "Chuyển sang tiếng Anh (English)"
      );
    });
  }

  function applyLang(lang) {
    var normalized = lang === "en" ? "en" : "vi";
    document.documentElement.setAttribute("data-lang", normalized);
    document.documentElement.setAttribute("lang", normalized);
    try {
      localStorage.setItem("holarise_lang", normalized);
    } catch (_e) {}

    syncLangButtons(normalized);

    // 1. Plain text nodes
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!el.hasAttribute("data-vi-orig")) {
        el.setAttribute("data-vi-orig", el.textContent);
      }
      if (normalized === "en" && DICT_EN[key]) {
        el.textContent = DICT_EN[key];
      } else if (normalized === "vi") {
        el.textContent = el.getAttribute("data-vi-orig");
      }
    });

    // 2. Trusted pre-defined HTML headline masks
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-html");
      if (!el.hasAttribute("data-vi-html-orig")) {
        el.setAttribute("data-vi-html-orig", el.innerHTML);
      }
      if (normalized === "en" && DICT_EN[key]) {
        el.innerHTML = DICT_EN[key];
      } else if (normalized === "vi") {
        el.innerHTML = el.getAttribute("data-vi-html-orig");
      }
    });

    // 3. Dynamic D1 / JSON Event titles & summaries
    document.querySelectorAll("[data-title-en]").forEach(function (el) {
      var enVal = el.getAttribute("data-title-en");
      if (!enVal) return;
      if (!el.hasAttribute("data-vi-orig")) {
        el.setAttribute("data-vi-orig", el.textContent);
      }
      el.textContent = normalized === "en" ? enVal : el.getAttribute("data-vi-orig");
    });

    document.querySelectorAll("[data-summary-en]").forEach(function (el) {
      var enVal = el.getAttribute("data-summary-en");
      if (!enVal) return;
      if (!el.hasAttribute("data-vi-orig")) {
        el.setAttribute("data-vi-orig", el.textContent);
      }
      el.textContent = normalized === "en" ? enVal : el.getAttribute("data-vi-orig");
    });

    // 4. Placeholder attributes
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (!el.hasAttribute("data-vi-ph-orig")) {
        el.setAttribute("data-vi-ph-orig", el.getAttribute("placeholder") || "");
      }
      if (normalized === "en" && DICT_EN[key]) {
        el.setAttribute("placeholder", DICT_EN[key]);
      } else if (normalized === "vi") {
        el.setAttribute("placeholder", el.getAttribute("data-vi-ph-orig"));
      }
    });

    window.dispatchEvent(new CustomEvent("holarise:langchange", { detail: { lang: normalized } }));
  }

  document.addEventListener("click", function (e) {
    var opt = e.target.closest("[data-lang-opt]");
    if (opt) {
      e.preventDefault();
      var chosen = opt.getAttribute("data-lang-opt");
      applyLang(chosen === "en" ? "en" : "vi");
      return;
    }
    var btn = e.target.closest("[data-lang-toggle]");
    if (btn) {
      e.preventDefault();
      applyLang(getLang() === "en" ? "vi" : "en");
    }
  });

  window.HolaI18n = {
    getLang: getLang,
    setLang: applyLang,
    apply: function () {
      applyLang(getLang());
    },
    t: function (key, viFallback) {
      return getLang() === "en" && DICT_EN[key] ? DICT_EN[key] : viFallback;
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyLang(getLang());
    });
  } else {
    applyLang(getLang());
  }
})();
