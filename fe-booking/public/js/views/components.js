import { html, icon, statusBadge, priorityBadge, fmtSlot } from '../ui.js';

export function jobCard(job, { showEngineer = false } = {}) {
  const progress = job.checklist_total ? html`<span>${icon('check')} ${job.checklist_done}/${job.checklist_total}</span>` : '';
  return html`
    <a class="job-card prio-edge-${job.priority}" href="#/jobs/${job.id}">
      <div class="job-card-top">
        <span class="ref">${job.ref}</span>
        ${priorityBadge(job.priority)}
        ${statusBadge(job.status)}
      </div>
      <div class="job-title">${job.title}</div>
      <div class="job-meta">
        ${job.site_name ? html`<span>${icon('building')} ${job.site_name}${job.rack ? ` · Rack ${job.rack}` : ''}</span>` : ''}
        <span>${icon('clock')} ${fmtSlot(job.scheduled_start, job.scheduled_end)}</span>
        ${showEngineer ? html`<span>${icon('user')} ${job.engineer_name ?? 'Unassigned'}</span>` : ''}
        <span>${icon('camera')} ${job.photo_count}</span>
        ${progress}
      </div>
    </a>`;
}

export function offlineNote(offline) {
  return offline ? html`<p class="notice offline">${icon('cloud-off')} Offline — showing what was last loaded on this device.</p>` : '';
}
