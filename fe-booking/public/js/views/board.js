import * as api from '../api.js';
import { html, mount, icon } from '../ui.js';
import { jobCard, offlineNote } from './components.js';

const FILTERS = [
  ['open', 'Open', 'unassigned,assigned,en_route,on_site,returned'],
  ['review', 'Needs review', 'completed'],
  ['unassigned', 'Unassigned', 'unassigned'],
  ['active', 'On site / travelling', 'en_route,on_site'],
  ['approved', 'Approved', 'approved'],
  ['all', 'All', ''],
];

export async function boardView(el, { query }) {
  const filter = FILTERS.find((f) => f[0] === query.get('f')) ?? FILTERS[0];
  const q = query.get('q') ?? '';
  const engineer = query.get('engineer') ?? '';
  const site = query.get('site') ?? '';

  const params = new URLSearchParams();
  if (filter[2]) params.set('status', filter[2]);
  if (q) params.set('q', q);
  if (engineer) params.set('engineer', engineer);
  if (site) params.set('site', site);

  const [{ data, offline }, users, review] = await Promise.all([
    api.get(`/jobs?${params}`),
    api.get('/users'),
    api.get('/jobs?status=completed'),
  ]);
  const engineers = users.data.users.filter((u) => u.role === 'engineer' && u.active);
  const reviewCount = review.data.jobs.length;

  const link = (changes) => {
    const p = new URLSearchParams(query);
    for (const [k, v] of Object.entries(changes)) v ? p.set(k, v) : p.delete(k);
    return `#/jobs?${p}`;
  };

  mount(el, html`
    <div class="page">
      <header class="page-head">
        <h1>Jobs</h1>
        <a class="btn primary" href="#/jobs/new">${icon('plus')} New job</a>
      </header>
      ${offlineNote(offline)}
      ${reviewCount && filter[0] !== 'review' ? html`
        <a class="notice info link" href="${link({ f: 'review' })}">${reviewCount} job${reviewCount > 1 ? 's' : ''} waiting for your review →</a>` : ''}
      <div class="filters">
        <nav class="chips" aria-label="Status">
          ${FILTERS.map(([key, label]) => html`<a class="chip ${key === filter[0] ? 'active' : ''}" href="${link({ f: key })}">${label}${key === 'review' && reviewCount ? html` <span class="count">${reviewCount}</span>` : ''}</a>`)}
        </nav>
        <form class="row wrap" id="board-search">
          <input type="search" name="q" value="${q}" placeholder="Search ref, site, rack, ticket, serial…" aria-label="Search">
          <select name="engineer" aria-label="Engineer">
            <option value="">All engineers</option>
            <option value="none" ${engineer === 'none' ? 'selected' : ''}>Unassigned</option>
            ${engineers.map((u) => html`<option value="${u.id}" ${String(u.id) === engineer ? 'selected' : ''}>${u.name}</option>`)}
          </select>
          <button class="btn">${icon('search')} Search</button>
          ${q || engineer || site ? html`<a class="btn ghost" href="${link({ q: '', engineer: '', site: '' })}">Clear</a>` : ''}
        </form>
      </div>
      ${data.jobs.length
        ? html`<div class="cards">${data.jobs.map((j) => jobCard(j, { showEngineer: true }))}</div>`
        : html`<div class="empty"><p class="muted">No ${filter[0] === 'all' ? '' : filter[1].toLowerCase() + ' '}jobs${q ? ` matching “${q}”` : ''}.</p></div>`}
    </div>`);

  el.querySelector('#board-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    location.hash = link({ q: fd.get('q').trim(), engineer: fd.get('engineer') });
  });
}

