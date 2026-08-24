/* ==========================================================================
   PrintPoP 3D — admin panel logic.
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let site = null;      // what we are editing
let saved = null;     // last version the server confirmed
let dirty = false;
let openProduct = null;

const STATUS_LABEL = { in_stock: 'In stock', sold_out: 'Sold out', preorder: 'Pre-order' };

/* Shared with admin-messages.js */
window.$ = $;
window.$ = $;

/* ---------- tiny helpers ---------- */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json', 'X-PrintPoP-Admin': '1' } : { 'X-PrintPoP-Admin': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try { data = await res.json(); } catch { /* empty body is fine */ }

  if (res.status === 401 && site) {
    location.reload();          // session expired mid-edit
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let toastTimer;
window.api = api;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function notice(id, msg, show = true) {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle('show', show && Boolean(msg));
}

window.toast = toast;
window.notice = notice;

function markDirty(value = true) {
  dirty = value;
  $('#dirtyFlag').textContent = value ? 'Unsaved changes' : 'All changes saved';
  $('#dirtyFlag').classList.toggle('dirty', value);
  $('#revertBtn').disabled = !value;
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((acc, key) => (acc[key] ??= {}), obj)[last] = value;
}

/* ---------- gate: setup and login ---------- */

async function boot() {
  const status = await api('GET', '/api/status');

  if (status.authed) return openEditor();

  $('#gate').classList.remove('hidden');
  if (status.needsSetup) {
    $('#setupBox').classList.remove('hidden');
    $('#setupPass').focus();
  } else {
    $('#loginBox').classList.remove('hidden');
    $('#loginPass').focus();
  }
}

$('#setupBtn').addEventListener('click', async () => {
  const a = $('#setupPass').value;
  const b = $('#setupPass2').value;

  if (a.length < 8) return notice('#setupErr', 'Password must be at least 8 characters.');
  if (a !== b) return notice('#setupErr', "The two passwords don't match.");

  try {
    $('#setupBtn').disabled = true;
    await api('POST', '/api/setup', { password: a });
    location.reload();
  } catch (err) {
    $('#setupBtn').disabled = false;
    notice('#setupErr', err.message);
  }
});

$('#loginBtn').addEventListener('click', doLogin);
$('#loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('#setupPass2').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#setupBtn').click(); });

async function doLogin() {
  const password = $('#loginPass').value;
  if (!password) return notice('#loginErr', 'Enter your password.');

  try {
    $('#loginBtn').disabled = true;
    await api('POST', '/api/login', { password });
    location.reload();
  } catch (err) {
    $('#loginBtn').disabled = false;
    notice('#loginErr', err.message);
    $('#loginPass').select();
  }
}

$('#logoutBtn').addEventListener('click', async () => {
  if (dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
  await api('POST', '/api/logout');
  location.reload();
});

/* ---------- editor ---------- */

async function openEditor() {
  site = await api('GET', '/api/site');
  saved = structuredClone(site);

  $('#gate').classList.add('hidden');
  $('#app').classList.remove('hidden');

  window.site = site;
  renderSteps();
  renderProducts();
  bindFields();
  markDirty(false);

  // inbox + notification state live in admin-messages.js
  if (typeof loadMessages === 'function') { loadMessages(); refreshPushUi(); }
}

/* --- tabs --- */
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
    window.scrollTo(0, 0);
  });
});

/* --- generic settings inputs, bound by data-field --- */
function bindFields() {
  $$('[data-field]').forEach((el) => {
    const path = el.dataset.field;
    const value = getPath(site, path);

    if (el.type === 'checkbox') el.checked = Boolean(value);
    else if (el.dataset.list) el.value = (value ?? []).join('\n');
    else el.value = value ?? '';

    el.addEventListener('input', () => {
      if (el.type === 'checkbox') setPath(site, path, el.checked);
      else if (el.dataset.list) {
        setPath(site, path, el.value.split('\n').map((s) => s.trim()).filter(Boolean));
      } else setPath(site, path, el.value);
      markDirty();
    });
    el.addEventListener('change', () => {
      if (el.type === 'checkbox') { setPath(site, path, el.checked); markDirty(); }
    });
  });
}

/* --- "how it works" steps --- */
function renderSteps() {
  const host = $('#stepList');
  host.innerHTML = '';

  site.settings.steps.forEach((step, i) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="field">
        <label>Step ${i + 1} title</label>
        <input type="text" value="${escapeAttr(step.title)}">
      </div>
      <div class="field">
        <label>Step ${i + 1} text</label>
        <textarea>${escapeHtml(step.text)}</textarea>
      </div>`;

    wrap.querySelector('input').addEventListener('input', (e) => {
      site.settings.steps[i].title = e.target.value; markDirty();
    });
    wrap.querySelector('textarea').addEventListener('input', (e) => {
      site.settings.steps[i].text = e.target.value; markDirty();
    });
    host.appendChild(wrap);
  });
}

/* --- products --- */
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;
window.escapeHtml = escapeHtml;

function renderProducts() {
  const host = $('#prodList');
  host.innerHTML = '';

  if (!site.products.length) {
    host.innerHTML = '<div class="card-box"><p class="sub" style="margin:0">No products yet. Tap the button below to add your first one.</p></div>';
    return;
  }

  site.products.forEach((p, index) => {
    const isOpen = openProduct === p.id;
    const el = document.createElement('div');
    el.className = `prod${p.hidden ? ' is-hidden' : ''}`;

    const thumb = p.image
      ? `<img class="thumb" src="${escapeAttr(p.image)}" alt="">`
      : '<div class="thumb thumb-empty">📷</div>';

    el.innerHTML = `
      <div class="prod-head">
        ${thumb}
        <div class="t">
          <b>${escapeHtml(p.name || 'Untitled')}<span class="pill pill-${p.status || 'in_stock'}">${STATUS_LABEL[p.status] || 'In stock'}</span></b>
          <span>${p.price ? escapeHtml(site.settings.currency + p.price) : 'No price'}${p.hidden ? ' · hidden' : ''}</span>
        </div>
        <button class="icon-btn js-up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn js-down" title="Move down" ${index === site.products.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-btn js-toggle" title="Open">${isOpen ? '▲' : '▼'}</button>
      </div>
      <div class="prod-body${isOpen ? '' : ' hidden'}">
        <div class="photo-slot">
          ${p.image
            ? `<img class="preview" src="${escapeAttr(p.image)}" alt="">`
            : '<div class="preview preview-empty">No photo yet</div>'}
          <div class="photo-actions">
            <button class="btn btn-ghost btn-sm js-photo">${p.image ? 'Replace photo' : 'Upload photo'}</button>
            ${p.image ? '<button class="btn btn-ghost btn-sm js-photo-clear">Remove photo</button>' : ''}
          </div>
        </div>
        <div class="field"><label>Name</label><input type="text" class="js-f" data-k="name" value="${escapeAttr(p.name)}"></div>
        <div class="field"><label>Description</label><textarea class="js-f" data-k="desc">${escapeHtml(p.desc)}</textarea></div>
        <div class="row">
          <div class="field"><label>Price</label><input type="text" class="js-f" data-k="price" inputmode="decimal" value="${escapeAttr(p.price)}"></div>
          <div class="field"><label>Price note</label><input type="text" class="js-f" data-k="unit" value="${escapeAttr(p.unit)}" placeholder="each"></div>
          <div class="field"><label>Corner label</label><input type="text" class="js-f" data-k="tag" value="${escapeAttr(p.tag)}" placeholder="Best seller"></div>
        </div>
        <div class="field">
          <label>Details</label>
          <textarea class="js-specs" placeholder="One per line">${escapeHtml(p.specs.join('\n'))}</textarea>
          <div class="hint">One per line — these show as small pills, e.g. "10+ colors".</div>
        </div>
        <div class="field">
          <label>Availability</label>
          <div class="status-row">
            ${Object.entries(STATUS_LABEL).map(([key, text]) => `
              <label class="status-opt">
                <input type="radio" name="status-${p.id}" class="js-status" value="${key}" ${(p.status || 'in_stock') === key ? 'checked' : ''}>
                <span>${text}</span>
              </label>`).join('')}
          </div>
        </div>
        <label class="check">
          <input type="checkbox" class="js-hidden" ${p.hidden ? 'checked' : ''}>
          <span>Hide this product from the shop</span>
        </label>
        <button class="btn btn-danger btn-sm js-delete">Delete this product</button>
      </div>`;

    /* open / close */
    const toggle = () => { openProduct = isOpen ? null : p.id; renderProducts(); };
    el.querySelector('.js-toggle').addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    el.querySelector('.prod-head').addEventListener('click', (e) => {
      if (!e.target.closest('.icon-btn')) toggle();
    });

    /* reorder */
    el.querySelector('.js-up').addEventListener('click', (e) => { e.stopPropagation(); move(index, -1); });
    el.querySelector('.js-down').addEventListener('click', (e) => { e.stopPropagation(); move(index, 1); });

    /* plain fields */
    el.querySelectorAll('.js-f').forEach((input) => {
      input.addEventListener('input', () => { p[input.dataset.k] = input.value; markDirty(); });
    });
    el.querySelector('.js-specs')?.addEventListener('input', (e) => {
      p.specs = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
      markDirty();
    });
    el.querySelectorAll('.js-status').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) { p.status = radio.value; markDirty(); renderProducts(); }
      });
    });

    el.querySelector('.js-hidden')?.addEventListener('change', (e) => {
      p.hidden = e.target.checked; markDirty(); renderProducts();
    });

    /* photo */
    el.querySelector('.js-photo')?.addEventListener('click', () => pickPhoto(p));
    el.querySelector('.js-photo-clear')?.addEventListener('click', () => {
      p.image = ''; markDirty(); renderProducts();
    });

    /* delete */
    el.querySelector('.js-delete')?.addEventListener('click', () => {
      if (!confirm(`Delete "${p.name || 'this product'}"? This can't be undone once you save.`)) return;
      site.products.splice(index, 1);
      openProduct = null;
      markDirty();
      renderProducts();
    });

    host.appendChild(el);
  });
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= site.products.length) return;
  const [item] = site.products.splice(index, 1);
  site.products.splice(target, 0, item);
  markDirty();
  renderProducts();
}

$('#addProd').addEventListener('click', () => {
  const id = `p-${Date.now().toString(36)}`;
  site.products.push({
    id, name: 'New product', desc: '', price: '', unit: 'each',
    tag: '', specs: [], image: '', status: 'in_stock', hidden: false,
  });
  openProduct = id;
  markDirty();
  renderProducts();
  window.scrollTo(0, document.body.scrollHeight);
});

/* ---------- photo upload (shrunk in the browser first) ---------- */

let photoTarget = null;
const picker = $('#filePicker');

function pickPhoto(product) {
  photoTarget = product;
  picker.value = '';
  picker.click();
}

picker.addEventListener('change', async () => {
  const file = picker.files?.[0];
  if (!file || !photoTarget) return;

  try {
    toast('Uploading photo…');
    const dataUrl = await shrink(file, 1200, 0.85);
    const { url } = await api('POST', '/api/upload', { dataUrl });
    photoTarget.image = url;
    markDirty();
    renderProducts();
    toast('Photo added — remember to save');
  } catch (err) {
    toast(err.message || 'That photo would not upload');
  }
});

/* Resize on the customer's own device so a 12 MP phone photo doesn't
   travel over the network at full size. */
function shrink(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- save / revert / reset ---------- */

$('#saveBtn').addEventListener('click', async () => {
  const btn = $('#saveBtn');
  try {
    btn.disabled = true;
    $('#saveMsg').textContent = 'Saving…';
    site = await api('PUT', '/api/site', site);
    saved = structuredClone(site);
    markDirty(false);
    renderSteps();
    renderProducts();
    bindFields();
    $('#saveMsg').textContent = '';
    toast('✅ Saved — your shop is updated');
  } catch (err) {
    $('#saveMsg').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#revertBtn').addEventListener('click', () => {
  if (!dirty || !confirm('Throw away every change since your last save?')) return;
  site = structuredClone(saved);
  openProduct = null;
  renderSteps();
  renderProducts();
  bindFields();
  markDirty(false);
  toast('Changes undone');
});

$('#resetBtn').addEventListener('click', async () => {
  if (!confirm('This puts every product and all the text back to the original. Continue?')) return;
  site = await api('POST', '/api/reset');
  saved = structuredClone(site);
  openProduct = null;
  renderSteps();
  renderProducts();
  bindFields();
  markDirty(false);
  toast('Site reset to the original');
});

/* ---------- password change ---------- */

$('#pwBtn').addEventListener('click', async () => {
  notice('#pwErr', '', false);
  notice('#pwOk', '', false);

  const current = $('#pwCurrent').value;
  const next = $('#pwNext').value;

  if (next.length < 8) return notice('#pwErr', 'New password must be at least 8 characters.');
  if (next !== $('#pwNext2').value) return notice('#pwErr', "The two new passwords don't match.");

  try {
    $('#pwBtn').disabled = true;
    await api('POST', '/api/password', { current, next });
    $('#pwCurrent').value = $('#pwNext').value = $('#pwNext2').value = '';
    notice('#pwOk', 'Password updated. Use the new one next time you log in.');
  } catch (err) {
    notice('#pwErr', err.message);
  } finally {
    $('#pwBtn').disabled = false;
  }
});

/* ---------- don't lose work ---------- */

window.addEventListener('beforeunload', (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

boot().catch((err) => {
  document.body.innerHTML =
    `<div class="gate"><div class="gate-card"><h1>Can't reach the server</h1>
     <p class="lead">${escapeHtml(err.message)}</p></div></div>`;
});
