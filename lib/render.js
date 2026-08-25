'use strict';
/* ==========================================================================
   Renders the storefront on the server from the saved site data, so the shop
   works with JavaScript switched off and search engines see real content.
   ========================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('./http');

const TEMPLATE = path.join(__dirname, '..', 'public', 'index.html');

/* Text wrapped in *stars* becomes glowing gradient text. Escaping happens
   first, so a customer-visible star is the only thing that can trigger it. */
function highlight(text) {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, '<span class="grad-text">$1</span>');
}

function socialUrls(s) {
  return {
    ig: s.instagram ? `https://ig.me/m/${encodeURIComponent(s.instagram)}` : '',
    igProfile: s.instagram ? `https://instagram.com/${encodeURIComponent(s.instagram)}` : '',
    tt: s.tiktok ? `https://www.tiktok.com/@${encodeURIComponent(s.tiktok)}` : '',
    wa: s.whatsappEnabled && s.whatsapp ? `https://wa.me/${encodeURIComponent(s.whatsapp)}` : '',
  };
}

/* WhatsApp is the only one that can pre-fill a message, so it gets the text
   in the link. Instagram and TikTok fall back to copy-to-clipboard. */
function orderButtons(urls, label, price, currency, status = 'in_stock') {
  const priced = price ? ` (${currency}${price})` : '';
  const message =
    status === 'sold_out'
      ? `Hi! Is the ${label}${priced} coming back in stock?`
      : status === 'preorder'
        ? `Hi! I'd like to pre-order the ${label}${priced}.`
        : `Hi! I'd like to order the ${label}${priced}. Is it available?`;

  const out = [];
  if (urls.wa) {
    out.push(`<a class="btn btn-primary btn-sm js-order" href="${escapeHtml(urls.wa)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener" data-prefilled="1">
            <svg class="ic"><use href="#i-wa"/></svg> WhatsApp
          </a>`);
  }
  if (urls.ig) {
    out.push(`<a class="btn ${urls.wa ? 'btn-ghost' : 'btn-primary'} btn-sm js-order" href="${escapeHtml(urls.ig)}" target="_blank" rel="noopener">
            <svg class="ic"><use href="#i-ig"/></svg> Instagram
          </a>`);
  }
  if (urls.tt) {
    out.push(`<a class="btn btn-ghost btn-sm js-order" href="${escapeHtml(urls.tt)}" target="_blank" rel="noopener">
            <svg class="ic"><use href="#i-tiktok"/></svg> TikTok
          </a>`);
  }
  return out.join('\n          ');
}

const STATUS_TEXT = { in_stock: 'In stock', sold_out: 'Sold out', preorder: 'Pre-order' };

function productCard(p, s, urls) {
  const specs = p.specs.map((x) => `<i>${escapeHtml(x)}</i>`).join('');
  const status = STATUS_TEXT[p.status] ? p.status : 'in_stock';
  const image = p.image
    ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">`
    : '<div class="shot-empty">No photo yet</div>';

  return `      <article class="card reveal${status === 'sold_out' ? ' is-sold-out' : ''}" data-product="${escapeHtml(p.name)}" data-price="${escapeHtml(p.price)}" data-status="${status}">
        <div class="shot">
          ${p.tag ? `<span class="tag">${escapeHtml(p.tag)}</span>` : ''}
          <span class="stock stock-${status}">${STATUS_TEXT[status]}</span>
          ${image}
        </div>
        <h3>${escapeHtml(p.name)}</h3>
        <p class="desc">${escapeHtml(p.desc)}</p>
        ${specs ? `<div class="specs">${specs}</div>` : ''}
        <div class="price-row">
          ${p.price ? `<span class="price">${escapeHtml(s.currency)}${escapeHtml(p.price)}</span>` : '<span class="price">Ask us</span>'}
          ${p.unit ? `<small>${escapeHtml(p.unit)}</small>` : ''}
        </div>
        <div class="card-actions">
          ${orderButtons(urls, p.name, p.price, s.currency, status)}
        </div>
      </article>`;
}

function bundleBlock(s, urls) {
  if (!s.bundleEnabled) return '';
  return `    <div class="bundle reveal" data-product="${escapeHtml(s.bundleTitle)}" data-price="${escapeHtml(s.bundlePrice)}">
      <div class="bundle-in">
        <div class="bundle-txt">
          <h3>${escapeHtml(s.bundleTitle)}</h3>
          <p>${escapeHtml(s.bundleText)}</p>
        </div>
        <div>
          ${s.bundlePrice ? `<span class="price grad-text">${escapeHtml(s.currency)}${escapeHtml(s.bundlePrice)}</span>` : ''}
          ${s.bundleCompare ? `<span class="strike">${escapeHtml(s.currency)}${escapeHtml(s.bundleCompare)}</span>` : ''}
        </div>
        <div class="card-actions bundle-actions">
          ${orderButtons(urls, s.bundleTitle, s.bundlePrice, s.currency, 'in_stock')}
        </div>
      </div>
    </div>`;
}

function socialCards(s, urls) {
  const rows = [];
  if (urls.tt) {
    rows.push(`      <a class="social" href="${escapeHtml(urls.tt)}" target="_blank" rel="noopener">
        <svg class="ic" style="color:var(--cyan)"><use href="#i-tiktok"/></svg>
        <div><b>TikTok</b><span>@${escapeHtml(s.tiktok)}</span></div>
      </a>`);
  }
  if (urls.igProfile) {
    rows.push(`      <a class="social" href="${escapeHtml(urls.igProfile)}" target="_blank" rel="noopener">
        <svg class="ic" style="color:var(--magenta)"><use href="#i-ig"/></svg>
        <div><b>Instagram</b><span>@${escapeHtml(s.instagram)}</span></div>
      </a>`);
  }
  if (urls.wa) {
    rows.push(`      <a class="social" href="${escapeHtml(urls.wa)}" target="_blank" rel="noopener">
        <svg class="ic" style="color:#25D366"><use href="#i-wa"/></svg>
        <div><b>WhatsApp</b><span>+${escapeHtml(s.whatsapp)}</span></div>
      </a>`);
  }
  return rows.join('\n');
}


function contactForm(s) {
  if (!s.contactFormEnabled) return '';
  return `    <div class="msgbox reveal">
      <h3>${highlight(s.contactHeading)}</h3>
      <p>${escapeHtml(s.contactText)}</p>
      <div class="msgbox-cta">
        <button class="btn btn-primary" data-open-chat type="button">
          <svg class="ic"><use href="#i-chat"/></svg> Start a chat
        </button>
      </div>
    </div>`;
}

function render(site) {
  const s = site.settings;
  const urls = socialUrls(s);
  const visible = site.products.filter((p) => !p.hidden);

  const heroCta = [
    '<a class="btn btn-primary" href="#shop">Shop the Fidgets</a>',
    '<a class="btn btn-ghost" href="#custom">Order Something Custom</a>',
  ].join('\n    ');

  const customCta = [
    urls.wa && `<a class="btn btn-primary" href="${escapeHtml(urls.wa)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-wa"/></svg> Message on WhatsApp</a>`,
    urls.ig && `<a class="btn ${urls.wa ? 'btn-ghost' : 'btn-primary'}" href="${escapeHtml(urls.ig)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-ig"/></svg> DM on Instagram</a>`,
    urls.tt && `<a class="btn btn-ghost" href="${escapeHtml(urls.tt)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-tiktok"/></svg> DM on TikTok</a>`,
  ].filter(Boolean).join('\n        ');

  const headerCta = urls.wa || urls.ig || urls.tt || '#contact';
  const headerIcon = urls.wa ? '#i-wa' : urls.ig ? '#i-ig' : '#i-tiktok';

  const values = {
    BRAND: escapeHtml(s.brandName),
    TITLE: escapeHtml(`${s.brandName} — Custom 3D Printed Fidgets & Prints | Lebanon`),
    META_DESC: escapeHtml(`${s.brandName}. ${s.heroText}`.slice(0, 300)),
    TAGLINE_A: escapeHtml(s.taglineA),
    TAGLINE_B: escapeHtml(s.taglineB),
    TAGLINE_C: escapeHtml(s.taglineC),
    HERO_TEXT: escapeHtml(s.heroText),
    CURRENCY: escapeHtml(s.currency),
    HERO_CTA: heroCta,
    HEADER_CTA_URL: escapeHtml(headerCta),
    HEADER_CTA_ICON: headerIcon,
    BADGES: s.badges.map((b) => `<span>${escapeHtml(b)}</span>`).join('\n    '),
    SHOP_HEADING: highlight(s.shopHeading),
    SHOP_TEXT: escapeHtml(s.shopText),
    PRODUCTS: visible.length
      ? visible.map((p) => productCard(p, s, urls)).join('\n')
      : '      <p class="empty">No products yet — add some from the admin page.</p>',
    BUNDLE: bundleBlock(s, urls),
    CUSTOM_HEADING: highlight(s.customHeading),
    CUSTOM_TEXT: escapeHtml(s.customText),
    CUSTOM_CTA: customCta,
    STEPS: s.steps
      .map((st) => `      <div class="step reveal"><h3>${escapeHtml(st.title)}</h3><p>${escapeHtml(st.text)}</p></div>`)
      .join('\n'),
    STEPS_HEADING: highlight(s.stepsHeading),
    SOCIALS: socialCards(s, urls),
    CONTACT_FORM: contactForm(s),
    // Switched off means the widget is never sent to the browser at all.
    CHAT_CSS: s.contactFormEnabled ? '<link rel="stylesheet" href="/chat.css">' : '',
    CHAT_JS: s.contactFormEnabled ? '<script src="/chat.js"></script>' : '',
    FOOTER_NOTE: escapeHtml(s.footerNote),
    YEAR: String(new Date().getFullYear()),
  };

  const template = fs.readFileSync(TEMPLATE, 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}

module.exports = { render, highlight, socialUrls };
