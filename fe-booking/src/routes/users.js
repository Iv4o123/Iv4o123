import { Router } from 'express';
import { requireRole, hashPassword, validatePassword } from '../auth.js';
import { str, oneOf, notFound, conflict } from '../errors.js';
import { publicUser } from './auth.js';

const ROLES = ['admin', 'dispatcher', 'engineer'];

export function userRoutes({ db }) {
  const r = Router();

  r.get('/users', requireRole('admin', 'dispatcher'), (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY active DESC, name').all();
    res.json({ users: rows.map(publicUser) });
  });

  r.post('/users', requireRole('admin'), (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name, { field: 'Name', required: true, max: 120 });
    const email = str(b.email, { field: 'Email', required: true, max: 200 });
    const role = oneOf(b.role, ROLES, 'Role');
    const phone = str(b.phone, { field: 'Phone', max: 40 });
    const password = validatePassword(b.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw conflict('A user with this email already exists');
    const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, phone, role, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, phone, role, hashPassword(password));
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)) });
  });

  r.patch('/users/:id', requireRole('admin'), (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!user) throw notFound('User not found');
    const b = req.body ?? {};
    const next = {
      name: b.name !== undefined ? str(b.name, { field: 'Name', required: true, max: 120 }) : user.name,
      phone: b.phone !== undefined ? str(b.phone, { field: 'Phone', max: 40 }) : user.phone,
      role: b.role !== undefined ? oneOf(b.role, ROLES, 'Role') : user.role,
      active: b.active !== undefined ? (b.active ? 1 : 0) : user.active,
    };
    if (user.id === req.user.id && (next.role !== 'admin' || !next.active)) {
      throw conflict('You cannot remove your own admin access');
    }
    db.prepare('UPDATE users SET name = ?, phone = ?, role = ?, active = ? WHERE id = ?')
      .run(next.name, next.phone, next.role, next.active, user.id);
    if (b.password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(validatePassword(b.password)), user.id);
    }
    // Deactivation or a password reset signs the user out everywhere.
    if (!next.active || (b.password && user.id !== req.user.id)) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    }
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
  });

  return r;
}
