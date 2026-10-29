import * as api from '../api.js';
import { html, mount, icon, toast, busy } from '../ui.js';

export async function accountView(el, { user, signOut }) {
  mount(el, html`
    <div class="page narrow">
      <h1>Account</h1>
      <section class="card">
        <h2>${user.name}</h2>
        <p class="muted">${user.email} · ${user.role === 'engineer' ? 'Field engineer' : user.role === 'admin' ? 'Admin' : 'Dispatcher'}</p>
        <div class="row wrap">
          <a class="btn" href="#/sync">${icon('upload')} Upload queue</a>
          <button class="btn danger" data-signout>${icon('logout')} Sign out</button>
        </div>
      </section>
      <section class="card">
        <h2>Change password</h2>
        <form class="stack" id="pw-form">
          <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
          <label>New password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
          <button class="btn primary">Change password</button>
        </form>
      </section>
      <section class="card">
        <h2>Install on your phone</h2>
        <p class="muted">Android (Chrome): menu ⋮ → <strong>Install app</strong>. iPhone (Safari): Share → <strong>Add to Home Screen</strong>.
        The app then opens full screen and keeps working without signal.</p>
      </section>
    </div>`);

  el.querySelector('[data-signout]').addEventListener('click', signOut);
  const form = el.querySelector('#pw-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form.querySelector('button'), async () => {
      await api.post('/me/password', Object.fromEntries(new FormData(form)));
      form.reset();
      toast('Password changed', 'ok');
    });
  });
}
