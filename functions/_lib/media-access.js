/**
 * Single Source of Truth for Deep Member Control, Album Visibility,
 * Per-Member Media Grants & /media/ Viewer Mode.
 */

import { getSessionMember, getSessionUser, isSoleAdminAccount } from "./security.js";

export const VALID_ALBUM_VISIBILITIES = new Set([
  "public",
  "members_only",
  "attendees_only",
  "private",
]);

export const VALID_STAGE_OVERRIDES = new Set(["auto", "invite", "memory"]);

const ensuredDeepDbs = new WeakSet();

export async function ensureDeepControlSchema(db) {
  if (!db || ensuredDeepDbs.has(db)) return;
  try {
    const [mColsRes, aColsRes, eColsRes] = await Promise.all([
      db.prepare("PRAGMA table_info(members)").all().catch(() => ({ results: [] })),
      db.prepare("PRAGMA table_info(media_albums)").all().catch(() => ({ results: [] })),
      db.prepare("PRAGMA table_info(events)").all().catch(() => ({ results: [] })),
    ]);

    const mCols = new Set((mColsRes.results || []).map((c) => String(c.name || "").toLowerCase()));
    if (mCols.size > 0) {
      if (!mCols.has("can_view_all_media")) {
        await db.prepare("ALTER TABLE members ADD COLUMN can_view_all_media INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
      }
      if (!mCols.has("can_access_media_portal")) {
        await db.prepare("ALTER TABLE members ADD COLUMN can_access_media_portal INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
      }
    }

    const aCols = new Set((aColsRes.results || []).map((c) => String(c.name || "").toLowerCase()));
    if (aCols.size > 0 && !aCols.has("visibility")) {
      await db
        .prepare("ALTER TABLE media_albums ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'")
        .run()
        .catch(() => {});
    }

    const eCols = new Set((eColsRes.results || []).map((c) => String(c.name || "").toLowerCase()));
    if (eCols.size > 0) {
      if (!eCols.has("rsvp_closed")) {
        await db.prepare("ALTER TABLE events ADD COLUMN rsvp_closed INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
      }
      if (!eCols.has("stage_override")) {
        await db
          .prepare("ALTER TABLE events ADD COLUMN stage_override TEXT NOT NULL DEFAULT 'auto'")
          .run()
          .catch(() => {});
      }
    }

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS member_album_grants (
          member_id TEXT NOT NULL,
          album_id TEXT NOT NULL,
          granted_by TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          PRIMARY KEY (member_id, album_id)
        )`
      )
      .run()
      .catch(() => {});
  } catch {
    // Non-fatal on minimal DB mocks
  }
  ensuredDeepDbs.add(db);
}

export async function getMemberPermissions(db, memberId) {
  if (!db || !memberId) {
    return { canViewAllMedia: false, canAccessMediaPortal: false };
  }
  await ensureDeepControlSchema(db);
  const row = await db
    .prepare("SELECT can_view_all_media, can_access_media_portal FROM members WHERE id = ? AND is_active = 1")
    .bind(memberId)
    .first()
    .catch(() => null);
  return {
    canViewAllMedia: Number(row?.can_view_all_media || 0) === 1,
    canAccessMediaPortal: Number(row?.can_access_media_portal || 0) === 1,
  };
}

export async function resolveActorContext(env, request) {
  if (!env?.DB || !request) {
    return {
      adminUser: null,
      isSoleAdmin: false,
      isMediaTeam: false,
      member: null,
      canViewAllMedia: false,
      isMediaViewer: false,
    };
  }
  await ensureDeepControlSchema(env.DB);
  const [adminUser, member] = await Promise.all([
    getSessionUser(env.DB, request).catch(() => null),
    getSessionMember(env.DB, request).catch(() => null),
  ]);
  const isSoleAdmin = Boolean(adminUser && isSoleAdminAccount(adminUser, env));
  const isMediaTeam = Boolean(adminUser && adminUser.role === "media");
  let canViewAllMedia = false;
  let isMediaViewer = false;
  if (member) {
    const perms = await getMemberPermissions(env.DB, member.id);
    canViewAllMedia = perms.canViewAllMedia;
    isMediaViewer = perms.canAccessMediaPortal;
  }
  return {
    adminUser,
    isSoleAdmin,
    isMediaTeam,
    member,
    canViewAllMedia,
    isMediaViewer,
  };
}

function phoneVariants(phoneNorm) {
  const clean = String(phoneNorm || "").replace(/\D/g, "");
  if (clean.length < 8) return [];
  const set = new Set([clean]);
  if (clean.startsWith("0") && clean.length === 10) {
    set.add(`84${clean.slice(1)}`);
    set.add(`+84${clean.slice(1)}`);
  } else if (clean.startsWith("84") && clean.length === 11) {
    set.add(`0${clean.slice(2)}`);
    set.add(`+${clean}`);
  }
  return Array.from(set);
}

export async function hasMemberEventRegistration(db, member, eventId) {
  if (!db || !member || !eventId) return false;
  const clauses = ["member_id = ?"];
  const binds = [eventId, member.id];
  const email = String(member.email || "").trim().toLowerCase();
  if (email) {
    clauses.push("LOWER(TRIM(email)) = ?");
    binds.push(email);
  }
  const variants = phoneVariants(member.phone_norm);
  if (variants.length > 0) {
    const ph = variants.map(() => "?").join(", ");
    clauses.push(
      `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '') IN (${ph})`
    );
    binds.push(...variants);
  }
  const row = await db
    .prepare(
      `SELECT id FROM registrations
       WHERE event_id = ? AND status != 'cancelled' AND (${clauses.join(" OR ")})
       LIMIT 1`
    )
    .bind(...binds)
    .first()
    .catch(() => null);
  return Boolean(row);
}

export async function hasMemberAlbumGrant(db, memberId, albumId) {
  if (!db || !memberId || !albumId) return false;
  const row = await db
    .prepare("SELECT member_id FROM member_album_grants WHERE member_id = ? AND album_id = ? LIMIT 1")
    .bind(memberId, albumId)
    .first()
    .catch(() => null);
  return Boolean(row);
}

export async function getMemberGrantedAlbumIds(db, memberId) {
  if (!db || !memberId) return new Set();
  await ensureDeepControlSchema(db);
  const { results } = await db
    .prepare("SELECT album_id FROM member_album_grants WHERE member_id = ?")
    .bind(memberId)
    .all()
    .catch(() => ({ results: [] }));
  return new Set((results || []).map((r) => r.album_id));
}

export async function canActorViewAlbum(db, album, actor) {
  if (!album) return false;
  const vis = String(album.visibility || "public").toLowerCase();
  if (actor?.isSoleAdmin || actor?.isMediaTeam || actor?.isMediaViewer) return true;
  if (vis === "public") return true;
  if (!actor?.member) return false;
  if (actor.canViewAllMedia) return true;
  if (vis === "members_only") return true;
  if (await hasMemberAlbumGrant(db, actor.member.id, album.id)) return true;
  if (vis === "attendees_only") {
    const eventId = album.event_id || album.eventId || "";
    if (eventId && (await hasMemberEventRegistration(db, actor.member, eventId))) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a proxied media file (/api/media/drive/:id or /api/media/:id)
 * belongs to any restricted album (visibility != 'public').
 * Returns { restricted: false, allowed: true } for public/unlinked media so Edge cache works at full speed.
 */
export async function checkMediaAssetAccess(env, request, { driveFileId = "", kvMediaKey = "" } = {}) {
  if (!env?.DB) return { restricted: false, allowed: true };
  await ensureDeepControlSchema(env.DB);

  let album = null;
  if (driveFileId) {
    const driveKey = `drive:${driveFileId}`;
    const driveUrl = `/api/media/drive/${driveFileId}`;
    album = await env.DB.prepare(
      `SELECT a.id, a.event_id, COALESCE(a.visibility, 'public') AS visibility
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE p.media_key = ? OR p.url = ?
       LIMIT 1`
    )
      .bind(driveKey, driveUrl)
      .first()
      .catch(() => null);
  } else if (kvMediaKey) {
    const kvUrl = `/api/media/${kvMediaKey}`;
    album = await env.DB.prepare(
      `SELECT a.id, a.event_id, COALESCE(a.visibility, 'public') AS visibility
       FROM media_photos p
       JOIN media_albums a ON a.id = p.album_id
       WHERE p.media_key = ? OR p.web_media_key = ? OR p.url = ? OR p.web_url = ?
       LIMIT 1`
    )
      .bind(kvMediaKey, kvMediaKey, kvUrl, kvUrl)
      .first()
      .catch(() => null);
  }

  if (!album || String(album.visibility || "public") === "public") {
    return { restricted: false, allowed: true };
  }

  const actor = await resolveActorContext(env, request);
  const allowed = await canActorViewAlbum(env.DB, album, actor);
  return { restricted: true, allowed, visibility: album.visibility, albumId: album.id };
}
