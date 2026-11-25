/**
 * Boundary validation, Vietnamese slugification, date formatting, and safe CSV export.
 */

export const VALID_FILTERS = new Set([
  "holaheart",
  "holagreen",
  "holaconnect",
  "sach",
  "biet-on",
  "tu-te",
  "se-chia",
]);
export const VALID_PILLAR_CHOICES = new Set(["holaheart", "holagreen", "holaconnect"]);
export const VALID_PARTICIPANT_ROLES = new Set(["member", "volunteer", "speaker"]);
export const VALID_REFLECTION_STATUSES = new Set(["pending", "approved", "rejected"]);
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

export function isSafeExternalHttpsUrl(url) {
  const s = cleanStr(url, 600);
  if (!s) return true; // empty = optional
  try {
    const parsed = new URL(s);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !/[\r\n"'<>]/.test(s);
  } catch {
    return false;
  }
}

export function extractMediaKeyFromUrl(url) {
  const s = cleanStr(url, 500);
  const m = s.match(/^\/api\/media\/([a-zA-Z0-9._-]{6,96})$/);
  return m ? m[1] : "";
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
  const fee = cleanStr(body.fee, 120) || "Miễn phí tham dự · Tự túc đồ uống";
  const seats = cleanStr(body.seats, 80);
  const rawCap = Number(body.seatCapacity ?? body.seat_capacity ?? 0);
  const seatCapacity = Number.isFinite(rawCap) ? Math.min(5000, Math.max(0, Math.trunc(rawCap))) : 0;
  const rawExt = Number(body.externalBooked ?? body.external_booked ?? 0);
  const externalBooked = Number.isFinite(rawExt) ? Math.min(5000, Math.max(0, Math.trunc(rawExt))) : 0;
  const showSeatBar = Boolean(body.showSeatBar ?? body.show_seat_bar) ? 1 : 0;
  const summary = cleanStr(body.summary, 360);
  if (kind === "upcoming" && summary.length < 8) {
    fields.summary = "Mô tả ngắn cho sự kiện sắp tới cần ít nhất 8 ký tự.";
  }

  const titleEn = cleanStr(body.titleEn ?? body.title_en, 200);
  const summaryEn = cleanStr(body.summaryEn ?? body.summary_en, 360);

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
      seat_capacity: seatCapacity,
      external_booked: externalBooked,
      show_seat_bar: showSeatBar,
      title,
      title_en: titleEn,
      summary,
      summary_en: summaryEn,
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

  const sourceRaw = cleanStr(body.source, 30);
  const isFeedback = sourceRaw === "feedback";
  const fields = {};

  let fullName = cleanStr(body.fullName || body.full_name, 120);
  if (isFeedback) {
    if (!fullName) fullName = "Thành viên đóng góp";
  } else if (fullName.length < 2) {
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
  if (isFeedback) {
    if (!phone) phone = email || "Ẩn danh";
  } else if (digitCount < 8 && !isValidEmail(phone)) {
    fields.phone = "Vui lòng nhập số điện thoại / Zalo hợp lệ (ít nhất 8 chữ số).";
  }

  if (email && !isValidEmail(email)) {
    fields.email = "Email không đúng định dạng (ví dụ: tenban@gmail.com).";
  }

  const activityTitle = cleanStr(body.activity || body.activityTitle || body.activity_title, 220);
  const source =
    sourceRaw === "event_modal" || (!sourceRaw && activityTitle) ? "event_modal" : "join_page";
  const eventId = cleanStr(body.eventId || body.event_id, 120);
  const role = cleanStr(body.role, 160);
  const organization = cleanStr(body.organization, 160);
  const note = cleanStr(body.note, 1000);
  if (isFeedback && note.length < 8) {
    fields.note = "Vui lòng chia sẻ nội dung đóng góp ít nhất 8 ký tự để Ban Điều Phối nắm rõ ý của bạn.";
  }

  let diagnostics = "";
  let screenshotDataUrl = "";
  if (isFeedback) {
    diagnostics = cleanStr(body.diagnostics, 900);
    const rawShot = typeof body.screenshotDataUrl === "string" ? body.screenshotDataUrl.trim() : "";
    if (rawShot) {
      if (rawShot.length > 720000) {
        fields.screenshotDataUrl = "Ảnh màn hình đính kèm vượt quá giới hạn dung lượng cho phép.";
      } else if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(rawShot)) {
        fields.screenshotDataUrl = "Định dạng ảnh đính kèm không hợp lệ (chỉ hỗ trợ JPEG, PNG, WebP).";
      } else {
        screenshotDataUrl = rawShot;
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    honeypot: false,
    value: {
      source,
      is_feedback: isFeedback,
      event_id: eventId,
      activity_title: activityTitle || role || "Đăng ký tham gia cộng đồng HolaRise",
      full_name: fullName,
      phone,
      email,
      role,
      organization,
      note,
      diagnostics,
      screenshot_data_url: screenshotDataUrl,
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

export function validateAlbumInput(body) {
  const fields = {};
  const title = cleanStr(body.title, 180);
  if (title.length < 3) fields.title = "Tên album cần ít nhất 3 ký tự.";

  const slug = body.slug ? slugifyVi(body.slug) : slugifyVi(title);
  if (!slug || slug.length < 2) fields.slug = "Đường dẫn (slug) album không hợp lệ.";

  const description = cleanStr(body.description, 500);
  const eventDate = cleanStr(body.eventDate ?? body.event_date, 20) || new Date().toISOString().slice(0, 10);
  if (eventDate && !ISO_DATE_RE.test(eventDate)) {
    fields.eventDate = "Ngày sự kiện phải theo định dạng YYYY-MM-DD.";
  }
  const dateDisplay =
    cleanStr(body.dateDisplay ?? body.date_display, 40) ||
    (ISO_DATE_RE.test(eventDate) ? formatIsoDateVi(eventDate, false) : eventDate);
  const location = cleanStr(body.location, 140) || "Hòa Lạc, Hà Nội";
  const filters = normalizeFilters(body.filters);

  const driveUrl = cleanStr(body.driveUrl ?? body.drive_url, 600);
  if (driveUrl && !isSafeExternalHttpsUrl(driveUrl)) {
    fields.driveUrl = "Liên kết ảnh gốc (Google Drive/Photos) phải bắt đầu bằng https://.";
  }

  const coverUrl = cleanStr(body.coverUrl ?? body.cover_url, 500);
  if (coverUrl && !isSafeMediaUrl(coverUrl)) {
    fields.coverUrl = "Đường dẫn ảnh bìa album không hợp lệ.";
  }

  const status = cleanStr(body.status, 20) || "published";
  if (!VALID_POST_STATUSES.has(status)) {
    fields.status = "Trạng thái album chỉ nhận 'published' hoặc 'draft'.";
  }

  const sortOrder = Number.isFinite(Number(body.sortOrder ?? body.sort_order))
    ? Math.trunc(Number(body.sortOrder ?? body.sort_order))
    : 0;

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      slug,
      title,
      description,
      event_date: eventDate,
      date_display: dateDisplay,
      location,
      filters,
      drive_url: driveUrl,
      cover_url: coverUrl,
      status,
      sort_order: sortOrder,
    },
  };
}

export function validatePhotoInput(body) {
  const fields = {};
  const url = cleanStr(body.url, 500);
  if (!url || !isSafeMediaUrl(url)) {
    fields.url = "Đường dẫn ảnh không hợp lệ.";
  }
  const rawKey = cleanStr(body.mediaKey ?? body.media_key, 100);
  const mediaKey = rawKey && /^[a-zA-Z0-9._-]{6,96}$/.test(rawKey)
    ? rawKey
    : extractMediaKeyFromUrl(url);
  const caption = cleanStr(body.caption, 300);
  const alt = cleanStr(body.alt, 240) || caption || "Khoảnh khắc hoạt động cộng đồng HolaRise";
  const photographer = cleanStr(body.photographer, 100);
  const isFeaturedHome = body.isFeaturedHome ?? body.is_featured_home ? 1 : 0;
  const sortOrder = Number.isFinite(Number(body.sortOrder ?? body.sort_order))
    ? Math.trunc(Number(body.sortOrder ?? body.sort_order))
    : 0;

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      url,
      media_key: mediaKey,
      caption,
      alt,
      photographer,
      is_featured_home: isFeaturedHome,
      sort_order: sortOrder,
    },
  };
}

export function normalizePhone(raw) {
  const s = cleanStr(raw, 40);
  if (!s) return { ok: false, phoneNorm: "", phoneDisplay: "" };
  const hasPlus = s.trim().startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, phoneNorm: "", phoneDisplay: "" };
  }
  // Canonicalize Vietnamese mobile numbers (+849... / 849... -> 09...)
  if ((hasPlus || digits.length === 11) && digits.startsWith("84") && digits.length >= 10 && digits.length <= 11) {
    digits = "0" + digits.slice(2);
  }
  const display =
    digits.length === 10 && digits.startsWith("0")
      ? `${digits.slice(0, 4)}.${digits.slice(4, 7)}.${digits.slice(7)}`
      : hasPlus && !digits.startsWith("0")
        ? `+${digits}`
        : digits;
  return { ok: true, phoneNorm: digits, phoneDisplay: display };
}

export function parseMemberIdentifier(raw) {
  const trimmed = cleanStr(raw, 160);
  if (!trimmed) {
    return {
      ok: false,
      error: "Vui lòng nhập Email hoặc Số điện thoại của bạn.",
    };
  }
  if (trimmed.includes("@")) {
    const lower = trimmed.toLowerCase();
    if (!isValidEmail(lower)) {
      return {
        ok: false,
        error: "Email chưa đúng định dạng (ví dụ: tenban@gmail.com).",
      };
    }
    return {
      ok: true,
      kind: "email",
      email: lower,
      phoneNorm: null,
      phoneDisplay: "",
    };
  }
  const phone = normalizePhone(trimmed);
  if (!phone.ok) {
    return {
      ok: false,
      error: "Vui lòng nhập Email hợp lệ hoặc Số điện thoại (tối thiểu 8 chữ số).",
    };
  }
  return {
    ok: true,
    kind: "phone",
    email: null,
    phoneNorm: phone.phoneNorm,
    phoneDisplay: phone.phoneDisplay,
  };
}

export function validateMemberRegisterInput(body) {
  if (cleanStr(body.website || body._hp, 100) !== "") {
    return { ok: true, honeypot: true };
  }
  const fields = {};
  const name = cleanStr(body.name || body.fullName || body.full_name, 100);
  if (name.length < 2) {
    fields.name = "Vui lòng nhập họ và tên của bạn (tối thiểu 2 ký tự).";
  }

  const rawId = body.identifier ?? body.emailOrPhone ?? body.email ?? body.phone ?? "";
  const parsedId = parseMemberIdentifier(rawId);
  if (!parsedId.ok) {
    fields.identifier = parsedId.error;
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6 || password.length > 128) {
    fields.password = "Mật khẩu cần từ 6 đến 128 ký tự.";
  }

  const organization = cleanStr(body.organization, 160);
  const rawPillar = cleanStr(body.pillarChoice ?? body.pillar_choice, 32).toLowerCase() || "holaheart";
  const pillarChoice = VALID_PILLAR_CHOICES.has(rawPillar) ? rawPillar : "holaheart";

  let autoRegisterEvent = null;
  if (body.autoRegisterEvent && typeof body.autoRegisterEvent === "object") {
    const evId = cleanStr(body.autoRegisterEvent.eventId || body.autoRegisterEvent.event_id, 120);
    const actTitle = cleanStr(
      body.autoRegisterEvent.activityTitle || body.autoRegisterEvent.activity,
      220
    );
    const note = cleanStr(body.autoRegisterEvent.note, 800);
    const role = cleanStr(body.autoRegisterEvent.role, 160);
    if (evId || actTitle) {
      autoRegisterEvent = {
        event_id: evId,
        activity_title: actTitle || "Đăng ký tham dự sự kiện Hola",
        role,
        note,
      };
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    honeypot: false,
    value: {
      name,
      identifier: parsedId,
      password,
      organization,
      pillar_choice: pillarChoice,
      auto_register_event: autoRegisterEvent,
    },
  };
}

export function validateMemberProfileInput(body) {
  const fields = {};
  const out = {};

  if (body.name !== undefined) {
    const name = cleanStr(body.name, 100);
    if (name.length < 2) fields.name = "Họ và tên cần tối thiểu 2 ký tự.";
    else out.name = name;
  }

  if (body.organization !== undefined) {
    out.organization = cleanStr(body.organization, 160);
  }

  if (body.phone !== undefined || body.phoneDisplay !== undefined || body.phone_display !== undefined) {
    const rawPhone = cleanStr(body.phone ?? body.phoneDisplay ?? body.phone_display, 40);
    if (!rawPhone) {
      out.phone_norm = null;
      out.phone_display = "";
    } else {
      const parsedPhone = normalizePhone(rawPhone);
      if (!parsedPhone.ok) {
        fields.phone = "Vui lòng nhập số điện thoại / Zalo hợp lệ (8–15 chữ số).";
      } else {
        out.phone_norm = parsedPhone.phoneNorm;
        out.phone_display = parsedPhone.phoneDisplay;
      }
    }
  }

  if (body.pillarChoice !== undefined || body.pillar_choice !== undefined) {
    const p = cleanStr(body.pillarChoice ?? body.pillar_choice, 32).toLowerCase();
    if (!VALID_PILLAR_CHOICES.has(p)) {
      fields.pillarChoice = "Trụ cột quan tâm không hợp lệ.";
    } else {
      out.pillar_choice = p;
    }
  }

  if (body.avatarUrl !== undefined || body.avatar_url !== undefined) {
    const av = cleanStr(body.avatarUrl ?? body.avatar_url, 500);
    if (av && !isSafeMediaUrl(av)) {
      fields.avatarUrl = "Đường dẫn ảnh đại diện không hợp lệ.";
    } else {
      out.avatar_url = av;
      out.avatar_media_key = av ? extractMediaKeyFromUrl(av) : "";
    }
  }

  if (body.newPassword !== undefined && String(body.newPassword).length > 0) {
    const cur = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = String(body.newPassword);
    if (!cur) {
      fields.currentPassword = "Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu mới.";
    }
    if (next.length < 6 || next.length > 128) {
      fields.newPassword = "Mật khẩu mới cần từ 6 đến 128 ký tự.";
    }
    out.current_password = cur;
    out.new_password = next;
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }
  return { ok: true, value: out };
}

export function validateReflectionInput(body, { requireSlug = true } = {}) {
  const fields = {};
  const rawSlug = cleanStr(body.activitySlug ?? body.activity_slug, 140);
  const activitySlug = rawSlug ? slugifyVi(rawSlug) : "";
  if (requireSlug && (!activitySlug || activitySlug.length < 2)) {
    fields.activitySlug = "Không xác định được hoạt động cần lưu bút.";
  }

  const rawRole = cleanStr(body.participantRole ?? body.participant_role, 32).toLowerCase() || "member";
  const participantRole = VALID_PARTICIPANT_ROLES.has(rawRole) ? rawRole : "member";

  const pullQuote = cleanStr(body.pullQuote ?? body.pull_quote, 140);
  const content = cleanStr(body.content, 1500);
  if (content.length < 12) {
    fields.content = "Lời cảm nhận cần ít nhất 12 ký tự để chia sẻ trọn vẹn ý nghĩa.";
  }

  const photoUrl = cleanStr(body.photoUrl ?? body.photo_url, 500);
  if (photoUrl && !isSafeMediaUrl(photoUrl)) {
    fields.photoUrl = "Đường dẫn ảnh kỷ niệm không hợp lệ.";
  }
  const photoMediaKey = photoUrl ? extractMediaKeyFromUrl(photoUrl) : "";

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      activity_slug: activitySlug,
      participant_role: participantRole,
      pull_quote: pullQuote,
      content,
      photo_url: photoUrl,
      photo_media_key: photoMediaKey,
    },
  };
}

export function validateSiteVisualsInput(body, current = {}) {
  const fields = {};
  const checkImg = (raw, fieldKey) => {
    const val = cleanStr(raw, 500);
    if (val && !isSafeMediaUrl(val)) {
      fields[fieldKey] = "Đường dẫn hình ảnh không hợp lệ.";
    }
    return val;
  };

  const heroImage =
    body.heroImage !== undefined ? checkImg(body.heroImage, "heroImage") : cleanStr(current.heroImage, 500);
  const heroImageAlt =
    body.heroImageAlt !== undefined ? cleanStr(body.heroImageAlt, 240) : cleanStr(current.heroImageAlt, 240);
  const heroIsIllustration =
    body.heroIsIllustration !== undefined ? Boolean(body.heroIsIllustration) : Boolean(current.heroIsIllustration);

  const aboutImage =
    body.aboutImage !== undefined ? checkImg(body.aboutImage, "aboutImage") : cleanStr(current.aboutImage, 500);
  const aboutImageAlt =
    body.aboutImageAlt !== undefined ? cleanStr(body.aboutImageAlt, 240) : cleanStr(current.aboutImageAlt, 240);
  const aboutIsIllustration =
    body.aboutIsIllustration !== undefined ? Boolean(body.aboutIsIllustration) : Boolean(current.aboutIsIllustration);

  const curPillars = current.pillars && typeof current.pillars === "object" ? current.pillars : {};
  const inPillars = body.pillars && typeof body.pillars === "object" ? body.pillars : {};
  const pillars = {};

  for (const key of ["holaheart", "holagreen", "holaconnect"]) {
    const c = curPillars[key] && typeof curPillars[key] === "object" ? curPillars[key] : {};
    const p = inPillars[key] && typeof inPillars[key] === "object" ? inPillars[key] : {};
    pillars[key] = {
      image: p.image !== undefined ? checkImg(p.image, `pillars.${key}.image`) : cleanStr(c.image, 500),
      imageAlt: p.imageAlt !== undefined ? cleanStr(p.imageAlt, 240) : cleanStr(c.imageAlt, 240),
      isIllustration:
        p.isIllustration !== undefined ? Boolean(p.isIllustration) : Boolean(c.isIllustration),
    };
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      heroImage,
      heroImageAlt,
      heroIsIllustration,
      aboutImage,
      aboutImageAlt,
      aboutIsIllustration,
      pillars,
    },
  };
}
