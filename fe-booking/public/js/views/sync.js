import * as api from '../api.js';
import { html, mount, icon, toast, busy, fmtDateTime, PHOTO_LABELS } from '../ui.js';

function describe(item) {
  if (item.blob) return `${PHOTO_LABELS[item.body.category] ?? 'Photo'} photo`;
  if (item.url.endsWith('/actions')) return `Status: ${item.body.action.replace('_', ' ')}`;
  if (item.url.endsWith('/notes')) return 'Note';
  if (item.url.endsWith('/assets')) return `Equipment ${item.body.serial}`;
  if (item.url.includes('/checklist/')) return `Checklist item ${item.body.done ? 'ticked' : 'unticked'}`;
  return item.url;
}

// Shows changes saved on this device that have not reached the server yet.
export async function syncView(el) {
  const controller = new AbortController();

  async function draw() {
    const items = await api.pendingItems();
    mount(el, html`
      <div class="page narrow">
        <h1>Upload queue</h1>
        <p class="muted">${navigator.onLine ? 'Online.' : 'Offline.'} Changes made without signal are kept on this phone and uploaded automatically.</p>
        ${items.length ? html`
          <div class="row"><button class="btn primary" data-sync ${navigator.onLine ? '' : 'disabled'}>${icon('upload')} Upload now</button></div>
          <ul class="queue">
            ${items.map((i) => html`
              <li class="${i.error ? 'failed' : ''}">
                <div>
                  <strong>${describe(i)}</strong>
                  <div class="small muted"><a href="#/jobs/${i.jobId}">Job #${i.jobId}</a> · saved ${fmtDateTime(i.created)}</div>
                  ${i.error ? html`<div class="small error-text">Not accepted: ${i.error}</div>` : ''}
                </div>
                ${i.error ? html`
                  <div class="row">
                    <button class="btn small" data-retry="${i.seq}">Retry</button>
                    <button class="btn small ghost danger-text" data-discard="${i.seq}">Discard</button>
                  </div>` : html`<span class="badge">Waiting</span>`}
              </li>`)}
          </ul>` : html`<div class="empty"><p>${icon('check')} Everything is uploaded.</p></div>`}
      </div>`);
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-sync],[data-retry],[data-discard]');
    if (!t) return;
    await busy(t, async () => {
      if ('sync' in t.dataset) {
        const n = await api.syncNow();
        toast(n ? `${n} item(s) uploaded` : 'Nothing could be uploaded yet', n ? 'ok' : 'offline');
      } else if (t.dataset.retry) await api.retry(Number(t.dataset.retry));
      else if (confirm('Discard this change? It will not be uploaded.')) await api.discard(Number(t.dataset.discard));
    });
    draw();
  }, { signal: controller.signal });

  api.onChange(draw);
  await draw();
  return () => {
    controller.abort();
    api.offChange(draw);
  };
}
