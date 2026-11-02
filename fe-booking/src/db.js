import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
const migrations = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin','dispatcher','engineer')),
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE sites (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    access_notes TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    ref TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    site_id INTEGER REFERENCES sites(id),
    rack TEXT,
    ticket_ref TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    status TEXT NOT NULL,
    assigned_to INTEGER REFERENCES users(id),
    scheduled_start TEXT,
    scheduled_end TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW},
    checkin_at TEXT,
    checkin_lat REAL,
    checkin_lng REAL,
    checkout_at TEXT,
    completion_notes TEXT,
    signed_by TEXT,
    reviewed_at TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    review_note TEXT
  );
  CREATE INDEX jobs_assigned ON jobs(assigned_to, scheduled_start);
  CREATE INDEX jobs_status ON jobs(status);
  CREATE TABLE checklist_items (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    done_by INTEGER REFERENCES users(id),
    done_at TEXT
  );
  CREATE TABLE photos (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id),
    category TEXT NOT NULL,
    caption TEXT,
    storage_key TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    client_id TEXT UNIQUE,
    taken_at TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX photos_job ON photos(job_id);
  CREATE TABLE assets (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind TEXT,
    model TEXT,
    serial TEXT NOT NULL,
    notes TEXT,
    client_id TEXT UNIQUE,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX assets_job ON assets(job_id);
  CREATE TABLE job_events (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL,
    message TEXT,
    client_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX job_events_job ON job_events(job_id);
  `,
];

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < migrations.length; v++) {
    tx(db, () => {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const nowIso = () => new Date().toISOString();
