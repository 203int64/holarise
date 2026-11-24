import { serializeEventRow } from "../../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { slugifyVi, validateEventInput } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const kind = (url.searchParams.get("kind") || "").trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);

  let stmt;
  if (kind === "upcoming" || kind === "past") {
    stmt = context.env.DB.prepare(
      "SELECT * FROM events WHERE kind = ? ORDER BY sort_order ASC, date ASC, created_at DESC LIMIT ?"
    ).bind(kind, limit);
  } else {
    stmt = context.env.DB.prepare(
      "SELECT * FROM events ORDER BY kind DESC, sort_order ASC, date ASC, created_at DESC LIMIT ?"
    ).bind(limit);
  }

  const { results } = await stmt.all();
  return jsonResponse({
    ok: true,
    items: (results || []).map(serializeEventRow),
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 128 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validateEventInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin sự kiện chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  const baseSlug = slugifyVi(parsed.data.id || v.title).slice(0, 48);
  const id = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();

  try {
    await context.env.DB.prepare(
      `INSERT INTO events
       (id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, title_en, summary, summary_en, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        v.kind,
        v.type,
        JSON.stringify(v.filters),
        v.date,
        v.date_display,
        v.time,
        v.location,
        v.fee,
        v.seats,
        v.title,
        v.title_en,
        v.summary,
        v.summary_en,
        JSON.stringify(v.highlights),
        v.participants,
        v.image,
        v.image_alt,
        v.status,
        v.sort_order,
        now,
        now
      )
      .run();
  } catch (err) {
    if (String(err?.message || "").includes("title_en")) {
      await context.env.DB.prepare(
        `INSERT INTO events
         (id, kind, type, filters_json, date, date_display, time, location, fee, seats, title, summary, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          v.kind,
          v.type,
          JSON.stringify(v.filters),
          v.date,
          v.date_display,
          v.time,
          v.location,
          v.fee,
          v.seats,
          v.title,
          v.summary,
          JSON.stringify(v.highlights),
          v.participants,
          v.image,
          v.image_alt,
          v.status,
          v.sort_order,
          now,
          now
        )
        .run();
    } else {
      throw err;
    }
  }

  const created = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializeEventRow(created) }, 201);
}
