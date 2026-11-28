import { ensureDeepControlSchema, getMemberGrantedAlbumIds } from "../../../_lib/media-access.js";
import { ensureMediaApprovalSchema } from "../../../_lib/media-approval-schema.js";
import {
  ensureReflectionsSchema,
  errorResponse,
  hashPassword,
  jsonResponse,
  readJsonBody,
  requireAdmin,
} from "../../../_lib/security.js";
import {
  VALID_PILLAR_CHOICES,
  cleanStr,
  extractMediaKeyFromUrl,
  isSafeMediaUrl,
  isValidEmail,
  normalizePhone,
  parseReflectionPhotos,
} from "../../../_lib/validation.js";
import { ensureMemberProfileColumns, serializeAdminMember } from "./index.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context, { permission: "members.read" });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  await Promise.all([
    ensureMemberProfileColumns(db),
    ensureDeepControlSchema(db),
    ensureReflectionsSchema(db),
    ensureMediaApprovalSchema(db),
  ]);

  const id = String(context.params?.id || "").trim();
  const row = await db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM registrations rg WHERE rg.member_id = m.id) AS reg_count,
              (SELECT COUNT(*) FROM activity_reflections rf WHERE rf.member_id = m.id) AS ref_count,
              (SELECT COUNT(*) FROM member_album_grants g WHERE g.member_id = m.id) AS grant_count
       FROM members m
       WHERE m.id = ?`
    )
    .bind(id)
    .first();

  if (!row) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy thành viên.");
  }

  const nowIso = new Date().toISOString();
  const matchClauses = ["r.member_id = ?"];
  const regBinds = [row.id];
  const email = String(row.email || "").trim().toLowerCase();
  if (email) {
    matchClauses.push("((r.member_id IS NULL OR r.member_id = '') AND LOWER(TRIM(r.email)) = ?)");
    regBinds.push(email);
  }
  const phoneNorm = String(row.phone_norm || "").replace(/\D/g, "");
  if (phoneNorm.length >= 8) {
    matchClauses.push(
      "((r.member_id IS NULL OR r.member_id = '') AND REPLACE(REPLACE(REPLACE(r.phone, ' ', ''), '.', ''), '-', '') = ?)"
    );
    regBinds.push(phoneNorm);
  }

  const [regsRes, refsRes, photosRes, sessRow, passkeyRow, grantedIds, albumsRes, eventsRes] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.event_id, r.activity_title, r.status, r.admin_note, r.member_id, r.created_at,
                e.title AS event_title, e.date_display, e.date AS event_date, e.kind AS event_kind
         FROM registrations r
         LEFT JOIN events e ON e.id = r.event_id
         WHERE ${matchClauses.join(" OR ")}
         ORDER BY r.created_at DESC
         LIMIT 60`
      )
      .bind(...regBinds)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT id, activity_slug, participant_role, pull_quote, content, photo_url, photos_json,
                heart_count, status, admin_note, created_at
         FROM activity_reflections
         WHERE member_id = ?
         ORDER BY created_at DESC
         LIMIT 40`
      )
      .bind(row.id)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT p.id, p.album_id, COALESCE(NULLIF(p.web_url, ''), p.url) AS url, p.caption,
                p.approval_status, p.created_at, a.title AS album_title
         FROM media_photos p
         LEFT JOIN media_albums a ON a.id = p.album_id
         WHERE p.contributor_member_id = ?
         ORDER BY p.created_at DESC
         LIMIT 40`
      )
      .bind(row.id)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT COUNT(*) AS cnt FROM member_sessions WHERE member_id = ? AND expires_at > ?")
      .bind(row.id, nowIso)
      .first()
      .catch(() => ({ cnt: 0 })),
    db
      .prepare("SELECT COUNT(*) AS cnt FROM member_passkeys WHERE member_id = ?")
      .bind(row.id)
      .first()
      .catch(() => ({ cnt: 0 })),
    getMemberGrantedAlbumIds(db, row.id),
    db
      .prepare(
        `SELECT a.id, a.slug, a.title, a.event_date, a.date_display, a.status,
                COALESCE(a.visibility, 'public') AS visibility,
                (SELECT COUNT(*) FROM media_photos p WHERE p.album_id = a.id) AS photo_count
         FROM media_albums a
         ORDER BY a.event_date DESC, a.created_at DESC
         LIMIT 100`
      )
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare("SELECT id, title, date, date_display, kind, status FROM events ORDER BY date DESC, created_at DESC LIMIT 80")
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const member = serializeAdminMember(row);
  return jsonResponse({
    ok: true,
    member,
    registrations: regsRes.results || [],
    reflections: (refsRes.results || []).map((rf) => ({
      id: rf.id,
      activitySlug: rf.activity_slug,
      participantRole: rf.participant_role,
      pullQuote: rf.pull_quote || "",
      content: rf.content || "",
      photoUrls: parseReflectionPhotos(rf.photos_json, rf.photo_url || ""),
      heartCount: Number(rf.heart_count || 0),
      status: rf.status,
      adminNote: rf.admin_note || "",
      createdAt: rf.created_at,
    })),
    photos: photosRes.results || [],
    security: {
      activeSessionCount: Number(sessRow?.cnt || 0),
      passkeyCount: Number(passkeyRow?.cnt || 0),
      lastLoginAt: member.lastLoginAt,
    },
    mediaAccess: {
      canViewAllMedia: member.canViewAllMedia,
      canAccessMediaPortal: member.canAccessMediaPortal,
      grantedAlbumIds: Array.from(grantedIds),
      albums: (albumsRes.results || []).map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        eventDate: a.event_date || "",
        dateDisplay: a.date_display || a.event_date || "",
        status: a.status,
        visibility: a.visibility || "public",
        photoCount: Number(a.photo_count || 0),
        granted: grantedIds.has(a.id),
      })),
    },
    events: (eventsRes.results || []).map((e) => ({
      id: e.id,
      title: e.title,
      date: e.date,
      dateDisplay: e.date_display || e.date,
      kind: e.kind,
      status: e.status,
    })),
  });
}

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  await Promise.all([
    ensureMemberProfileColumns(context.env.DB),
    ensureDeepControlSchema(context.env.DB),
  ]);

  const id = String(context.params?.id || "").trim();
  const existing = await context.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first();
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy thành viên.");
  }

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data || {};

  const nextName = d.name !== undefined ? cleanStr(d.name, 120) : existing.name;
  if (nextName.length < 2) {
    return errorResponse(400, "VALIDATION_ERROR", "Họ và tên cần tối thiểu 2 ký tự.");
  }

  let nextEmail = existing.email;
  if (d.email !== undefined) {
    const raw = cleanStr(d.email, 160).toLowerCase();
    if (raw && !isValidEmail(raw)) {
      return errorResponse(400, "VALIDATION_ERROR", "Email chưa đúng định dạng.");
    }
    nextEmail = raw || null;
  }

  let nextPhoneDisplay = existing.phone_display || "";
  let nextPhoneNorm = existing.phone_norm;
  if (d.phone !== undefined || d.phoneDisplay !== undefined) {
    const rawP = cleanStr(d.phone ?? d.phoneDisplay, 40);
    nextPhoneDisplay = rawP;
    const parsedP = rawP ? normalizePhone(rawP) : null;
    nextPhoneNorm = rawP ? (parsedP?.ok ? parsedP.phoneNorm : rawP.replace(/\D/g, "")) : null;
  }

  const nextOrg = d.organization !== undefined ? cleanStr(d.organization, 160) : existing.organization || "";
  const nextPillar =
    d.pillarChoice !== undefined && VALID_PILLAR_CHOICES.has(cleanStr(d.pillarChoice, 32))
      ? cleanStr(d.pillarChoice, 32)
      : existing.pillar_choice || "holaheart";
  const nextRoleTitle =
    d.roleTitle !== undefined || d.role_title !== undefined
      ? cleanStr(d.roleTitle ?? d.role_title, 120)
      : existing.role_title || "";
  const nextBio = d.bio !== undefined ? cleanStr(d.bio, 400) : existing.bio || "";
  const nextNotes = d.notes !== undefined ? cleanStr(d.notes, 800) : existing.notes || "";
  const nextPublicTeam =
    d.isPublicTeam !== undefined || d.is_public_team !== undefined
      ? Boolean(d.isPublicTeam ?? d.is_public_team) ? 1 : 0
      : Number(existing.is_public_team || 0);

  let nextAvatarUrl = existing.avatar_url || "";
  let nextAvatarKey = existing.avatar_media_key || "";
  if (d.avatarUrl !== undefined || d.avatar_url !== undefined) {
    const rawUrl = cleanStr(d.avatarUrl ?? d.avatar_url, 500);
    if (rawUrl && !isSafeMediaUrl(rawUrl)) {
      return errorResponse(400, "VALIDATION_ERROR", "Đường dẫn ảnh đại diện không hợp lệ.");
    }
    nextAvatarUrl = rawUrl;
    nextAvatarKey = rawUrl ? extractMediaKeyFromUrl(rawUrl) : "";
  }

  let nextActive = Number(existing.is_active);
  if (d.isActive !== undefined || d.is_active !== undefined) {
    nextActive = Boolean(d.isActive ?? d.is_active) ? 1 : 0;
  }

  const nextCanViewAllMedia =
    d.canViewAllMedia !== undefined || d.can_view_all_media !== undefined
      ? Boolean(d.canViewAllMedia ?? d.can_view_all_media) ? 1 : 0
      : Number(existing.can_view_all_media || 0);

  const nextCanAccessMediaPortal =
    d.canAccessMediaPortal !== undefined || d.can_access_media_portal !== undefined
      ? Boolean(d.canAccessMediaPortal ?? d.can_access_media_portal) ? 1 : 0
      : Number(existing.can_access_media_portal || 0);

  let nextHash = existing.password_hash;
  let nextSalt = existing.password_salt;
  let clearSessions = nextActive === 0;

  if (d.resetPassword !== undefined && String(d.resetPassword).length > 0) {
    const tempPw = String(d.resetPassword);
    if (tempPw.length < 6 || tempPw.length > 128) {
      return errorResponse(400, "INVALID_PASSWORD", "Mật khẩu tạm cần từ 6 đến 128 ký tự.");
    }
    const hashed = await hashPassword(tempPw);
    nextHash = hashed.hash;
    nextSalt = hashed.salt;
    clearSessions = true;
  }

  const now = new Date().toISOString();
  const stmts = [
    context.env.DB.prepare(
      `UPDATE members
       SET name = ?, email = ?, phone_norm = ?, phone_display = ?, organization = ?,
           pillar_choice = ?, role_title = ?, bio = ?, notes = ?, is_public_team = ?,
           avatar_url = ?, avatar_media_key = ?, is_active = ?,
           can_view_all_media = ?, can_access_media_portal = ?,
           password_hash = ?, password_salt = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      nextName,
      nextEmail,
      nextPhoneNorm,
      nextPhoneDisplay,
      nextOrg,
      nextPillar,
      nextRoleTitle,
      nextBio,
      nextNotes,
      nextPublicTeam,
      nextAvatarUrl,
      nextAvatarKey,
      nextActive,
      nextCanViewAllMedia,
      nextCanAccessMediaPortal,
      nextHash,
      nextSalt,
      now,
      id
    ),
  ];

  if (clearSessions) {
    stmts.push(context.env.DB.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(id));
  }

  await context.env.DB.batch(stmts);

  const updated = await context.env.DB.prepare(
    `SELECT m.*,
            (SELECT COUNT(*) FROM registrations rg WHERE rg.member_id = m.id) AS reg_count,
            (SELECT COUNT(*) FROM activity_reflections rf WHERE rf.member_id = m.id) AS ref_count
     FROM members m
     WHERE m.id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({
    ok: true,
    item: serializeAdminMember(updated),
  });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = String(context.params?.id || "").trim();
  const existing = await context.env.DB.prepare("SELECT id, avatar_media_key FROM members WHERE id = ?")
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy thành viên để xóa.");
  }

  const refPhotos = await context.env.DB.prepare(
    "SELECT photo_media_key FROM activity_reflections WHERE member_id = ? AND photo_media_key != ''"
  )
    .bind(id)
    .all();

  await context.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id).run();

  if (context.env?.MEDIA_KV?.delete) {
    const keysToDelete = [];
    if (existing.avatar_media_key) keysToDelete.push(existing.avatar_media_key);
    for (const r of refPhotos.results || []) {
      if (r.photo_media_key) keysToDelete.push(r.photo_media_key);
    }
    await Promise.all(keysToDelete.map((k) => context.env.MEDIA_KV.delete(`media:${k}`).catch(() => null)));
  }

  return jsonResponse({ ok: true, id });
}
