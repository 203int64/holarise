/**
 * HolaRise Member Desk Workspace (/tham-gia/ & /en/join/)
 * - Shows scoped capabilities (pending accept with safeguarding consent + active roles with expiry)
 * - Privacy-masked on-site Event Check-in panel for active `event.checkin` members
 * - Two-way Chat Desk (BTC direct thread + Guest Event Support threads for `event.companion`)
 */
(function () {
  "use strict";

  var isEn = document.documentElement.lang === "en" || document.documentElement.getAttribute("data-lang") === "en";
  function t(vi, en) {
    return isEn ? en : vi;
  }

  var deskPane = document.querySelector('[data-dash-pane="desk"]');
  if (!deskPane) return;

  var badgeEl = document.getElementById("dash-desk-badge");
  var capListEl = document.getElementById("member-capabilities-list");
  var refreshBtn = document.getElementById("btn-refresh-member-desk");
  var threadsEl = document.getElementById("member-desk-threads");
  var convTitleEl = document.getElementById("member-desk-conv-title");
  var convMetaEl = document.getElementById("member-desk-conv-meta");
  var msgsEl = document.getElementById("member-desk-messages");
  var formEl = document.getElementById("member-desk-form");
  var inputEl = document.getElementById("member-desk-input");
  var sendBtn = document.getElementById("member-desk-send-btn");
  var statusEl = document.getElementById("member-desk-status");

  var checkinSection = document.getElementById("member-checkin-section");
  var checkinTitleEl = document.getElementById("member-checkin-title");
  var checkinStatsEl = document.getElementById("member-checkin-stats");
  var checkinSearchEl = document.getElementById("member-checkin-search");
  var checkinListEl = document.getElementById("member-checkin-list");
  var closeCheckinBtn = document.getElementById("btn-close-member-checkin");
  var tasksSection = document.getElementById("member-tasks-section");
  var tasksListEl = document.getElementById("member-tasks-list");
  var serviceSummaryEl = document.getElementById("member-service-summary");
  var qrScanBtn = document.getElementById("btn-checkin-qr-scan");
  var qrStopBtn = document.getElementById("btn-checkin-qr-stop");
  var qrInputEl = document.getElementById("member-checkin-qr-input");
  var qrSubmitBtn = document.getElementById("btn-checkin-qr-submit");
  var qrVideoWrap = document.getElementById("member-checkin-qr-video-wrap");
  var qrVideoEl = document.getElementById("member-checkin-qr-video");
  var qrStatusEl = document.getElementById("member-checkin-qr-status");
  var qrStream = null;
  var qrScanRaf = 0;

  var state = {
    threads: [],
    companionThreads: [],
    capabilities: [],
    assignedTasks: [],
    activeThreadId: "",
    activeMessages: [],
    lastCreatedAt: "",
    pollTimer: null,
    checkinEventId: "",
    checkinAttendees: [],
  };

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    var dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleString(isEn ? "en-GB" : "vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function updateBadge() {
    if (!badgeEl) return;
    var unread = 0;
    state.threads.forEach(function (th) {
      unread += Number(th.unreadMember || 0);
    });
    state.companionThreads.forEach(function (th) {
      unread += Number(th.unreadAdmin || 0);
    });
    state.capabilities.forEach(function (c) {
      if (c.status === "pending_accept") unread += 1;
    });
    state.assignedTasks.forEach(function (tk) {
      if (tk.status !== "done") unread += 1;
    });
    badgeEl.hidden = unread <= 0;
    badgeEl.textContent = String(unread);
  }

  function renderAssignedTasks() {
    if (!tasksSection || !tasksListEl) return;
    if (!state.assignedTasks.length) {
      tasksSection.hidden = true;
      tasksListEl.innerHTML = "";
      return;
    }
    tasksSection.hidden = false;
    var statusMap = {
      todo: t("Cần làm", "To do"),
      in_progress: t("Đang làm", "In progress"),
      review: t("Chờ duyệt", "In review"),
      done: t("Hoàn thành", "Done"),
    };
    var nextMap = { todo: "in_progress", in_progress: "review", review: "done", done: "todo" };
    tasksListEl.innerHTML = state.assignedTasks
      .map(function (tk) {
        var nextSt = nextMap[tk.status] || "done";
        return (
          '<article class="member-cap-card' +
          (tk.status === "done" ? "" : " is-pending") +
          '">' +
          '<div class="member-cap-top"><span class="cap-status-pill">' +
          esc(statusMap[tk.status] || tk.status) +
          "</span>" +
          (tk.eventTitle ? '<span class="cap-scope-pill">' + esc(tk.eventTitle) + "</span>" : "") +
          "</div>" +
          "<h3>" +
          esc(tk.title) +
          "</h3>" +
          (tk.description ? "<p>" + esc(tk.description) + "</p>" : "") +
          '<div class="member-cap-actions">' +
          '<button type="button" class="btn btn--primary btn--sm" data-member-task-id="' +
          esc(tk.id) +
          '" data-member-task-next="' +
          esc(nextSt) +
          '">' +
          esc(t("Chuyển: ", "Move to: ")) +
          esc(statusMap[nextSt] || nextSt) +
          "</button>" +
          (tk.zaloUrl
            ? '<a class="btn btn--outline btn--sm" href="' +
              esc(tk.zaloUrl) +
              '" target="_blank" rel="noopener">' +
              esc(t("Nhóm Zalo ↗", "Zalo Group ↗")) +
              "</a>"
            : "") +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function loadAssignedTasks() {
    fetch("/api/member/tasks", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok) {
          state.assignedTasks = data.items || [];
          var rec = data.serviceRecord || {};
          if (serviceSummaryEl) {
            var evCnt = Number(rec.eventsServed || 0);
            var doneCnt = Number(rec.completedTasks || 0);
            serviceSummaryEl.textContent =
              evCnt > 0 || doneCnt > 0
                ? t(
                    "Hồ sơ phụng sự: " + evCnt + " buổi đã đồng hành · " + doneCnt + " nhiệm vụ hoàn thành.",
                    "Service record: " + evCnt + " gatherings served · " + doneCnt + " tasks completed."
                  )
                : "";
          }
          renderAssignedTasks();
          updateBadge();
        }
      })
      .catch(function () {});
  }

  function stopQrScanner() {
    if (qrScanRaf) {
      cancelAnimationFrame(qrScanRaf);
      qrScanRaf = 0;
    }
    if (qrStream) {
      qrStream.getTracks().forEach(function (tr) {
        tr.stop();
      });
      qrStream = null;
    }
    if (qrVideoWrap) qrVideoWrap.hidden = true;
  }

  function submitQrCheckin(rawCode) {
    var code = String(rawCode || "").trim();
    if (!code || !state.checkinEventId) return;
    if (qrStatusEl) {
      qrStatusEl.hidden = false;
      qrStatusEl.style.background = "#f3f4f6";
      qrStatusEl.style.color = "#374151";
      qrStatusEl.textContent = t("Đang xác thực mã thẻ...", "Checking member card...");
    }
    fetch("/api/member/checkin", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: state.checkinEventId, qrCode: code, allowWalkIn: true }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          if (qrStatusEl) {
            qrStatusEl.style.background = "#fef3f2";
            qrStatusEl.style.color = "#b42318";
            qrStatusEl.textContent = (data && data.error && data.error.message) || t("Không thể check-in mã này.", "QR check-in failed.");
          }
          return;
        }
        if (qrInputEl) qrInputEl.value = "";
        if (qrStatusEl) {
          qrStatusEl.style.background = "#ecfdf3";
          qrStatusEl.style.color = "#027a48";
          var welcomeTag = data.isFirstTime
            ? t(" · ✨ Lần đầu tham dự — ưu tiên đón tiếp!", " · ✨ First-time guest — warm welcome!")
            : "";
          qrStatusEl.textContent =
            t("✓ Đã check-in: ", "✓ Checked in: ") +
            (data.fullName || data.memberCode || "Thành viên") +
            (data.walkInCreated ? t(" (bổ sung tại cửa)", " (door walk-in)") : "") +
            welcomeTag;
        }
        openCheckinPanel(state.checkinEventId);
      })
      .catch(function () {});
  }

  if (qrSubmitBtn && qrInputEl) {
    qrSubmitBtn.addEventListener("click", function () {
      submitQrCheckin(qrInputEl.value);
    });
    qrInputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitQrCheckin(qrInputEl.value);
      }
    });
  }
  if (qrStopBtn) {
    qrStopBtn.addEventListener("click", stopQrScanner);
  }
  if (qrScanBtn) {
    qrScanBtn.addEventListener("click", function () {
      if (!("BarcodeDetector" in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (qrStatusEl) {
          qrStatusEl.hidden = false;
          qrStatusEl.style.background = "#fffbeb";
          qrStatusEl.style.color = "#92400e";
          qrStatusEl.textContent = t(
            "Trình duyệt này chưa hỗ trợ quét QR trực tiếp — bạn hãy quét bằng camera máy rồi dán mã HR-YYMMDD-STT vào ô bên cạnh.",
            "Direct QR camera is unavailable in this browser — paste the HR-YYMMDD-STT code in the box."
          );
        }
        if (qrInputEl) qrInputEl.focus();
        return;
      }
      var detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then(function (stream) {
          qrStream = stream;
          if (qrVideoEl) {
            qrVideoEl.srcObject = stream;
            qrVideoEl.play();
          }
          if (qrVideoWrap) qrVideoWrap.hidden = false;
          var tick = function () {
            if (!qrStream || !qrVideoEl) return;
            detector
              .detect(qrVideoEl)
              .then(function (codes) {
                if (codes && codes.length && codes[0].rawValue) {
                  stopQrScanner();
                  submitQrCheckin(codes[0].rawValue);
                  return;
                }
                qrScanRaf = requestAnimationFrame(tick);
              })
              .catch(function () {
                qrScanRaf = requestAnimationFrame(tick);
              });
          };
          qrScanRaf = requestAnimationFrame(tick);
        })
        .catch(function () {
          if (qrStatusEl) {
            qrStatusEl.hidden = false;
            qrStatusEl.style.background = "#fef3f2";
            qrStatusEl.style.color = "#b42318";
            qrStatusEl.textContent = t("Không mở được camera. Hãy nhập mã thẻ thủ công.", "Camera access denied.");
          }
        });
    });
  }

  function renderCapabilities() {
    if (!capListEl) return;
    if (!state.capabilities.length) {
      capListEl.innerHTML =
        '<p class="member-empty-hint">' +
        esc(
          t(
            "Khi Ban Điều phối trao quyền Người đồng hành đón khách, Check-in buổi gặp hoặc mở khóa Album gốc, thẻ quyền sẽ hiện tại đây.",
            "When coordinators grant you Event Companion, On-site Check-in, or Private Album access, it appears here."
          )
        ) +
        "</p>";
      return;
    }

    capListEl.innerHTML = state.capabilities
      .map(function (c) {
        var label = isEn ? c.labelEn || c.labelVi : c.labelVi || c.capability;
        var summary = isEn ? c.summaryEn || c.summaryVi : c.summaryVi || "";
        var consent = isEn ? c.consentEn || c.consentVi : c.consentVi || "";
        var scopeBadge = c.scopeTitle ? '<span class="cap-scope-pill">' + esc(c.scopeTitle) + "</span>" : "";
        var expiryHtml = c.expiresAt
          ? '<span class="cap-expiry">' + esc(t("Hiệu lực đến: ", "Expires: ")) + esc(formatDateTime(c.expiresAt)) + "</span>"
          : "";

        if (c.status === "pending_accept") {
          return (
            '<article class="member-cap-card is-pending" data-cap-id="' +
            esc(c.id) +
            '">' +
            '<div class="member-cap-top"><span class="cap-status-pill is-pending">' +
            esc(t("Chờ bạn xác nhận", "Awaiting confirmation")) +
            "</span>" +
            scopeBadge +
            "</div>" +
            "<h3>" +
            esc(label) +
            "</h3>" +
            "<p>" +
            esc(c.note || summary) +
            "</p>" +
            (consent
              ? '<label class="cap-consent-row"><input type="checkbox" data-cap-consent="' +
                esc(c.id) +
                '"> <span>' +
                esc(consent) +
                "</span></label>"
              : "") +
            (c.capability === "event.companion"
              ? '<input type="text" class="cap-greeting-input" data-cap-greeting="' +
                esc(c.id) +
                '" maxlength="200" placeholder="' +
                esc(t("Lời chào ngắn gửi khách đi một mình (tùy chọn)...", "Short welcoming note for solo guests (optional)...")) +
                '" value="' +
                esc(c.greeting || "") +
                '">'
              : "") +
            '<div class="member-cap-actions">' +
            '<button type="button" class="btn btn--primary btn--sm" data-cap-accept="' +
            esc(c.id) +
            '">' +
            esc(t("Chấp nhận đồng hành", "Accept role")) +
            "</button>" +
            '<button type="button" class="btn btn--outline btn--sm" data-cap-decline="' +
            esc(c.id) +
            '">' +
            esc(t("Hẹn dịp khác", "Decline")) +
            "</button>" +
            "</div>" +
            "</article>"
          );
        }

        var actionBtn = "";
        if (c.capability === "event.checkin" && c.scopeId) {
          actionBtn =
            '<button type="button" class="btn btn--primary btn--sm" data-open-checkin="' +
            esc(c.scopeId) +
            '">' +
            esc(t("Mở Check-in buổi này", "Open Check-in")) +
            "</button>";
        } else if (c.capability === "event.companion" && c.scopeSlug) {
          actionBtn =
            '<a class="btn btn--outline btn--sm" href="/su-kien/' +
            esc(c.scopeSlug) +
            '/" target="_blank" rel="noopener">' +
            esc(t("Xem trang thư mời ↗", "View invitation ↗")) +
            "</a>";
        } else if (c.capability === "album.view_private") {
          actionBtn =
            '<a class="btn btn--primary btn--sm" href="/media/?album=' +
            esc(encodeURIComponent(c.scopeSlug || c.scopeId)) +
            '">' +
            esc(t("Mở Album gốc →", "Open Album →")) +
            "</a>";
        } else if (c.capability === "media.portal") {
          actionBtn =
            '<a class="btn btn--primary btn--sm" href="/media/">' +
            esc(t("Vào Cổng Media →", "Open Media Portal →")) +
            "</a>";
        }

        return (
          '<article class="member-cap-card is-active" data-cap-id="' +
          esc(c.id) +
          '">' +
          '<div class="member-cap-top"><span class="cap-status-pill is-active">' +
          esc(t("Đang hoạt động", "Active")) +
          "</span>" +
          scopeBadge +
          "</div>" +
          "<h3>" +
          esc(label) +
          "</h3>" +
          "<p>" +
          esc(summary) +
          "</p>" +
          expiryHtml +
          '<div class="member-cap-actions">' +
          actionBtn +
          '<button type="button" class="btn btn--outline btn--sm" data-cap-revoke="' +
          esc(c.id) +
          '">' +
          esc(t("Kết thúc vai trò", "Step down")) +
          "</button>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function allThreadsList() {
    var combined = [];
    state.threads.forEach(function (th) {
      combined.push({ item: th, group: "own" });
    });
    state.companionThreads.forEach(function (th) {
      if (
        !combined.some(function (x) {
          return x.item.id === th.id;
        })
      ) {
        combined.push({ item: th, group: "companion" });
      }
    });
    return combined;
  }

  function renderThreadsList() {
    if (!threadsEl) return;
    var list = allThreadsList();
    if (!list.length) {
      threadsEl.innerHTML =
        '<div class="desk-empty-list">' + esc(t("Chưa có hội thoại nào.", "No conversations yet.")) + "</div>";
      return;
    }

    threadsEl.innerHTML = list
      .map(function (entry) {
        var th = entry.item;
        var isComp = entry.group === "companion";
        var isSelected = th.id === state.activeThreadId;
        var unread = isComp ? Number(th.unreadAdmin || 0) : Number(th.unreadMember || 0);
        var title = isComp
          ? (th.memberName || th.guestName || t("Khách hỏi sự kiện", "Event guest"))
          : th.kind === "member_direct"
            ? t("Ban Điều phối HolaRise", "HolaRise Coordinators")
            : th.eventTitle || t("Hỏi đáp sự kiện", "Event Help");
        var tag = isComp
          ? '<span class="desk-tag is-companion">' + esc(t("Đón khách", "Hosting")) + "</span>"
          : th.kind === "event_support"
            ? '<span class="desk-tag">' + esc(t("Sự kiện", "Event")) + "</span>"
            : '<span class="desk-tag is-direct">' + esc(t("BTC", "Direct")) + "</span>";
        return (
          '<button type="button" class="desk-thread-btn' +
          (isSelected ? " is-active" : "") +
          (unread > 0 ? " has-unread" : "") +
          '" data-desk-thread="' +
          esc(th.id) +
          '">' +
          '<div class="desk-thread-row"><strong>' +
          esc(title) +
          "</strong>" +
          (unread > 0 ? '<span class="desk-unread-pill">' + unread + "</span>" : "") +
          "</div>" +
          '<div class="desk-thread-sub">' +
          tag +
          "<span>" +
          esc(th.eventTitle || formatDateTime(th.lastMessageAt)) +
          "</span></div>" +
          '<p class="desk-thread-preview">' +
          esc(th.lastMessagePreview || t("Bắt đầu trao đổi...", "Start conversation...")) +
          "</p>" +
          "</button>"
        );
      })
      .join("");
  }

  function renderMessages() {
    if (!msgsEl) return;
    if (!state.activeThreadId) {
      msgsEl.innerHTML =
        '<div class="desk-empty-list">' + esc(t("Chọn một cuộc trò chuyện ở cột bên trái.", "Select a conversation on the left.")) + "</div>";
      return;
    }
    if (!state.activeMessages.length) {
      msgsEl.innerHTML =
        '<div class="desk-empty-list">' +
        esc(t("Chưa có tin nhắn nào. Bạn có thể gửi lời nhắn đầu tiên cho Ban Điều phối tại đây.", "No messages yet. Say hello below.")) +
        "</div>";
      return;
    }

    msgsEl.innerHTML = state.activeMessages
      .map(function (m) {
        var isSys = m.senderType === "system";
        var isMine = m.senderType === "member" || m.senderType === "companion";
        var cls = isSys ? "desk-msg is-system" : isMine ? "desk-msg is-mine" : "desk-msg is-other";
        var cardHtml = "";

        if (m.msgKind === "capability_card" && m.payload) {
          var p = m.payload;
          var st = p.liveStatus || "active";
          var statusText =
            st === "pending_accept"
              ? t("Chờ bạn xác nhận ở khung Quyền phía trên", "Confirm in Your Roles panel above")
              : st === "active"
                ? t("Đang hoạt động", "Active")
                : st === "revoked"
                  ? t("Đã kết thúc", "Ended")
                  : t("Đã hết hạn", "Expired");
          cardHtml =
            '<div class="desk-card desk-card--cap is-' +
            esc(st) +
            '">' +
            '<div class="desk-card-kicker">' +
            esc(t("THẺ TRAO QUYỀN", "ROLE GRANT")) +
            " · " +
            esc(statusText) +
            "</div>" +
            "<strong>" +
            esc(isEn ? p.labelEn || p.labelVi : p.labelVi) +
            (p.scopeTitle ? " — " + esc(p.scopeTitle) : "") +
            "</strong>" +
            (st === "active" && p.actionHref
              ? '<div class="desk-card-foot"><a class="btn btn--outline btn--sm" href="' +
                esc(p.actionHref) +
                '">' +
                esc(t("Mở ngay →", "Open now →")) +
                "</a></div>"
              : "") +
            "</div>";
        } else if (m.msgKind === "context_card" && m.payload) {
          var cp = m.payload;
          cardHtml =
            '<div class="desk-card desk-card--ctx">' +
            '<div class="desk-card-kicker">' +
            esc(cp.title || t("Đóng góp của bạn", "Your contribution")) +
            "</div>" +
            (cp.excerpt ? "<p>" + esc(cp.excerpt) + "</p>" : "") +
            (cp.href ? '<a href="' + esc(cp.href) + '">' + esc(t("Xem chi tiết ↗", "View details ↗")) + "</a>" : "") +
            "</div>";
        }

        return (
          '<div class="' +
          cls +
          '">' +
          (isSys ? "" : '<div class="desk-msg-meta">' + esc(m.senderName || "") + " · " + esc(formatDateTime(m.createdAt)) + "</div>") +
          cardHtml +
          '<div class="desk-msg-body">' +
          esc(m.body).replace(/\n/g, "<br>") +
          "</div></div>"
        );
      })
      .join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function loadMessages(threadId, incremental) {
    if (!threadId) return;
    var url = "/api/chat/messages?threadId=" + encodeURIComponent(threadId);
    if (incremental && state.lastCreatedAt) {
      url += "&since=" + encodeURIComponent(state.lastCreatedAt);
    }
    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        if (!incremental) {
          state.activeMessages = data.messages || [];
          if (convTitleEl && data.thread) {
            convTitleEl.textContent =
              data.viewerRole === "companion"
                ? (data.thread.memberName || data.thread.guestName) + " · " + (data.thread.eventTitle || "")
                : data.thread.kind === "member_direct"
                  ? t("Ban Điều phối HolaRise", "HolaRise Coordinators")
                  : data.thread.eventTitle || t("Hỏi đáp sự kiện", "Event Help");
          }
          if (convMetaEl && data.thread) {
            convMetaEl.textContent = data.thread.assignedName
              ? t("Đang hỗ trợ: " + data.thread.assignedName, "Assisted by: " + data.thread.assignedName)
              : "";
          }
          state.lastCreatedAt = state.activeMessages.length
            ? state.activeMessages[state.activeMessages.length - 1].createdAt
            : "";
          renderMessages();
        } else if (Array.isArray(data.messages) && data.messages.length) {
          var seen = new Set(
            state.activeMessages.map(function (x) {
              return x.id;
            })
          );
          var added = false;
          data.messages.forEach(function (m) {
            if (!seen.has(m.id)) {
              state.activeMessages.push(m);
              state.lastCreatedAt = m.createdAt || state.lastCreatedAt;
              added = true;
            }
          });
          if (added) renderMessages();
        }
      })
      .catch(function () {});
  }

  function loadDesk() {
    return fetch("/api/chat/threads", { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        state.threads = data.threads || [];
        state.companionThreads = data.companionThreads || [];
        state.capabilities = data.capabilities || [];
        updateBadge();
        renderCapabilities();

        if (!state.activeThreadId) {
          var all = allThreadsList();
          if (all.length) state.activeThreadId = all[0].item.id;
        }
        renderThreadsList();
        if (state.activeThreadId) {
          loadMessages(state.activeThreadId, false);
        } else {
          renderMessages();
        }
      })
      .catch(function () {});
  }

  function renderCheckinList() {
    if (!checkinListEl) return;
    var q = String((checkinSearchEl && checkinSearchEl.value) || "").trim().toLowerCase();
    var filtered = state.checkinAttendees.filter(function (a) {
      if (!q) return true;
      return (
        String(a.fullName || "").toLowerCase().includes(q) ||
        String(a.maskedPhone || "").toLowerCase().includes(q) ||
        String(a.organization || "").toLowerCase().includes(q)
      );
    });
    if (!filtered.length) {
      checkinListEl.innerHTML =
        '<p class="member-empty-hint">' + esc(t("Không tìm thấy người tham dự khớp bộ lọc.", "No matching attendees.")) + "</p>";
      return;
    }
    checkinListEl.innerHTML = filtered
      .map(function (a) {
        return (
          '<div class="checkin-row' +
          (a.checkedIn ? " is-checked" : "") +
          '">' +
          '<div class="checkin-row-info"><strong>' +
          esc(a.fullName) +
          "</strong><span>" +
          esc(a.maskedPhone) +
          (a.organization ? " · " + esc(a.organization) : "") +
          "</span></div>" +
          '<button type="button" class="btn ' +
          (a.checkedIn ? "btn--outline" : "btn--primary") +
          ' btn--sm" data-toggle-checkin="' +
          esc(a.id) +
          '" data-next-checked="' +
          (a.checkedIn ? "0" : "1") +
          '">' +
          esc(a.checkedIn ? t("Đã có mặt ✓", "Checked in ✓") : t("Check-in", "Check in")) +
          "</button></div>"
        );
      })
      .join("");
  }

  function openCheckinPanel(eventId) {
    if (!checkinSection || !eventId) return;
    state.checkinEventId = eventId;
    checkinSection.hidden = false;
    checkinListEl.innerHTML = '<p class="member-empty-hint">' + esc(t("Đang tải danh sách điểm danh...", "Loading attendee list...")) + "</p>";
    fetch("/api/member/checkin?eventId=" + encodeURIComponent(eventId), { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          checkinListEl.innerHTML =
            '<p class="member-empty-hint">' + esc((data && data.message) || t("Không mở được danh sách.", "Unable to open list.")) + "</p>";
          return;
        }
        state.checkinAttendees = data.attendees || [];
        if (checkinTitleEl) checkinTitleEl.textContent = t("Check-in: ", "Check-in: ") + (data.event?.title || "");
        if (checkinStatsEl && data.stats) {
          checkinStatsEl.textContent = t(
            "Đã có mặt " + data.stats.attended + "/" + data.stats.total + " · Chỉ hiện Tên & 4 số cuối (bảo mật NĐ 13).",
            "Checked in " + data.stats.attended + "/" + data.stats.total + " · Privacy-masked list."
          );
        }
        renderCheckinList();
        checkinSection.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(function () {});
  }

  // Event delegation inside member desk pane
  deskPane.addEventListener("click", function (e) {
    var threadBtn = e.target.closest("[data-desk-thread]");
    if (threadBtn) {
      state.activeThreadId = threadBtn.getAttribute("data-desk-thread") || "";
      state.lastCreatedAt = "";
      renderThreadsList();
      loadMessages(state.activeThreadId, false);
      return;
    }

    var acceptBtn = e.target.closest("[data-cap-accept]");
    if (acceptBtn) {
      var capId = acceptBtn.getAttribute("data-cap-accept");
      var consentBox = deskPane.querySelector('[data-cap-consent="' + capId + '"]');
      var greetingInput = deskPane.querySelector('[data-cap-greeting="' + capId + '"]');
      if (consentBox && !consentBox.checked) {
        if (statusEl) statusEl.textContent = t("Vui lòng đánh dấu đồng ý cam kết trước khi kích hoạt.", "Please check the consent box first.");
        consentBox.focus();
        return;
      }
      acceptBtn.disabled = true;
      fetch("/api/chat/capabilities", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept",
          capabilityId: capId,
          consentAccepted: true,
          greeting: greetingInput ? greetingInput.value.trim() : "",
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (statusEl && data && !data.ok) statusEl.textContent = data.message || "";
          loadDesk();
        })
        .finally(function () {
          acceptBtn.disabled = false;
        });
      return;
    }

    var declineBtn = e.target.closest("[data-cap-decline]");
    if (declineBtn) {
      var dId = declineBtn.getAttribute("data-cap-decline");
      declineBtn.disabled = true;
      fetch("/api/chat/capabilities", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline", capabilityId: dId }),
      })
        .then(function () {
          loadDesk();
        })
        .finally(function () {
          declineBtn.disabled = false;
        });
      return;
    }

    var revokeBtn = e.target.closest("[data-cap-revoke]");
    if (revokeBtn) {
      var rId = revokeBtn.getAttribute("data-cap-revoke");
      revokeBtn.disabled = true;
      fetch("/api/chat/capabilities", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", capabilityId: rId }),
      })
        .then(function () {
          loadDesk();
        })
        .finally(function () {
          revokeBtn.disabled = false;
        });
      return;
    }

    var taskBtn = e.target.closest("[data-member-task-id]");
    if (taskBtn) {
      var taskId = taskBtn.getAttribute("data-member-task-id");
      var nextStatus = taskBtn.getAttribute("data-member-task-next");
      taskBtn.disabled = true;
      fetch("/api/member/tasks", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: taskId, status: nextStatus }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (data && data.ok) loadAssignedTasks();
        })
        .finally(function () {
          taskBtn.disabled = false;
        });
      return;
    }

    var checkinBtn = e.target.closest("[data-open-checkin]");
    if (checkinBtn) {
      openCheckinPanel(checkinBtn.getAttribute("data-open-checkin"));
      return;
    }

    var toggleCheckinBtn = e.target.closest("[data-toggle-checkin]");
    if (toggleCheckinBtn && state.checkinEventId) {
      var regId = toggleCheckinBtn.getAttribute("data-toggle-checkin");
      var nextChecked = toggleCheckinBtn.getAttribute("data-next-checked") === "1";
      toggleCheckinBtn.disabled = true;
      fetch("/api/member/checkin", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: state.checkinEventId,
          registrationId: regId,
          checkedIn: nextChecked,
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (data && data.ok) {
            state.checkinAttendees = state.checkinAttendees.map(function (a) {
              return a.id === regId ? Object.assign({}, a, { checkedIn: data.checkedIn, status: data.status }) : a;
            });
            var attended = state.checkinAttendees.filter(function (a) {
              return a.checkedIn;
            }).length;
            if (checkinStatsEl) {
              checkinStatsEl.textContent = t(
                "Đã có mặt " + attended + "/" + state.checkinAttendees.length + " · Chỉ hiện Tên & 4 số cuối (bảo mật NĐ 13).",
                "Checked in " + attended + "/" + state.checkinAttendees.length + " · Privacy-masked list."
              );
            }
            renderCheckinList();
          }
        })
        .finally(function () {
          toggleCheckinBtn.disabled = false;
        });
    }
  });

  if (checkinSearchEl) {
    checkinSearchEl.addEventListener("input", renderCheckinList);
  }
  if (closeCheckinBtn && checkinSection) {
    closeCheckinBtn.addEventListener("click", function () {
      checkinSection.hidden = true;
    });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadDesk);
  }

  if (formEl) {
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = String((inputEl && inputEl.value) || "").trim();
      if (!state.activeThreadId || !body) return;
      if (sendBtn) sendBtn.disabled = true;
      if (statusEl) statusEl.textContent = t("Đang gửi...", "Sending...");

      fetch("/api/chat/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: state.activeThreadId, body: body }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.ok) {
            if (statusEl) statusEl.textContent = (data && data.message) || t("Không gửi được tin nhắn.", "Send failed.");
            return;
          }
          if (inputEl) inputEl.value = "";
          if (statusEl) statusEl.textContent = "";
          if (data.message) {
            state.activeMessages.push(data.message);
            state.lastCreatedAt = data.message.createdAt || state.lastCreatedAt;
            renderMessages();
          }
        })
        .finally(function () {
          if (sendBtn) sendBtn.disabled = false;
        });
    });
  }

  function startPoll() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(function () {
      if (document.hidden || deskPane.hidden || !state.activeThreadId) return;
      loadMessages(state.activeThreadId, true);
    }, 4500);
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  window.__holariseMemberDesk = {
    open: function () {
      loadDesk();
      loadAssignedTasks();
      startPoll();
    },
    pause: stopPoll,
    refreshBadge: function () {
      loadDesk();
      loadAssignedTasks();
    },
  };
})();
