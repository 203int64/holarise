import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_GEMINI_CHAT_FALLBACK_MODEL,
  DEFAULT_GEMINI_CHAT_MODEL,
  detectCrisisIntent,
  extractTextFromInteractionResponse,
  runGeminiAssistant,
} from "../functions/_lib/assistant.js";
import { onRequestPost as assistantPost } from "../functions/api/chat/assistant.js";

function createSqliteD1Mock() {
  const db = new DatabaseSync(":memory:");
  for (const mig of [
    "migrations/0001_init.sql",
    "migrations/0006_member_auth_and_reflections.sql",
    "migrations/0011_event_seats_and_slugs.sql",
  ]) {
    db.exec(fs.readFileSync(mig, "utf8"));
  }

  const now = "2026-11-28T10:00:00.000Z";
  db.prepare(
    `INSERT INTO events (id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at)
     VALUES ('workshop-cuoc-doi-cua-cha', 'upcoming', 'HolaHeart', '[]', '2099-12-20', 'CN, 20/12/2099', '19:15 – 21:15', 'Cafe Mây Lang Thang, Hòa Lạc', 'Miễn phí tham dự · Tự túc đồ uống', '30 chỗ', 'Workshop Cuộc Đời Của Cha', 'Buổi lắng nghe nhẹ nhàng về gia đình', '[]', '', '/assets/images/activity-workshop.jpg', 'Workshop', 'published', 1, ?, ?)`
  ).run(now, now);

  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        async first() {
          return stmt.get(...this._binds) || null;
        },
        async all() {
          return { results: stmt.all(...this._binds) };
        },
        async run() {
          const info = stmt.run(...this._binds);
          return { success: true, meta: { changes: Number(info.changes || 0) } };
        },
      };
    },
  };
}

test("detectCrisisIntent & runGeminiAssistant: deterministic safeguarding guardrail triggers BEFORE any LLM call", async () => {
  assert.equal(detectCrisisIntent("Mình thấy buồn quá muốn tự tử"), true);
  assert.equal(detectCrisisIntent("I want to end my life"), true);
  assert.equal(detectCrisisIntent("Lịch tuần này có gì?"), false);

  let fetchCalled = 0;
  const resVi = await runGeminiAssistant({
    env: { GEMINI_API_KEY: "AIza-fake-key-1234567890" },
    db: null,
    message: "Mình không muốn sống nữa",
    lang: "vi",
    fetchImpl: async () => {
      fetchCalled += 1;
      throw new Error("Should never call Gemini on crisis guardrail");
    },
  });

  assert.equal(fetchCalled, 0);
  assert.equal(resVi.mode, "safeguarding");
  assert.match(resVi.reply, /111/);
  assert.match(resVi.reply, /115/);
  assert.equal(resVi.handoffSuggested, true);

  const resEn = await runGeminiAssistant({
    env: { GEMINI_API_KEY: "AIza-fake-key-1234567890" },
    db: null,
    message: "I feel hopeless and want to kill myself",
    lang: "en",
    fetchImpl: async () => {
      fetchCalled += 1;
      throw new Error("Should never call Gemini");
    },
  });
  assert.equal(fetchCalled, 0);
  assert.equal(resEn.mode, "safeguarding");
  assert.match(resEn.reply, /111/);
});

test("extractTextFromInteractionResponse handles canonical Interactions v1 steps, output_text, and candidates", () => {
  assert.equal(
    extractTextFromInteractionResponse({ output_text: "Chào bạn" }),
    "Chào bạn"
  );
  assert.equal(
    extractTextFromInteractionResponse({
      steps: [
        { type: "user_input", content: [{ type: "text", text: "ignored" }] },
        { type: "model_output", content: [{ type: "text", text: "Buổi gặp diễn ra tối Chủ nhật." }] },
      ],
    }),
    "Buổi gặp diễn ra tối Chủ nhật."
  );
});

test("runGeminiAssistant grounds D1 events, calls Interactions v1 with store=false, and rotates on 429 to fallback model", async () => {
  const d1 = createSqliteD1Mock();
  const calls = [];

  const fakeFetch = async (url, init) => {
    const parsedBody = JSON.parse(init.body);
    calls.push({ url, apiKey: init.headers["x-goog-api-key"], body: parsedBody });

    // First call hits 429 quota -> should rotate / fallback to second model
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
    }
    return new Response(
      JSON.stringify({
        id: "int_123",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: "Tuần này HolaRise có Workshop Cuộc Đời Của Cha (19:15 – 21:15) tại Cafe Mây Lang Thang." }],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const res = await runGeminiAssistant({
    env: { GEMINI_API_KEY: "AIza-primary-key-9999" },
    db: d1,
    message: "Lịch tuần này có sự kiện gì?",
    lang: "vi",
    pageUrl: "/lich-hoat-dong/",
    fetchImpl: fakeFetch,
  });

  assert.equal(res.mode, "gemini");
  assert.equal(res.model, DEFAULT_GEMINI_CHAT_FALLBACK_MODEL);
  assert.match(res.reply, /Cuộc Đời Của Cha/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1/interactions");
  assert.equal(calls[0].body.model, DEFAULT_GEMINI_CHAT_MODEL);
  assert.equal(calls[0].body.store, false);
  assert.match(calls[0].body.system_instruction, /Workshop Cuộc Đời Của Cha/);
  assert.equal(calls[1].body.model, DEFAULT_GEMINI_CHAT_FALLBACK_MODEL);
  assert.ok(res.suggestedLinks.some((l) => l.href === "/su-kien/workshop-cuoc-doi-cua-cha/"));
});

test("POST /api/chat/assistant falls back gracefully to real D1 events when no Gemini key is set & enforces CSRF + rate limits", async () => {
  const d1 = createSqliteD1Mock();

  // 1) Cross-origin blocked (403)
  const badOrigin = await assistantPost({
    request: new Request("https://holarise.org/api/chat/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ message: "Lịch tuần này có gì?" }),
    }),
    env: { DB: d1 },
  });
  assert.equal(badOrigin.status, 403);

  // 2) Short message rejected (400)
  const shortRes = await assistantPost({
    request: new Request("https://holarise.org/api/chat/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({ message: "?" }),
    }),
    env: { DB: d1 },
  });
  assert.equal(shortRes.status, 400);

  // 3) Valid question without GEMINI_API_KEY returns grounded D1 fallback with live event
  const okRes = await assistantPost({
    request: new Request("https://holarise.org/api/chat/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://holarise.org" },
      body: JSON.stringify({ message: "Lịch tuần này có sự kiện gì?", lang: "vi", pageUrl: "/" }),
    }),
    env: { DB: d1 },
  });
  assert.equal(okRes.status, 200);
  const okJson = await okRes.json();
  assert.equal(okJson.ok, true);
  assert.equal(okJson.mode, "grounded_fallback");
  assert.match(okJson.reply, /Workshop Cuộc Đời Của Cha/);
  assert.ok(okJson.suggestedLinks.some((l) => l.href === "/su-kien/workshop-cuoc-doi-cua-cha/"));
});
