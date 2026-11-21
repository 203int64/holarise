/**
 * ============================================================================
 * HolaRise — Google Sheets & Gmail Auto-Notification Bridge (0đ/tháng)
 * ============================================================================
 * HƯỚNG DẪN CÀI ĐẶT NHANH (2 PHÚT — CHỈ LÀM 1 LẦN):
 * 1. Tạo 1 Google Sheet mới (ví dụ: "HolaRise - Danh sách Đăng ký").
 * 2. Trên thanh menu Google Sheet, chọn: Tiện ích mở rộng (Extensions) -> Apps Script.
 * 3. Xóa mã mặc định, dán toàn bộ file này vào và sửa WEBHOOK_SECRET thành mật khẩu bất kỳ (ví dụ: "holarise-2026-secret").
 * 4. Nhấn Triển khai (Deploy) -> Tùy chọn triển khai mới (New deployment):
 *    - Loại (Type): Ứng dụng web (Web app)
 *    - Thực thi với tư cách (Execute as): Tôi (Me)
 *    - Người có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 *    -> Bấm Triển khai -> Cấp quyền truy cập Google Sheets & Gmail cho chính bạn -> Sao chép URL Web App (dạng https://script.google.com/macros/s/.../exec).
 * 5. Vào https://holarise.pages.dev/admin -> Tab "Đội ngũ & Cài đặt" -> Dán URL Web App + WEBHOOK_SECRET -> Lưu -> Bấm "Gửi thử kiểm tra".
 * ============================================================================
 */

var WEBHOOK_SECRET = "DOI_MA_BI_MAT_TAI_DAY";
var SHEET_NAME = "Danh sách Đăng ký";
var CLUB_HOTLINE = "077.777.7777";
var CLUB_ZALO = "https://zalo.me/0777777777";
var CLUB_SITE = "https://holarise.pages.dev";

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var payload = JSON.parse(raw);

    // Fail closed: bắt buộc đổi WEBHOOK_SECRET trước khi nhận request công khai
    if (!WEBHOOK_SECRET || WEBHOOK_SECRET === "DOI_MA_BI_MAT_TAI_DAY") {
      return jsonOut({ ok: false, error: "Chưa cấu hình WEBHOOK_SECRET trong Google Apps Script." });
    }
    if (String(payload.secret || "") !== WEBHOOK_SECRET) {
      return jsonOut({ ok: false, error: "Sai mã bí mật webhook (secret)." });
    }

    var clubName = payload.clubName || "Cộng đồng Thanh niên Hòa Lạc - HolaRise";
    var notifyEmail = String(payload.notifyEmail || "").trim();

    if (payload.action === "ping") {
      ensureSheet_();
      if (notifyEmail) {
        MailApp.sendEmail({
          to: notifyEmail,
          subject: "[HolaRise CMS] Kiểm tra kết nối Google Sheets & Email thành công",
          body:
            "Xin chào Ban Điều Phối,\n\n" +
            "Kết nối giữa HolaRise CMS (" + CLUB_SITE + ") và Google Sheets / Gmail đã hoạt động bình thường.\n" +
            "Người kiểm tra: " + (payload.tester || "Admin") + "\n" +
            "Thời gian: " + formatVietnamTime_(new Date()) + "\n",
          name: clubName,
        });
      }
      return jsonOut({ ok: true, action: "ping" });
    }

    if (payload.action === "registration" && payload.registration) {
      var r = payload.registration;
      var sheet = ensureSheet_();
      var vnTime = formatVietnamTime_(r.createdAt ? new Date(r.createdAt) : new Date());
      var sourceLabel = r.source === "event_modal" ? "Đăng ký sự kiện" : "Trang Tham gia";

      // 1. Ghi dòng mới vào Google Sheets (chống Formula Injection trên mọi cột)
      sheet.appendRow([
        safeCell_(r.id),
        safeCell_(vnTime),
        safeCell_(sourceLabel),
        safeCell_(r.activityTitle),
        safeCell_(r.fullName),
        "'" + String(r.phone || ""),
        safeCell_(r.email),
        safeCell_(r.role),
        safeCell_(r.organization),
        safeCell_(r.note),
        "Mới",
      ]);

      // 2. Gửi Email thông báo tức thì cho Ban Điều Phối
      if (notifyEmail) {
        var phoneDigits = String(r.phone || "").replace(/\D/g, "");
        var adminBody =
          "Có đơn đăng ký mới vừa gửi từ website " + CLUB_SITE + "\n\n" +
          "• Mã đơn: " + (r.id || "") + "\n" +
          "• Thời gian: " + vnTime + "\n" +
          "• Hoạt động / Sự kiện: " + (r.activityTitle || "") + "\n" +
          "• Họ và tên: " + (r.fullName || "") + "\n" +
          "• SĐT / Zalo: " + (r.phone || "") + (phoneDigits ? " (https://zalo.me/" + phoneDigits + ")" : "") + "\n" +
          "• Email: " + (r.email || "(không nhập)") + "\n" +
          "• Đơn vị / Trường: " + (r.organization || "(không nhập)") + "\n" +
          "• Lời nhắn: " + (r.note || "(không có)") + "\n\n" +
          "Quản lý & cập nhật trạng thái tại: " + CLUB_SITE + "/admin/\n";

        MailApp.sendEmail({
          to: notifyEmail,
          subject: "[Đăng ký mới] " + (r.fullName || "Thành viên") + " — " + (r.activityTitle || "HolaRise"),
          body: adminBody,
          name: clubName,
        });
      }

      // 3. Tự động gửi Email xác nhận lại cho người đăng ký (nếu có nhập Email hợp lệ)
      var userEmail = String(r.email || "").trim();
      if (userEmail && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(userEmail)) {
        var userBody =
          "Chào " + (r.fullName || "bạn") + ",\n\n" +
          "Cảm ơn bạn đã đăng ký đồng hành cùng " + clubName + "!\n\n" +
          "THÔNG TIN ĐĂNG KÝ CỦA BẠN:\n" +
          "• Mã xác nhận: " + (r.id || "") + "\n" +
          "• Hoạt động: " + (r.activityTitle || "Tham gia cộng đồng HolaRise") + "\n" +
          "• Số điện thoại / Zalo: " + (r.phone || "") + "\n" +
          "• Thời gian gửi: " + vnTime + "\n\n" +
          "Ban Điều Phối sẽ liên hệ hướng dẫn điểm tập trung tại Tân Xã, Hòa Lạc và mời bạn vào nhóm Zalo trong vòng 24 giờ.\n" +
          "Nếu cần hỗ trợ gấp, bạn có thể nhắn Zalo " + CLUB_ZALO + " hoặc gọi " + CLUB_HOTLINE + ".\n\n" +
          "Hẹn gặp bạn cuối tuần này!\n" +
          "— Ban Điều Phối " + clubName + "\n" +
          CLUB_SITE;

        MailApp.sendEmail({
          to: userEmail,
          subject: "[HolaRise] Xác nhận đăng ký: " + (r.activityTitle || "Tham gia cùng HolaRise"),
          body: userBody,
          name: clubName,
          replyTo: notifyEmail || undefined,
        });
      }

      return jsonOut({ ok: true, id: r.id || "" });
    }

    return jsonOut({ ok: false, error: "Action không được hỗ trợ." });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Mã đơn",
      "Thời gian (VN)",
      "Nguồn",
      "Sự kiện / Hoạt động",
      "Họ và tên",
      "SĐT / Zalo",
      "Email",
      "Vai trò",
      "Trường / Đơn vị",
      "Lời nhắn",
      "Trạng thái",
    ]);
    sheet.getRange(1, 1, 1, 11).setFontWeight("bold").setBackground("#EDF6F2");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function formatVietnamTime_(dateObj) {
  return Utilities.formatDate(dateObj, "Asia/Ho_Chi_Minh", "HH:mm dd/MM/yyyy");
}

function safeCell_(val) {
  var s = val === null || val === undefined ? "" : String(val);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
