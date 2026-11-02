import * as api from '../api.js';
import { html, mount, icon, dialog, toast, busy } from '../ui.js';

const siteForm = (s = {}) => html`
  <div class="stack">
    <label>Name<input name="name" required maxlength="200" value="${s.name ?? ''}" placeholder="e.g. Telehouse DC1"></label>
    <label>Address<input name="address" maxlength="300" value="${s.address ?? ''}"></label>
    <label>City<input name="city" maxlength="120" value="${s.city ?? ''}"></label>
    <div class="grid-2">
      <label>Contact name<input name="contact_name" maxlength="120" value="${s.contact_name ?? ''}"></label>
      <label>Contact phone<input name="contact_phone" type="tel" maxlength="40" value="${s.contact_phone ?? ''}"></label>
    </div>
    <label>Access notes<textarea name="access_notes" rows="3" maxlength="2000" placeholder="Badge, keys, parking, opening hours…">${s.access_notes ?? ''}</textarea></label>
  </div>`;

export async function sitesView(el, { rerender }) {
  const { data } = await api.get('/sites');

  mount(el, html`
    <div class="page">
      <header class="page-head">
        <h1>Sites</h1>
        <button class="btn primary" data-new>${icon('plus')} New site</button>
      </header>
      ${data.sites.length ? html`
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Site</th><th>City</th><th>Contact</th><th>Jobs</th><th></th></tr></thead>
            <tbody>
              ${data.sites.map((s) => html`
                <tr>
                  <td><strong>${s.name}</strong>${s.address ? html`<div class="small muted">${s.address}</div>` : ''}</td>
                  <td>${s.city ?? ''}</td>
                  <td>${s.contact_name ?? ''}${s.contact_phone ? html`<div class="small"><a href="tel:${s.contact_phone}">${s.contact_phone}</a></div>` : ''}</td>
                  <td><a href="#/jobs?f=all&site=${s.id}">${s.job_count} job${s.job_count === 1 ? '' : 's'}</a></td>
                  <td class="actions">
                    <a class="btn small ghost" href="#/jobs/new?site=${s.id}">Book job</a>
                    <button class="btn small" data-edit="${s.id}">Edit</button>
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : html`<div class="empty"><p class="muted">No sites yet. Add the locations your engineers visit.</p></div>`}
    </div>`);

  el.querySelector('.page').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-new],[data-edit]');
    if (!t) return;
    const site = t.dataset.edit ? data.sites.find((s) => s.id === Number(t.dataset.edit)) : null;
    const fd = await dialog({ title: site ? `Edit ${site.name}` : 'New site', body: siteForm(site ?? {}), submit: site ? 'Save' : 'Add site' });
    if (!fd) return;
    await busy(t, async () => {
      const body = Object.fromEntries(fd);
      if (site) await api.patch(`/sites/${site.id}`, body);
      else await api.post('/sites', body);
      toast('Site saved', 'ok');
      rerender();
    });
  });
}
