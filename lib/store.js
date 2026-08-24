'use strict';
/* ==========================================================================
   Site content + admin credentials, stored as JSON on disk.
   Writes are atomic (temp file + rename) so a crash mid-save can't corrupt.
   ========================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const push = require('./push');

/* Hosts that mount a volume elsewhere can point DATA_DIR at it. */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const SITE_FILE = path.join(DATA_DIR, 'site.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const PUSH_FILE = path.join(DATA_DIR, 'push.json');

const MAX = { name: 80, desc: 400, spec: 40, text: 600, handle: 60, products: 60, specs: 6, badges: 6 };

/* Stock states a product can be in. */
const STATUSES = ['in_stock', 'sold_out', 'preorder'];
const STATUS_LABELS = { in_stock: 'In stock', sold_out: 'Sold out', preorder: 'Pre-order' };

const MSG = { name: 60, contact: 80, body: 1200, keep: 500 };

/* ---------- the content Taym starts with ---------- */

const DEFAULT_SITE = {
  settings: {
    brandName: 'PrintPoP 3D',
    taglineA: 'Design it.',
    taglineB: 'Print it.',
    taglineC: 'Love it.',
    heroText:
      'Custom and ready-made 3D printed fidgets, toys and gifts — made to order in Lebanon. ' +
      'Pick something below, send us a DM, and we start printing.',
    currency: '$',
    tiktok: 'printpop3d1',
    instagram: 'printpop3d',
    whatsapp: '',
    whatsappEnabled: false,
    countryCode: '961',
    badges: ['🎨 Any color you want', '⚡ Printed in 1–3 days', '🇱🇧 Made in Lebanon', '💬 Order by DM'],
    shopHeading: 'Fidgets, *ready to print*',
    shopText:
      'Every piece is printed fresh in the color you choose. Tap a button, your message gets copied, ' +
      'paste it in our DMs.',
    customHeading: "Got an idea? *We'll print it.*",
    customText:
      'Name keychains, phone stands, cosplay props, replacement parts, gifts, your own 3D file — ' +
      "if it fits on the bed, we can make it. Send us a photo or a sketch and we'll quote you a price.",
    stepsHeading: 'From DM to *your hands*',
    steps: [
      { title: 'Send us a DM', text: "Tap any button on this page. Tell us what you want and which color — that's the whole order form." },
      { title: 'We confirm & print', text: 'We reply with the price and timing, then start printing. Most fidgets are done within 1–3 days.' },
      { title: 'Pick up or delivery', text: 'Meet up locally or we arrange delivery anywhere in Lebanon. Pay on delivery.' },
    ],
    bundleEnabled: true,
    bundleTitle: 'Fidget Starter Pack 🎁',
    bundleText: 'All three — Flexi Dragon, Infinity Cube and Fidget Slider — in the colors you pick.',
    bundlePrice: '27',
    bundleCompare: '30',
    footerNote: 'Made in Lebanon 🇱🇧',
    contactFormEnabled: true,
    contactHeading: 'Or just *send us a message*',
    contactText: "Not on Instagram or WhatsApp? Leave your details here and we'll get back to you.",
  },
  products: [
    {
      id: 'p-dragon',
      name: 'Flexi Dragon',
      desc: "Printed in one piece with 30+ moving joints — it slinks, curls and wraps around your wrist. The one everyone picks up and won't put down.",
      price: '12',
      unit: 'each',
      tag: 'Best seller',
      specs: ['~18 cm long', 'Fully articulated', '10+ colors'],
      image: '/assets/products/flexi-dragon.svg',
      status: 'in_stock',
      hidden: false,
    },
    {
      id: 'p-cube',
      name: 'Infinity Cube',
      desc: 'Eight linked cubes that fold over and over, forever. Silent, pocket-sized, and impossible to stop flipping in class or at your desk.',
      price: '10',
      unit: 'each',
      tag: 'Pocket size',
      specs: ['5 × 5 cm', 'Folds endlessly', 'Dual color option'],
      image: '/assets/products/infinity-cube.svg',
      status: 'in_stock',
      hidden: false,
    },
    {
      id: 'p-slider',
      name: 'Fidget Slider',
      desc: 'A weighted puck that snaps side to side with a clean, crisp click. Slim enough to live in your pocket and built to take a beating.',
      price: '8',
      unit: 'each',
      tag: 'Most satisfying',
      specs: ['Crisp click', 'One-hand use', '10+ colors'],
      image: '/assets/products/fidget-slider.svg',
      status: 'in_stock',
      hidden: false,
    },
  ],
};

/* ---------- helpers ---------- */

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function writeAtomic(file, value) {
  ensureDirs();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/* Trim, cap length, and strip control characters so nothing weird lands in the page. */
function str(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

/* Prices stay strings so "12", "12.50" and "" all behave predictably. */
function price(value) {
  const cleaned = str(value, 12).replace(/[^0-9.,]/g, '');
  return cleaned.slice(0, 12);
}

/* Only allow images we serve ourselves — never an arbitrary remote URL. */
function imagePath(value) {
  const s = str(value, 200);
  return /^\/(assets|uploads)\/[A-Za-z0-9._\-/]+$/.test(s) && !s.includes('..') ? s : '';
}

function handle(value, max = MAX.handle) {
  return str(value, max).replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '');
}

/* ---------- validation ---------- */

function cleanProduct(raw, index) {
  const specs = Array.isArray(raw?.specs)
    ? raw.specs.map((s) => str(s, MAX.spec)).filter(Boolean).slice(0, MAX.specs)
    : [];

  return {
    id: str(raw?.id, 40) || `p-${crypto.randomBytes(6).toString('hex')}`,
    name: str(raw?.name, MAX.name) || `Product ${index + 1}`,
    desc: str(raw?.desc, MAX.desc),
    price: price(raw?.price),
    unit: str(raw?.unit, 24),
    tag: str(raw?.tag, 30),
    specs,
    image: imagePath(raw?.image),
    status: STATUSES.includes(raw?.status) ? raw.status : 'in_stock',
    hidden: bool(raw?.hidden),
  };
}

function cleanSite(raw) {
  const d = DEFAULT_SITE.settings;
  const s = raw?.settings ?? {};

  const steps = Array.isArray(s.steps) ? s.steps : d.steps;
  const badges = Array.isArray(s.badges) ? s.badges : d.badges;

  return {
    settings: {
      brandName: str(s.brandName, MAX.name, d.brandName) || d.brandName,
      taglineA: str(s.taglineA, 40, d.taglineA),
      taglineB: str(s.taglineB, 40, d.taglineB),
      taglineC: str(s.taglineC, 40, d.taglineC),
      heroText: str(s.heroText, MAX.text, d.heroText),
      currency: str(s.currency, 4, d.currency) || '$',
      tiktok: handle(s.tiktok),
      instagram: handle(s.instagram),
      whatsapp: str(s.whatsapp, 20).replace(/[^0-9]/g, ''),
      whatsappEnabled: bool(s.whatsappEnabled),
      countryCode: str(s.countryCode, 4).replace(/[^0-9]/g, '') || d.countryCode,
      badges: badges.map((b) => str(b, 60)).filter(Boolean).slice(0, MAX.badges),
      shopHeading: str(s.shopHeading, MAX.name, d.shopHeading),
      shopText: str(s.shopText, MAX.text, d.shopText),
      customHeading: str(s.customHeading, MAX.name, d.customHeading),
      customText: str(s.customText, MAX.text, d.customText),
      stepsHeading: str(s.stepsHeading, MAX.name, d.stepsHeading),
      steps: steps.slice(0, 4).map((st, i) => ({
        title: str(st?.title, MAX.name, d.steps[i]?.title ?? ''),
        text: str(st?.text, MAX.text, d.steps[i]?.text ?? ''),
      })),
      bundleEnabled: bool(s.bundleEnabled, d.bundleEnabled),
      bundleTitle: str(s.bundleTitle, MAX.name, d.bundleTitle),
      bundleText: str(s.bundleText, MAX.text, d.bundleText),
      bundlePrice: price(s.bundlePrice),
      bundleCompare: price(s.bundleCompare),
      footerNote: str(s.footerNote, 120, d.footerNote),
      contactFormEnabled: bool(s.contactFormEnabled, d.contactFormEnabled),
      contactHeading: str(s.contactHeading, MAX.name, d.contactHeading),
      contactText: str(s.contactText, MAX.text, d.contactText),
    },
    products: (Array.isArray(raw?.products) ? raw.products : [])
      .slice(0, MAX.products)
      .map(cleanProduct),
  };
}

/* ---------- public API ---------- */

function getSite() {
  const stored = readJson(SITE_FILE, null);
  if (!stored) {
    const seeded = cleanSite(DEFAULT_SITE);
    writeAtomic(SITE_FILE, seeded);
    return seeded;
  }
  return cleanSite(stored);
}

function saveSite(raw) {
  const clean = cleanSite(raw);
  writeAtomic(SITE_FILE, clean);
  return clean;
}

function resetSite() {
  const seeded = cleanSite(DEFAULT_SITE);
  writeAtomic(SITE_FILE, seeded);
  return seeded;
}

function getAdmin() {
  return readJson(ADMIN_FILE, null);
}

function saveAdmin(passwordHash) {
  const existing = getAdmin();
  writeAtomic(ADMIN_FILE, {
    passwordHash,
    secret: existing?.secret ?? crypto.randomBytes(32).toString('hex'),
    updatedAt: new Date().toISOString(),
  });
}

/* ==========================================================================
   Customer messages
   ========================================================================== */

function getMessages() {
  const list = readJson(MESSAGES_FILE, []);
  return Array.isArray(list) ? list : [];
}

function addMessage(raw) {
  const message = {
    id: crypto.randomBytes(8).toString('hex'),
    name: str(raw?.name, MSG.name),
    contact: str(raw?.contact, MSG.contact),
    body: str(raw?.body, MSG.body),
    createdAt: new Date().toISOString(),
    read: false,
  };

  // Newest first, and never let the file grow without bound.
  const list = [message, ...getMessages()].slice(0, MSG.keep);
  writeAtomic(MESSAGES_FILE, list);
  return message;
}

function markMessage(id, read) {
  const list = getMessages();
  const found = list.find((m) => m.id === id);
  if (!found) return null;
  found.read = Boolean(read);
  writeAtomic(MESSAGES_FILE, list);
  return found;
}

function markAllRead() {
  const list = getMessages();
  list.forEach((m) => { m.read = true; });
  writeAtomic(MESSAGES_FILE, list);
  return list;
}

function deleteMessage(id) {
  const list = getMessages();
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  writeAtomic(MESSAGES_FILE, next);
  return true;
}

function unreadCount() {
  return getMessages().filter((m) => !m.read).length;
}

/* ==========================================================================
   Push notification devices
   ========================================================================== */

/* The VAPID keypair is this site's identity to the push services. It is
   created once, on demand, and must never change or every phone already
   subscribed goes silent. */
function getPush() {
  const stored = readJson(PUSH_FILE, null);
  if (stored?.keys?.publicKey) {
    return { keys: stored.keys, subs: Array.isArray(stored.subs) ? stored.subs : [] };
  }
  const fresh = { keys: push.generateVapidKeys(), subs: [] };
  writeAtomic(PUSH_FILE, fresh);
  return fresh;
}

function addSubscription(sub) {
  if (typeof sub?.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return false;

  const state = getPush();
  if (state.subs.some((s) => s.endpoint === sub.endpoint)) return true; // already known

  state.subs.push({ endpoint: sub.endpoint.slice(0, 600), createdAt: new Date().toISOString() });
  writeAtomic(PUSH_FILE, state);
  return true;
}

function removeSubscriptions(endpoints) {
  const list = Array.isArray(endpoints) ? endpoints : [endpoints];
  if (!list.length) return;

  const state = getPush();
  state.subs = state.subs.filter((s) => !list.includes(s.endpoint));
  writeAtomic(PUSH_FILE, state);
}

/* Fire-and-forget: a failed notification must never block saving a message. */
async function notifyDevices() {
  const state = getPush();
  try {
    const { sent, dead } = await push.notifyAll(state.subs, state.keys);
    if (dead.length) removeSubscriptions(dead);
    return sent;
  } catch {
    return 0;
  }
}

module.exports = {
  DATA_DIR, UPLOAD_DIR, MAX,
  readJson, writeAtomic, str,
  getSite, saveSite, resetSite,
  getAdmin, saveAdmin,
  ensureDirs,
  STATUSES, STATUS_LABELS,
  getMessages, addMessage, markMessage, markAllRead, deleteMessage, unreadCount,
  getPush, addSubscription, removeSubscriptions, notifyDevices,
};
