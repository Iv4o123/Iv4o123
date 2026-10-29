import crypto from 'node:crypto';
import { HttpError, forbidden } from './errors.js';

const COOKIE = 'fe_session';
export const OFFICE_ROLES = ['admin', 'dispatcher'];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters');
  }
  return password;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, config, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expires.toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires,
    path: '/',
  });
}

export function destroySession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Attaches req.user when a valid session cookie is present.
export function sessionMiddleware(db) {
  const lookup = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  return (req, _res, next) => {
    const token = readCookie(req, COOKIE);
    if (token) {
      const user = lookup.get(sha256(token), new Date().toISOString());
      if (user && user.active) req.user = user;
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const isOffice = (user) => OFFICE_ROLES.includes(user.role);

// Blocks cross-site form posts: the app always sends this header, browsers
// won't let another origin add it without a CORS preflight we never approve.
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'fe-booking') return next(forbidden('Missing request header'));
  next();
}

// Simple in-memory limiter for login attempts (per IP + email).
export function loginLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.reset < now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return true;
      }
      entry.count++;
      return entry.count <= max;
    },
    clear(key) {
      hits.delete(key);
    },
  };
}
