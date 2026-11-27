import { ensureChatAndCapabilitySchema, listMemberCapabilities } from "../../_lib/capabilities.js";
import { mergeGuestThreadsToMember } from "../../_lib/chat.js";
import { resolveEventHref } from "../../_lib/render.js";
import {
  ensureReflectionsSchema,
  errorResponse,
  getSessionMember,
  jsonResponse,
  serializePublicMember,
} from "../../_lib/security.js";
import { parseReflectionPhotos } from "../../_lib/validation.js";

function inferEventPillar(eventType, eventId, title) {
  const hay = `${eventType || ""} ${eventId || ""} ${title || ""}`.toLowerCase();
  if (hay.includes("holagreen") || hay.includes("sinh thái") || hay.includes("cảnh quan")) {
    return "holagreen";
  }
  if (hay.includes("holaconnect") || hay.includes("leo núi") || hay.includes("tri thức") || hay.includes("phụng sự")) {
    return "holaconnect";
  }
  return "holaheart";
}

function buildPhoneMatchVariants(phoneNorm) {
  const clean = String(phoneNorm || "").replace(/\D/g, "");
  if (clean.length < 8) return [];
  const variants = new Set([clean]);
  if (clean.startsWith("0") && clean.length === 10) {
    variants.add(`84${clean.slice(1)}`);
    variants.add(`+84${clean.slice(1)}`);
  } else if (clean.startsWith("84") && clean.length === 11) {
    variants.add(`0${clean.slice(2)}`);
    variants.add(`+${clean}`);
  }
  return Array.from(variants);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Cơ sở dữ liệu D1 chưa được kết nối.");
  }

  const member = await getSessionMember(env.DB, request);
  if (!member) {
    return errorResponse(401, "MEMBER_UNAUTHORIZED", "Vui lòng đăng nhập tài khoản Thành viên Hola.");
  }

  const matchClauses = ["r.member_id = ?"];
  const bindParams = [member.id];

  const memberEmail = String(member.email || "").trim().toLowerCase();
  if (memberEmail) {
    matchClauses.push("((r.member_id IS NULL OR r.member_id = '') AND LOWER(TRIM(r.email)) = ?)");
    bindParams.push(memberEmail);
  }

  const phoneVariants = buildPhoneMatchVariants(member.phone_norm);
  if (phoneVariants.length) {
    const placeholders = phoneVariants.map(() => "?").join(", ");
    matchClauses.push(
      `((r.member_id IS NULL OR r.member_id = '') AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(r.phone), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '') IN (${placeholders}))`
    );
    bindParams.push(...phoneVariants);
  }

  const regQuery = `
    SELECT
      r.id,
      r.source,
      r.event_id,
      r.activity_title,
      r.full_name,
      r.organization,
      r.role,
      r.note,
      r.status,
      r.created_at,
      e.title AS event_title,
      e.type AS event_type,
      e.kind AS event_kind,
      e.date AS event_date,
      e.date_display AS event_date_display,
      e.time AS event_time,
      e.location AS event_location,
      e.summary AS event_summary
    FROM registrations r
    LEFT JOIN events e ON e.id = r.event_id
    WHERE ${matchClauses.join(" OR ")}
    ORDER BY COALESCE(NULLIF(e.date, ''), substr(r.created_at, 1, 10)) DESC, r.created_at DESC
    LIMIT 60
  `;

  await Promise.all([
    ensureReflectionsSchema(env.DB),
    ensureChatAndCapabilitySchema(env.DB),
  ]);
  await mergeGuestThreadsToMember(env.DB, member).catch(() => 0);

  const [regsRes, refsRes, photosRes, capabilities, unreadChatRow] = await Promise.all([
    env.DB.prepare(regQuery).bind(...bindParams).all(),
    env.DB.prepare(
      `SELECT id, activity_slug, participant_role, pull_quote, content, photo_url, photos_json, heart_count, status, admin_note, created_at, updated_at
       FROM activity_reflections
       WHERE member_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
      .bind(member.id)
      .all(),
    env.DB.prepare(
      `SELECT p.id, p.url, p.web_url, p.caption, p.approval_status, p.media_type, p.created_at, a.title AS album_title, a.slug AS album_slug
       FROM media_photos p
       LEFT JOIN media_albums a ON a.id = p.album_id
       WHERE p.contributor_member_id = ?
         AND COALESCE(p.media_type, 'image') = 'image'
       ORDER BY p.created_at DESC
       LIMIT 12`
    )
      .bind(member.id)
      .all()
      .catch(() => ({ results: [] })),
    listMemberCapabilities(env.DB, member.id, { includeInactive: false }).catch(() => []),
    env.DB.prepare(
      `SELECT COALESCE(SUM(unread_member), 0) AS cnt FROM chat_threads WHERE member_id = ?`
    )
      .bind(member.id)
      .first()
      .catch(() => ({ cnt: 0 })),
  ]);

  const seenRegIds = new Set();
  const registrations = [];
  for (const r of regsRes.results || []) {
    if (!r.id || seenRegIds.has(r.id)) continue;
    seenRegIds.add(r.id);

    const title = r.event_title || r.activity_title || "Hoạt động HolaRise";
    const pillar = inferEventPillar(r.event_type, r.event_id, title);
    const eventHref = r.event_id ? resolveEventHref({ id: r.event_id }) : "";

    registrations.push({
      id: r.id,
      source: r.source || "event_modal",
      eventId: r.event_id || "",
      activityTitle: title,
      eventType: r.event_type || "",
      eventPillar: pillar,
      eventKind: r.event_kind || "",
      eventDate: r.event_date || "",
      eventDateDisplay: r.event_date_display || "",
      eventTime: r.event_time || "",
      eventLocation: r.event_location || "",
      eventSummary: r.event_summary || "",
      eventHref,
      fullName: r.full_name || member.name || "",
      organization: r.organization || member.organization || "",
      role: r.role || "",
      note: r.note || "",
      status: r.status || "new",
      createdAt: r.created_at,
    });
  }

  const reflections = (refsRes.results || []).map((r) => {
    const photoUrls = parseReflectionPhotos(r.photos_json, r.photo_url || "");
    return {
      id: r.id,
      activitySlug: r.activity_slug,
      participantRole: r.participant_role,
      pullQuote: r.pull_quote || "",
      content: r.content,
      photoUrl: photoUrls[0] || "",
      photoUrls,
      heartCount: Number(r.heart_count || 0),
      status: r.status,
      adminNote: r.admin_note || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  const contributedPhotos = (photosRes?.results || []).map((p) => ({
    id: p.id,
    url: p.web_url || p.url || "",
    caption: p.caption || "",
    approvalStatus: p.approval_status || "approved",
    albumTitle: p.album_title || "",
    albumSlug: p.album_slug || "",
    createdAt: p.created_at,
  }));

  const pillarsSet = new Set([member.pillar_choice || "holaheart"]);
  let activeCount = 0;
  let attendedCount = 0;
  for (const r of registrations) {
    if (r.status !== "cancelled") {
      activeCount += 1;
      if (r.eventPillar) pillarsSet.add(r.eventPillar);
    }
    if (r.status === "attended") attendedCount += 1;
  }

  const pendingCapabilitiesCount = capabilities.filter((c) => c.status === "pending_accept").length;

  return jsonResponse({
    ok: true,
    member: serializePublicMember(member),
    registrations,
    reflections,
    contributedPhotos,
    capabilities,
    unreadChatCount: Number(unreadChatRow?.cnt || 0) + pendingCapabilitiesCount,
    journeyStats: {
      activeEvents: activeCount,
      attendedEvents: attendedCount,
      pillarsTouched: Array.from(pillarsSet),
      reflectionsCount: reflections.length,
      contributedPhotosCount: contributedPhotos.length,
    },
  });
}
