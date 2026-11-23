import { getSettingsMap } from "../../_lib/gas.js";
import { parsePartnersJson } from "../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../_lib/security.js";
import { cleanStr, isSafeExternalHttpsUrl, isSafeMediaUrl } from "../../_lib/validation.js";

const VALID_PARTNER_ROLES = new Set([
  "Đối tác Chương trình",
  "Không gian Đồng hành",
  "Nhà trường & CLB",
  "Đơn vị Hỗ trợ",
]);

function normalizePartnerList(rawItems) {
  if (!Array.isArray(rawItems)) {
    return { ok: false, error: "Danh sách đối tác phải là mảng hợp lệ." };
  }
  if (rawItems.length > 50) {
    return { ok: false, error: "Tối đa 50 đối tác đồng hành." };
  }

  const out = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== "object") continue;

    const name = cleanStr(raw.name, 120);
    if (name.length < 2) {
      return { ok: false, error: `Tên đối tác #${i + 1} cần ít nhất 2 ký tự.` };
    }

    const rawRole = cleanStr(raw.role, 80);
    const role = VALID_PARTNER_ROLES.has(rawRole) ? rawRole : rawRole || "Đơn vị Đồng hành";

    const logoUrl = cleanStr(raw.logoUrl, 500);
    if (logoUrl && !isSafeMediaUrl(logoUrl)) {
      return { ok: false, error: `Logo của "${name}" phải là đường dẫn nội bộ hợp lệ hoặc HTTPS.` };
    }

    const websiteUrl = cleanStr(raw.websiteUrl, 500);
    if (websiteUrl && !isSafeExternalHttpsUrl(websiteUrl)) {
      return { ok: false, error: `Website của "${name}" phải bắt đầu bằng https://.` };
    }

    const id = cleanStr(raw.id, 64) || `partner-${crypto.randomUUID().slice(0, 8)}`;
    const isActive = raw.isActive !== false && raw.isActive !== 0;
    const sortOrder = Number.isFinite(Number(raw.sortOrder)) ? Math.trunc(Number(raw.sortOrder)) : i;

    out.push({ id, name, role, logoUrl, websiteUrl, isActive, sortOrder });
  }

  return { ok: true, items: out };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const map = await getSettingsMap(context.env.DB);
  const items = parsePartnersJson(map.partners_json || "[]");
  return jsonResponse({ ok: true, items });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 64 * 1024);
  if (!parsed.ok) return parsed.response;

  const normalized = normalizePartnerList(parsed.data.items);
  if (!normalized.ok) {
    return errorResponse(400, "VALIDATION_ERROR", normalized.error);
  }

  const now = new Date().toISOString();
  await context.env.DB.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
  )
    .bind("partners_json", JSON.stringify(normalized.items), now)
    .run();

  return jsonResponse({ ok: true, items: normalized.items });
}
