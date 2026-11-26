/**
 * Idempotent schema guard for media approval & post-event auto-album columns.
 * Ensures D1 databases created from earlier migrations safely gain the new columns
 * without crashing SSR or Media Portal APIs.
 */

const ensuredDbs = new WeakSet();

export async function ensureMediaApprovalSchema(db) {
  if (!db || ensuredDbs.has(db)) return;

  const [albumColsRes, photoColsRes] = await Promise.all([
    db.prepare("PRAGMA table_info(media_albums)").all().catch(() => ({ results: [] })),
    db.prepare("PRAGMA table_info(media_photos)").all().catch(() => ({ results: [] })),
  ]);

  const albumCols = new Set((albumColsRes.results || []).map((r) => r.name));
  const photoCols = new Set((photoColsRes.results || []).map((r) => r.name));

  const alters = [];
  if (albumCols.size > 0 && !albumCols.has("event_id")) {
    alters.push("ALTER TABLE media_albums ADD COLUMN event_id TEXT NOT NULL DEFAULT ''");
  }
  if (photoCols.size > 0) {
    if (!photoCols.has("approval_status")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'");
    }
    if (!photoCols.has("web_url")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN web_url TEXT NOT NULL DEFAULT ''");
    }
    if (!photoCols.has("web_media_key")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN web_media_key TEXT NOT NULL DEFAULT ''");
    }
    if (!photoCols.has("approved_by")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN approved_by TEXT NOT NULL DEFAULT ''");
    }
    if (!photoCols.has("approved_at")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN approved_at TEXT NOT NULL DEFAULT ''");
    }
    if (!photoCols.has("contributor_member_id")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN contributor_member_id TEXT NOT NULL DEFAULT ''");
    }
    if (!photoCols.has("source_kind")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'team'");
    }
    if (!photoCols.has("drive_path")) {
      alters.push("ALTER TABLE media_photos ADD COLUMN drive_path TEXT NOT NULL DEFAULT ''");
    }
  }

  for (const sql of alters) {
    await db.prepare(sql).run().catch(() => {});
  }

  ensuredDbs.add(db);
}
