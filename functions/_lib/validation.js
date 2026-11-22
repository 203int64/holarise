/**
 * Boundary validation, Vietnamese slugification, date formatting, and safe CSV export.
 */

export const VALID_FILTERS = new Set(["sach", "biet-on", "tu-te", "se-chia"]);
export const VALID_REG_STATUSES = new Set(["new", "contacted", "attended", "cancelled"]);
export const VALID_POST_STATUSES = new Set(["published", "draft"]);
export const VALID_EVENT_KINDS = new Set(["upcoming", "past"]);

const CATEGORY_TO_SLUG = {
  "HolaGreen · Sạch": "moi-truong",
  "HolaHeart · Biết ơn & Tử tế": "workshop",
  "HolaConnect · Sẻ chia": "cong-dong",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanStr(val, maxLen = 500) {
  if (val === null || val === undefined) return "";
  return String(val).trim().slice(0, maxLen);
}

export function slugifyVi(input) {
  const s = cleanStr(input, 200)
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return s || "bai-viet";
}

export function isValidEmail(email) {
  return typeof email === "string" && email.length <= 160 && EMAIL_RE.test(email.trim());
}

export function isSafeMediaUrl(url) {
  const s = cleanStr(url, 500);
  if (!s) return false;
  if (s.startsWith("/")) {
    return !/^\/[\\/]/.test(s) && !s.includes("..") && !/[\r\n"'<>]/.test(s);
  }
  try {
    const parsed = new URL(s);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Truncate string safely by UTF-8 byte length (for D1's hard 50-byte LIKE pattern cap).
 */
export function truncateUtf8Bytes(input, maxBytes) {
  const enc = new TextEncoder();
  let out = "";
  let used = 0;
  for (const ch of String(input || "")) {
    const b = enc.encode(ch).byteLength;
    if (used + b > maxBytes) break;
    out += ch;
    used += b;
  }
  return out;
}

export function isSafeGasWebhookUrl(url) {
  const s = cleanStr(url, 500);
  if (!s) return true; // empty = disabled
  try {
    const parsed = new URL(s);
    if (parsed.protocol !== "https:") return false;
    return (
      parsed.hostname === "script.google.com" ||
      parsed.hostname === "script.googleusercontent.com"
    );
  } catch {
    return false;
  }
}

export function formatIsoDateVi(isoDate, withWeekday = false) {
  const s = cleanStr(isoDate, 30);
  if (!ISO_DATE_RE.test(s)) return s;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  if (!withWeekday) return `${dd}/${mm}/${y}`;
  const days = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  return `${days[dt.getUTCDay()]}, ${dd}/${mm}/${y}`;
}

export function estimateReadTime(paragraphs) {
  const text = Array.isArray(paragraphs) ? paragraphs.join(" ") : String(paragraphs || "");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 180));
  return `${minutes} phút đọc`;
}

export function normalizeFilters(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,\s]+/)
      : [];
  const out = [];
  for (const item of arr) {
    const token = cleanStr(item, 32).toLowerCase();
    if (VALID_FILTERS.has(token) && !out.includes(token)) {
      out.push(token);
    }
  }
  return out;
}

export function normalizeParagraphs(raw) {
  if (Array.isArray(raw)) {
    return raw.map((p) => cleanStr(p, 4000)).filter(Boolean);
  }
  const text = cleanStr(raw, 40000);
  if (!text) return [];
  return text
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function validatePostInput(body) {
  const fields = {};
  const title = cleanStr(body.title, 200);
  if (title.length < 5) fields.title = "Tiêu đề bài viết cần ít nhất 5 ký tự.";

  const slug = body.slug ? slugifyVi(body.slug) : slugifyVi(title);
  if (!slug || slug.length < 2) fields.slug = "Đường dẫn (slug) không hợp lệ.";

  const category = cleanStr(body.category, 80) || "HolaGreen · Sạch";
  const categorySlug =
    cleanStr(body.categorySlug || body.category_slug, 40) ||
    CATEGORY_TO_SLUG[category] ||
    "cong-dong";

  const filters = normalizeFilters(body.filters);
  const date = cleanStr(body.date, 20) || new Date().toISOString().slice(0, 10);
  if (!ISO_DATE_RE.test(date)) fields.date = "Ngày đăng phải theo định dạng YYYY-MM-DD.";

  const dateDisplay = cleanStr(body.dateDisplay || body.date_display, 30) || formatIsoDateVi(date, false);
  const author = cleanStr(body.author, 100) || "Ban Điều Phối HolaRise";

  const image = cleanStr(body.image, 500) || "/assets/images/activity-environment.jpg";
  if (!isSafeMediaUrl(image)) fields.image = "Đường dẫn ảnh bìa không hợp lệ (chỉ chấp nhận ảnh tải lên hoặc HTTPS).";

  const imageAlt = cleanStr(body.imageAlt || body.image_alt, 240) || title;
  const excerpt = cleanStr(body.excerpt, 360);
  if (excerpt.length < 10) fields.excerpt = "Mô tả ngắn (hiển thị trên Zalo/Facebook) cần ít nhất 10 ký tự.";

  const content = normalizeParagraphs(body.content);
  if (content.length === 0) fields.content = "Nội dung bài viết không được để trống.";

  const readTime = cleanStr(body.readTime || body.read_time, 30) || estimateReadTime(content);
  const status = cleanStr(body.status, 20) || "published";
  if (!VALID_POST_STATUSES.has(status)) fields.status = "Trạng thái bài viết chỉ nhận 'published' hoặc 'draft'.";

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      slug,
      title,
      category,
      category_slug: categorySlug,
      filters,
      date,
      date_display: dateDisplay,
      read_time: readTime,
      author,
      image,
      image_alt: imageAlt,
      excerpt,
      content,
      status,
    },
  };
}

export function validateEventInput(body) {
  const fields = {};
  const kind = cleanStr(body.kind, 20) || "upcoming";
  if (!VALID_EVENT_KINDS.has(kind)) fields.kind = "Loại sự kiện chỉ nhận 'upcoming' hoặc 'past'.";

  const title = cleanStr(body.title, 200);
  if (title.length < 4) fields.title = "Tên sự kiện cần ít nhất 4 ký tự.";

  const type = cleanStr(body.type, 80) || "HolaHeart · Biết ơn & Tử tế";
  const filters = normalizeFilters(body.filters);
  const date = cleanStr(body.date, 30) || new Date().toISOString().slice(0, 10);
  const dateDisplay =
    cleanStr(body.dateDisplay || body.date_display, 40) ||
    (ISO_DATE_RE.test(date) ? formatIsoDateVi(date, true) : date);

  const time = cleanStr(body.time, 60);
  const location = cleanStr(body.location, 140) || "Hòa Lạc, Hà Nội";
  const fee = cleanStr(body.fee, 80) || "Miễn phí";
  const seats = cleanStr(body.seats, 80) || "Mở đăng ký";
  const summary = cleanStr(body.summary, 360);
  if (kind === "upcoming" && summary.length < 8) {
    fields.summary = "Mô tả ngắn cho sự kiện sắp tới cần ít nhất 8 ký tự.";
  }

  const highlights = Array.isArray(body.highlights)
    ? body.highlights.map((h) => cleanStr(h, 80)).filter(Boolean).slice(0, 6)
    : cleanStr(body.highlights, 400)
        .split(/\r?\n|,/)
        .map((h) => h.trim())
        .filter(Boolean)
        .slice(0, 6);

  const participants = cleanStr(body.participants, 60);
  const image = cleanStr(body.image, 500) || "/assets/images/activity-workshop.jpg";
  if (!isSafeMediaUrl(image)) fields.image = "Đường dẫn ảnh sự kiện không hợp lệ.";

  const imageAlt = cleanStr(body.imageAlt || body.image_alt, 240) || title;
  const status = cleanStr(body.status, 20) || "published";
  if (!VALID_POST_STATUSES.has(status)) fields.status = "Trạng thái sự kiện chỉ nhận 'published' hoặc 'draft'.";

  const sortOrder = Number.isFinite(Number(body.sortOrder ?? body.sort_order))
    ? Math.trunc(Number(body.sortOrder ?? body.sort_order))
    : 0;

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      kind,
      type,
      filters,
      date,
      date_display: dateDisplay,
      time,
      location,
      fee,
      seats,
      title,
      summary,
      highlights,
      participants,
      image,
      image_alt: imageAlt,
      status,
      sort_order: sortOrder,
    },
  };
}

export function validateRegistrationInput(body) {
  // Honeypot trap: bots often populate hidden "website" field
  if (cleanStr(body.website || body._hp, 100) !== "") {
    return { ok: true, honeypot: true };
  }

  const fields = {};
  const fullName = cleanStr(body.fullName || body.full_name, 120);
  if (fullName.length < 2) {
    fields.fullName = "Vui lòng nhập họ và tên (tối thiểu 2 ký tự).";
  }

  // Backward compatible: accept phone or legacy contact field
  const rawPhone = cleanStr(body.phone || body.contact, 80);
  const rawEmail = cleanStr(body.email, 160);

  let phone = rawPhone;
  let email = rawEmail;

  // If user pasted an email into legacy contact and left email blank, extract cleanly
  if (!email && isValidEmail(rawPhone)) {
    email = rawPhone;
  }

  const digitCount = phone.replace(/\D/g, "").length;
  if (digitCount < 8 && !isValidEmail(phone)) {
    fields.phone = "Vui lòng nhập số điện thoại / Zalo hợp lệ (ít nhất 8 chữ số).";
  }

  if (email && !isValidEmail(email)) {
    fields.email = "Email không đúng định dạng (ví dụ: tenban@gmail.com).";
  }

  const sourceRaw = cleanStr(body.source, 30);
  const activityTitle = cleanStr(body.activity || body.activityTitle || body.activity_title, 220);
  const source =
    sourceRaw === "event_modal" || (!sourceRaw && activityTitle) ? "event_modal" : "join_page";
  const eventId = cleanStr(body.eventId || body.event_id, 120);
  const role = cleanStr(body.role, 160);
  const organization = cleanStr(body.organization, 160);
  const note = cleanStr(body.note, 1000);

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    honeypot: false,
    value: {
      source,
      event_id: eventId,
      activity_title: activityTitle || role || "Đăng ký tham gia cộng đồng HolaRise",
      full_name: fullName,
      phone,
      email,
      role,
      organization,
      note,
    },
  };
}

/**
 * Neutralize CSV formula injection (=, +, -, @, tab, CR) and quote per RFC 4180.
 */
export function csvEscapeCell(val) {
  let s = val === null || val === undefined ? "" : String(val);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (/[",\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const STATUS_LABEL_VI = {
  new: "Mới",
  contacted: "Đã liên hệ",
  attended: "Đã tham gia",
  cancelled: "Đã hủy",
};

const SYNC_LABEL_VI = {
  synced: "Đã đồng bộ",
  pending: "Đang xử lý",
  failed: "Lỗi đồng bộ",
  skipped: "Chưa cấu hình Sheet",
};

export function buildRegistrationsCsv(rows) {
  const header = [
    "Mã đơn",
    "Thời gian gửi (UTC)",
    "Nguồn",
    "Sự kiện / Hoạt động",
    "Họ và tên",
    "Số điện thoại / Zalo",
    "Email",
    "Vai trò đăng ký",
    "Trường / Đơn vị",
    "Lời nhắn",
    "Trạng thái xử lý",
    "Ghi chú Ban Điều Phối",
    "Đồng bộ Google Sheets",
  ];
  const lines = [header.map(csvEscapeCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.created_at,
        r.source === "event_modal" ? "Đăng ký sự kiện" : "Trang Tham gia",
        r.activity_title,
        r.full_name,
        r.phone,
        r.email,
        r.role,
        r.organization,
        r.note,
        STATUS_LABEL_VI[r.status] || r.status,
        r.admin_note,
        SYNC_LABEL_VI[r.sync_status] || r.sync_status,
      ]
        .map(csvEscapeCell)
        .join(",")
    );
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
