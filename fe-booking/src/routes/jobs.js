import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole, isOffice } from '../auth.js';
import { tx, nowIso } from '../db.js';
import { str, oneOf, isoDate, badRequest, forbidden, notFound, conflict } from '../errors.js';
import { ACTIONS, PRIORITIES, PHOTO_CATEGORIES, EDITABLE_BY_ENGINEER, CLOSED } from '../workflow.js';
import { sniffImage } from '../storage.js';

const JOB_SELECT = `
  SELECT j.*, s.name AS site_name, s.address AS site_address, s.city AS site_city,
         s.contact_name AS site_contact_name, s.contact_phone AS site_contact_phone,
         s.access_notes AS site_access_notes,
         u.name AS engineer_name, u.phone AS engineer_phone,
         (SELECT COUNT(*) FROM photos p WHERE p.job_id = j.id AND p.category != 'signature') AS photo_count,
         (SELECT COUNT(*) FROM checklist_items c WHERE c.job_id = j.id) AS checklist_total,
         (SELECT COUNT(*) FROM checklist_items c WHERE c.job_id = j.id AND c.done = 1) AS checklist_done
  FROM jobs j
  LEFT JOIN sites s ON s.id = j.site_id
  LEFT JOIN users u ON u.id = j.assigned_to`;

export function jobRoutes({ db, storage, config }) {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPhotoBytes, files: 1 } });

  const getJob = db.prepare(`${JOB_SELECT} WHERE j.id = ?`);
  const logEvent = db.prepare('INSERT INTO job_events (job_id, user_id, type, message, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const touch = db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?');

  // Loads a job the current user may see: office sees all, engineers only their own.
  function loadJob(req, id = req.params.id) {
    const job = getJob.get(Number(id));
    if (!job) throw notFound('Job not found');
    if (!isOffice(req.user) && job.assigned_to !== req.user.id) throw notFound('Job not found');
    return job;
  }

  // Engineers may only change work details while the job is in progress.
  function assertCanEditWork(req, job) {
    if (CLOSED.includes(job.status)) throw conflict('This job is closed');
    if (!isOffice(req.user) && !EDITABLE_BY_ENGINEER.includes(job.status)) {
      throw conflict('This job is waiting for review and can no longer be changed');
    }
  }

  const seenClientId = (table, clientId) =>
    clientId ? db.prepare(`SELECT * FROM ${table} WHERE client_id = ?`).get(clientId) : null;

  function engineerOrNull(id) {
    if (id === undefined || id === null || id === '') return null;
    const u = db.prepare("SELECT id, active FROM users WHERE id = ? AND role = 'engineer'").get(Number(id));
    if (!u || !u.active) throw badRequest('Assigned engineer not found');
    return u.id;
  }

  function siteOrNull(id) {
    if (id === undefined || id === null || id === '') return null;
    if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(Number(id))) throw badRequest('Site not found');
    return Number(id);
  }

  // Warn (not block) when the engineer already has a job in the same time slot.
  function bookingWarnings(job) {
    if (!job.assigned_to || !job.scheduled_start) return [];
    const end = job.scheduled_end ?? new Date(new Date(job.scheduled_start).getTime() + 3600_000).toISOString();
    const clashes = db.prepare(`
      SELECT ref, title FROM jobs
      WHERE assigned_to = ? AND id != ? AND status NOT IN ('approved','cancelled','completed')
        AND scheduled_start < ? AND COALESCE(scheduled_end, scheduled_start) > ?`)
      .all(job.assigned_to, job.id ?? 0, end, job.scheduled_start);
    return clashes.map((c) => `Overlaps with ${c.ref} (${c.title})`);
  }

  function fullJob(id) {
    const job = getJob.get(id);
    job.checklist = db.prepare('SELECT * FROM checklist_items WHERE job_id = ? ORDER BY position, id').all(id);
    job.photos = db.prepare(`
      SELECT p.id, p.category, p.caption, p.mime, p.size, p.taken_at, p.created_at, p.uploaded_by, u.name AS uploaded_by_name
      FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by WHERE p.job_id = ? ORDER BY p.id`).all(id);
    job.assets = db.prepare('SELECT * FROM assets WHERE job_id = ? ORDER BY id').all(id);
    job.events = db.prepare(`
      SELECT e.id, e.type, e.message, e.created_at, u.name AS user_name
      FROM job_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.job_id = ? ORDER BY e.created_at, e.id`).all(id);
    return job;
  }

  // ---- List & read -------------------------------------------------------

  r.get('/jobs', requireAuth, (req, res) => {
    const where = [];
    const params = [];
    if (!isOffice(req.user)) {
      where.push('j.assigned_to = ?');
      params.push(req.user.id);
    } else if (req.query.engineer) {
      if (req.query.engineer === 'none') where.push('j.assigned_to IS NULL');
      else {
        where.push('j.assigned_to = ?');
        params.push(Number(req.query.engineer));
      }
    }
    if (req.query.status) {
      const list = String(req.query.status).split(',');
      where.push(`j.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
    if (req.query.from) {
      where.push('(j.scheduled_start >= ? OR j.scheduled_start IS NULL)');
      params.push(isoDate(req.query.from, 'from'));
    }
    if (req.query.to) {
      where.push('(j.scheduled_start < ? OR j.scheduled_start IS NULL)');
      params.push(isoDate(req.query.to, 'to'));
    }
    if (req.query.site) {
      where.push('j.site_id = ?');
      params.push(Number(req.query.site));
    }
    if (req.query.q) {
      const q = `%${String(req.query.q).trim()}%`;
      where.push(`(j.ref LIKE ? OR j.title LIKE ? OR j.rack LIKE ? OR j.ticket_ref LIKE ? OR s.name LIKE ? OR s.city LIKE ? OR u.name LIKE ?
        OR EXISTS (SELECT 1 FROM assets a WHERE a.job_id = j.id AND a.serial LIKE ?))`);
      params.push(q, q, q, q, q, q, q, q);
    }
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const sql = `${JOB_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY j.scheduled_start IS NULL, j.scheduled_start, j.id DESC LIMIT ${limit}`;
    res.json({ jobs: db.prepare(sql).all(...params) });
  });

  r.get('/jobs/:id', requireAuth, (req, res) => {
    const job = loadJob(req);
    res.json({ job: fullJob(job.id) });
  });

  // ---- Create & edit (office) -------------------------------------------

  r.post('/jobs', requireRole('admin', 'dispatcher'), (req, res) => {
    const b = req.body ?? {};
    const job = {
      title: str(b.title, { field: 'Title', required: true, max: 200 }),
      description: str(b.description, { field: 'Description', max: 5000 }),
      site_id: siteOrNull(b.site_id),
      rack: str(b.rack, { field: 'Rack', max: 100 }),
      ticket_ref: str(b.ticket_ref, { field: 'Ticket', max: 100 }),
      priority: b.priority ? oneOf(b.priority, PRIORITIES, 'Priority') : 'normal',
      assigned_to: engineerOrNull(b.assigned_to),
      scheduled_start: isoDate(b.scheduled_start, 'Start'),
      scheduled_end: isoDate(b.scheduled_end, 'End'),
    };
    if (job.scheduled_start && job.scheduled_end && job.scheduled_end <= job.scheduled_start) {
      throw badRequest('End must be after start');
    }
    const checklist = Array.isArray(b.checklist) ? b.checklist.map((l) => str(l, { field: 'Checklist item', max: 300 })).filter(Boolean) : [];
    const status = job.assigned_to ? 'assigned' : 'unassigned';
    const now = nowIso();

    const id = tx(db, () => {
      const { lastInsertRowid: id } = db.prepare(`
        INSERT INTO jobs (title, description, site_id, rack, ticket_ref, priority, status, assigned_to, scheduled_start, scheduled_end, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(job.title, job.description, job.site_id, job.rack, job.ticket_ref, job.priority, status,
          job.assigned_to, job.scheduled_start, job.scheduled_end, req.user.id, now, now);
      db.prepare('UPDATE jobs SET ref = ? WHERE id = ?').run(`FE-${String(id).padStart(5, '0')}`, id);
      const addItem = db.prepare('INSERT INTO checklist_items (job_id, label, position) VALUES (?, ?, ?)');
      checklist.forEach((label, i) => addItem.run(id, label, i));
      logEvent.run(id, req.user.id, 'created', job.assigned_to ? `Created and assigned` : 'Created', null, now);
      return Number(id);
    });
    res.status(201).json({ job: fullJob(id), warnings: bookingWarnings({ ...job, id }) });
  });

  r.patch('/jobs/:id', requireRole('admin', 'dispatcher'), (req, res) => {
    const job = loadJob(req);
    if (CLOSED.includes(job.status)) throw conflict('This job is closed');
    const b = req.body ?? {};
    const pick = (key, read) => (b[key] !== undefined ? read(b[key]) : job[key]);
    const next = {
      title: pick('title', (v) => str(v, { field: 'Title', required: true, max: 200 })),
      description: pick('description', (v) => str(v, { field: 'Description', max: 5000 })),
      site_id: pick('site_id', siteOrNull),
      rack: pick('rack', (v) => str(v, { field: 'Rack', max: 100 })),
      ticket_ref: pick('ticket_ref', (v) => str(v, { field: 'Ticket', max: 100 })),
      priority: pick('priority', (v) => oneOf(v, PRIORITIES, 'Priority')),
      assigned_to: pick('assigned_to', engineerOrNull),
      scheduled_start: pick('scheduled_start', (v) => isoDate(v, 'Start')),
      scheduled_end: pick('scheduled_end', (v) => isoDate(v, 'End')),
    };
    if (next.scheduled_start && next.scheduled_end && next.scheduled_end <= next.scheduled_start) {
      throw badRequest('End must be after start');
    }
    let status = job.status;
    if (status === 'unassigned' && next.assigned_to) status = 'assigned';
    if (status === 'assigned' && !next.assigned_to) status = 'unassigned';
    if (!next.assigned_to && !['unassigned', 'assigned'].includes(job.status)) {
      throw conflict('Cannot unassign a job that is already in progress');
    }
    const now = nowIso();
    tx(db, () => {
      db.prepare(`UPDATE jobs SET title = ?, description = ?, site_id = ?, rack = ?, ticket_ref = ?, priority = ?,
        assigned_to = ?, scheduled_start = ?, scheduled_end = ?, status = ?, updated_at = ? WHERE id = ?`)
        .run(next.title, next.description, next.site_id, next.rack, next.ticket_ref, next.priority,
          next.assigned_to, next.scheduled_start, next.scheduled_end, status, now, job.id);
      if (next.assigned_to !== job.assigned_to) {
        const name = next.assigned_to ? db.prepare('SELECT name FROM users WHERE id = ?').get(next.assigned_to).name : null;
        logEvent.run(job.id, req.user.id, 'assigned', name ? `Assigned to ${name}` : 'Unassigned', null, now);
      } else {
        logEvent.run(job.id, req.user.id, 'edited', 'Job details updated', null, now);
      }
    });
    res.json({ job: fullJob(job.id), warnings: bookingWarnings({ ...next, id: job.id }) });
  });

  // ---- Status actions ----------------------------------------------------

  r.post('/jobs/:id/actions', requireAuth, (req, res) => {
    const b = req.body ?? {};
    const clientId = str(b.client_id, { field: 'client_id', max: 100 });
    // Replayed from the offline queue after it already succeeded: just return current state.
    if (seenClientId('job_events', clientId)) return res.json({ job: fullJob(loadJob(req).id), duplicate: true });

    const job = loadJob(req);
    const action = ACTIONS[b.action];
    if (!action) throw badRequest('Unknown action');
    if (action.by === 'office' && !isOffice(req.user)) throw forbidden();
    if (action.by === 'engineer' && job.assigned_to !== req.user.id) throw forbidden('Only the assigned engineer can do this');
    if (!action.from.includes(job.status)) throw conflict(`Cannot ${b.action.replace('_', ' ')} a job that is ${job.status.replace('_', ' ')}`);

    const note = str(b.note, { field: 'Note', max: 5000 });
    // Offline actions carry the time they really happened on the device.
    let at = nowIso();
    if (b.at) {
      const t = new Date(b.at).getTime();
      if (!Number.isNaN(t) && t < Date.now() + 5 * 60_000 && t > Date.now() - 7 * 86400_000) at = new Date(t).toISOString();
    }

    tx(db, () => {
      switch (b.action) {
        case 'check_in': {
          const lat = Number.isFinite(b.lat) ? b.lat : null;
          const lng = Number.isFinite(b.lng) ? b.lng : null;
          db.prepare('UPDATE jobs SET checkin_at = ?, checkin_lat = ?, checkin_lng = ? WHERE id = ?').run(at, lat, lng, job.id);
          break;
        }
        case 'complete': {
          const counts = getJob.get(job.id);
          if (counts.photo_count < 1) throw conflict('Add at least one rack photo before completing');
          if (counts.checklist_done < counts.checklist_total) throw conflict('Finish the checklist before completing');
          const signedBy = str(b.signed_by, { field: 'Signed by', max: 120 });
          db.prepare('UPDATE jobs SET checkout_at = ?, completion_notes = ?, signed_by = ? WHERE id = ?').run(at, note, signedBy, job.id);
          break;
        }
        case 'approve':
        case 'return':
          if (b.action === 'return' && !note) throw badRequest('Say what needs to be fixed');
          db.prepare('UPDATE jobs SET reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ?').run(at, req.user.id, note, job.id);
          break;
      }
      db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run(action.to, nowIso(), job.id);
      logEvent.run(job.id, req.user.id, b.action, note, clientId, at);
    });
    res.json({ job: fullJob(job.id) });
  });

  // ---- Notes -------------------------------------------------------------

  r.post('/jobs/:id/notes', requireAuth, (req, res) => {
    const job = loadJob(req);
    const clientId = str(req.body?.client_id, { field: 'client_id', max: 100 });
    if (!seenClientId('job_events', clientId)) {
      const message = str(req.body?.message, { field: 'Note', required: true, max: 5000 });
      logEvent.run(job.id, req.user.id, 'note', message, clientId, nowIso());
      touch.run(nowIso(), job.id);
    }
    res.status(201).json({ job: fullJob(job.id) });
  });

  // ---- Checklist ---------------------------------------------------------

  r.post('/jobs/:id/checklist', requireRole('admin', 'dispatcher'), (req, res) => {
    const job = loadJob(req);
    assertCanEditWork(req, job);
    const label = str(req.body?.label, { field: 'Checklist item', required: true, max: 300 });
    const { pos } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM checklist_items WHERE job_id = ?').get(job.id);
    db.prepare('INSERT INTO checklist_items (job_id, label, position) VALUES (?, ?, ?)').run(job.id, label, pos);
    res.status(201).json({ job: fullJob(job.id) });
  });

  r.put('/jobs/:id/checklist/:itemId', requireAuth, (req, res) => {
    const job = loadJob(req);
    assertCanEditWork(req, job);
    const item = db.prepare('SELECT * FROM checklist_items WHERE id = ? AND job_id = ?').get(Number(req.params.itemId), job.id);
    if (!item) throw notFound('Checklist item not found');
    const done = !!req.body?.done;
    db.prepare('UPDATE checklist_items SET done = ?, done_by = ?, done_at = ? WHERE id = ?')
      .run(done ? 1 : 0, done ? req.user.id : null, done ? nowIso() : null, item.id);
    touch.run(nowIso(), job.id);
    res.json({ job: fullJob(job.id) });
  });

  r.delete('/jobs/:id/checklist/:itemId', requireRole('admin', 'dispatcher'), (req, res) => {
    const job = loadJob(req);
    assertCanEditWork(req, job);
    db.prepare('DELETE FROM checklist_items WHERE id = ? AND job_id = ?').run(Number(req.params.itemId), job.id);
    res.json({ job: fullJob(job.id) });
  });

  // ---- Assets (serial numbers of installed / removed equipment) ----------

  r.post('/jobs/:id/assets', requireAuth, (req, res) => {
    const job = loadJob(req);
    const b = req.body ?? {};
    const clientId = str(b.client_id, { field: 'client_id', max: 100 });
    if (!seenClientId('assets', clientId)) {
      assertCanEditWork(req, job);
      db.prepare('INSERT INTO assets (job_id, kind, model, serial, notes, client_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        job.id,
        str(b.kind, { field: 'Type', max: 60 }),
        str(b.model, { field: 'Model', max: 120 }),
        str(b.serial, { field: 'Serial number', required: true, max: 120 }),
        str(b.notes, { field: 'Notes', max: 1000 }),
        clientId,
        req.user.id,
      );
      touch.run(nowIso(), job.id);
    }
    res.status(201).json({ job: fullJob(job.id) });
  });

  r.delete('/jobs/:id/assets/:assetId', requireAuth, (req, res) => {
    const job = loadJob(req);
    assertCanEditWork(req, job);
    db.prepare('DELETE FROM assets WHERE id = ? AND job_id = ?').run(Number(req.params.assetId), job.id);
    res.json({ job: fullJob(job.id) });
  });

  // ---- Photos ------------------------------------------------------------

  r.post('/jobs/:id/photos', requireAuth, upload.single('photo'), async (req, res) => {
    const job = loadJob(req);
    const b = req.body ?? {};
    const clientId = str(b.client_id, { field: 'client_id', max: 100 });
    if (seenClientId('photos', clientId)) return res.status(200).json({ job: fullJob(job.id), duplicate: true });
    assertCanEditWork(req, job);
    if (!req.file) throw badRequest('No photo attached');
    const kind = sniffImage(req.file.buffer);
    if (!kind) throw badRequest('Photo must be a JPEG, PNG or WebP image');
    const category = oneOf(b.category || 'other', PHOTO_CATEGORIES, 'Category');
    const caption = str(b.caption, { field: 'Caption', max: 500 });
    const takenAt = isoDate(b.taken_at, 'Taken at');

    const key = await storage.save(req.file.buffer, kind.ext);
    try {
      db.prepare('INSERT INTO photos (job_id, uploaded_by, category, caption, storage_key, mime, size, client_id, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(job.id, req.user.id, category, caption, key, kind.mime, req.file.size, clientId, takenAt);
      touch.run(nowIso(), job.id);
    } catch (err) {
      await storage.remove(key);
      throw err;
    }
    res.status(201).json({ job: fullJob(job.id) });
  });

  r.get('/photos/:id/file', requireAuth, (req, res) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
    if (!photo) throw notFound('Photo not found');
    loadJob(req, photo.job_id);
    res.set({ 'Content-Type': photo.mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
    if (req.query.download) res.attachment(`photo-${photo.id}.${photo.mime.split('/')[1].replace('jpeg', 'jpg')}`);
    storage.open(photo.storage_key).on('error', () => res.destroy()).pipe(res);
  });

  r.delete('/photos/:id', requireAuth, async (req, res) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
    if (!photo) throw notFound('Photo not found');
    const job = loadJob(req, photo.job_id);
    assertCanEditWork(req, job);
    if (!isOffice(req.user) && photo.uploaded_by !== req.user.id) throw forbidden();
    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    await storage.remove(photo.storage_key);
    res.json({ job: fullJob(job.id) });
  });

  return r;
}
