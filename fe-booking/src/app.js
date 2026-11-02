import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { openDb } from './db.js';
import { localStorage } from './storage.js';
import { sessionMiddleware, csrfGuard } from './auth.js';
import { HttpError } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { siteRoutes } from './routes/sites.js';
import { jobRoutes } from './routes/jobs.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(config) {
  const db = openDb(config.dbPath);
  const storage = localStorage(config.uploadDir);
  const ctx = { db, storage, config };

  const app = express();
  app.disable('x-powered-by');
  // Trust X-Forwarded-Proto from a reverse proxy on this machine or a private network (e.g. Docker).
  app.set('trust proxy', config.trustProxy);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'",
    });
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(sessionMiddleware(db));
  api.use(csrfGuard);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use(authRoutes(ctx));
  api.use(userRoutes(ctx));
  api.use(siteRoutes(ctx));
  api.use(jobRoutes(ctx));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  app.use(express.static(publicDir, {
    setHeaders(res, file) {
      // The service worker and app shell must always be revalidated so updates reach phones.
      res.set('Cache-Control', /\.(js|css|html|webmanifest)$/.test(file) ? 'no-cache' : 'public, max-age=86400');
    },
  }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  return { app, db };
}
