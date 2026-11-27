/**
 * HolaRise Admin Unified Desk (/admin/ -> Hộp thoại)
 * - Split-pane inbox for Guest Event Support & Member 1-1 Direct threads
 * - In-thread Scoped Capability Grants (`event.companion`, `event.checkin`, `album.view_private`, `media.portal`)
 * - 1-click Revoke on live Capability Cards
 * - Internal BTC Whisper Notes (amber bubbles invisible to members/guests)
 * - Visibility-aware smart polling (4s on active thread, paused when tab hidden)
 */
(function () {
  "use strict";

  var panel = document.getElementById("panel-inbox");
  if (!panel) return;

  var refreshBtn = document.getElementById("btn-refresh-inbox");
  var startMemberSel = document.getElementById("inbox-start-member-select");
  var threadsEl = document.getElementById("admin-inbox-threads");
  var titleEl = document.getElementById("admin-inbox-title");
  var metaEl = document.getElementById("admin-inbox-meta");
  var headActionsEl = document.getElementById("admin-inbox-head-actions");
  var toggleGrantBtn = document.getElementById("btn-inbox-toggle-grant");
  var claimBtn = document.getElementById("btn-inbox-claim");
  var resolveBtn = document.getElementById("btn-inbox-resolve");
  var grantForm = document.getElementById("admin-grant-form");
  var closeGrantBtn = document.getElementById("btn-close-grant-drawer");
  var capSelect = document.getElementById("grant-cap-select");
  var eventWrap = document.getElementById("grant-event-wrap");
  var eventSelect = document.getElementById("grant-event-select");
  var albumWrap = document.getElementById("grant-album-wrap");
  var albumSelect = document.getElementById("grant-album-select");
  var ttlInput = document.getElementById("grant-ttl-hours");
  var noteInput = document.getElementById("grant-note-input");
  var grantStatusEl = document.getElementById("grant-status-msg");
  var submitGrantBtn = document.getElementById("btn-submit-grant");

  var msgsEl = document.getElementById("admin-inbox-messages");
  var formEl = document.getElementById("admin-inbox-form");
  var inputEl = document.getElementById("admin-inbox-input");
  var internalCb = document.getElementById("admin-inbox-internal");
  var sendBtn = document.getElementById("admin-inbox-send-btn");
  var statusEl = document.getElementById("admin-inbox-status");
  var badgeEl = document.getElementById("badge-unread-chat");

  var state = {
    filter: "all",
    threads: [],
    grantOptions: { events: [], albums: [], members: [] },
    activeThreadId: "",
    activeThread: null,
    messages: [],
    lastCreatedAt: "",
    pollTimer: null,
  };

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTime(iso) {
    if (!iso) return "";
    var dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function syncGrantScopeFields() {
    var cap = (capSelect && capSelect.value) || "event.companion";
    if (eventWrap) eventWrap.hidden = cap !== "event.companion" && cap !== "event.checkin";
    if (albumWrap) albumWrap.hidden = cap !== "album.view_private";
  }

  function populateGrantDropdowns() {
    var opts = state.grantOptions || {};
    if (startMemberSel) {
      var members = opts.members || [];
      startMemberSel.innerHTML =
        '<option value="">+ Nhắn thành viên...</option>' +
        members
          .map(function (m) {
            return (
              '<option value="' +
              esc(m.id) +
              '">' +
              esc(m.name) +
              (m.memberCode ? " (" + esc(m.memberCode) + ")" : "") +
              "</option>"
            );
          })
          .join("");
    }
    if (eventSelect) {
      var events = opts.events || [];
      eventSelect.innerHTML = events.length
        ? events
            .map(function (ev) {
              return '<option value="' + esc(ev.id) + '">' + esc(ev.title) + (ev.date ? " (" + esc(ev.date) + ")" : "") + "</option>";
            })
            .join("")
        : '<option value="">Chưa có sự kiện</option>';
    }
    if (albumSelect) {
      var albums = opts.albums || [];
      albumSelect.innerHTML = albums.length
        ? albums
            .map(function (a) {
              return '<option value="' + esc(a.id) + '">' + esc(a.title) + " [" + esc(a.visibility || "public") + "]</option>";
            })
            .join("")
        : '<option value="">Chưa có album</option>';
    }
    syncGrantScopeFields();
  }

  function renderThreads() {
    if (!threadsEl) return;
    if (!state.threads.length) {
      threadsEl.innerHTML = '<div class="admin-inbox-empty">Chưa có hội thoại nào trong bộ lọc này.</div>';
      return;
    }

    threadsEl.innerHTML = state.threads
      .map(function (th) {
        var active = th.id === state.activeThreadId;
        var unread = Number(th.unreadAdmin || 0);
        var kindBadge =
          th.kind === "event_support"
            ? '<span class="inbox-pill is-event">Hỏi sự kiện</span>'
            : '<span class="inbox-pill is-member">Thành viên</span>';
        var statusPill =
          th.status === "resolved"
            ? '<span class="inbox-pill is-done">Đã xong</span>'
            : th.assignedName
              ? '<span class="inbox-pill is-assigned">' + esc(th.assignedName) + "</span>"
              : "";
        return (
          '<button type="button" class="admin-thread-item' +
          (active ? " is-active" : "") +
          (unread > 0 ? " has-unread" : "") +
          '" data-admin-thread="' +
          esc(th.id) +
          '">' +
          '<div class="admin-thread-top"><strong>' +
          esc(th.memberName || th.guestName || "Khách tham dự") +
          "</strong>" +
          (unread > 0 ? '<span class="nav-badge">' + unread + "</span>" : "") +
          "</div>" +
          '<div class="admin-thread-badges">' +
          kindBadge +
          statusPill +
          "</div>" +
          (th.eventTitle ? '<div class="admin-thread-ev">' + esc(th.eventTitle) + "</div>" : "") +
          '<p class="admin-thread-preview">' +
          esc(th.lastMessagePreview || "Chưa có tin nhắn") +
          "</p>" +
          '<span class="admin-thread-time">' +
          esc(fmtTime(th.lastMessageAt)) +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function renderMessages() {
    if (!msgsEl) return;
    if (!state.activeThread) {
      msgsEl.innerHTML = '<div class="admin-inbox-empty">Chọn một cuộc trò chuyện ở danh sách bên trái hoặc chọn "+ Nhắn thành viên...".</div>';
      return;
    }
    if (!state.messages.length) {
      msgsEl.innerHTML = '<div class="admin-inbox-empty">Hộp thoại mới — hãy gửi tin nhắn hoặc bấm "+ Trao quyền" ở trên.</div>';
      return;
    }

    msgsEl.innerHTML = state.messages
      .map(function (m) {
        var cls = "admin-msg";
        if (m.isInternal) cls += " is-internal";
        else if (m.senderType === "system") cls += " is-system";
        else if (m.senderType === "admin" || m.senderType === "companion") cls += " is-staff";
        else cls += " is-client";

        var metaPrefix = m.isInternal ? "Ghi chú nội bộ BTC · " : "";
        var cardHtml = "";
        if (m.msgKind === "capability_card" && m.payload) {
          var p = m.payload;
          var st = p.liveStatus || "active";
          var canRevoke = st === "active" || st === "pending_accept";
          var stLabel =
            st === "pending_accept"
              ? "Chờ xác nhận"
              : st === "active"
                ? "Đang hoạt động"
                : st === "revoked"
                  ? "Đã thu hồi"
                  : "Hết hạn";
          cardHtml =
            '<div class="admin-cap-card is-' +
            esc(st) +
            '">' +
            '<div class="admin-cap-kicker">THẺ QUYỀN · ' +
            esc(stLabel) +
            "</div>" +
            "<strong>" +
            esc(p.labelVi || p.capability) +
            (p.scopeTitle ? " — " + esc(p.scopeTitle) : "") +
            "</strong>" +
            (p.expiresAt ? '<div class="admin-cap-exp">Hạn: ' + esc(fmtTime(p.expiresAt)) + "</div>" : "") +
            (canRevoke
              ? '<div class="admin-cap-actions"><button type="button" class="btn btn--outline btn--sm" data-admin-revoke-cap="' +
                esc(p.capabilityId) +
                '">Thu hồi quyền</button></div>'
              : "") +
            "</div>";
        } else if (m.msgKind === "context_card" && m.payload) {
          cardHtml =
            '<div class="admin-ctx-card"><strong>' +
            esc(m.payload.title || "Ngữ cảnh đóng góp") +
            "</strong>" +
            (m.payload.excerpt ? "<p>" + esc(m.payload.excerpt) + "</p>" : "") +
            "</div>";
        }

        return (
          '<div class="' +
          cls +
          '">' +
          '<div class="admin-msg-meta">' +
          esc(metaPrefix + (m.senderName || "") + " · " + fmtTime(m.createdAt)) +
          "</div>" +
          cardHtml +
          '<div class="admin-msg-body">' +
          esc(m.body).replace(/\n/g, "<br>") +
          "</div></div>"
        );
      })
      .join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function updateHeadForThread(th) {
    state.activeThread = th;
    if (!th) {
      if (titleEl) titleEl.textContent = "Chọn một hội thoại bên trái";
      if (metaEl) metaEl.textContent = "—";
      if (headActionsEl) headActionsEl.hidden = true;
      if (formEl) formEl.hidden = true;
      if (grantForm) grantForm.hidden = true;
      return;
    }
    if (titleEl) {
      titleEl.textContent =
        (th.memberName || th.guestName || "Khách tham dự") +
        (th.memberCode ? " (" + th.memberCode + ")" : "");
    }
    if (metaEl) {
      var parts = [];
      if (th.kind === "event_support" && th.eventTitle) parts.push("Sự kiện: " + th.eventTitle);
      if (th.contact) parts.push("Liên hệ: " + th.contact);
      if (th.assignedName) parts.push("Phụ trách: " + th.assignedName);
      metaEl.textContent = parts.join(" · ") || "Hội thoại trực tiếp";
    }
    if (headActionsEl) headActionsEl.hidden = false;
    if (toggleGrantBtn) toggleGrantBtn.hidden = !th.memberId;
    if (resolveBtn) {
      resolveBtn.textContent = th.status === "resolved" ? "Mở lại" : "Đánh dấu xong";
    }
    if (formEl) formEl.hidden = false;
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
          updateHeadForThread(data.thread);
          state.messages = data.messages || [];
          state.lastCreatedAt = state.messages.length ? state.messages[state.messages.length - 1].createdAt : "";
          renderMessages();
        } else if (Array.isArray(data.messages) && data.messages.length) {
          var seen = new Set(
            state.messages.map(function (x) {
              return x.id;
            })
          );
          var added = false;
          data.messages.forEach(function (m) {
            if (!seen.has(m.id)) {
              state.messages.push(m);
              state.lastCreatedAt = m.createdAt || state.lastCreatedAt;
              added = true;
            }
          });
          if (added) renderMessages();
        }
      })
      .catch(function () {});
  }

  function loadInbox(selectThreadId) {
    var qs = new URLSearchParams({ scope: "admin" });
    if (state.filter === "event_support" || state.filter === "member_direct") {
      qs.set("kind", state.filter);
    } else if (state.filter === "open") {
      qs.set("status", "open");
    }

    return fetch("/api/chat/threads?" + qs.toString(), { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        state.threads = data.threads || [];
        if (data.grantOptions) {
          state.grantOptions = data.grantOptions;
          populateGrantDropdowns();
        }
        if (badgeEl) {
          var unread = Number(data.unreadTotal || 0);
          badgeEl.hidden = unread <= 0;
          badgeEl.textContent = String(unread);
        }
        if (selectThreadId) {
          state.activeThreadId = selectThreadId;
        } else if (!state.activeThreadId && state.threads.length) {
          state.activeThreadId = state.threads[0].id;
        }
        renderThreads();
        if (state.activeThreadId) {
          loadMessages(state.activeThreadId, false);
        } else {
          updateHeadForThread(null);
          renderMessages();
        }
      })
      .catch(function () {});
  }

  function openMemberDirectThread(memberId, contextCard) {
    if (!memberId) return;
    fetch("/api/chat/threads", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "member_direct",
        memberId: memberId,
        contextCard: contextCard || undefined,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok && data.thread) {
          state.filter = "all";
          loadInbox(data.thread.id);
        }
      })
      .catch(function () {});
  }

  panel.addEventListener("click", function (e) {
    var filterBtn = e.target.closest("[data-inbox-filter]");
    if (filterBtn) {
      state.filter = filterBtn.getAttribute("data-inbox-filter") || "all";
      panel.querySelectorAll("[data-inbox-filter]").forEach(function (b) {
        b.classList.toggle("is-active", b === filterBtn);
      });
      loadInbox();
      return;
    }

    var thBtn = e.target.closest("[data-admin-thread]");
    if (thBtn) {
      state.activeThreadId = thBtn.getAttribute("data-admin-thread") || "";
      state.lastCreatedAt = "";
      if (grantForm) grantForm.hidden = true;
      renderThreads();
      loadMessages(state.activeThreadId, false);
      return;
    }

    var revokeBtn = e.target.closest("[data-admin-revoke-cap]");
    if (revokeBtn) {
      var capId = revokeBtn.getAttribute("data-admin-revoke-cap");
      revokeBtn.disabled = true;
      fetch("/api/chat/capabilities", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", capabilityId: capId }),
      })
        .then(function () {
          loadMessages(state.activeThreadId, false);
        })
        .finally(function () {
          revokeBtn.disabled = false;
        });
    }
  });

  if (refreshBtn) refreshBtn.addEventListener("click", function () { loadInbox(state.activeThreadId); });

  if (startMemberSel) {
    startMemberSel.addEventListener("change", function () {
      var id = startMemberSel.value;
      if (!id) return;
      startMemberSel.value = "";
      openMemberDirectThread(id);
    });
  }

  if (toggleGrantBtn && grantForm) {
    toggleGrantBtn.addEventListener("click", function () {
      grantForm.hidden = !grantForm.hidden;
      if (grantStatusEl) grantStatusEl.textContent = "";
      syncGrantScopeFields();
    });
  }
  if (closeGrantBtn && grantForm) {
    closeGrantBtn.addEventListener("click", function () {
      grantForm.hidden = true;
    });
  }
  if (capSelect) {
    capSelect.addEventListener("change", syncGrantScopeFields);
  }

  if (claimBtn) {
    claimBtn.addEventListener("click", function () {
      if (!state.activeThreadId) return;
      fetch("/api/chat/threads", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: state.activeThreadId, claim: true }),
      }).then(function () {
        loadInbox(state.activeThreadId);
      });
    });
  }

  if (resolveBtn) {
    resolveBtn.addEventListener("click", function () {
      if (!state.activeThreadId || !state.activeThread) return;
      var nextStatus = state.activeThread.status === "resolved" ? "open" : "resolved";
      fetch("/api/chat/threads", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: state.activeThreadId, status: nextStatus }),
      }).then(function () {
        loadInbox(state.activeThreadId);
      });
    });
  }

  if (grantForm) {
    grantForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!state.activeThread || !state.activeThread.memberId) {
        if (grantStatusEl) grantStatusEl.textContent = "Chỉ trao quyền được cho tài khoản đã là Thành viên.";
        return;
      }
      var capability = capSelect ? capSelect.value : "event.companion";
      var scopeId =
        capability === "album.view_private"
          ? albumSelect
            ? albumSelect.value
            : ""
          : capability === "media.portal"
            ? ""
            : eventSelect
              ? eventSelect.value
              : "";

      if (submitGrantBtn) submitGrantBtn.disabled = true;
      if (grantStatusEl) grantStatusEl.textContent = "Đang gửi thẻ trao quyền...";

      fetch("/api/chat/capabilities", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grant",
          memberId: state.activeThread.memberId,
          threadId: state.activeThread.id,
          capability: capability,
          scopeId: scopeId,
          ttlHours: ttlInput && ttlInput.value ? Number(ttlInput.value) : 0,
          note: noteInput ? noteInput.value.trim() : "",
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.ok) {
            if (grantStatusEl) grantStatusEl.textContent = (data && data.message) || "Không trao được quyền.";
            return;
          }
          if (noteInput) noteInput.value = "";
          if (ttlInput) ttlInput.value = "";
          grantForm.hidden = true;
          loadMessages(state.activeThreadId, false);
        })
        .finally(function () {
          if (submitGrantBtn) submitGrantBtn.disabled = false;
        });
    });
  }

  if (formEl) {
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = String((inputEl && inputEl.value) || "").trim();
      if (!state.activeThreadId || !body) return;
      if (sendBtn) sendBtn.disabled = true;
      if (statusEl) statusEl.textContent = "Đang gửi...";

      fetch("/api/chat/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: state.activeThreadId,
          body: body,
          isInternal: Boolean(internalCb && internalCb.checked),
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.ok) {
            if (statusEl) statusEl.textContent = (data && data.message) || "Không gửi được tin nhắn.";
            return;
          }
          if (inputEl) inputEl.value = "";
          if (internalCb) internalCb.checked = false;
          if (statusEl) statusEl.textContent = "";
          if (data.message) {
            state.messages.push(data.message);
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
      if (document.hidden || panel.hidden) return;
      if (state.activeThreadId) loadMessages(state.activeThreadId, true);
    }, 4500);
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  window.__holariseAdminDesk = {
    open: function () {
      loadInbox(state.activeThreadId);
      startPoll();
    },
    pause: stopPoll,
    openMemberThread: openMemberDirectThread,
  };
})();
