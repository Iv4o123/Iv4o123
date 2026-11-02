import * as api from '../api.js';
import { cache } from '../store.js';
import {
  html, mount, icon, toast, busy, dialog, confirmDialog, uid, statusBadge, priorityBadge,
  fmtSlot, fmtDateTime, mapsUrl, PHOTO_LABELS,
} from '../ui.js';
import { compressPhoto, canScanBarcodes, scanBarcode, signaturePad, currentPosition } from '../media.js';
import { offlineNote } from './components.js';

const OFFICE = ['admin', 'dispatcher'];
const ENGINEER_EDITABLE = ['assigned', 'en_route', 'on_site', 'returned'];
const CLOSED = ['approved', 'cancelled'];
const CAPTURE_CATEGORIES = ['rack_front', 'rack_rear', 'cabling', 'labels', 'equipment', 'other'];

const EVENT_LABELS = {
  created: 'Job created',
  assigned: 'Assignment changed',
  edited: 'Details edited',
  start_travel: 'Started travelling',
  check_in: 'Checked in on site',
  complete: 'Completed on site',
  approve: 'Approved',
  return: 'Sent back',
  cancel: 'Cancelled',
  note: 'Note',
};

export async function jobView(el, { params, user }) {
  const id = Number(params[0]);
  const url = `/jobs/${id}`;
  const isOffice = OFFICE.includes(user.role);
  const controller = new AbortController();
  const on = (type, fn) => el.addEventListener(type, fn, { signal: controller.signal });

  let { data, offline } = await api.get(url);
  let job = data.job;
  let pending = [];
  const blobUrls = new Map();

  const isAssignee = () => job.assigned_to === user.id;
  const canEditWork = () => !CLOSED.includes(job.status) && (isOffice || (isAssignee() && ENGINEER_EDITABLE.includes(job.status)));

  async function loadPending() {
    pending = (await api.pendingItems()).filter((i) => i.jobId === id);
    for (const p of pending) if (p.blob && !blobUrls.has(p.seq)) blobUrls.set(p.seq, URL.createObjectURL(p.blob));
  }

  // Apply a change locally when it had to be queued, so the screen reflects it.
  async function applyResult(result, localChange) {
    if (result.data?.job) job = result.data.job;
    else if (result.queued && localChange) {
      localChange(job);
      toast('Saved on this phone. It will upload when you have signal.', 'offline');
    }
    await cache.set(url, { job });
    await loadPending();
    draw();
  }

  const send = (item, localChange) => api.send({ jobId: id, ...item }).then((r) => applyResult(r, localChange));

  async function action(name, extra = {}, localChange) {
    const body = { action: name, client_id: uid(), at: new Date().toISOString(), ...extra };
    // Office decisions need the live state, so they are never queued.
    if (['approve', 'return', 'cancel'].includes(name)) {
      job = (await api.post(`${url}/actions`, body)).job;
      await cache.set(url, { job });
      draw();
      return;
    }
    await send({ method: 'POST', url: `${url}/actions`, body }, (j) => {
      localChange?.(j);
      j.events.push({ id: `local-${body.client_id}`, type: name, message: extra.note ?? null, created_at: body.at, user_name: user.name, pending: true });
    });
  }

  // ---- Rendering ----------------------------------------------------------

  function actionBar() {
    if (CLOSED.includes(job.status)) return '';
    const b = [];
    if (isAssignee()) {
      if (['assigned', 'returned'].includes(job.status)) {
        b.push(html`<button class="btn" data-act="start_travel">${icon('car')} Start travel</button>`);
      }
      if (['assigned', 'en_route', 'returned'].includes(job.status)) {
        b.push(html`<button class="btn primary" data-act="check_in">${icon('pin')} Check in on site</button>`);
      }
      if (job.status === 'on_site') b.push(html`<button class="btn primary" data-act="complete">${icon('check')} Complete job</button>`);
    }
    if (isOffice) {
      if (job.status === 'completed') {
        b.push(html`<button class="btn primary" data-act="approve">${icon('check')} Approve</button>`);
        b.push(html`<button class="btn" data-act="return">Send back</button>`);
      }
      b.push(html`<a class="btn ghost" href="#/jobs/${job.id}/edit">Edit</a>`);
      b.push(html`<button class="btn ghost danger-text" data-act="cancel">Cancel job</button>`);
    }
    return b.length ? html`<div class="action-bar">${b}</div>` : '';
  }

  function statusNotice() {
    if (job.status === 'returned' && job.review_note) {
      return html`<div class="notice warn"><strong>Sent back:</strong> ${job.review_note}</div>`;
    }
    if (job.status === 'completed') {
      return html`<div class="notice info">${isOffice ? 'Completed on site — review the photos and approve or send back.' : 'Completed. Waiting for the office to review.'}</div>`;
    }
    if (job.status === 'approved') {
      return html`<div class="notice ok">Approved ${job.reviewed_at ? fmtDateTime(job.reviewed_at) : ''}${job.review_note ? ` — ${job.review_note}` : ''}</div>`;
    }
    return '';
  }

  function siteCard() {
    if (!job.site_name) return html`<section class="card"><h2>Site</h2><p class="muted">No site set.</p></section>`;
    const maps = mapsUrl(job);
    return html`
      <section class="card">
        <h2>Site</h2>
        <div class="site-name">${job.site_name}${job.rack ? html` <span class="badge">Rack ${job.rack}</span>` : ''}</div>
        ${job.site_address || job.site_city ? html`<p>${[job.site_address, job.site_city].filter(Boolean).join(', ')}</p>` : ''}
        <div class="row wrap">
          ${maps ? html`<a class="btn small" href="${maps}" target="_blank" rel="noopener">${icon('map')} Navigate</a>` : ''}
          ${job.site_contact_phone ? html`<a class="btn small" href="tel:${job.site_contact_phone.replace(/[^\d+]/g, '')}">${icon('phone')} ${job.site_contact_name || 'Call site'}</a>` : ''}
        </div>
        ${job.site_access_notes ? html`<p class="access-notes"><strong>Access:</strong> ${job.site_access_notes}</p>` : ''}
      </section>`;
  }

  function detailsCard() {
    return html`
      <section class="card">
        <h2>Job</h2>
        <dl class="details">
          <dt>When</dt><dd>${fmtSlot(job.scheduled_start, job.scheduled_end)}</dd>
          <dt>Engineer</dt><dd>${job.engineer_name ?? 'Unassigned'}${isOffice && job.engineer_phone ? html` · <a href="tel:${job.engineer_phone}">${job.engineer_phone}</a>` : ''}</dd>
          ${job.ticket_ref ? html`<dt>Ticket</dt><dd>${job.ticket_ref}</dd>` : ''}
          ${job.checkin_at ? html`<dt>On site</dt><dd>${fmtDateTime(job.checkin_at)}${job.checkout_at ? ` → ${fmtDateTime(job.checkout_at)}` : ''}
            ${job.checkin_lat != null ? html` · <a href="https://www.google.com/maps?q=${job.checkin_lat},${job.checkin_lng}" target="_blank" rel="noopener">location</a>` : ''}</dd>` : ''}
          ${job.signed_by ? html`<dt>Signed by</dt><dd>${job.signed_by}</dd>` : ''}
        </dl>
        ${job.description ? html`<div class="description">${job.description}</div>` : ''}
        ${job.completion_notes ? html`<h3>Engineer's notes</h3><div class="description">${job.completion_notes}</div>` : ''}
      </section>`;
  }

  function checklistCard() {
    if (!job.checklist.length && !isOffice) return '';
    const editable = canEditWork() && (isOffice || job.status === 'on_site' || job.status === 'returned');
    return html`
      <section class="card">
        <h2>Checklist <span class="count">${job.checklist.filter((c) => c.done).length}/${job.checklist.length}</span></h2>
        ${!editable && isAssignee() && ENGINEER_EDITABLE.includes(job.status) ? html`<p class="muted small">Check in on site to tick items.</p>` : ''}
        <ul class="checklist">
          ${job.checklist.map((c) => html`
            <li>
              <label class="check ${c.done ? 'done' : ''}">
                <input type="checkbox" data-check="${c.id}" ${c.done ? 'checked' : ''} ${editable ? '' : 'disabled'}>
                <span>${c.label}</span>
              </label>
              ${isOffice && canEditWork() ? html`<button class="icon-btn" data-del-item="${c.id}" aria-label="Remove item">${icon('trash')}</button>` : ''}
            </li>`)}
        </ul>
        ${isOffice && canEditWork() ? html`
          <form class="row" data-form="checklist">
            <input name="label" placeholder="Add checklist item" required maxlength="300">
            <button class="btn small">Add</button>
          </form>` : ''}
      </section>`;
  }

  function photosCard() {
    const photos = job.photos.filter((p) => p.category !== 'signature');
    const signature = job.photos.find((p) => p.category === 'signature');
    const pendingPhotos = pending.filter((p) => p.blob);
    const has = (cat) => photos.some((p) => p.category === cat) || pendingPhotos.some((p) => p.body.category === cat);
    const canAdd = canEditWork();
    // Taking photos is the engineer's job; office only reviews or removes them.
    const canCapture = canAdd && isAssignee();
    return html`
      <section class="card card-photos">
        <h2>Photos <span class="count">${photos.length + pendingPhotos.filter((p) => p.body.category !== 'signature').length}</span></h2>
        ${canCapture ? html`
          <p class="muted small">Tap what you are photographing. The camera opens straight away.</p>
          <div class="capture-grid">
            ${CAPTURE_CATEGORIES.map((c) => html`
              <button class="capture ${has(c) ? 'has' : ''}" data-capture="${c}">
                ${icon(has(c) ? 'check' : 'camera')}<span>${PHOTO_LABELS[c]}</span>
              </button>`)}
          </div>
          <button class="btn small ghost" data-gallery>${icon('image')} Choose from gallery</button>` : ''}
        <div class="photo-grid">
          ${pendingPhotos.filter((p) => p.body.category !== 'signature').map((p) => html`
            <figure class="photo pending ${p.error ? 'failed' : ''}">
              <img src="${blobUrls.get(p.seq)}" alt="${PHOTO_LABELS[p.body.category]}">
              <figcaption>${PHOTO_LABELS[p.body.category]} · ${p.error ? 'not sent' : 'waiting to upload'}</figcaption>
            </figure>`)}
          ${photos.map((p) => html`
            <figure class="photo">
              <button class="photo-open" data-photo="${p.id}" aria-label="Open photo">
                <img src="/api/photos/${p.id}/file" alt="${PHOTO_LABELS[p.category]}" loading="lazy">
              </button>
              <figcaption>${PHOTO_LABELS[p.category]}${p.caption ? ` · ${p.caption}` : ''}</figcaption>
              ${canAdd && (isOffice || p.uploaded_by === user.id) ? html`<button class="icon-btn photo-del" data-del-photo="${p.id}" aria-label="Delete photo">${icon('trash')}</button>` : ''}
            </figure>`)}
        </div>
        ${!photos.length && !pendingPhotos.length && !canCapture ? html`<p class="muted">No photos yet.</p>` : ''}
        ${signature ? html`<h3>Signature</h3><img class="signature-img" src="/api/photos/${signature.id}/file" alt="Customer signature">` : ''}
      </section>`;
  }

  function assetsCard() {
    const canAdd = canEditWork();
    if (!job.assets.length && !canAdd) return '';
    const pendingAssets = pending.filter((p) => p.url.endsWith('/assets'));
    return html`
      <section class="card card-assets">
        <h2>Equipment & serial numbers</h2>
        <ul class="assets">
          ${job.assets.map((a) => html`
            <li>
              <div><strong>${a.serial}</strong> ${a.kind || a.model ? html`<span class="muted">${[a.kind, a.model].filter(Boolean).join(' · ')}</span>` : ''}
                ${a.notes ? html`<div class="small muted">${a.notes}</div>` : ''}</div>
              ${canAdd ? html`<button class="icon-btn" data-del-asset="${a.id}" aria-label="Remove">${icon('trash')}</button>` : ''}
            </li>`)}
          ${pendingAssets.map((p) => html`<li><div><strong>${p.body.serial}</strong> <span class="muted">${p.body.kind ?? ''} · waiting to upload</span></div></li>`)}
        </ul>
        ${canAdd ? html`
          <form class="asset-form" data-form="asset">
            <input name="kind" placeholder="Type (e.g. Switch)" maxlength="60">
            <input name="model" placeholder="Model" maxlength="120">
            <div class="row">
              <input name="serial" placeholder="Serial number" required maxlength="120">
              ${canScanBarcodes() ? html`<button type="button" class="btn small" data-scan aria-label="Scan barcode">${icon('barcode')}</button>` : ''}
            </div>
            <button class="btn small">Add equipment</button>
          </form>` : ''}
      </section>`;
  }

  function activityCard() {
    return html`
      <section class="card card-activity">
        <h2>Activity</h2>
        <form class="note-form" data-form="note">
          <textarea name="message" rows="2" placeholder="Add a note for the team" required maxlength="5000"></textarea>
          <button class="btn small">Add note</button>
        </form>
        <ol class="timeline">
          ${[...job.events].reverse().map((e) => html`
            <li class="${e.type} ${e.pending ? 'pending' : ''}">
              <div class="tl-head"><strong>${EVENT_LABELS[e.type] ?? e.type}</strong> <span class="muted small">${e.user_name ?? ''} · ${fmtDateTime(e.created_at)}${e.pending ? ' · waiting to upload' : ''}</span></div>
              ${e.message ? html`<div class="tl-msg">${e.message}</div>` : ''}
            </li>`)}
        </ol>
      </section>`;
  }

  function draw() {
    mount(el, html`
      <div class="page job-page">
        <a class="back" href="#${isOffice ? '/jobs' : '/my'}">${icon('chevron-left')} Back</a>
        <header class="job-head">
          <div class="row wrap"><span class="ref">${job.ref}</span>${statusBadge(job.status)}${priorityBadge(job.priority)}</div>
          <h1>${job.title}</h1>
        </header>
        ${offlineNote(offline)}
        ${statusNotice()}
        ${actionBar()}
        <div class="job-grid">
          <div class="col">
            ${siteCard()}
            ${detailsCard()}
            ${checklistCard()}
            ${assetsCard()}
          </div>
          <div class="col">
            ${photosCard()}
            ${activityCard()}
          </div>
        </div>
        <input type="file" accept="image/*" capture="environment" data-camera hidden>
        <input type="file" accept="image/*" multiple data-gallery-input hidden>
        <input type="file" accept="image/*" capture="environment" data-scan-input hidden>
      </div>`);
  }

  // ---- Photo handling -------------------------------------------------------

  let captureCategory = 'other';

  async function queuePhotos(files, category) {
    for (const file of files) {
      const blob = await compressPhoto(file);
      await send({
        method: 'POST',
        url: `${url}/photos`,
        blob,
        body: { category, client_id: uid(), taken_at: new Date(file.lastModified || Date.now()).toISOString() },
      });
    }
    toast(files.length > 1 ? `${files.length} photos added` : `${PHOTO_LABELS[category]} photo added`, 'ok');
  }

  function openPhoto(photoId) {
    const p = job.photos.find((x) => x.id === photoId);
    const dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    mount(dlg, html`
      <form method="dialog"><button class="icon-btn close" aria-label="Close">✕</button></form>
      <img src="/api/photos/${photoId}/file" alt="">
      <div class="lightbox-bar">
        <span>${PHOTO_LABELS[p.category]} · ${p.uploaded_by_name ?? ''} · ${fmtDateTime(p.taken_at || p.created_at)}</span>
        <a class="btn small" href="/api/photos/${photoId}/file?download=1">Download</a>
      </div>`);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
    dlg.showModal();
  }

  // ---- Completion -----------------------------------------------------------

  async function complete() {
    const photoCount = job.photo_count + pending.filter((p) => p.blob && p.body.category !== 'signature').length;
    if (photoCount < 1) return toast('Add at least one rack photo before completing', 'error');
    const open = job.checklist.filter((c) => !c.done);
    if (open.length) return toast(`Finish the checklist first (${open.length} left)`, 'error');

    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    mount(dlg, html`
      <form method="dialog" class="stack">
        <h2>Complete job</h2>
        <label>What was done<textarea name="note" rows="4" maxlength="5000" placeholder="Summary for the office"></textarea></label>
        <label>Customer / site contact name<input name="signed_by" maxlength="120" value="${job.site_contact_name ?? ''}"></label>
        <div>
          <div class="row between"><span class="label">Signature (optional)</span><button type="button" class="btn small ghost" data-clear>Clear</button></div>
          <canvas class="sig-pad" aria-label="Signature pad"></canvas>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-cancel>Cancel</button>
          <button type="submit" class="btn primary" value="ok">Complete job</button>
        </div>
      </form>`);
    document.body.append(dlg);
    dlg.showModal();
    const pad = signaturePad(dlg.querySelector('canvas'));
    dlg.querySelector('[data-clear]').addEventListener('click', pad.clear);
    dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const submitBtn = e.target.querySelector('[type=submit]');
      await busy(submitBtn, async () => {
        if (!pad.isEmpty()) {
          await send({ method: 'POST', url: `${url}/photos`, blob: await pad.toBlob(), body: { category: 'signature', client_id: uid() } });
        }
        await action('complete', { note: fd.get('note') || null, signed_by: fd.get('signed_by') || null }, (j) => {
          j.status = 'completed';
          j.completion_notes = fd.get('note');
          j.signed_by = fd.get('signed_by');
        });
        dlg.close();
        toast('Job completed', 'ok');
      });
    });
    dlg.addEventListener('close', () => dlg.remove());
  }

  // ---- Events ---------------------------------------------------------------

  on('click', async (e) => {
    const t = e.target.closest('[data-act],[data-capture],[data-gallery],[data-photo],[data-del-photo],[data-del-asset],[data-del-item],[data-scan]');
    if (!t) return;
    const d = t.dataset;
    if (d.capture) {
      captureCategory = d.capture;
      el.querySelector('[data-camera]').click();
    } else if ('gallery' in d) {
      el.querySelector('[data-gallery-input]').click();
    } else if (d.photo) {
      openPhoto(Number(d.photo));
    } else if ('scan' in d) {
      el.querySelector('[data-scan-input]').click();
    } else if (d.delPhoto) {
      if (await confirmDialog('Delete photo?', 'This photo will be removed from the job.', 'Delete', true)) {
        busy(t, async () => {
          job = (await api.del(`/photos/${d.delPhoto}`)).job;
          draw();
        });
      }
    } else if (d.delAsset) {
      busy(t, async () => {
        job = (await api.del(`${url}/assets/${d.delAsset}`)).job;
        draw();
      });
    } else if (d.delItem) {
      busy(t, async () => {
        job = (await api.del(`${url}/checklist/${d.delItem}`)).job;
        draw();
      });
    } else if (d.act === 'complete') {
      complete();
    } else if (d.act === 'check_in') {
      busy(t, async () => {
        t.textContent = 'Getting location…';
        const pos = await currentPosition();
        await action('check_in', pos ?? {}, (j) => {
          j.status = 'on_site';
          j.checkin_at = new Date().toISOString();
        });
        toast('Checked in', 'ok');
      });
    } else if (d.act === 'start_travel') {
      busy(t, () => action('start_travel', {}, (j) => { j.status = 'en_route'; }));
    } else if (d.act === 'approve') {
      busy(t, async () => {
        await action('approve');
        toast('Job approved', 'ok');
      });
    } else if (d.act === 'return') {
      const fd = await dialog({
        title: 'Send back to engineer',
        body: html`<label>What needs to be fixed?<textarea name="note" rows="3" required maxlength="5000"></textarea></label>`,
        submit: 'Send back',
      });
      if (fd) busy(t, () => action('return', { note: fd.get('note') }));
    } else if (d.act === 'cancel') {
      const fd = await dialog({
        title: 'Cancel job?',
        body: html`<p>The engineer will no longer see this as an open job.</p><label>Reason<textarea name="note" rows="2" maxlength="5000"></textarea></label>`,
        submit: 'Cancel job',
        danger: true,
      });
      if (fd) busy(t, () => action('cancel', { note: fd.get('note') || null }));
    }
  });

  on('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-camera]') && t.files.length) {
      await busy(null, () => queuePhotos([...t.files], captureCategory));
      t.value = '';
    } else if (t.matches('[data-gallery-input]') && t.files.length) {
      const files = [...t.files];
      t.value = '';
      const fd = await dialog({
        title: files.length > 1 ? `Add ${files.length} photos` : 'Add photo',
        body: html`<label>What do they show?<select name="category">${CAPTURE_CATEGORIES.map((c) => html`<option value="${c}">${PHOTO_LABELS[c]}</option>`)}</select></label>`,
        submit: 'Upload',
      });
      if (fd) await busy(null, () => queuePhotos(files, fd.get('category')));
    } else if (t.matches('[data-scan-input]') && t.files.length) {
      const file = t.files[0];
      t.value = '';
      busy(null, async () => {
        const code = await scanBarcode(file);
        if (!code) return toast('No barcode found. Try again closer and in focus.', 'error');
        el.querySelector('[data-form=asset] [name=serial]').value = code;
      });
    } else if (t.matches('[data-check]')) {
      const itemId = Number(t.dataset.check);
      const done = t.checked;
      busy(null, () => send({ method: 'PUT', url: `${url}/checklist/${itemId}`, body: { done } }, (j) => {
        const item = j.checklist.find((c) => c.id === itemId);
        item.done = done ? 1 : 0;
      }));
    }
  });

  on('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button:not([type=button])');
    if (form.dataset.form === 'note') {
      const clientId = uid();
      busy(btn, () => send({ method: 'POST', url: `${url}/notes`, body: { message: fd.message, client_id: clientId } }, (j) => {
        j.events.push({ id: `local-${clientId}`, type: 'note', message: fd.message, created_at: new Date().toISOString(), user_name: user.name, pending: true });
      }));
    } else if (form.dataset.form === 'asset') {
      busy(btn, () => send({ method: 'POST', url: `${url}/assets`, body: { ...fd, client_id: uid() } }));
    } else if (form.dataset.form === 'checklist') {
      busy(btn, async () => {
        job = (await api.post(`${url}/checklist`, { label: fd.label })).job;
        draw();
      });
    }
  });

  // Refresh after queued changes upload, so server state replaces local guesses.
  const onSync = async () => {
    const before = pending.length;
    await loadPending();
    if (before && pending.length < before) {
      try {
        const fresh = await api.get(url);
        job = fresh.data.job;
        offline = fresh.offline;
      } catch {
        /* keep current */
      }
    }
    draw();
  };
  api.onChange(onSync);

  await loadPending();
  draw();

  return () => {
    controller.abort();
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
    api.offChange(onSync);
  };
}

