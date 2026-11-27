/**
 * HolaRise Lazy-Loaded Event Companion Chat Drawer
 * Loaded on-demand ONLY when a visitor clicks [data-open-event-chat] on /su-kien/* or /en/events/*.
 * Zero initial JS overhead on Zalo In-App WebView.
 */
(function () {
  "use strict";

  var isEn = document.documentElement.lang === "en" || document.documentElement.getAttribute("data-lang") === "en";
  function t(vi, en) {
    return isEn ? en : vi;
  }

  var dlg = document.getElementById("event-companion-chat-dialog");
  if (!dlg) return;

  var titleEl = document.getElementById("evchat-heading");
  var subEl = document.getElementById("evchat-sub");
  var zaloLink = document.getElementById("evchat-zalo-escape");
  var msgsEl = document.getElementById("evchat-messages");
  var formEl = document.getElementById("evchat-form");
  var guestFieldsEl = document.getElementById("evchat-guest-fields");
  var guestNameInput = document.getElementById("evchat-guest-name");
  var guestContactInput = document.getElementById("evchat-guest-contact");
  var msgInput = document.getElementById("evchat-input");
  var sendBtn = document.getElementById("evchat-send-btn");
  var statusEl = document.getElementById("evchat-status");

  var state = {
    eventId: "",
    eventTitle: "",
    zaloGroup: "",
    companionNames: "",
    isMember: false,
    threadId: "",
    lastCreatedAt: "",
    messages: [],
    pollTimer: null,
    sending: false,
  };

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    if (!iso) return "";
    var dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleTimeString(isEn ? "en-GB" : "vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function prefillGuestFromDraft() {
    try {
      var raw = localStorage.getItem("holarise_form_draft_quick-register");
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (guestNameInput && !guestNameInput.value && parsed && parsed.full_name) {
        guestNameInput.value = String(parsed.full_name).slice(0, 80);
      }
      if (guestContactInput && !guestContactInput.value && parsed && (parsed.phone || parsed.email)) {
        guestContactInput.value = String(parsed.phone || parsed.email).slice(0, 120);
      }
    } catch {
      // Ignore storage errors in restricted WebViews
    }
  }

  function renderMessages() {
    if (!msgsEl) return;
    if (!state.messages.length) {
      msgsEl.innerHTML =
        '<div class="evchat-empty">' +
        esc(
          t(
            "Chưa có tin nhắn nào. Bạn cứ hỏi thoải mái về đường đi, chỗ gửi xe hoặc việc đi một mình lần đầu — người đón bạn sẽ trả lời tại đây.",
            "No messages yet. Ask anything about directions, parking, or coming solo — your welcoming host will reply right here."
          )
        ) +
        "</div>";
      return;
    }

    msgsEl.innerHTML = state.messages
      .map(function (m) {
        var isMine = m.senderType === "guest" || m.senderType === "member";
        var isSys = m.senderType === "system";
        var cls = isSys ? "evchat-bubble is-system" : isMine ? "evchat-bubble is-mine" : "evchat-bubble is-staff";
        var senderTag = isSys ? "" : '<div class="evchat-sender">' + esc(m.senderName || "") + " · " + esc(formatTime(m.createdAt)) + "</div>";
        return '<div class="' + cls + '">' + senderTag + '<div class="evchat-body">' + esc(m.body).replace(/\n/g, "<br>") + "</div></div>";
      })
      .join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    if (!state.threadId || !dlg.open) return;
    state.pollTimer = setInterval(function () {
      if (document.hidden || !dlg.open || !state.threadId) return;
      pollNewMessages();
    }, 4000);
  }

  function pollNewMessages() {
    if (!state.threadId) return;
    var url = "/api/chat/messages?threadId=" + encodeURIComponent(state.threadId);
    if (state.lastCreatedAt) {
      url += "&since=" + encodeURIComponent(state.lastCreatedAt);
    }
    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.messages) || !data.messages.length) return;
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
      })
      .catch(function () {});
  }

  function loadInitialThread() {
    if (statusEl) statusEl.textContent = "";
    msgsEl.innerHTML = '<div class="evchat-empty">' + esc(t("Đang mở hộp thoại...", "Opening conversation...")) + "</div>";

    fetch("/api/chat/threads?scope=event&eventId=" + encodeURIComponent(state.eventId), {
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          msgsEl.innerHTML = '<div class="evchat-empty">' + esc(t("Chưa thể tải hộp thoại lúc này.", "Could not load conversation.")) + "</div>";
          return;
        }
        state.isMember = Boolean(data.isMember);
        if (guestFieldsEl) {
          guestFieldsEl.hidden = state.isMember || Boolean(data.thread);
        }
        if (!state.isMember) prefillGuestFromDraft();

        if (data.thread && data.thread.id) {
          state.threadId = data.thread.id;
          return fetch("/api/chat/messages?threadId=" + encodeURIComponent(state.threadId), {
            credentials: "same-origin",
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (msgData) {
              state.messages = (msgData && msgData.messages) || [];
              state.lastCreatedAt = state.messages.length
                ? state.messages[state.messages.length - 1].createdAt
                : "";
              renderMessages();
              startPolling();
            });
        }

        state.threadId = "";
        state.messages = [];
        state.lastCreatedAt = "";
        renderMessages();
      })
      .catch(function () {
        msgsEl.innerHTML = '<div class="evchat-empty">' + esc(t("Mạng đang chập chờn. Bạn có thể mở Nhóm Zalo ở trên để nhắn ngay.", "Connection unstable. You can use the Zalo group link above.")) + "</div>";
      });
  }

  function openEventChat(triggerBtn) {
    state.eventId = (triggerBtn && triggerBtn.getAttribute("data-event-id")) || "";
    state.eventTitle = (triggerBtn && triggerBtn.getAttribute("data-event-title")) || "";
    state.zaloGroup = (triggerBtn && triggerBtn.getAttribute("data-zalo-group")) || "";
    state.companionNames = (triggerBtn && triggerBtn.getAttribute("data-companion-names")) || "";

    if (titleEl) {
      titleEl.textContent = state.companionNames
        ? t("Nhắn cho " + state.companionNames, "Message " + state.companionNames)
        : t("Hỏi nhanh trước buổi gặp", "Ask before the gathering");
    }
    if (zaloLink && state.zaloGroup) {
      zaloLink.href = state.zaloGroup;
    }
    if (subEl && state.eventTitle) {
      subEl.firstChild && (subEl.firstChild.nodeValue = t("Về buổi: " + state.eventTitle + ". Đang đi ngoài đường cần gấp? Mở ", "About: " + state.eventTitle + ". On your way? Open "));
    }

    if (typeof dlg.showModal === "function" && !dlg.open) {
      dlg.showModal();
    }
    loadInitialThread();
  }

  if (formEl) {
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      if (state.sending) return;
      var body = String((msgInput && msgInput.value) || "").trim();
      if (!body) {
        if (statusEl) statusEl.textContent = t("Vui lòng nhập nội dung câu hỏi.", "Please enter your message.");
        return;
      }

      state.sending = true;
      if (sendBtn) sendBtn.disabled = true;
      if (statusEl) statusEl.textContent = t("Đang gửi...", "Sending...");

      var endpoint = state.threadId ? "/api/chat/messages" : "/api/chat/threads";
      var payload = state.threadId
        ? { threadId: state.threadId, body: body }
        : {
            kind: "event_support",
            eventId: state.eventId,
            body: body,
            guestName: guestNameInput ? guestNameInput.value.trim() : "",
            guestContact: guestContactInput ? guestContactInput.value.trim() : "",
          };

      fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { ok: r.ok, data: data };
          });
        })
        .then(function (res) {
          if (!res.ok || !res.data || !res.data.ok) {
            if (statusEl) {
              statusEl.textContent =
                (res.data && res.data.message) || t("Không gửi được tin nhắn, vui lòng thử lại.", "Could not send message.");
            }
            return;
          }
          if (msgInput) msgInput.value = "";
          if (statusEl) statusEl.textContent = "";
          if (res.data.thread && res.data.thread.id) {
            state.threadId = res.data.thread.id;
            if (guestFieldsEl) guestFieldsEl.hidden = true;
          }
          if (res.data.message) {
            state.messages.push(res.data.message);
            state.lastCreatedAt = res.data.message.createdAt || state.lastCreatedAt;
            renderMessages();
          }
          startPolling();
        })
        .catch(function () {
          if (statusEl) statusEl.textContent = t("Mất kết nối tạm thời, vui lòng thử lại.", "Network error, please retry.");
        })
        .finally(function () {
          state.sending = false;
          if (sendBtn) sendBtn.disabled = false;
        });
    });
  }

  dlg.addEventListener("close", stopPolling);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && dlg.open && state.threadId) {
      pollNewMessages();
    }
  });

  window.__holariseOpenEventChat = openEventChat;
})();
