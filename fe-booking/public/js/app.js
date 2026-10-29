import * as api from './api.js';
import { cache, outbox } from './store.js';
import { html, mount, icon, toast } from './ui.js';
import { loginView } from './views/login.js';
import { myJobsView } from './views/my-jobs.js';
import { jobView } from './views/job.js';
import { boardView } from './views/board.js';
import { jobFormView } from './views/job-form.js';
import { calendarView } from './views/calendar.js';
import { sitesView } from './views/sites.js';
import { usersView } from './views/users.js';
import { accountView } from './views/account.js';
import { syncView } from './views/sync.js';

const OFFICE = ['admin', 'dispatcher'];

const routes = [
  { path: /^\/login$/, view: loginView, public: true },
  { path: /^\/my$/, view: myJobsView },
  { path: /^\/jobs$/, view: boardView, roles: OFFICE },
  { path: /^\/jobs\/new$/, view: jobFormView, roles: OFFICE },
  { path: /^\/jobs\/(\d+)\/edit$/, view: jobFormView, roles: OFFICE },
  { path: /^\/jobs\/(\d+)$/, view: jobView },
  { path: /^\/calendar$/, view: calendarView, roles: OFFICE },
  { path: /^\/sites$/, view: sitesView, roles: OFFICE },
  { path: /^\/users$/, view: usersView, roles: ['admin'] },
  { path: /^\/account$/, view: accountView },
  { path: /^\/sync$/, view: syncView },
];

const state = { user: null };
const main = document.getElementById('main');

export const homePath = (user) => (OFFICE.includes(user?.role) ? '/jobs' : '/my');
export const navigate = (path) => {
  location.hash = `#${path}`;
};

function navLinks(user) {
  if (!user) return [];
  const links = OFFICE.includes(user.role)
    ? [['/jobs', 'Jobs', 'list'], ['/calendar', 'Calendar', 'calendar'], ['/sites', 'Sites', 'building']]
    : [['/my', 'My jobs', 'list']];
  if (user.role === 'admin') links.push(['/users', 'Team', 'users']);
  links.push(['/account', 'Account', 'user']);
  return links;
}

function renderShell(currentPath) {
  const links = navLinks(state.user);
  const nav = links.map(([href, label, ic]) => html`
    <a href="#${href}" class="${currentPath.startsWith(href) ? 'active' : ''}">${icon(ic)}<span>${label}</span></a>`);
  document.body.classList.toggle('signed-in', !!state.user);
  mount(document.getElementById('nav'), nav);
  mount(document.getElementById('tabbar'), nav);
}

async function renderSyncBadge() {
  const el = document.getElementById('sync');
  const items = await outbox.all().catch(() => []);
  const failed = items.filter((i) => i.error).length;
  const offline = !navigator.onLine;
  if (!state.user || (!items.length && !offline)) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `sync-pill ${failed ? 'error' : offline ? 'offline' : 'pending'}`;
  const label = failed
    ? `${failed} not sent`
    : items.length
      ? `${items.length} waiting to upload`
      : 'Offline';
  mount(el, html`${icon(offline ? 'cloud-off' : 'upload')}<span>${label}</span>`);
}

let cleanup;
async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = new URLSearchParams(qs);

  if (!state.user && path !== '/login') return navigate('/login');
  if (path === '/' || path === '') return navigate(homePath(state.user));
  if (state.user && path === '/login') return navigate(homePath(state.user));

  const match = routes.map((r) => ({ r, m: path.match(r.path) })).find((x) => x.m);
  renderShell(path);
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  if (!match || (match.r.roles && !match.r.roles.includes(state.user.role))) {
    mount(main, html`<div class="empty"><h1>Page not found</h1><a class="btn" href="#${homePath(state.user)}">Go home</a></div>`);
    return;
  }
  const ctx = {
    params: match.m.slice(1),
    query,
    user: state.user,
    rerender: route,
    signedIn: (user) => {
      state.user = user;
      navigate(homePath(user));
    },
    signOut,
  };
  try {
    cleanup = await match.r.view(main, ctx);
  } catch (err) {
    const offline = err instanceof api.OfflineError;
    mount(main, html`
      <div class="empty">
        <h1>${offline ? 'You are offline' : 'Could not load this page'}</h1>
        <p class="muted">${offline ? "This page hasn't been opened on this device before. It will load once you have signal." : err.message}</p>
        <button class="btn" data-retry>Try again</button>
      </div>`);
    main.querySelector('[data-retry]').addEventListener('click', route);
  }
  document.title = `${main.querySelector('h1')?.textContent?.trim() || 'FE Booking'} · FE Booking`;
}

async function signOut() {
  const pending = (await outbox.all()).length;
  if (pending && !confirm(`${pending} change(s) have not been uploaded yet and will be lost. Sign out anyway?`)) return;
  try {
    await api.post('/auth/logout');
  } catch {
    // Offline: still clear this device.
  }
  await Promise.all([cache.clear(), outbox.clear()]);
  navigator.serviceWorker?.controller?.postMessage('clear-private');
  state.user = null;
  navigate('/login');
}

api.onUnauthorized(() => {
  if (!state.user) return;
  state.user = null;
  toast('Your session ended. Please sign in again.', 'error');
  navigate('/login');
});
api.onChange(renderSyncBadge);
window.addEventListener('online', renderSyncBadge);
window.addEventListener('offline', renderSyncBadge);
window.addEventListener('hashchange', route);

async function boot() {
  try {
    state.user = (await api.get('/me')).data.user;
  } catch {
    state.user = null;
  }
  await route();
  renderSyncBadge();
  api.syncNow();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
