'use strict';
/* ==========================================================================
   PrintPoP 3D — storefront + admin API.
   Plain Node, no npm packages to install or keep updated.
   ========================================================================== */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const store = require('./lib/store');
const chat = require('./lib/chat');
const auth = require('./lib/auth');
const { escapeHtml, sendJson, sendText, readJsonBody, resolveInside, serveFile } = require('./lib/http');
const { render } = require('./lib/render');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const BODY_LIMIT = 512 * 1024;        // site content
const UPLOAD_LIMIT = 6 * 1024 * 1024; // one image, base64-encoded
const MIN_PASSWORD = 8;

/* Browsers won't send a custom header cross-origin without CORS approval,
   which we never grant — so requiring one blocks CSRF. */
const CSRF_HEADER = 'x-printpop-admin';

/* ---------- image handling ---------- */

const IMAGE_TYPES = [
  { ext: '.jpg', mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { ext: '.png', mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: '.gif', mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
];

/* Trust the bytes, not the label the browser sent. */
function sniffImage(buf) {
  for (const type of IMAGE_TYPES) {
    if (type.magic.every((byte, i) => buf[i] === byte)) return type;
  }
  // WebP is "RIFF" .... "WEBP"
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    return { ext: '.webp', mime: 'image/webp' };
  }
  return null;
}


/* ---------- message flood protection ---------- */

const msgHits = new Map();
const MSG_WINDOW_MS = 10 * 60_000;
const MSG_MAX = 5;

function messageAllowed(ip) {
  const rec = msgHits.get(ip);
  if (!rec || Date.now() - rec.first > MSG_WINDOW_MS) return true;
  return rec.count < MSG_MAX;
}

/* Only messages we actually keep count against the limit, so somebody
   fumbling the form doesn't get locked out of their own enquiry. */
function recordMessage(ip) {
  const rec = msgHits.get(ip);
  if (!rec || Date.now() - rec.first > MSG_WINDOW_MS) {
    msgHits.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count += 1;
  }
}

/* Tell every registered phone that a customer wrote in. Never awaited —
   a push failure must not stop the message being saved. */
function announce(who) {
  const devices = store.getPush().subs.length;
  if (!devices) {
    console.log(`[chat] message from ${who} — no devices registered, nothing sent`);
    return;
  }
  store.notifyDevices().then((sent) =>
    console.log(`[chat] message from ${who} — notified ${sent}/${devices} device(s)`)
  );
}

/* ---------- helpers ---------- */

function isAuthed(req) {
  const admin = store.getAdmin();
  if (!admin?.secret) return false;
  return auth.verifyToken(auth.readCookie(req, auth.COOKIE), admin.secret);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* Only mark the cookie Secure when the connection really is HTTPS,
   otherwise the browser drops it during local testing. */
function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
}

function requireAdmin(req, res) {
  if (req.headers[CSRF_HEADER] !== '1') {
    sendJson(res, 403, { error: 'Blocked. Refresh the admin page and try again.' });
    return false;
  }
  if (!isAuthed(req)) {
    sendJson(res, 401, { error: 'Please log in again.' });
    return false;
  }
  return true;
}

/* ---------- API ---------- */

async function handleApi(req, res, route) {
  const method = req.method;

  if (route === '/api/status' && method === 'GET') {
    return sendJson(res, 200, {
      needsSetup: !store.getAdmin(),
      authed: isAuthed(req),
    });
  }

  if (route === '/api/site' && method === 'GET') {
    return sendJson(res, 200, store.getSite());
  }

  /* --- first run: choose a password --- */
  if (route === '/api/setup' && method === 'POST') {
    if (store.getAdmin()) return sendJson(res, 409, { error: 'A password is already set.' });

    const { password } = await readJsonBody(req, 4096);
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return sendJson(res, 400, { error: `Password must be at least ${MIN_PASSWORD} characters.` });
    }

    store.saveAdmin(auth.hashPassword(password));
    const token = auth.createToken(store.getAdmin().secret);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(token, isSecure(req)) });
  }

  if (route === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    if (!auth.loginAllowed(ip)) {
      return sendJson(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
    }

    const admin = store.getAdmin();
    const { password } = await readJsonBody(req, 4096);

    if (!admin || typeof password !== 'string' || !auth.verifyPassword(password, admin.passwordHash)) {
      auth.recordFailure(ip);
      return sendJson(res, 401, { error: 'Wrong password.' });
    }

    auth.clearFailures(ip);
    const token = auth.createToken(admin.secret);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(token, isSecure(req)) });
  }

  if (route === '/api/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie('', isSecure(req)) });
  }


  /* --- a customer sends a message (public, throttled) --- */
  if (route === '/api/message' && method === 'POST') {
    const site = store.getSite();
    if (!site.settings.contactFormEnabled) {
      return sendJson(res, 403, { error: 'The message form is switched off.' });
    }

    if (!messageAllowed(clientIp(req))) {
      return sendJson(res, 429, { error: "You've sent a few already — try again a bit later." });
    }

    const body = await readJsonBody(req, 32 * 1024);

    // Hidden field real people never see, let alone fill in.
    if (typeof body.website === 'string' && body.website.trim()) {
      return sendJson(res, 200, { ok: true }); // quietly swallow the bot
    }

    const name = String(body.name ?? '').trim();
    const contact = String(body.contact ?? '').trim();
    const text = String(body.body ?? '').trim();

    if (name.length < 2) return sendJson(res, 400, { error: 'Please tell us your name.' });
    if (contact.length < 3) return sendJson(res, 400, { error: 'Please leave a phone number or Instagram handle.' });
    if (text.length < 5) return sendJson(res, 400, { error: 'Please write your message.' });

    store.addMessage({ name, contact, body: text });
    recordMessage(clientIp(req));

    // Not awaited — a push failure must never stop a message being saved.
    // Logged so the reason is visible in the host's logs.
    const devices = store.getPush().subs.length;
    if (!devices) {
      console.log(`[message] from ${name} — no devices registered, no notification sent`);
    } else {
      store.notifyDevices().then((sent) =>
        console.log(`[message] from ${name} — notified ${sent}/${devices} device(s)`)
      );
    }

    return sendJson(res, 200, { ok: true });
  }


  /* ======================= CHAT: customer side ======================= */

  /* Starting a conversation mints a token their browser keeps. */
  if (route === '/api/chat/start' && method === 'POST') {
    if (!store.getSite().settings.contactFormEnabled) {
      return sendJson(res, 403, { error: 'Chat is switched off right now.' });
    }
    if (!messageAllowed(clientIp(req))) {
      return sendJson(res, 429, { error: "You've sent a few already — try again a bit later." });
    }

    const body = await readJsonBody(req, 32 * 1024);
    if (typeof body.website === 'string' && body.website.trim()) {
      return sendJson(res, 200, { threadId: 'ignored', token: 'ignored', thread: { messages: [] } });
    }

    const name = String(body.name ?? '').trim();
    const contact = String(body.contact ?? '').trim();
    const text = String(body.body ?? '').trim();

    if (name.length < 2) return sendJson(res, 400, { error: 'Please tell us your name.' });
    if (contact.length < 3) return sendJson(res, 400, { error: 'Please leave a phone number or Instagram handle.' });
    if (text.length < 2) return sendJson(res, 400, { error: 'Please write your message.' });

    const started = chat.startThread({ name, contact, body: text });
    recordMessage(clientIp(req));
    announce(name);

    return sendJson(res, 200, started);
  }

  if (route === '/api/chat/send' && method === 'POST') {
    const { threadId, token, body } = await readJsonBody(req, 32 * 1024);
    const text = String(body ?? '').trim();
    if (text.length < 1) return sendJson(res, 400, { error: 'Type something first.' });

    if (!messageAllowed(clientIp(req))) {
      return sendJson(res, 429, { error: 'Slow down a moment, then try again.' });
    }

    const result = chat.customerSend(String(threadId ?? ''), String(token ?? ''), text);
    if (!result) return sendJson(res, 404, { error: 'This conversation no longer exists.' });
    if (result.error) return sendJson(res, 403, result);

    recordMessage(clientIp(req));
    announce(result.thread.name);

    return sendJson(res, 200, result);
  }

  /* Polled by the customer's open chat window. */
  if (route === '/api/chat/poll' && method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const thread = chat.customerRead(
      url.searchParams.get('threadId') ?? '',
      url.searchParams.get('token') ?? ''
    );
    if (!thread) return sendJson(res, 404, { error: 'This conversation no longer exists.' });
    return sendJson(res, 200, thread);
  }

  /* ======================= CHAT: shop side ======================= */

  if (route === '/api/chat/threads' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { threads: chat.listThreads(), unread: chat.unreadCount() });
  }

  if (route === '/api/chat/open' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { threadId } = await readJsonBody(req, 4096);
    const thread = chat.openThread(String(threadId ?? ''));
    if (!thread) return sendJson(res, 404, { error: 'Conversation not found.' });
    return sendJson(res, 200, { thread, threads: chat.listThreads(), unread: chat.unreadCount() });
  }

  if (route === '/api/chat/reply' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { threadId, body } = await readJsonBody(req, 32 * 1024);
    const text = String(body ?? '').trim();
    if (!text) return sendJson(res, 400, { error: 'Type a reply first.' });

    const thread = chat.shopReply(String(threadId ?? ''), text);
    if (!thread) return sendJson(res, 404, { error: 'Conversation not found.' });
    return sendJson(res, 200, { thread, threads: chat.listThreads(), unread: chat.unreadCount() });
  }

  if (route === '/api/chat/close' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { threadId, closed } = await readJsonBody(req, 4096);
    const thread = chat.setClosed(String(threadId ?? ''), closed !== false);
    if (!thread) return sendJson(res, 404, { error: 'Conversation not found.' });
    return sendJson(res, 200, { thread, threads: chat.listThreads(), unread: chat.unreadCount() });
  }

  if (route === '/api/chat/delete' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { threadId } = await readJsonBody(req, 4096);
    chat.deleteThread(String(threadId ?? ''));
    return sendJson(res, 200, { threads: chat.listThreads(), unread: chat.unreadCount() });
  }

  /* --- the public key a phone needs in order to subscribe --- */
  if (route === '/api/push/key' && method === 'GET') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Please log in again.' });
    const state = store.getPush();
    return sendJson(res, 200, { publicKey: state.keys.publicKey, devices: state.subs.length });
  }

  if (route === '/api/messages' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { messages: store.getMessages(), unread: store.unreadCount() });
  }

  if (route === '/api/messages/unread' && method === 'GET') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Please log in again.' });
    return sendJson(res, 200, { unread: store.unreadCount() });
  }

  if (route === '/api/messages/read' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { id, all, read } = await readJsonBody(req, 4096);
    if (all) return sendJson(res, 200, { messages: store.markAllRead(), unread: 0 });
    store.markMessage(String(id ?? ''), read !== false);
    return sendJson(res, 200, { messages: store.getMessages(), unread: store.unreadCount() });
  }

  if (route === '/api/messages/delete' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { id } = await readJsonBody(req, 4096);
    store.deleteMessage(String(id ?? ''));
    return sendJson(res, 200, { messages: store.getMessages(), unread: store.unreadCount() });
  }

  if (route === '/api/push/subscribe' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { subscription } = await readJsonBody(req, 16 * 1024);
    if (!store.addSubscription(subscription)) {
      return sendJson(res, 400, { error: "That device couldn't be registered." });
    }
    return sendJson(res, 200, { ok: true, devices: store.getPush().subs.length });
  }

  if (route === '/api/push/unsubscribe' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { endpoint } = await readJsonBody(req, 16 * 1024);
    store.removeSubscriptions(String(endpoint ?? ''));
    return sendJson(res, 200, { ok: true, devices: store.getPush().subs.length });
  }

  if (route === '/api/push/test' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const sent = await store.notifyDevices();
    return sendJson(res, 200, { sent });
  }

  /* --- everything below needs a login --- */

  if (route === '/api/site' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    const body = await readJsonBody(req, BODY_LIMIT);
    return sendJson(res, 200, store.saveSite(body));
  }

  if (route === '/api/upload' && method === 'POST') {
    if (!requireAdmin(req, res)) return;

    const { dataUrl } = await readJsonBody(req, UPLOAD_LIMIT + 1024);
    if (typeof dataUrl !== 'string') return sendJson(res, 400, { error: 'No image received.' });

    const comma = dataUrl.indexOf(',');
    if (comma === -1 || !dataUrl.startsWith('data:image/')) {
      return sendJson(res, 400, { error: 'That file is not an image.' });
    }

    const buf = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    if (!buf.length) return sendJson(res, 400, { error: 'That image is empty.' });
    if (buf.length > UPLOAD_LIMIT) return sendJson(res, 413, { error: 'That image is too big (max 6 MB).' });

    const type = sniffImage(buf);
    if (!type) return sendJson(res, 400, { error: 'Only JPG, PNG, WEBP or GIF images work.' });

    store.ensureDirs();
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}${type.ext}`;
    fs.writeFileSync(path.join(store.UPLOAD_DIR, name), buf);
    return sendJson(res, 200, { url: `/uploads/${name}` });
  }

  if (route === '/api/password' && method === 'POST') {
    if (!requireAdmin(req, res)) return;

    const { current, next } = await readJsonBody(req, 4096);
    const admin = store.getAdmin();
    if (!auth.verifyPassword(String(current ?? ''), admin.passwordHash)) {
      return sendJson(res, 401, { error: 'Current password is wrong.' });
    }
    if (typeof next !== 'string' || next.length < MIN_PASSWORD) {
      return sendJson(res, 400, { error: `New password must be at least ${MIN_PASSWORD} characters.` });
    }

    store.saveAdmin(auth.hashPassword(next));
    return sendJson(res, 200, { ok: true });
  }

  if (route === '/api/reset' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, store.resetSite());
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  let route;
  try {
    route = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return sendText(res, 400, 'Bad request');
  }

  try {
    if (route.startsWith('/api/')) return await handleApi(req, res, route);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method not allowed');
    }

    /* storefront */
    if (route === '/' || route === '/index.html') {
      const html = render(store.getSite());
      return sendText(res, 200, html, 'text/html; charset=utf-8');
    }

    /* admin page */
    if (route === '/admin' || route === '/admin/') {
      if (serveFile(res, path.join(PUBLIC_DIR, 'admin.html'), { cache: 'no-store' })) return;
      return sendText(res, 404, 'Admin page missing');
    }

    /* uploaded photos */
    if (route.startsWith('/uploads/')) {
      const file = resolveInside(store.UPLOAD_DIR, route.slice('/uploads'.length));
      if (file && serveFile(res, file)) return;
      return sendText(res, 404, 'Not found');
    }

    /* everything else in public/ */
    const file = resolveInside(PUBLIC_DIR, route);
    if (file && serveFile(res, file)) return;

    return sendText(
      res,
      404,
      `<!doctype html><meta charset="utf-8"><title>Not found</title>
       <body style="background:#05060A;color:#F5F7FF;font-family:system-ui;text-align:center;padding:80px">
       <h1>Page not found</h1><p><a style="color:#22D3EE" href="/">Back to ${escapeHtml(store.getSite().settings.brandName)}</a></p>`,
      'text/html; charset=utf-8'
    );
  } catch (err) {
    const status = err?.status ?? 500;
    if (status === 500) console.error('[error]', err);
    if (res.headersSent) return res.end();
    return sendJson(res, status, { error: status === 500 ? 'Something went wrong.' : err.message });
  }
});

store.ensureDirs();
store.getSite();

server.listen(PORT, HOST, () => {
  console.log(`\n  PrintPoP 3D is running`);
  console.log(`  Shop   →  http://localhost:${PORT}`);
  console.log(`  Admin  →  http://localhost:${PORT}/admin`);
  console.log(store.getAdmin() ? '' : '  (first visit to /admin will ask you to choose a password)\n');
});
