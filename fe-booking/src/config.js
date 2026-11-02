import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Paths are relative to the project folder, not to wherever the command was run from,
// so `npm run seed` and `npm start` always use the same database.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so the app runs without extra dependencies.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function loadConfig(overrides = {}) {
  loadDotEnv(path.join(projectRoot, '.env'));
  const dataDir = path.resolve(projectRoot, overrides.dataDir ?? process.env.DATA_DIR ?? './data');
  return {
    port: Number(overrides.port ?? process.env.PORT ?? 3000),
    dataDir,
    dbPath: overrides.dbPath ?? path.join(dataDir, 'fe-booking.db'),
    uploadDir: overrides.uploadDir ?? path.join(dataDir, 'uploads'),
    cookieSecure: (overrides.cookieSecure ?? process.env.COOKIE_SECURE) === '1' || overrides.cookieSecure === true,
    trustProxy: overrides.trustProxy ?? process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal',
    maxPhotoBytes: 15 * 1024 * 1024,
    sessionDays: 30,
  };
}
