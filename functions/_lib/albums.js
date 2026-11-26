import { getTodayVnIso, isEventFinished } from "./render.js";
import { slugifyVi } from "./validation.js";

/**
 * Automatically creates a published media_albums entry for every finished published event
 * that does not yet have an album, so both Ban Hình Ảnh (/media/) and Members (/hanh-trinh/)
 * can immediately contribute photos right after an event wraps up.
 */
export async function autoProvisionFinishedEventAlbums(env, nowDate = new Date()) {
  if (!env?.DB) return;
  const todayVn = getTodayVnIso(nowDate);
  const candidateEventsRes = await env.DB.prepare(
    `SELECT id, kind, title, date, time, date_display, location, filters_json, image, summary
     FROM events
     WHERE status = 'published'
       AND (kind = 'past' OR (date != '' AND date <= ?))
     ORDER BY date DESC
     LIMIT 60`
  )
    .bind(todayVn)
    .all()
    .catch(() => null);

  const finishedEvents = (candidateEventsRes?.results || []).filter((ev) => isEventFinished(ev, nowDate));
  if (finishedEvents.length === 0) return;

  const existingAlbumsRes = await env.DB.prepare(
    "SELECT id, slug, event_id, event_date, title FROM media_albums LIMIT 300"
  )
    .all()
    .catch(() => null);
  const existingAlbums = existingAlbumsRes?.results || [];

  const existingEventIds = new Set(existingAlbums.map((a) => a.event_id).filter(Boolean));
  const existingSlugs = new Set(existingAlbums.map((a) => a.slug).filter(Boolean));
  const existingDates = new Set(existingAlbums.map((a) => a.event_date).filter(Boolean));

  const now = new Date().toISOString();
  for (const ev of finishedEvents) {
    if (!ev.id || existingEventIds.has(ev.id)) continue;
    const baseSlug = slugifyVi(`${ev.title || ev.id}-${ev.date || ""}`).slice(0, 80) || slugifyVi(ev.id);
    const alreadyMatchedByDate =
      ev.date &&
      existingDates.has(ev.date) &&
      existingAlbums.some(
        (a) =>
          a.event_date === ev.date &&
          slugifyVi(a.title || "").slice(0, 24) === slugifyVi(ev.title || "").slice(0, 24)
      );
    if (alreadyMatchedByDate || existingSlugs.has(baseSlug)) continue;

    const id = `alb-ev-${slugifyVi(ev.id).slice(0, 48)}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO media_albums (
         id, slug, title, description, event_date, date_display, location,
         filters_json, drive_url, cover_url, status, sort_order, event_id,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'published', 10, ?, 'auto-event', ?, ?)`
    )
      .bind(
        id,
        baseSlug,
        ev.title || "Album sự kiện HolaRise",
        ev.summary || "",
        ev.date || "",
        ev.date_display || ev.date || "",
        ev.location || "Hòa Lạc, Hà Nội",
        ev.filters_json || "[]",
        ev.image || "",
        ev.id,
        now,
        now
      )
      .run()
      .catch(() => {});

    existingEventIds.add(ev.id);
    existingSlugs.add(baseSlug);
    if (ev.date) existingDates.add(ev.date);
  }
}
