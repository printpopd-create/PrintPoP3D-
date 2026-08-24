/* ==========================================================================
   PrintPoP 3D admin — customer conversations and phone notifications.
   Loaded after admin.js, so it reuses $, api(), toast(), notice(), escapeHtml.
   ========================================================================== */

let threads = [];
let openThreadId = null;
let openThread = null;
let chatPoll = null;

const POLL_MS = 6000;

/* ---------- small helpers ---------- */

function timeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* Turn a phone number or @handle into something tappable. */
function contactLink(raw) {
  const value = String(raw ?? '').trim();

  if (value.startsWith('@')) {
    const handle = value.slice(1).replace(/[^A-Za-z0-9._]/g, '');
    return handle
      ? `<a href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`
      : escapeHtml(value);
  }

  let digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 7) return escapeHtml(value);

  const cc = (window.site?.settings?.countryCode || '961').replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = cc + digits.replace(/^0+/, '');
  else if (digits.length <= 8) digits = cc + digits;

  return `<a href="https://wa.me/${digits}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`;
}

/* ---------- thread list ---------- */

function renderThreads() {
  const host = $('#threadList');
  const unread = threads.filter((t) => t.adminUnread > 0).length;

  const badge = $('#msgBadge');
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);

  $('#msgCount').textContent = threads.length
    ? `${threads.length} conversation${threads.length === 1 ? '' : 's'}${unread ? ` · ${unread} needing a reply` : ''}`
    : 'No conversations yet';

  if (!threads.length) {
    host.innerHTML =
      '<div class="msg-empty">Nothing yet. When someone opens the chat on your shop, it appears here.</div>';
    return;
  }

  host.innerHTML = threads
    .map(
      (t) => `
      <button class="thread${t.adminUnread ? ' unread' : ''}${t.id === openThreadId ? ' active' : ''}${t.closed ? ' closed' : ''}" data-id="${escapeHtml(t.id)}">
        <div class="thread-top">
          <b>${escapeHtml(t.name)}</b>
          <span class="when">${timeAgo(t.lastAt)}</span>
        </div>
        <div class="thread-preview">${t.lastFrom === 'shop' ? '<i>You:</i> ' : ''}${escapeHtml(t.preview)}</div>
        ${t.adminUnread ? `<span class="thread-badge">${t.adminUnread}</span>` : ''}
        ${t.closed ? '<span class="thread-closed">closed</span>' : ''}
      </button>`
    )
    .join('');

  host.querySelectorAll('.thread').forEach((btn) => {
    btn.addEventListener('click', () => selectThread(btn.dataset.id));
  });
}

/* ---------- one conversation ---------- */

function renderThread() {
  const view = $('#threadView');
  const split = document.querySelector('.chat-split');

  if (!openThread) {
    view.hidden = true;
    split.classList.remove('viewing');
    return;
  }

  view.hidden = false;
  split.classList.add('viewing');

  $('#tvName').textContent = openThread.name;
  $('#tvContact').innerHTML = contactLink(openThread.contact);
  $('#tvClose').textContent = openThread.closed ? '↩' : '✓';
  $('#tvClose').title = openThread.closed ? 'Reopen conversation' : 'Close conversation';

  $('#tvLog').innerHTML = openThread.messages
    .map(
      (m) => `
      <div class="tv-msg ${m.from === 'shop' ? 'from-shop' : 'from-customer'}">
        <div class="tv-text">${escapeHtml(m.body)}</div>
        <time>${clock(m.at)}</time>
      </div>`
    )
    .join('');

  $('#tvLog').scrollTop = $('#tvLog').scrollHeight;
  $('#tvClosedNote').hidden = !openThread.closed;
  $('#tvReply').hidden = Boolean(openThread.closed);
}

async function selectThread(id) {
  try {
    const res = await api('POST', '/api/chat/open', { threadId: id });
    openThreadId = id;
    openThread = res.thread;
    threads = res.threads;
    renderThreads();
    renderThread();
    setTimeout(() => $('#tvInput')?.focus(), 60);
  } catch (err) {
    toast(err.message);
  }
}

async function loadThreads({ keepOpen = true } = {}) {
  try {
    const res = await api('GET', '/api/chat/threads');
    threads = res.threads;
    renderThreads();

    // refresh the open conversation so new replies appear without a click
    if (keepOpen && openThreadId) {
      const still = threads.find((t) => t.id === openThreadId);
      if (!still) {
        openThreadId = null;
        openThread = null;
        renderThread();
      } else if (openThread && still.messageCount !== openThread.messages.length) {
        const fresh = await api('POST', '/api/chat/open', { threadId: openThreadId });
        openThread = fresh.thread;
        threads = fresh.threads;
        renderThreads();
        renderThread();
      }
    }
  } catch {
    /* not fatal — the rest of the admin keeps working */
  }
}

/* Poll only while the Messages tab is actually on screen. */
function setChatPolling(on) {
  clearInterval(chatPoll);
  if (on) chatPoll = setInterval(() => loadThreads(), POLL_MS);
}

/* ---------- actions ---------- */

$('#refreshMsgs').addEventListener('click', async () => {
  await loadThreads();
  toast('Refreshed');
});

$('#tvBack').addEventListener('click', () => {
  openThreadId = null;
  openThread = null;
  renderThreads();
  renderThread();
});

$('#tvReply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#tvInput');
  const text = input.value.trim();
  if (!text || !openThreadId) return;

  input.value = '';
  input.style.height = 'auto';

  try {
    const res = await api('POST', '/api/chat/reply', { threadId: openThreadId, body: text });
    openThread = res.thread;
    threads = res.threads;
    renderThreads();
    renderThread();
  } catch (err) {
    input.value = text;              // hand their typing back
    toast(err.message);
  }
});

$('#tvInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#tvReply').requestSubmit();
  }
});

$('#tvInput').addEventListener('input', () => {
  const input = $('#tvInput');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

$('#tvClose').addEventListener('click', async () => {
  if (!openThread) return;
  const res = await api('POST', '/api/chat/close', {
    threadId: openThreadId,
    closed: !openThread.closed,
  });
  openThread = res.thread;
  threads = res.threads;
  renderThreads();
  renderThread();
  toast(openThread.closed ? 'Conversation closed' : 'Conversation reopened');
});

$('#tvDelete').addEventListener('click', async () => {
  if (!openThread) return;
  if (!confirm(`Delete the whole conversation with ${openThread.name}? This cannot be undone.`)) return;

  const res = await api('POST', '/api/chat/delete', { threadId: openThreadId });
  threads = res.threads;
  openThreadId = null;
  openThread = null;
  renderThreads();
  renderThread();
  toast('Conversation deleted');
});

/* ==========================================================================
   Phone push notifications
   ========================================================================== */

const pushSupported =
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/* iPhone only allows push once the site is installed to the Home Screen. */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isInstalled =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/* Push can only reach a phone if the phone can reach the site. */
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

function base64UrlToBytes(value) {
  const padding = (4 - (value.length % 4)) % 4;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding);
  const binary = atob(base64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

async function refreshPushUi() {
  const btn = $('#pushBtn');
  const test = $('#pushTest');
  const hint = $('#pushHint');
  const sub2 = $('#pushSub');

  let devices = null;
  try { devices = (await api('GET', '/api/push/key')).devices; } catch { /* not logged in yet */ }

  sub2.textContent =
    devices === null
      ? 'Get a notification the moment someone messages you.'
      : devices === 0
        ? 'No devices are set up yet — nothing will buzz until you turn this on.'
        : `${devices} device${devices === 1 ? '' : 's'} will buzz when a customer messages you.`;

  if (isLocal) {
    btn.disabled = true;
    btn.textContent = 'Put the site online first';
    hint.innerHTML =
      'You are viewing this at <b>localhost</b>, which only exists on this computer — your phone ' +
      'has no way to reach it, and the site is only running while <b>npm start</b> is open. ' +
      'Notifications start working once the site is deployed with a real https address.';
    test.classList.add('hidden');
    return;
  }

  if (!pushSupported) {
    btn.disabled = true;
    btn.textContent = 'Not supported on this browser';
    hint.textContent = 'Try Chrome on Android, or Safari on an iPhone running iOS 16.4 or newer.';
    return;
  }

  if (isIOS && !isInstalled) {
    btn.disabled = true;
    btn.textContent = 'Add to Home Screen first';
    hint.innerHTML =
      'On iPhone, notifications only work once this page is installed. Tap <b>Share</b> in Safari, choose ' +
      '<b>Add to Home Screen</b>, open PrintPoP from your home screen, then come back to this tab.';
    return;
  }

  if (Notification.permission === 'denied') {
    btn.disabled = true;
    btn.textContent = 'Notifications are blocked';
    hint.textContent =
      'This site is blocked from sending notifications. Re-allow it in your browser settings, then reload.';
    return;
  }

  const sub = await currentSubscription();
  btn.disabled = false;

  if (sub) {
    btn.textContent = 'Turn off on this device';
    btn.classList.replace('btn-primary', 'btn-ghost');
    test.classList.remove('hidden');
    hint.textContent = 'This device will buzz when a customer messages you.';
  } else {
    btn.textContent = 'Turn on notifications';
    btn.classList.replace('btn-ghost', 'btn-primary');
    test.classList.add('hidden');
    hint.textContent = 'Do this once on every phone or computer you want alerts on.';
  }
}

$('#pushBtn').addEventListener('click', async () => {
  notice('#pushErr', '', false);
  notice('#pushOk', '', false);
  const btn = $('#pushBtn');

  try {
    btn.disabled = true;
    const existing = await currentSubscription();

    if (existing) {
      await api('POST', '/api/push/unsubscribe', { endpoint: existing.endpoint });
      await existing.unsubscribe();
      notice('#pushOk', 'Notifications turned off on this device.');
      return refreshPushUi();
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      notice('#pushErr', 'You said no to notifications. Allow them and try again.');
      return refreshPushUi();
    }

    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    const { publicKey } = await api('GET', '/api/push/key');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });

    await api('POST', '/api/push/subscribe', { subscription: { endpoint: sub.endpoint } });
    notice('#pushOk', 'Done — this device will buzz when someone messages you.');
    refreshPushUi();
  } catch (err) {
    notice('#pushErr', err.message || 'Could not switch notifications on.');
    refreshPushUi();
  } finally {
    btn.disabled = false;
  }
});

$('#pushTest').addEventListener('click', async () => {
  notice('#pushErr', '', false);
  notice('#pushOk', '', false);
  try {
    const { sent } = await api('POST', '/api/push/test');
    notice(
      '#pushOk',
      sent
        ? `Test sent to ${sent} device${sent === 1 ? '' : 's'} — check your notifications.`
        : 'No devices are registered yet.'
    );
  } catch (err) {
    notice('#pushErr', err.message);
  }
});

/* Only poll while the Messages tab is the one being looked at. */
window.$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const onMessages = tab.dataset.tab === 'messages';
    setChatPolling(onMessages);
    if (onMessages) loadThreads();
  });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.site) loadThreads();
});

/* admin.js calls this once you're logged in */
function loadMessages() {
  return loadThreads();
}
