import { requireAdmin } from "../../../_lib/security.js";
import { buildRegistrationsCsv, cleanStr, VALID_REG_STATUSES } from "../../../_lib/validation.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const status = cleanStr(url.searchParams.get("status"), 20);
  const activity = cleanStr(url.searchParams.get("activity"), 220);

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
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { results } = await context.env.DB.prepare(
    `SELECT id, created_at, source, activity_title, full_name, phone, email, role, organization, note, status, admin_note, sync_status
     FROM registrations
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT 2000`
  )
    .bind(...binds)
    .all();

  const csv = buildRegistrationsCsv(results || []);
  const dateTag = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="holarise-dang-ky-${dateTag}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
