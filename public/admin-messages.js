/* ==========================================================================
   PrintPoP 3D admin — customer inbox and phone notifications.
   Loaded after admin.js, so it reuses $, api(), toast(), notice(), escapeHtml.
   ========================================================================== */

let messages = [];

function timeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
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

  // A local number ("03 445 221") needs its leading 0 swapped for the country code.
  if (digits.startsWith('0')) digits = cc + digits.replace(/^0+/, '');
  // A bare local number with no prefix at all ("70123456").
  else if (digits.length <= 8) digits = cc + digits;

  return `<a href="https://wa.me/${digits}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`;
}

function renderMessages() {
  const host = $('#msgList');
  const unread = messages.filter((m) => !m.read).length;

  const badge = $('#msgBadge');
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);

  $('#msgCount').textContent = messages.length
    ? `${messages.length} message${messages.length === 1 ? '' : 's'}${unread ? ` · ${unread} unread` : ''}`
    : 'No messages yet';
  $('#markAll').disabled = unread === 0;

  if (!messages.length) {
    host.innerHTML = '<div class="msg-empty">Nothing yet. Messages sent from your shop page land here.</div>';
    return;
  }

  host.innerHTML = messages
    .map(
      (m) => `
      <div class="inbox-item${m.read ? '' : ' unread'}" data-id="${escapeHtml(m.id)}">
        <div class="msg-head">
          <b>${escapeHtml(m.name)}</b>
          <span class="when">${timeAgo(m.createdAt)}</span>
        </div>
        <div class="msg-contact">${contactLink(m.contact)}</div>
        <div class="msg-body">${escapeHtml(m.body)}</div>
        <div class="msg-actions">
          <button class="btn btn-ghost btn-sm js-read">${m.read ? 'Mark unread' : 'Mark read'}</button>
          <button class="btn btn-danger btn-sm js-del">Delete</button>
        </div>
      </div>`
    )
    .join('');

  host.querySelectorAll('.inbox-item').forEach((el) => {
    const id = el.dataset.id;
    const current = messages.find((m) => m.id === id);

    el.querySelector('.js-read').addEventListener('click', async () => {
      const res = await api('POST', '/api/messages/read', { id, read: !current.read });
      messages = res.messages;
      renderMessages();
    });

    el.querySelector('.js-del').addEventListener('click', async () => {
      if (!confirm(`Delete the message from ${current.name}?`)) return;
      const res = await api('POST', '/api/messages/delete', { id });
      messages = res.messages;
      renderMessages();
      toast('Message deleted');
    });
  });
}

async function loadMessages() {
  try {
    const res = await api('GET', '/api/messages');
    messages = res.messages;
    renderMessages();
  } catch {
    /* not fatal — the rest of the admin keeps working */
  }
}

$('#markAll').addEventListener('click', async () => {
  const res = await api('POST', '/api/messages/read', { all: true });
  messages = res.messages;
  renderMessages();
});

$('#refreshMsgs').addEventListener('click', async () => {
  await loadMessages();
  toast('Refreshed');
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

/* Push can only reach a phone if the phone can reach the site. */
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

async function refreshPushUi() {
  const btn = $('#pushBtn');
  const test = $('#pushTest');
  const hint = $('#pushHint');
  const sub2 = $('#pushSub');

  // How many devices the server thinks are listening.
  let devices = null;
  try { devices = (await api('GET', '/api/push/key')).devices; } catch { /* not logged in yet */ }
  sub2.textContent = devices === null
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

/* Pick up new messages when you come back to the tab. */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && site) loadMessages();
});
