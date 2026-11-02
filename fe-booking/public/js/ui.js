// Shared rendering helpers. `html` escapes every interpolated value unless it
// was itself produced by `html` (or wrapped with `raw`), so views can nest safely.

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return escape(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Safe(out);
}

export const raw = (s) => new Safe(s);

export function mount(el, content) {
  el.innerHTML = render(content);
}

// ---- Labels & formatting ------------------------------------------------

export const STATUS_LABELS = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  en_route: 'En route',
  on_site: 'On site',
  completed: 'Awaiting review',
  returned: 'Returned',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

export const PHOTO_LABELS = {
  rack_front: 'Rack front',
  rack_rear: 'Rack rear',
  cabling: 'Cabling',
  labels: 'Labels',
  equipment: 'Equipment',
  other: 'Other',
  signature: 'Signature',
};

export const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

export const statusBadge = (s) => html`<span class="badge status-${s}">${STATUS_LABELS[s] ?? s}</span>`;
export const priorityBadge = (p) => (p === 'high' || p === 'urgent' ? html`<span class="badge prio-${p}">${PRIORITY_LABELS[p]}</span>` : '');

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '');
export const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '');
export const fmtDateTime = (iso) => (iso ? fullFmt.format(new Date(iso)) : '');

export function fmtSlot(start, end) {
  if (!start) return 'Not scheduled';
  const s = `${fmtDate(start)}, ${fmtTime(start)}`;
  return end ? `${s} – ${fmtTime(end)}` : s;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Value for <input type="datetime-local"> in the device's time zone.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

export function mapsUrl(job) {
  const q = [job.site_address, job.site_city].filter(Boolean).join(', ') || job.site_name;
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---- Feedback -------------------------------------------------------------

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// Promise-based modal dialog. `body` is html content; resolves with the
// submitted FormData, or null if cancelled.
export function dialog({ title, body, submit = 'Save', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    mount(dlg, html`
      <form method="dialog">
        <h2>${title}</h2>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-cancel>Cancel</button>
          <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${submit}</button>
        </div>
      </form>`);
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    let result = null;
    dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    form.addEventListener('submit', (e) => {
      if (!form.reportValidity()) {
        e.preventDefault();
        return;
      }
      result = new FormData(form);
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.showModal();
    dlg.querySelector('input, textarea, select')?.focus();
  });
}

export const confirmDialog = (title, message, submit = 'Confirm', danger = false) =>
  dialog({ title, body: html`<p>${message}</p>`, submit, danger }).then((r) => r !== null);

// Runs an async handler on a button, disabling it while busy and showing errors.
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message || 'Something went wrong', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export const icon = (name) => raw(`<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`);
