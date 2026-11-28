/**
 * HolaRise Grounded Quick-Assistant ("Hỏi nhanh") powered by Gemini Interactions v1 REST API.
 *
 * Design & Safeguarding Invariants (AGENTS.md Tầng 1, 2, 3):
 * - Grounded strictly in live D1 data (upcoming events, recent posts) + verified HolaRise facts.
 * - Deterministic pre-LLM crisis guardrail for HolaHeart (NEVER acts as clinical therapy/diagnosis).
 * - Uses current Gemini models (`gemini-3.5-flash-lite` -> `gemini-4-hydrogen`), `store: false`
 *   for privacy (Nghị định 13/2023), and reuses the existing Gemini key pool from `ai-retouch.js`.
 * - Graceful grounded D1 fallback when API keys are unconfigured or temporarily quota-limited.
 */

import { resolveFullAiRuntime } from "./ai-retouch.js";
import { serializeEventRow, splitEventsByDate } from "./render.js";
import { cleanStr } from "./validation.js";

export const GEMINI_CHAT_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1/interactions";
export const GEMINI_CHAT_INTERACTIONS_BETA_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_GEMINI_CHAT_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_CHAT_FALLBACK_MODEL = "gemini-4-hydrogen";
export const DEFAULT_GEMINI_CHAT_TERTIARY_MODEL = "gemini-3.1-flash-lite";

const CRISIS_PATTERNS = [
  /tự\s*tử/i,
  /tự\s*sát/i,
  /tự\s*làm\s*đau/i,
  /tự\s*hại/i,
  /muốn\s*chết/i,
  /không\s*muốn\s*sống/i,
  /kết\s*thúc\s*cuộc\s*đời/i,
  /nhảy\s*lầu/i,
  /uống\s*thuốc\s*tự/i,
  /\bsuicid(e|al)\b/i,
  /\bkill\s+myself\b/i,
  /\bend\s+my\s+life\b/i,
  /\bself[\s-]*harm\b/i,
];

export function detectCrisisIntent(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return CRISIS_PATTERNS.some((re) => re.test(s));
}

export function buildCrisisSafeguardingReply(lang = "vi") {
  if (lang === "en") {
    return {
      reply:
        "Thank you for reaching out. HolaRise and HolaHeart are peer community spaces and cannot provide clinical or emergency mental health care. If you are feeling overwhelmed or unsafe right now, please reach out immediately to a trusted person nearby, local emergency services (115 in Vietnam), or the National Child & Family Protection Helpline (111, free 24/7).",
      mode: "safeguarding",
      handoffSuggested: true,
      suggestedLinks: [
        { label: "Call 111 (24/7 Helpline)", href: "tel:111" },
        { label: "Call 115 (Emergency)", href: "tel:115" },
      ],
    };
  }
  return {
    reply:
      "Cảm ơn bạn đã lên tiếng. HolaHeart là không gian chia sẻ đồng đẳng, không phải dịch vụ tham vấn hay điều trị tâm lý chuyên môn. Nếu lúc này bạn đang thấy quá tải hoặc không an toàn, hãy gọi ngay người thân bên cạnh, Tổng đài Quốc gia 111 (miễn phí 24/7) hoặc cấp cứu 115 để được chuyên gia hỗ trợ kịp thời nhé.",
    mode: "safeguarding",
    handoffSuggested: true,
    suggestedLinks: [
      { label: "Gọi Tổng đài 111 (24/7)", href: "tel:111" },
      { label: "Gọi Cấp cứu 115", href: "tel:115" },
    ],
  };
}

export function extractTextFromInteractionResponse(payload) {
  if (!payload || typeof payload !== "object") return "";

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textParts = [];
  const collectFromArray = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
        textParts.push(item.text.trim());
      } else if (typeof item.text === "string" && !item.type && item.text.trim()) {
        textParts.push(item.text.trim());
      }
    }
  };

  // Canonical v1 Interactions schema: steps[] with model_output content/outputs
  if (Array.isArray(payload.steps)) {
    for (const step of payload.steps) {
      if (!step || typeof step !== "object") continue;
      if (step.type && step.type !== "model_output" && step.role !== "model") continue;
      if (typeof step.content === "string" && step.content.trim()) {
        textParts.push(step.content.trim());
      } else {
        collectFromArray(step.content);
      }
      collectFromArray(step.outputs);
    }
  }

  if (textParts.length === 0 && Array.isArray(payload.outputs)) {
    collectFromArray(payload.outputs);
  }

  if (textParts.length === 0) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (typeof p?.text === "string" && p.text.trim()) {
          textParts.push(p.text.trim());
        }
      }
    }
  }

  return textParts.join("\n").trim();
}

export async function loadAssistantGrounding(db, lang = "vi") {
  let upcoming = [];
  let recentPosts = [];

  if (db) {
    const [eventsRes, postsRes] = await Promise.all([
      db
        .prepare("SELECT * FROM events WHERE status = 'published' ORDER BY sort_order ASC, date ASC LIMIT 40")
        .all()
        .catch(() => ({ results: [] })),
      db
        .prepare("SELECT slug, title, category, date_display, excerpt FROM posts WHERE status = 'published' ORDER BY date DESC LIMIT 4")
        .all()
        .catch(() => ({ results: [] })),
    ]);

    const serialized = (eventsRes.results || []).map(serializeEventRow);
    const split = splitEventsByDate(serialized);
    upcoming = split.upcoming.slice(0, 6);
    recentPosts = (postsRes.results || []).slice(0, 3);
  }

  const isEn = lang === "en";
  const eventLines = upcoming.length
    ? upcoming
        .map((ev) => {
          const title = isEn && ev.titleEn ? ev.titleEn : ev.title;
          const slugUrl = isEn ? `/en/events/${ev.slug || ev.id}/` : `/su-kien/${ev.slug || ev.id}/`;
          return `- ${title} | ${ev.dateDisplay || ev.date} ${ev.time || ""} | ${ev.location || "Hòa Lạc"} | ${ev.fee || "Miễn phí tham dự"} | ${slugUrl}`;
        })
        .join("\n")
    : isEn
      ? "- No upcoming scheduled gatherings listed yet. Visitors can check /en/schedule/ or join our Zalo community."
      : "- Hiện chưa có buổi gặp mới mở lịch công khai. Mời bạn xem /lich-hoat-dong/ hoặc kết nối Zalo 077.777.1948.";

  const postLines = recentPosts.length
    ? recentPosts.map((p) => `- ${p.title} (${p.date_display || ""}) — /hanh-trinh/${p.slug}/`).join("\n")
    : "";

  return {
    upcoming,
    recentPosts,
    eventLines,
    postLines,
  };
}

export function buildSystemInstruction(grounding, lang = "vi", pageUrl = "/") {
  if (lang === "en") {
    return [
      "You are the HolaRise Quick Assistant on holarise.org.",
      "HolaRise is a non-profit youth community initiative rooted in Hoa Lac (Hanoi) with an open mission across three pillars:",
      "1) HolaHeart — quiet reflection, peer listening, and gratitude circles (NOT clinical therapy or diagnosis).",
      "2) HolaGreen — local ecology, trails, and sustainable living.",
      "3) HolaConnect — youth knowledge sharing, community libraries, and social service.",
      "",
      "VERIFIED PRACTICAL FACTS:",
      "- First-time and solo visitors are warmly welcomed; nobody is forced to speak.",
      "- Events are generally free to attend (at cafes, guests cover their own drink).",
      "- No password or account is required to reserve a seat — just Name + Phone/Zalo (or Email for international guests).",
      "- Carpooling, reminders, and photo albums are coordinated via the gathering's Zalo group and Hotline/Zalo 077.777.1948 or phungsu@holarise.org.",
      "- Key pages: /en/schedule/ (Schedule), /en/join/ (Join & Member Pass), /en/journey/ (Stories), /en/about/ (About), /en/privacy/ (Transparency).",
      "",
      "LIVE UPCOMING GATHERINGS (FROM D1 DATABASE):",
      grounding.eventLines,
      "",
      `VISITOR CURRENT PAGE: ${pageUrl || "/en/"}`,
      "",
      "STRICT RULES:",
      "- Reply in clear, warm, concise English (under 110 words, plain text, no markdown tables, no exclamation-mark hype).",
      "- ONLY state dates, fees, or venues present in the data above. Never invent schedules or promises.",
      "- Never give medical or psychological diagnoses.",
      "- If asked something outside these facts, briefly say you do not have that detail yet and point to the Feedback tab or phungsu@holarise.org.",
    ].join("\n");
  }

  return [
    "Bạn là Trợ lý Hỏi nhanh của HolaRise trên holarise.org.",
    "Bản sắc: HolaRise là tổ chức cộng đồng thanh niên phi lợi nhuận khởi nguồn tại Hòa Lạc (Hà Nội) với sứ mệnh mở rộng qua 3 trụ cột:",
    "1) HolaHeart — tĩnh tại nội tâm, lắng nghe đồng đẳng & biết ơn (KHÔNG phải tham vấn hay trị liệu tâm lý lâm sàng).",
    "2) HolaGreen — sinh thái, cảnh quan và lối sống bền vững.",
    "3) HolaConnect — tri thức, tủ sách thiếu nhi và phụng sự cộng đồng.",
    "",
    "DỮ KIỆN THỰC TẾ ĐÃ KIỂM CHỨNG:",
    "- Người đi lần đầu hoặc đi một mình luôn có thành viên đón tiếp, không ép phát biểu.",
    "- Các buổi gặp thường miễn phí tham dự (tại quán cafe, thành viên tự túc đồ uống của mình).",
    "- Giữ chỗ chỉ cần Tên + SĐT/Zalo trong 15 giây, không bắt buộc tạo tài khoản trước.",
    "- Ghép xe, nhắc lịch sát giờ và gửi album ảnh gốc diễn ra trong Nhóm Zalo từng buổi. Liên hệ Ban Điều Phối: Zalo/Hotline 077.777.1948 hoặc phungsu@holarise.org.",
    "- Các trang chính: /lich-hoat-dong/ (Lịch hoạt động), /tham-gia/ (Tham gia & Thẻ Thành Viên), /hanh-trinh/ (Hành trình), /gioi-thieu/ (Về HolaRise), /chinh-sach/ (Minh bạch).",
    "",
    "LỊCH SỰ KIỆN SẮP TỚI (DỮ LIỆU THẬT TỪ D1):",
    grounding.eventLines,
    grounding.postLines ? `\nBÀI HÀNH TRÌNH GẦN ĐÂY:\n${grounding.postLines}` : "",
    `\nTRANG NGƯỜI DÙNG ĐANG XEM: ${pageUrl || "/"}`,
    "",
    "QUY TẮC BẮT BUỘC:",
    "- Xưng 'chúng mình / Hola' và gọi người hỏi là 'bạn'. Giọng điềm tĩnh, thân tình, ngắn gọn (tối đa 120 từ), dùng câu rõ ý, không dấu chấm than hô hào, không văn sáo rỗng.",
    "- CHỈ nêu ngày, giờ, địa điểm, chi phí có trong dữ liệu trên; tuyệt đối không bịa lịch hay hứa tần suất.",
    "- Tuyệt đối không chẩn đoán tâm lý hay đưa lời khuyên y khoa.",
    "- Nếu câu hỏi nằm ngoài thông tin trên, nói thẳng ngắn gọn và gợi ý chuyển sang tab 'Góp ý & Báo lỗi' hoặc nhắn Zalo 077.777.1948 để Ban Điều Phối hỗ trợ trực tiếp.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function pickSuggestedLinks(message, grounding, lang = "vi") {
  const q = String(message || "").toLowerCase();
  const isEn = lang === "en";
  const links = [];

  if (grounding.upcoming.length > 0 && /lịch|sự kiện|tuần|sắp|tham gia|đăng ký|giữ chỗ|workshop|schedule|event|upcoming|join|rsvp/i.test(q)) {
    const first = grounding.upcoming[0];
    links.push({
      label: isEn ? `View: ${first.titleEn || first.title}` : `Xem: ${first.title}`,
      href: isEn ? `/en/events/${first.slug || first.id}/` : `/su-kien/${first.slug || first.id}/`,
    });
  }

  if (/lịch|sự kiện|tuần|schedule|event/i.test(q)) {
    links.push({
      label: isEn ? "Full Schedule" : "Xem Lịch hoạt động",
      href: isEn ? "/en/schedule/" : "/lich-hoat-dong/",
    });
  } else if (/thẻ|tài khoản|tham gia|đồng hành|ctv|tình nguyện|join|member|volunteer|partner/i.test(q)) {
    links.push({
      label: isEn ? "Join & Member Pass" : "Mở trang Tham gia",
      href: isEn ? "/en/join/" : "/tham-gia/",
    });
  } else if (/trụ cột|giới thiệu|là gì|holaheart|holagreen|holaconnect|about|pillar/i.test(q)) {
    links.push({
      label: isEn ? "About HolaRise" : "Về HolaRise",
      href: isEn ? "/en/about/" : "/gioi-thieu/",
    });
  }

  return links.slice(0, 2);
}

export function buildGroundedFallbackAnswer(message, grounding, lang = "vi") {
  const q = String(message || "").toLowerCase();
  const isEn = lang === "en";
  const links = pickSuggestedLinks(message, grounding, lang);

  if (/lịch|sự kiện|tuần|sắp|workshop|schedule|event|upcoming/i.test(q)) {
    if (grounding.upcoming.length > 0) {
      const list = grounding.upcoming
        .slice(0, 3)
        .map((ev) => {
          const title = isEn && ev.titleEn ? ev.titleEn : ev.title;
          return `• ${title} (${ev.dateDisplay || ev.date}${ev.time ? `, ${ev.time}` : ""} · ${ev.location || "Hòa Lạc"})`;
        })
        .join("\n");
      return {
        reply: isEn
          ? `Here are the upcoming gatherings on HolaRise:\n${list}\nYou can reserve a seat in 15 seconds without creating an account.`
          : `Lịch sắp tới của HolaRise hiện có:\n${list}\nBạn chỉ cần bấm vào buổi gặp để giữ chỗ trong 15 giây, không cần tạo tài khoản trước.`,
        mode: "grounded_fallback",
        handoffSuggested: false,
        suggestedLinks: links,
      };
    }
    return {
      reply: isEn
        ? "We do not have a newly published gathering on the schedule right now. Please check the Schedule page or reach us at phungsu@holarise.org."
        : "Hiện lịch tuần mới đang được Ban Điều Phối cập nhật. Bạn có thể theo dõi tại trang Lịch hoạt động hoặc nhắn Zalo 077.777.1948 nhé.",
      mode: "grounded_fallback",
      handoffSuggested: true,
      suggestedLinks: links.length ? links : [{ label: isEn ? "Schedule" : "Lịch hoạt động", href: isEn ? "/en/schedule/" : "/lich-hoat-dong/" }],
    };
  }

  if (/một mình|1 mình|ngại|lần đầu|phát biểu|solo|first time|shy/i.test(q)) {
    return {
      reply: isEn
        ? "Most guests join solo on their first visit. Our coordinators greet you at the venue, you are never forced to speak, and gatherings are free to attend (guests only cover their own drink at cafes)."
        : "Phần lớn các bạn tham gia lần đầu đều đi một mình. Tới điểm hẹn luôn có thành viên Hola đón tiếp, không ép phát biểu và buổi gặp miễn phí tham dự (tại quán cafe mỗi bạn tự túc đồ uống của mình).",
      mode: "grounded_fallback",
      handoffSuggested: false,
      suggestedLinks: links.length
        ? links
        : [{ label: isEn ? "Upcoming Schedule" : "Xem lịch sắp tới", href: isEn ? "/en/schedule/" : "/lich-hoat-dong/" }],
    };
  }

  if (/trụ cột|là gì|holaheart|holagreen|holaconnect|pillar|about/i.test(q)) {
    return {
      reply: isEn
        ? "HolaRise is a non-profit youth community rooted in Hoa Lac with 3 pillars: HolaHeart (reflection & peer listening), HolaGreen (ecology & trails), and HolaConnect (youth knowledge & community libraries)."
        : "HolaRise là cộng đồng thanh niên phi lợi nhuận khởi nguồn tại Hòa Lạc với 3 trụ cột: HolaHeart (tĩnh tại nội tâm & lắng nghe đồng đẳng), HolaGreen (sinh thái & cảnh quan bền vững) và HolaConnect (tri thức & phụng sự cộng đồng).",
      mode: "grounded_fallback",
      handoffSuggested: false,
      suggestedLinks: links.length
        ? links
        : [{ label: isEn ? "About HolaRise" : "Về HolaRise", href: isEn ? "/en/about/" : "/gioi-thieu/" }],
    };
  }

  if (/phí|tiền|miễn phí|ghép xe|di chuyển|fee|cost|free|ride/i.test(q)) {
    return {
      reply: isEn
        ? "HolaRise gatherings are free to join (at cafes, each guest covers their own drink). After reserving a seat, you get the gathering's Zalo group link to coordinate carpooling and receive reminders."
        : "Các buổi gặp của HolaRise miễn phí tham dự (nếu tổ chức tại quán cafe, bạn tự túc phần đồ uống của mình). Sau khi giữ chỗ, bạn sẽ có link Nhóm Zalo buổi gặp để ghép xe và nhận nhắc lịch sát giờ.",
      mode: "grounded_fallback",
      handoffSuggested: false,
      suggestedLinks: links,
    };
  }

  return {
    reply: isEn
      ? "Thank you for asking. For specific details beyond our published schedule, please switch to the Feedback tab or message our coordinating team at phungsu@holarise.org (Zalo 077.777.1948)."
      : "Cảm ơn bạn đã hỏi. Với nội dung cụ thể hơn ngoài lịch công khai, bạn chuyển sang tab Góp ý & Báo lỗi hoặc nhắn trực tiếp Zalo 077.777.1948 để Ban Điều Phối phản hồi nhanh nhất nhé.",
    mode: "grounded_fallback",
    handoffSuggested: true,
    suggestedLinks: links.length
      ? links
      : [{ label: isEn ? "Schedule" : "Xem Lịch hoạt động", href: isEn ? "/en/schedule/" : "/lich-hoat-dong/" }],
  };
}

function isRetryableStatus(status) {
  return status === 429 || status === 403 || status === 408 || status >= 500;
}

export async function runGeminiAssistant({
  env,
  db,
  message,
  history = [],
  lang = "vi",
  pageUrl = "/",
  fetchImpl = fetch,
}) {
  const normLang = lang === "en" ? "en" : "vi";

  // 1. Deterministic NGO Safeguarding guardrail BEFORE any LLM call
  if (detectCrisisIntent(message)) {
    return buildCrisisSafeguardingReply(normLang);
  }

  // 2. Load real D1 grounding (events + posts)
  const grounding = await loadAssistantGrounding(db, normLang);
  const runtime = await resolveFullAiRuntime(env, db).catch(() => ({ keyPool: [] }));
  const keyPool = runtime.keyPool || [];

  if (keyPool.length === 0) {
    return buildGroundedFallbackAnswer(message, grounding, normLang);
  }

  const systemInstruction = buildSystemInstruction(grounding, normLang, pageUrl);
  const safeHistory = Array.isArray(history)
    ? history
        .slice(-4)
        .filter((h) => h && (h.role === "user" || h.role === "model") && typeof h.text === "string" && h.text.trim())
        .map((h) => ({
          role: h.role,
          content: [{ type: "text", text: cleanStr(h.text, 400) }],
        }))
    : [];

  const inputPayload =
    safeHistory.length > 0
      ? [...safeHistory, { role: "user", content: [{ type: "text", text: message }] }]
      : message;

  const primaryModel = String(env?.GEMINI_CHAT_MODEL || DEFAULT_GEMINI_CHAT_MODEL).trim();
  const fallbackModel = String(env?.GEMINI_CHAT_FALLBACK_MODEL || DEFAULT_GEMINI_CHAT_FALLBACK_MODEL).trim();
  const modelsToTry = Array.from(
    new Set([primaryModel, fallbackModel, DEFAULT_GEMINI_CHAT_TERTIARY_MODEL].filter(Boolean))
  );
  const endpoints = [GEMINI_CHAT_INTERACTIONS_URL, GEMINI_CHAT_INTERACTIONS_BETA_URL];

  for (const model of modelsToTry) {
    for (const slot of keyPool) {
      for (const endpoint of endpoints) {
        try {
          const res = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": slot.key,
            },
            signal: AbortSignal.timeout(12000),
            body: JSON.stringify({
              model,
              system_instruction: systemInstruction,
              input: inputPayload,
              store: false,
              generation_config: {
                max_output_tokens: 360,
              },
            }),
          });

          if (!res.ok) {
            // If v1 returns 404, try v1beta for the same key/model; otherwise rotate key/model
            if (res.status === 404 && endpoint === GEMINI_CHAT_INTERACTIONS_URL) continue;
            if (isRetryableStatus(res.status)) break;
            break;
          }

          const json = await res.json();
          const reply = extractTextFromInteractionResponse(json);
          if (reply) {
            return {
              reply: reply.slice(0, 1200),
              mode: "gemini",
              model,
              handoffSuggested: /077\.777\.1948|phungsu@holarise\.org|góp ý|feedback/i.test(reply),
              suggestedLinks: pickSuggestedLinks(message, grounding, normLang),
            };
          }
          break;
        } catch {
          break;
        }
      }
    }
  }

  return buildGroundedFallbackAnswer(message, grounding, normLang);
}
