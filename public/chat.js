/* ==========================================================================
   PrintPoP 3D — customer chat widget.

   No sign-up. The first message mints a token the browser keeps, and
   whoever holds it can continue that one conversation.
   ========================================================================== */
(() => {
  const KEY = 'printpop-chat';
  const POLL_OPEN = 4000;      // while the window is open
  const POLL_IDLE = 30000;     // in the background, just to light the badge

  const el = {};
  let thread = null;
  let seenCount = 0;
  let pollTimer = null;
  let isOpen = false;

  /* ---------- saved identity ---------- */

  function saved() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
  }

  function remember(threadId, token) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ threadId, token }));
    } catch {
      /* private browsing — the chat still works for this visit */
    }
  }

  function forget() {
    try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
  }

  /* ---------- markup ---------- */

  function build() {
    const root = document.createElement('div');
    root.className = 'chat-root';
    root.innerHTML = `
      <button class="chat-bubble" id="chatBubble" aria-label="Chat with us">
        <svg viewBox="0 0 24 24" class="chat-ic-open" aria-hidden="true">
          <path fill="currentColor" d="M12 3C6.99 3 3 6.36 3 10.5c0 2.3 1.23 4.35 3.16 5.72-.1 1.2-.5 2.5-1.36 3.53 1.86-.24 3.3-1.03 4.24-1.7.9.23 1.87.36 2.96.36 5.01 0 9-3.36 9-7.5S17.01 3 12 3Z"/>
        </svg>
        <svg viewBox="0 0 24 24" class="chat-ic-close" aria-hidden="true">
          <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"/>
        </svg>
        <span class="chat-dot" id="chatDot" hidden></span>
      </button>

      <div class="chat-panel" id="chatPanel" hidden>
        <div class="chat-head">
          <img src="/assets/logo.jpeg" alt="">
          <div>
            <b>PrintPoP 3D</b>
            <span id="chatStatus">Ask us anything</span>
          </div>
          <button class="chat-x" id="chatClose" aria-label="Close chat">&times;</button>
        </div>

        <!-- first contact -->
        <form class="chat-start" id="chatStart">
          <p class="chat-intro">Tell us what you're after and we'll reply right here.</p>
          <label><span>Your name</span>
            <input type="text" name="name" maxlength="60" autocomplete="name" required></label>
          <label><span>Phone or Instagram</span>
            <input type="text" name="contact" maxlength="80" placeholder="03 123 456 or @yourname" required></label>
          <label><span>Message</span>
            <textarea name="body" maxlength="1500" rows="3" placeholder="What would you like printed?" required></textarea></label>
          <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="chat-hp">
          <button type="submit" class="chat-send-btn">Start chat</button>
          <p class="chat-err" id="chatStartErr"></p>
        </form>

        <!-- ongoing conversation -->
        <div class="chat-convo" id="chatConvo" hidden>
          <div class="chat-log" id="chatLog"></div>
          <form class="chat-reply" id="chatReply">
            <textarea id="chatInput" rows="1" maxlength="1500" placeholder="Write a message…"></textarea>
            <button type="submit" aria-label="Send">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 20.5v-6l8-2.5-8-2.5v-6l19 8.5z"/></svg>
            </button>
          </form>
          <p class="chat-closed" id="chatClosedNote" hidden>This conversation was closed by the shop.</p>
        </div>
      </div>`;
    document.body.appendChild(root);

    ['chatBubble', 'chatPanel', 'chatClose', 'chatStart', 'chatStartErr', 'chatConvo',
     'chatLog', 'chatReply', 'chatInput', 'chatDot', 'chatStatus', 'chatClosedNote']
      .forEach((id) => { el[id] = document.getElementById(id); });
  }

  /* ---------- rendering ---------- */

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function clock(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderLog() {
    if (!thread) return;

    el.chatLog.innerHTML = thread.messages
      .map(
        (m) => `
        <div class="chat-msg ${m.from === 'shop' ? 'from-shop' : 'from-me'}">
          <div class="chat-bubble-text">${escapeHtml(m.body)}</div>
          <time>${clock(m.at)}</time>
        </div>`
      )
      .join('');

    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    el.chatClosedNote.hidden = !thread.closed;
    el.chatReply.hidden = Boolean(thread.closed);
    el.chatStatus.textContent = thread.closed ? 'Conversation closed' : 'We usually reply within a few hours';
  }

  /* A dot on the bubble when the shop has replied and you haven't looked. */
  function updateDot() {
    if (!thread) return;
    const unseen = thread.messages.length - seenCount;
    el.chatDot.hidden = isOpen || unseen <= 0;
  }

  function showConversation() {
    el.chatStart.hidden = true;
    el.chatConvo.hidden = false;
    renderLog();
  }

  /* ---------- server talk ---------- */

  async function post(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  async function poll() {
    const id = saved();
    if (!id) return;

    try {
      const res = await fetch(
        `/api/chat/poll?threadId=${encodeURIComponent(id.threadId)}&token=${encodeURIComponent(id.token)}`
      );
      if (res.status === 404) {           // shop deleted the conversation
        forget();
        thread = null;
        el.chatConvo.hidden = true;
        el.chatStart.hidden = false;
        return;
      }
      if (!res.ok) return;

      const fresh = await res.json();
      const grew = !thread || fresh.messages.length !== thread.messages.length;
      thread = fresh;

      if (grew) {
        if (isOpen) seenCount = thread.messages.length;
        renderLog();
      }
      updateDot();
    } catch {
      /* offline — the next tick will catch up */
    }
  }

  function schedule() {
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, isOpen ? POLL_OPEN : POLL_IDLE);
  }

  /* ---------- opening and closing ---------- */

  function openChat() {
    isOpen = true;
    el.chatPanel.hidden = false;
    document.querySelector('.chat-root').classList.add('is-open');
    if (thread) {
      seenCount = thread.messages.length;
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
    }
    updateDot();
    schedule();
    poll();
    setTimeout(() => (thread ? el.chatInput : el.chatStart.name)?.focus?.(), 60);
  }

  function closeChat() {
    isOpen = false;
    el.chatPanel.hidden = true;
    document.querySelector('.chat-root').classList.remove('is-open');
    schedule();
  }

  /* ---------- wiring ---------- */

  function wire() {
    el.chatBubble.addEventListener('click', () => (isOpen ? closeChat() : openChat()));
    el.chatClose.addEventListener('click', closeChat);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) closeChat();
    });

    // any "message us" link on the page opens the chat instead of scrolling
    document.querySelectorAll('[data-open-chat]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.preventDefault(); openChat(); });
    });

    el.chatStart.addEventListener('submit', async (e) => {
      e.preventDefault();
      el.chatStartErr.textContent = '';
      const btn = el.chatStart.querySelector('button');
      const payload = Object.fromEntries(new FormData(el.chatStart).entries());

      try {
        btn.disabled = true;
        btn.textContent = 'Sending…';
        const res = await post('/api/chat/start', payload);
        remember(res.threadId, res.token);
        thread = res.thread;
        seenCount = thread.messages.length;
        showConversation();
        schedule();
      } catch (err) {
        el.chatStartErr.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Start chat';
      }
    });

    el.chatReply.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = el.chatInput.value.trim();
      if (!text) return;
      const id = saved();
      if (!id) return;

      // Show it immediately; the poll will reconcile with the server.
      const optimistic = { id: 'pending', from: 'customer', body: text, at: new Date().toISOString() };
      thread.messages.push(optimistic);
      renderLog();
      el.chatInput.value = '';
      el.chatInput.style.height = 'auto';

      try {
        const res = await post('/api/chat/send', { threadId: id.threadId, token: id.token, body: text });
        thread = res.thread;
        seenCount = thread.messages.length;
        renderLog();
      } catch (err) {
        thread.messages = thread.messages.filter((m) => m !== optimistic);
        renderLog();
        el.chatStatus.textContent = err.message;
      }
    });

    // Enter sends, Shift+Enter makes a new line
    el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.chatReply.requestSubmit();
      }
    });

    // grow the box with the text
    el.chatInput.addEventListener('input', () => {
      el.chatInput.style.height = 'auto';
      el.chatInput.style.height = `${Math.min(el.chatInput.scrollHeight, 110)}px`;
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll();
    });
  }

  /* ---------- start ---------- */

  build();
  wire();

  if (saved()) {
    poll().then(() => {
      if (thread) {
        seenCount = thread.messages.length - (thread.customerUnread ?? 0);
        showConversation();
      }
    });
  }
  schedule();
})();
