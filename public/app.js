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

    const status = host?.dataset.status || 'in_stock';
    const priced = price ? ` (${currency}${price})` : '';

    // Must match the WhatsApp wording in lib/render.js
    const msg =
      status === 'sold_out'
        ? `Hi! Is the ${product}${priced} coming back in stock?`
        : status === 'preorder'
          ? `Hi! I'd like to pre-order the ${product}${priced}.`
          : `Hi! I'd like to order the ${product}${priced}. Is it available?`;

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

/* ==========================================================================
   Customer message form
   ========================================================================== */
const msgForm = document.getElementById('msgForm');

if (msgForm) {
  const status = document.getElementById('msgStatus');
  const submit = msgForm.querySelector('button[type=submit]');

  msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'msg-status';
    status.textContent = '';

    const payload = Object.fromEntries(new FormData(msgForm).entries());

    if (!payload.name?.trim() || !payload.contact?.trim() || !payload.body?.trim()) {
      status.className = 'msg-status err';
      status.textContent = 'Please fill in all three boxes.';
      return;
    }

    try {
      submit.disabled = true;
      submit.textContent = 'Sending…';

      const res = await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send that.');

      msgForm.reset();
      status.className = 'msg-status ok';
      status.textContent = "✅ Sent! We'll get back to you soon.";
    } catch (err) {
      status.className = 'msg-status err';
      status.textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send message';
    }
  });
}
