import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { str, notFound } from '../errors.js';

const FIELDS = [
  ['name', 'Name', 200, true],
  ['address', 'Address', 300],
  ['city', 'City', 120],
  ['contact_name', 'Contact name', 120],
  ['contact_phone', 'Contact phone', 40],
  ['access_notes', 'Access notes', 2000],
];

function readSite(body, existing = {}) {
  const out = {};
  for (const [key, label, max, required] of FIELDS) {
    out[key] = body[key] !== undefined ? str(body[key], { field: label, max, required }) : existing[key] ?? null;
  }
  if (!out.name) str(null, { field: 'Name', required: true });
  return out;
}

export function siteRoutes({ db }) {
  const r = Router();

  r.get('/sites', requireAuth, (req, res) => {
    const sites = db.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM jobs j WHERE j.site_id = s.id) AS job_count
      FROM sites s ORDER BY s.name`).all();
    res.json({ sites });
  });

  r.post('/sites', requireRole('admin', 'dispatcher'), (req, res) => {
    const s = readSite(req.body ?? {});
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO sites (name, address, city, contact_name, contact_phone, access_notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(s.name, s.address, s.city, s.contact_name, s.contact_phone, s.access_notes);
    res.status(201).json({ site: db.prepare('SELECT * FROM sites WHERE id = ?').get(lastInsertRowid) });
  });

  r.patch('/sites/:id', requireRole('admin', 'dispatcher'), (req, res) => {
    const existing = db.prepare('SELECT * FROM sites WHERE id = ?').get(Number(req.params.id));
    if (!existing) throw notFound('Site not found');
    const s = readSite(req.body ?? {}, existing);
    db.prepare(`UPDATE sites SET name = ?, address = ?, city = ?, contact_name = ?, contact_phone = ?, access_notes = ? WHERE id = ?`)
      .run(s.name, s.address, s.city, s.contact_name, s.contact_phone, s.access_notes, existing.id);
    res.json({ site: db.prepare('SELECT * FROM sites WHERE id = ?').get(existing.id) });
  });

  return r;
}
