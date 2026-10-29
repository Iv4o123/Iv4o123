import * as api from '../api.js';
import { html, mount, icon, fmtTime, isSameDay, STATUS_LABELS } from '../ui.js';
import { offlineNote } from './components.js';

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Week board: one row per engineer, one column per day. Tap an empty slot to book a job.
export async function calendarView(el, { query }) {
  const start = mondayOf(query.get('week') ? new Date(`${query.get('week')}T00:00`) : new Date());
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const prev = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);

  const [{ data, offline }, users] = await Promise.all([
    api.get(`/jobs?from=${start.toISOString()}&to=${end.toISOString()}&status=unassigned,assigned,en_route,on_site,returned,completed,approved`),
    api.get('/users'),
  ]);
  const jobs = data.jobs.filter((j) => j.scheduled_start);
  const engineers = users.data.users.filter((u) => u.role === 'engineer' && u.active);
  const rows = [...engineers.map((u) => ({ id: u.id, name: u.name })), { id: null, name: 'Unassigned' }];
  const today = new Date();
  const unscheduled = data.jobs.filter((j) => !j.scheduled_start && !['approved'].includes(j.status));

  const cell = (row, day) => {
    const list = jobs
      .filter((j) => (j.assigned_to ?? null) === row.id && isSameDay(new Date(j.scheduled_start), day))
      .sort((a, b) => (a.scheduled_start > b.scheduled_start ? 1 : -1));
    const bookHref = `#/jobs/new?start=${encodeURIComponent(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).toISOString())}${row.id ? `&engineer=${row.id}` : ''}`;
    return html`
      <div class="cal-cell ${isSameDay(day, today) ? 'today' : ''}">
        ${list.map((j) => html`
          <a class="cal-job status-${j.status}" href="#/jobs/${j.id}" title="${j.title} · ${STATUS_LABELS[j.status]}">
            <span class="cal-time">${fmtTime(j.scheduled_start)}</span>
            <span class="cal-title">${j.title}</span>
            ${j.site_name ? html`<span class="cal-site">${j.site_name}</span>` : ''}
          </a>`)}
        <a class="cal-add" href="${bookHref}" aria-label="Book ${row.name} on ${day.toDateString()}">${icon('plus')}</a>
      </div>`;
  };

  mount(el, html`
    <div class="page wide">
      <header class="page-head">
        <h1>Calendar</h1>
        <div class="row">
          <a class="btn" href="#/calendar?week=${ymd(prev)}" aria-label="Previous week">${icon('chevron-left')}</a>
          <a class="btn ghost" href="#/calendar">This week</a>
          <a class="btn" href="#/calendar?week=${ymd(end)}" aria-label="Next week">${icon('chevron-right')}</a>
        </div>
      </header>
      <p class="muted">${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      ${offlineNote(offline)}
      <div class="cal-scroll">
        <div class="cal">
          <div class="cal-corner"></div>
          ${days.map((d) => html`<div class="cal-day ${isSameDay(d, today) ? 'today' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short' })} <strong>${d.getDate()}</strong></div>`)}
          ${rows.map((row) => html`
            <div class="cal-eng">${row.name}</div>
            ${days.map((d) => cell(row, d))}`)}
        </div>
      </div>
      ${unscheduled.length ? html`
        <section class="section">
          <h2>Not scheduled <span class="count">${unscheduled.length}</span></h2>
          <ul class="plain-list">${unscheduled.map((j) => html`<li><a href="#/jobs/${j.id}">${j.ref} · ${j.title}</a> <span class="muted">${j.engineer_name ?? 'Unassigned'}</span></li>`)}</ul>
        </section>` : ''}
    </div>`);

  // Grid column count depends on data, so it is set via CSSOM (CSP forbids inline style attributes).
  el.querySelector('.cal').style.gridTemplateColumns = `minmax(110px, 140px) repeat(7, minmax(120px, 1fr))`;
}
