'use strict';
/* ==========================================================================
   Two-way conversations between a customer and the shop.

   Customers never sign up. When someone starts a chat we mint a random
   token and their browser keeps it — whoever holds the token can read and
   write that one conversation and nothing else. It is unguessable, so it
   works like a private link.
   ========================================================================== */
const crypto = require('node:crypto');
const path = require('node:path');
const store = require('./store');

const CHATS_FILE = path.join(store.DATA_DIR, 'chats.json');

const LIMITS = {
  name: 60,
  contact: 80,
  body: 1500,
  threads: 300,          // oldest conversations fall off the end
  messagesPerThread: 300,
};

function load() {
  const data = store.readJson(CHATS_FILE, null);
  return Array.isArray(data?.threads) ? data : { threads: [] };
}

function save(data) {
  store.writeAtomic(CHATS_FILE, data);
}

function newId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function message(from, body) {
  return {
    id: newId(6),
    from,                                   // 'customer' | 'shop'
    body: store.str(body, LIMITS.body),
    at: new Date().toISOString(),
  };
}

/* Constant-time compare so a wrong token can't be narrowed down by timing. */
function tokenMatches(stored, given) {
  if (typeof stored !== 'string' || typeof given !== 'string') return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- what the customer is allowed to see ---------- */

function publicView(thread) {
  return {
    id: thread.id,
    name: thread.name,
    closed: Boolean(thread.closed),
    messages: thread.messages,
  };
}

/* ---------- customer side ---------- */

function startThread({ name, contact, body }) {
  const data = load();

  const thread = {
    id: newId(8),
    token: newId(16),
    name: store.str(name, LIMITS.name),
    contact: store.str(contact, LIMITS.contact),
    createdAt: new Date().toISOString(),
    lastAt: new Date().toISOString(),
    adminUnread: 1,
    customerUnread: 0,
    closed: false,
    messages: [message('customer', body)],
  };

  data.threads.unshift(thread);
  data.threads = data.threads.slice(0, LIMITS.threads);
  save(data);

  return { threadId: thread.id, token: thread.token, thread: publicView(thread) };
}

function findThread(data, threadId, token) {
  const thread = data.threads.find((t) => t.id === threadId);
  if (!thread || !tokenMatches(thread.token, token)) return null;
  return thread;
}

function customerSend(threadId, token, body) {
  const data = load();
  const thread = findThread(data, threadId, token);
  if (!thread) return null;
  if (thread.closed) return { error: 'This conversation has been closed.' };

  thread.messages.push(message('customer', body));
  thread.messages = thread.messages.slice(-LIMITS.messagesPerThread);
  thread.lastAt = new Date().toISOString();
  thread.adminUnread += 1;

  // Move it back to the top of the shop's list.
  data.threads = [thread, ...data.threads.filter((t) => t.id !== thread.id)];
  save(data);

  return { thread: publicView(thread) };
}

/* Reading their own conversation clears their unread marker. */
function customerRead(threadId, token) {
  const data = load();
  const thread = findThread(data, threadId, token);
  if (!thread) return null;

  if (thread.customerUnread) {
    thread.customerUnread = 0;
    save(data);
  }
  return publicView(thread);
}

/* ---------- shop side ---------- */

function listThreads() {
  const data = load();
  return data.threads.map((t) => ({
    id: t.id,
    name: t.name,
    contact: t.contact,
    createdAt: t.createdAt,
    lastAt: t.lastAt,
    adminUnread: t.adminUnread,
    closed: Boolean(t.closed),
    messageCount: t.messages.length,
    preview: t.messages[t.messages.length - 1]?.body.slice(0, 90) ?? '',
    lastFrom: t.messages[t.messages.length - 1]?.from ?? 'customer',
  }));
}

function getThread(threadId) {
  const thread = load().threads.find((t) => t.id === threadId);
  return thread ? { ...thread, token: undefined } : null;
}

function openThread(threadId) {
  const data = load();
  const thread = data.threads.find((t) => t.id === threadId);
  if (!thread) return null;

  thread.adminUnread = 0;
  save(data);
  return { ...thread, token: undefined };
}

function shopReply(threadId, body) {
  const data = load();
  const thread = data.threads.find((t) => t.id === threadId);
  if (!thread) return null;

  thread.messages.push(message('shop', body));
  thread.messages = thread.messages.slice(-LIMITS.messagesPerThread);
  thread.lastAt = new Date().toISOString();
  thread.adminUnread = 0;
  thread.customerUnread += 1;
  save(data);

  return { ...thread, token: undefined };
}

function setClosed(threadId, closed) {
  const data = load();
  const thread = data.threads.find((t) => t.id === threadId);
  if (!thread) return null;

  thread.closed = Boolean(closed);
  save(data);
  return { ...thread, token: undefined };
}

function deleteThread(threadId) {
  const data = load();
  const before = data.threads.length;
  data.threads = data.threads.filter((t) => t.id !== threadId);
  if (data.threads.length === before) return false;
  save(data);
  return true;
}

function unreadCount() {
  return load().threads.reduce((sum, t) => sum + (t.adminUnread ? 1 : 0), 0);
}

module.exports = {
  LIMITS,
  startThread, customerSend, customerRead,
  listThreads, getThread, openThread, shopReply, setClosed, deleteThread,
  unreadCount,
};
