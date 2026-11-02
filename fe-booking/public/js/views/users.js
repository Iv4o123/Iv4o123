import * as api from '../api.js';
import { html, mount, icon, dialog, toast, busy } from '../ui.js';

const ROLE_LABELS = { admin: 'Admin', dispatcher: 'Dispatcher', engineer: 'Field engineer' };

const userForm = (u) => html`
  <div class="stack">
    <label>Name<input name="name" required maxlength="120" value="${u?.name ?? ''}"></label>
    ${u ? '' : html`<label>Email<input name="email" type="email" required maxlength="200"></label>`}
    <label>Phone<input name="phone" type="tel" maxlength="40" value="${u?.phone ?? ''}"></label>
    <label>Role
      <select name="role">${Object.entries(ROLE_LABELS).map(([k, v]) => html`<option value="${k}" ${k === (u?.role ?? 'engineer') ? 'selected' : ''}>${v}</option>`)}</select>
    </label>
    <label>${u ? 'New password (leave empty to keep)' : 'Password'}
      <input name="password" type="password" minlength="8" autocomplete="new-password" ${u ? '' : 'required'}>
    </label>
    ${u ? html`<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> <span>Active (can sign in)</span></label>` : ''}
  </div>`;

export async function usersView(el, { rerender, user: me }) {
  const { data } = await api.get('/users');

  mount(el, html`
    <div class="page">
      <header class="page-head">
        <h1>Team</h1>
        <button class="btn primary" data-new>${icon('plus')} Add person</button>
      </header>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${data.users.map((u) => html`
              <tr class="${u.active ? '' : 'inactive'}">
                <td><strong>${u.name}</strong>${u.id === me.id ? html` <span class="muted small">(you)</span>` : ''}<div class="small muted">${u.email}</div></td>
                <td>${ROLE_LABELS[u.role]}</td>
                <td>${u.phone ? html`<a href="tel:${u.phone}">${u.phone}</a>` : ''}</td>
                <td>${u.active ? 'Active' : 'Deactivated'}</td>
                <td class="actions">
                  ${u.role === 'engineer' ? html`<a class="btn small ghost" href="#/jobs?f=open&engineer=${u.id}">Jobs</a>` : ''}
                  <button class="btn small" data-edit="${u.id}">Edit</button>
                </td>
              </tr>`)}
          </tbody>
        </table>
      </div>
    </div>`);

  el.querySelector('.page').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-new],[data-edit]');
    if (!t) return;
    const u = t.dataset.edit ? data.users.find((x) => x.id === Number(t.dataset.edit)) : null;
    const fd = await dialog({ title: u ? `Edit ${u.name}` : 'Add person', body: userForm(u), submit: u ? 'Save' : 'Add' });
    if (!fd) return;
    await busy(t, async () => {
      const body = Object.fromEntries(fd);
      if (u) {
        body.active = fd.get('active') === 'on';
        if (!body.password) delete body.password;
        await api.patch(`/users/${u.id}`, body);
      } else {
        await api.post('/users', body);
      }
      toast('Saved', 'ok');
      rerender();
    });
  });
}
