import * as api from '../api.js';
import { html, mount, icon, toast, busy, toLocalInput, fromLocalInput, PRIORITY_LABELS } from '../ui.js';
import { navigate } from '../app.js';

export async function jobFormView(el, { params, query }) {
  const editing = params[0] ? Number(params[0]) : null;
  const [sites, users, existing] = await Promise.all([
    api.get('/sites'),
    api.get('/users'),
    editing ? api.get(`/jobs/${editing}`) : null,
  ]);
  const job = existing?.data.job ?? {
    priority: 'normal',
    site_id: query.get('site') ? Number(query.get('site')) : null,
    scheduled_start: query.get('start'),
    assigned_to: query.get('engineer') ? Number(query.get('engineer')) : null,
  };
  const engineers = users.data.users.filter((u) => u.role === 'engineer' && (u.active || u.id === job.assigned_to));
  const locked = editing && !['unassigned', 'assigned'].includes(job.status);

  mount(el, html`
    <div class="page narrow">
      <a class="back" href="#${editing ? `/jobs/${editing}` : '/jobs'}">${icon('chevron-left')} Back</a>
      <h1>${editing ? `Edit ${job.ref}` : 'New job'}</h1>
      <form class="card stack" id="job-form">
        <label>Title<input name="title" required maxlength="200" value="${job.title ?? ''}" placeholder="e.g. Install core switch"></label>
        <div class="grid-2">
          <label>Site
            <select name="site_id">
              <option value="">— No site —</option>
              ${sites.data.sites.map((s) => html`<option value="${s.id}" ${s.id === job.site_id ? 'selected' : ''}>${s.name}${s.city ? ` (${s.city})` : ''}</option>`)}
            </select>
            <a class="small" href="#/sites">Add or edit sites</a>
          </label>
          <label>Rack<input name="rack" maxlength="100" value="${job.rack ?? ''}" placeholder="e.g. B3"></label>
        </div>
        <label>What needs to be done<textarea name="description" rows="5" maxlength="5000">${job.description ?? ''}</textarea></label>
        <div class="grid-2">
          <label>Engineer
            <select name="assigned_to" ${locked ? 'disabled' : ''}>
              <option value="">— Unassigned —</option>
              ${engineers.map((u) => html`<option value="${u.id}" ${u.id === job.assigned_to ? 'selected' : ''}>${u.name}</option>`)}
            </select>
            ${locked ? html`<span class="small muted">Engineer can't be removed while the job is in progress.</span>` : ''}
          </label>
          <label>Priority
            <select name="priority">
              ${Object.entries(PRIORITY_LABELS).map(([k, v]) => html`<option value="${k}" ${k === job.priority ? 'selected' : ''}>${v}</option>`)}
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label>Start<input type="datetime-local" name="scheduled_start" value="${toLocalInput(job.scheduled_start)}"></label>
          <label>End<input type="datetime-local" name="scheduled_end" value="${toLocalInput(job.scheduled_end)}"></label>
        </div>
        <label>Ticket / reference<input name="ticket_ref" maxlength="100" value="${job.ticket_ref ?? ''}" placeholder="e.g. INC-10422"></label>
        ${editing ? '' : html`
          <label>Checklist <span class="muted small">(one item per line)</span>
            <textarea name="checklist" rows="4" placeholder="Equipment mounted and powered\nPorts patched\nCables labelled"></textarea>
          </label>`}
        <p class="form-error" id="form-error" hidden></p>
        <div class="row end">
          <a class="btn ghost" href="#${editing ? `/jobs/${editing}` : '/jobs'}">Cancel</a>
          <button class="btn primary" type="submit">${editing ? 'Save changes' : 'Create job'}</button>
        </div>
      </form>
    </div>`);

  const form = el.querySelector('#job-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      title: fd.get('title'),
      site_id: fd.get('site_id') || null,
      rack: fd.get('rack'),
      description: fd.get('description'),
      priority: fd.get('priority'),
      scheduled_start: fromLocalInput(fd.get('scheduled_start')),
      scheduled_end: fromLocalInput(fd.get('scheduled_end')),
      ticket_ref: fd.get('ticket_ref'),
    };
    if (!locked) body.assigned_to = fd.get('assigned_to') || null;
    if (!editing) body.checklist = String(fd.get('checklist') ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const error = el.querySelector('#form-error');
    error.hidden = true;
    busy(form.querySelector('[type=submit]'), async () => {
      try {
        const res = editing ? await api.patch(`/jobs/${editing}`, body) : await api.post('/jobs', body);
        for (const w of res.warnings ?? []) toast(`Booking clash: ${w}`, 'error');
        if (!res.warnings?.length) toast(editing ? 'Saved' : `Job ${res.job.ref} created`, 'ok');
        navigate(`/jobs/${res.job.id}`);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  });
}
