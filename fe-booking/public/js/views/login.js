import * as api from '../api.js';
import { html, mount, busy } from '../ui.js';

export async function loginView(el, { signedIn }) {
  mount(el, html`
    <div class="login">
      <div class="login-brand">
        <img src="/icon.svg" alt="" width="56" height="56">
        <h1>FE Booking</h1>
        <p class="muted">Field engineer jobs, photos and sign-off</p>
      </div>
      <form class="card stack" id="login-form">
        <label>Email<input name="email" type="email" autocomplete="username" required autofocus></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" id="login-error" hidden></p>
        <button class="btn primary block" type="submit">Sign in</button>
      </form>
    </div>`);
  const form = el.querySelector('#login-form');
  const error = el.querySelector('#login-error');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    error.hidden = true;
    busy(form.querySelector('button'), async () => {
      try {
        const fd = new FormData(form);
        const { user } = await api.post('/auth/login', { email: fd.get('email'), password: fd.get('password') });
        signedIn(user);
      } catch (err) {
        error.textContent = err instanceof api.OfflineError ? 'No connection. Signing in needs signal.' : err.message;
        error.hidden = false;
      }
    });
  });
}
