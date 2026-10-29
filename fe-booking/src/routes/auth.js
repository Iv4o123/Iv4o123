import { Router } from 'express';
import { createSession, destroySession, verifyPassword, validatePassword, hashPassword, requireAuth, loginLimiter } from '../auth.js';
import { HttpError, str } from '../errors.js';

export function authRoutes({ db, config }) {
  const r = Router();
  const limiter = loginLimiter();
  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

  r.post('/auth/login', (req, res) => {
    const email = str(req.body?.email, { field: 'Email', required: true, max: 200 });
    const password = String(req.body?.password ?? '');
    const key = `${req.ip}|${email.toLowerCase()}`;
    if (!limiter.check(key)) throw new HttpError(429, 'Too many attempts, try again in 15 minutes');
    const user = findByEmail.get(email);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Wrong email or password');
    }
    limiter.clear(key);
    createSession(db, config, res, user.id);
    res.json({ user: publicUser(user) });
  });

  r.post('/auth/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  r.post('/me/password', requireAuth, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.current ?? ''), row.password_hash)) {
      throw new HttpError(400, 'Current password is wrong');
    }
    const next = validatePassword(req.body?.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    res.json({ ok: true });
  });

  return r;
}

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone ?? null, role: u.role, active: !!u.active });
