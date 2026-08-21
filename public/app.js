/* ==========================================================================
   Storefront: copy the order message, toast, scroll reveal.
   ========================================================================== */

const toast = document.getElementById('toast');
let toastTimer;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
}

/* WhatsApp links already carry the message, so they need no clipboard help.
   Instagram and TikTok can't be pre-filled — copy it and tell them to paste. */
document.querySelectorAll('.js-order').forEach((link) => {
  if (link.dataset.prefilled) return;

  link.addEventListener('click', () => {
    const host = link.closest('[data-product]');
    const product = host?.dataset.product || 'your prints';
    const price = host?.dataset.price;
    const currency = document.body.dataset.currency || '$';

    const msg = price
      ? `Hi! I'd like to order the ${product} (${currency}${price}). Is it available?`
      : `Hi! I'd like to order the ${product}.`;

    copyText(msg)
      .then(() => showToast('✅ Message copied — just paste it in the DM!'))
      .catch(() => showToast(`💬 Ask for: ${product}`));
  });
});

const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
