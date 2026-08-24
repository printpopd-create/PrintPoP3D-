'use strict';
/* ==========================================================================
   Web Push notifications, written against the raw protocol so there are
   still no npm packages to install.

   We deliberately send an EMPTY push (no payload). Encrypting a payload
   would mean implementing ECDH + HKDF + AES-GCM by hand for very little
   gain — the phone only needs to know "something arrived", and the service
   worker shows the banner. It also means a stolen push endpoint leaks
   nothing about the message.
   ========================================================================== */
const crypto = require('node:crypto');
const https = require('node:https');
const { URL } = require('node:url');

const JWT_HOURS = 11; // push services reject anything over 24h

/* ---------- VAPID identity ---------- */

function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  // The public key travels as the raw 65-byte uncompressed point.
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const raw = spki.subarray(spki.length - 65);

  return {
    publicKey: raw.toString('base64url'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

function privateKeyFrom(base64) {
  return crypto.createPrivateKey({
    key: Buffer.from(base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

/* ---------- signed VAPID token ---------- */

function vapidToken(audience, keys, subject) {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + JWT_HOURS * 3600,
      sub: subject,
    })
  ).toString('base64url');

  const signed = `${header}.${body}`;
  // JWT wants the raw r||s pair, not the DER wrapper Node defaults to.
  const signature = crypto
    .createSign('SHA256')
    .update(signed)
    .sign({ key: privateKeyFrom(keys.privateKey), dsaEncoding: 'ieee-p1363' });

  return `${signed}.${signature.toString('base64url')}`;
}

/* ---------- delivery ---------- */

/* Resolves to 'sent', or 'gone' when the phone has unsubscribed and the
   caller should forget this endpoint. */
function sendOne(subscription, keys, subject) {
  return new Promise((resolve) => {
    let endpoint;
    try {
      endpoint = new URL(subscription.endpoint);
    } catch {
      return resolve('gone');
    }
    if (endpoint.protocol !== 'https:') return resolve('gone');

    const token = vapidToken(endpoint.origin, keys, subject);

    const req = https.request(
      {
        hostname: endpoint.hostname,
        port: 443,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers: {
          Authorization: `vapid t=${token}, k=${keys.publicKey}`,
          TTL: '86400',
          Urgency: 'high',
          'Content-Length': 0,
        },
        timeout: 10_000,
      },
      (res) => {
        res.resume();
        // 404/410 mean the browser threw the subscription away.
        resolve(res.statusCode === 404 || res.statusCode === 410 ? 'gone' : 'sent');
      }
    );

    req.on('error', () => resolve('error'));
    req.on('timeout', () => { req.destroy(); resolve('error'); });
    req.end();
  });
}

/* Pings every registered device. Returns the endpoints that are dead so the
   store can drop them. */
async function notifyAll(subscriptions, keys, subject = 'mailto:noreply@printpop3d.app') {
  if (!keys?.publicKey || !subscriptions.length) return { sent: 0, dead: [] };

  const results = await Promise.all(subscriptions.map((sub) => sendOne(sub, keys, subject)));

  return {
    sent: results.filter((r) => r === 'sent').length,
    dead: subscriptions.filter((_, i) => results[i] === 'gone').map((s) => s.endpoint),
  };
}

module.exports = { generateVapidKeys, notifyAll };
