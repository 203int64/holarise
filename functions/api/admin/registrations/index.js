import { jsonResponse, requireAdmin } from "../../../_lib/security.js";
import { cleanStr, truncateUtf8Bytes, VALID_REG_STATUSES } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const status = cleanStr(url.searchParams.get("status"), 20);
  const activity = cleanStr(url.searchParams.get("activity"), 220);
  // Enforce <= 42 UTF-8 bytes after LIKE escaping so %q% stays strictly under D1's 50-byte LIKE limit
  const rawQ = cleanStr(url.searchParams.get("q"), 80);
  const escapedQ = truncateUtf8Bytes(rawQ.replace(/[\\%_]/g, (m) => `\\${m}`), 42).replace(/\\$/, "");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const where = [];
  const binds = [];

  if (status && VALID_REG_STATUSES.has(status)) {
    where.push("status = ?");
    binds.push(status);
  }
  if (activity) {
    where.push("activity_title = ?");
    binds.push(activity);
  }
  if (escapedQ) {
    const pat = `%${escapedQ}%`;
    where.push(
      "(full_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR organization LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"
    );
    binds.push(pat, pat, pat, pat, pat);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [listRes, totalRes, countsRes, activitiesRes] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, source, event_id, activity_title, full_name, phone, email, role, organization, note,
              status, admin_note, sync_status, sync_error, created_at, updated_at
       FROM registrations
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...binds, limit, offset)
      .all(),
    context.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM registrations ${whereSql}`)
      .bind(...binds)
      .first(),
    context.env.DB.prepare("SELECT status, COUNT(*) AS cnt FROM registrations GROUP BY status").all(),
    context.env.DB.prepare(
      "SELECT activity_title, COUNT(*) AS cnt FROM registrations GROUP BY activity_title ORDER BY cnt DESC LIMIT 60"
    ).all(),
  ]);

  const counts = { all: 0, new: 0, contacted: 0, attended: 0, cancelled: 0 };
  for (const row of countsRes.results || []) {
    const c = Number(row.cnt || 0);
    counts.all += c;
    if (row.status in counts) counts[row.status] = c;
  }

  return jsonResponse({
    ok: true,
    items: listRes.results || [],
    total: Number(totalRes?.cnt || 0),
    limit,
    offset,
    counts,
    activities: (activitiesRes.results || []).map((r) => ({
      title: r.activity_title,
      count: Number(r.cnt || 0),
    })),
  });
}
