import {
  buildEventFolderName,
  ensureCategorySubfolder,
  isDriveConfigured,
} from "../../../_lib/drive.js";
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
       (id, kind, type, filters_json, date, date_display, time, location, fee, seats, seat_capacity, external_booked, show_seat_bar, title, title_en, summary, summary_en, highlights_json, participants, image, image_alt, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        now
      )
      .run();
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("seat_capacity") || msg.includes("title_en")) {
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

  // Best-effort auto-provision a draft Media Album + Google Drive event folder
  let mediaAlbum = null;
  try {
    let albumSlug = slugifyVi(v.title).slice(0, 72) || baseSlug || `su-kien-${id.slice(-6)}`;
    const existingAlbum = await context.env.DB.prepare("SELECT id FROM media_albums WHERE slug = ?")
      .bind(albumSlug)
      .first();
    if (existingAlbum) {
      albumSlug = `${albumSlug}-${id.slice(-6)}`;
    }

    const folderName = buildEventFolderName({
      eventDate: v.date,
      title: v.title,
      fallback: albumSlug,
    });

    let driveUrl = "";
    if (isDriveConfigured(context.env)) {
      try {
        const folder = await ensureCategorySubfolder(context.env, {
          category: "album",
          subfolder: folderName,
        });
        if (folder?.folderUrl) driveUrl = folder.folderUrl;
      } catch {
        // Best-effort Drive folder provisioning
      }
    }

    const albumId = `alb-${crypto.randomUUID().slice(0, 12)}`;
    await context.env.DB.prepare(
      `INSERT INTO media_albums (
         id, slug, title, description, event_date, date_display, location,
         filters_json, drive_url, cover_url, status, sort_order, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?)`
    )
      .bind(
        albumId,
        albumSlug,
        v.title,
        v.summary || "",
        v.date || "",
        v.date_display || "",
        v.location || "",
        JSON.stringify(v.filters || []),
        driveUrl,
        v.image || "",
        auth.user.email,
        now,
        now
      )
      .run();

    mediaAlbum = { id: albumId, slug: albumSlug, folderName, driveUrl };
  } catch {
    // Graceful fallback if media_albums table is not present in a minimal DB
  }

  return jsonResponse({ ok: true, item: serializeEventRow(created), mediaAlbum }, 201);
}
