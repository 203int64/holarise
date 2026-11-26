import { safeJsonParse, serializeEventRow } from "../../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../../_lib/security.js";
import { validateEventInput } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const row = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!row) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện.");
  }
  return jsonResponse({ ok: true, item: serializeEventRow(row) });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const existing = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện để cập nhật.");
  }

  const parsed = await readJsonBody(context.request, 128 * 1024);
  if (!parsed.ok) return parsed.response;

  const mergedBody = {
    ...parsed.data,
    highlights:
      parsed.data.highlights !== undefined
        ? parsed.data.highlights
        : safeJsonParse(existing.highlights_json, []),
    imageAlt:
      parsed.data.imageAlt !== undefined || parsed.data.image_alt !== undefined
        ? (parsed.data.imageAlt ?? parsed.data.image_alt)
        : existing.image_alt,
    sortOrder:
      parsed.data.sortOrder !== undefined || parsed.data.sort_order !== undefined
        ? (parsed.data.sortOrder ?? parsed.data.sort_order)
        : existing.sort_order,
    titleEn:
      parsed.data.titleEn !== undefined || parsed.data.title_en !== undefined
        ? (parsed.data.titleEn ?? parsed.data.title_en)
        : (existing.title_en || ""),
    summaryEn:
      parsed.data.summaryEn !== undefined || parsed.data.summary_en !== undefined
        ? (parsed.data.summaryEn ?? parsed.data.summary_en)
        : (existing.summary_en || ""),
    seatCapacity:
      parsed.data.seatCapacity !== undefined || parsed.data.seat_capacity !== undefined
        ? (parsed.data.seatCapacity ?? parsed.data.seat_capacity)
        : (existing.seat_capacity || 0),
    externalBooked:
      parsed.data.externalBooked !== undefined || parsed.data.external_booked !== undefined
        ? (parsed.data.externalBooked ?? parsed.data.external_booked)
        : (existing.external_booked || 0),
    showSeatBar:
      parsed.data.showSeatBar !== undefined || parsed.data.show_seat_bar !== undefined
        ? (parsed.data.showSeatBar ?? parsed.data.show_seat_bar)
        : Boolean(existing.show_seat_bar),
    zaloGroupUrl:
      parsed.data.zaloGroupUrl !== undefined || parsed.data.zalo_group_url !== undefined
        ? (parsed.data.zaloGroupUrl ?? parsed.data.zalo_group_url)
        : (existing.zalo_group_url || ""),
  };

  const validated = validateEventInput(mergedBody);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin sự kiện chưa hợp lệ.", validated.fields);
  }

  const v = validated.value;
  const now = new Date().toISOString();

  try {
    await context.env.DB.prepare(
      `UPDATE events
       SET kind = ?, type = ?, filters_json = ?, date = ?, date_display = ?, time = ?, location = ?,
           fee = ?, seats = ?, seat_capacity = ?, external_booked = ?, show_seat_bar = ?,
           title = ?, title_en = ?, summary = ?, summary_en = ?, highlights_json = ?, participants = ?,
           image = ?, image_alt = ?, zalo_group_url = ?, status = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        v.kind,
        v.type,
        JSON.stringify(v.filters),
        v.date,
        v.date_display,
        v.time,
        v.location,
        v.fee,
        v.seats,
        v.seat_capacity,
        v.external_booked,
        v.show_seat_bar,
        v.title,
        v.title_en,
        v.summary,
        v.summary_en,
        JSON.stringify(v.highlights),
        v.participants,
        v.image,
        v.image_alt,
        v.zalo_group_url,
        v.status,
        v.sort_order,
        now,
        id
      )
      .run();
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("zalo_group_url")) {
      try {
        await context.env.DB.prepare(
          `UPDATE events
           SET kind = ?, type = ?, filters_json = ?, date = ?, date_display = ?, time = ?, location = ?,
               fee = ?, seats = ?, seat_capacity = ?, external_booked = ?, show_seat_bar = ?,
               title = ?, title_en = ?, summary = ?, summary_en = ?, highlights_json = ?, participants = ?,
               image = ?, image_alt = ?, status = ?, sort_order = ?, updated_at = ?
           WHERE id = ?`
        )
          .bind(
            v.kind,
            v.type,
            JSON.stringify(v.filters),
            v.date,
            v.date_display,
            v.time,
            v.location,
            v.fee,
            v.seats,
            v.seat_capacity,
            v.external_booked,
            v.show_seat_bar,
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
            id
          )
          .run();
      } catch (err2) {
        const msg2 = String(err2?.message || "");
        if (msg2.includes("seat_capacity") || msg2.includes("title_en")) {
          await context.env.DB.prepare(
            `UPDATE events
             SET kind = ?, type = ?, filters_json = ?, date = ?, date_display = ?, time = ?, location = ?,
                 fee = ?, seats = ?, title = ?, summary = ?, highlights_json = ?, participants = ?,
                 image = ?, image_alt = ?, status = ?, sort_order = ?, updated_at = ?
             WHERE id = ?`
          )
            .bind(
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
              id
            )
            .run();
        } else {
          throw err2;
        }
      }
    } else if (msg.includes("seat_capacity") || msg.includes("title_en")) {
      await context.env.DB.prepare(
        `UPDATE events
         SET kind = ?, type = ?, filters_json = ?, date = ?, date_display = ?, time = ?, location = ?,
             fee = ?, seats = ?, title = ?, summary = ?, highlights_json = ?, participants = ?,
             image = ?, image_alt = ?, status = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(
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
          id
        )
        .run();
    } else {
      throw err;
    }
  }

  const updated = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, item: serializeEventRow(updated) });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "");
  const res = await context.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  if (Number(res?.meta?.changes || 0) === 0) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy sự kiện để xóa.");
  }
  return jsonResponse({ ok: true, id });
}
