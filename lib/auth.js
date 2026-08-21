'use strict';
/* ==========================================================================
   Password hashing + signed session cookies. No dependencies.
   ========================================================================== */
const crypto = require('node:crypto');

const SESSION_HOURS = 12;
const COOKIE = 'pp_session';

/* ---------- password hashing (scrypt) ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  let expected, actual;
  try {
    expected = Buffer.from(keyHex, 'hex');
    actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: 16384, r: 8, p: 1,
    });
  } catch {
    return false;
  }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* ---------- session tokens: base64(payload).hmac ---------- */

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createToken(secret) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600_000, n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;

  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(payload, secret));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

/* ---------- cookies ---------- */

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function sessionCookie(token, secure) {
  const bits = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${token ? SESSION_HOURS * 3600 : 0}`,
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/* ---------- brute-force throttle (in memory) ---------- */

const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60_000;

function loginAllowed(ip) {
  const rec = attempts.get(ip);
  if (!rec) return true;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(ip);
    return true;
  }
  return rec.count < MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

function clearFailures(ip) {
  attempts.delete(ip);
}

module.exports = {
  COOKIE, SESSION_HOURS,
  hashPassword, verifyPassword,
  createToken, verifyToken,
  readCookie, sessionCookie,
  loginAllowed, recordFailure, clearFailures,
};
