import { safeJsonParse } from "../../_lib/render.js";
import { errorResponse, jsonResponse, readJsonBody, requireAdmin } from "../../_lib/security.js";
import { validateSiteVisualsInput } from "../../_lib/validation.js";

export const DEFAULT_SITE_VISUALS = {
  heroImage: "/assets/images/hero-holarise-binh-minh.webp",
  heroImageAlt: "Những người trẻ HolaRise cùng ngồi bên nhau đón bình minh trên đồi nhìn xuống mặt hồ Hòa Lạc.",
  heroIsIllustration: true,
  aboutImage: "/assets/images/hero-holarise-binh-minh.webp",
  aboutImageAlt: "Bình minh trên đồi và mặt hồ Hòa Lạc — nơi khởi nguồn hành trình của cộng đồng người trẻ HolaRise.",
  aboutIsIllustration: true,
  pillars: {
    holaheart: {
      image: "/assets/images/events/holaheart-2026-11-15/07-speaker-sharing.jpg",
      imageAlt: "Không gian đối thoại và lắng nghe tại sự kiện HolaHeart ở Hòa Lạc.",
      isIllustration: false,
    },
    holagreen: {
      image: "/assets/images/illustrations/holagreen/G03.jpg",
      imageAlt: "Nhóm tình nguyện viên HolaGreen gìn giữ cảnh quan ven hồ Hòa Lạc.",
      isIllustration: true,
    },
    holaconnect: {
      image: "/assets/images/illustrations/holaconnect/C04.jpg",
      imageAlt: "Thành viên HolaConnect trao tặng tủ sách thiếu nhi cho các em nhỏ.",
      isIllustration: true,
    },
  },
};

export function mergeSiteVisuals(rawValue) {
  const parsed = safeJsonParse(rawValue, {});
  const src = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const srcPillars = src.pillars && typeof src.pillars === "object" ? src.pillars : {};

  const out = {
    heroImage: src.heroImage || DEFAULT_SITE_VISUALS.heroImage,
    heroImageAlt: src.heroImageAlt || DEFAULT_SITE_VISUALS.heroImageAlt,
    heroIsIllustration:
      src.heroIsIllustration !== undefined ? Boolean(src.heroIsIllustration) : DEFAULT_SITE_VISUALS.heroIsIllustration,
    aboutImage: src.aboutImage || DEFAULT_SITE_VISUALS.aboutImage,
    aboutImageAlt: src.aboutImageAlt || DEFAULT_SITE_VISUALS.aboutImageAlt,
    aboutIsIllustration:
      src.aboutIsIllustration !== undefined
        ? Boolean(src.aboutIsIllustration)
        : DEFAULT_SITE_VISUALS.aboutIsIllustration,
    pillars: {},
  };

  for (const key of ["holaheart", "holagreen", "holaconnect"]) {
    const defP = DEFAULT_SITE_VISUALS.pillars[key];
    const p = srcPillars[key] && typeof srcPillars[key] === "object" ? srcPillars[key] : {};
    out.pillars[key] = {
      image: p.image || defP.image,
      imageAlt: p.imageAlt || defP.imageAlt,
      isIllustration: p.isIllustration !== undefined ? Boolean(p.isIllustration) : defP.isIllustration,
    };
  }
  return out;
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const row = await context.env.DB.prepare("SELECT value FROM settings WHERE key = 'site_visuals_json'")
    .first()
    .catch(() => null);

  return jsonResponse({
    ok: true,
    visuals: mergeSiteVisuals(row?.value || "{}"),
  });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const row = await context.env.DB.prepare("SELECT value FROM settings WHERE key = 'site_visuals_json'")
    .first()
    .catch(() => null);
  const current = mergeSiteVisuals(row?.value || "{}");

  const validated = validateSiteVisualsInput(parsed.data, current);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin hình ảnh giao diện chưa hợp lệ.", validated.fields);
  }

  const now = new Date().toISOString();
  await context.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
    .bind("site_visuals_json", JSON.stringify(validated.value), now)
    .run();

  return jsonResponse({
    ok: true,
    visuals: mergeSiteVisuals(JSON.stringify(validated.value)),
    message: "Đã cập nhật hình ảnh giao diện thành công!",
  });
}
