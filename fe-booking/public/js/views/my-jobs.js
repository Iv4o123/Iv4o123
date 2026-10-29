import * as api from '../api.js';
import { html, mount, isSameDay } from '../ui.js';
import { jobCard, offlineNote } from './components.js';

const ACTIVE = ['assigned', 'en_route', 'on_site', 'returned'];

export async function myJobsView(el, { user }) {
  const { data, offline } = await api.get('/jobs');
  const today = new Date();
  const jobs = data.jobs;

  const needsWork = jobs.filter((j) => j.status === 'returned');
  const inProgress = jobs.filter((j) => ['en_route', 'on_site'].includes(j.status));
  const todays = jobs.filter((j) => j.status === 'assigned' && (!j.scheduled_start || isSameDay(new Date(j.scheduled_start), today) || new Date(j.scheduled_start) < today));
  const upcoming = jobs.filter((j) => j.status === 'assigned' && j.scheduled_start && new Date(j.scheduled_start) > today && !isSameDay(new Date(j.scheduled_start), today));
  const done = jobs.filter((j) => !ACTIVE.includes(j.status)).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 10);

  const section = (title, list, empty) => html`
    <section class="section">
      <h2>${title} ${list.length ? html`<span class="count">${list.length}</span>` : ''}</h2>
      ${list.length ? html`<div class="cards">${list.map((j) => jobCard(j))}</div>` : empty ? html`<p class="muted">${empty}</p>` : ''}
    </section>`;

  mount(el, html`
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Hi, ${user.name.split(' ')[0]}</h1>
          <p class="muted">${today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>
      ${offlineNote(offline)}
      ${needsWork.length ? section('Sent back to you', needsWork) : ''}
      ${inProgress.length ? section('In progress', inProgress) : ''}
      ${section('Today', todays, inProgress.length || needsWork.length ? null : 'No jobs for today.')}
      ${upcoming.length ? section('Upcoming', upcoming) : ''}
      ${done.length ? section('Recently finished', done) : ''}
    </div>`);

  // Pre-load job details so they open without signal later in the day.
  if (!offline) for (const j of jobs.filter((j) => ACTIVE.includes(j.status))) api.get(`/jobs/${j.id}`).catch(() => {});
}
