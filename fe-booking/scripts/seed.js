// Creates the first admin account from .env (ADMIN_EMAIL / ADMIN_PASSWORD).
// With --demo, also creates demo accounts (all with password demo1234) and
// sample sites and jobs. Re-running --demo resets the demo accounts' passwords.
import { loadConfig } from '../src/config.js';
import { openDb, tx } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const demo = process.argv.includes('--demo');
const DEMO_PASSWORD = 'demo1234';

// Creates the user, or (when reset is true) restores its password and access.
function ensureUser(name, email, role, password, { phone = null, reset = false } = {}) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    if (reset) {
      db.prepare('UPDATE users SET password_hash = ?, role = ?, active = 1 WHERE id = ?').run(hashPassword(password), role, existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    }
    return existing.id;
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, phone, role, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, phone, role, hashPassword(password));
  console.log(`Created ${role} ${email}`);
  return Number(lastInsertRowid);
}

const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD;

if (!demo) {
  if (!adminPassword || adminPassword.length < 8) {
    console.error('Set ADMIN_PASSWORD in .env (at least 8 characters) before running the seed.');
    process.exit(1);
  }
  ensureUser(process.env.ADMIN_NAME || 'Administrator', adminEmail, 'admin', adminPassword);
  console.log(`Data folder: ${config.dataDir}`);
  console.log(`Sign in as ${adminEmail} with the ADMIN_PASSWORD from .env`);
  process.exit(0);
}

// Demo mode: every demo account uses the same password, whatever .env says.
const adminId = ensureUser('Demo Admin', 'admin@example.com', 'admin', DEMO_PASSWORD, { reset: true });
const fe1 = ensureUser('Georgi Petrov', 'georgi@example.com', 'engineer', DEMO_PASSWORD, { phone: '+359 88 000 0002', reset: true });
const fe2 = ensureUser('Maria Ivanova', 'maria@example.com', 'engineer', DEMO_PASSWORD, { phone: '+359 88 000 0003', reset: true });
ensureUser('Dana Dispatcher', 'dispatch@example.com', 'dispatcher', DEMO_PASSWORD, { phone: '+359 88 000 0001', reset: true });
// A real admin from .env (if set to another address) is kept alongside the demo accounts.
if (adminEmail !== 'admin@example.com' && adminPassword?.length >= 8) {
  ensureUser(process.env.ADMIN_NAME || 'Administrator', adminEmail, 'admin', adminPassword);
}

function printAccounts() {
  console.log(`\nDemo ready. Data folder: ${config.dataDir}`);
  console.log(`All demo accounts use password: ${DEMO_PASSWORD}`);
  console.log('  Admin:      admin@example.com');
  console.log('  Dispatcher: dispatch@example.com');
  console.log('  Engineers:  georgi@example.com, maria@example.com');
}

if (db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n > 0) {
  console.log('Jobs already exist, so no sample jobs were added.');
  printAccounts();
  process.exit(0);
}

tx(db, () => {
  const addSite = db.prepare('INSERT INTO sites (name, address, city, contact_name, contact_phone, access_notes) VALUES (?, ?, ?, ?, ?, ?)');
  const s1 = Number(addSite.run('Telehouse DC1', '12 Industrial St', 'Sofia', 'Nikolay (NOC)', '+359 2 000 1000', 'Badge at reception, ID required. Loading bay at rear.').lastInsertRowid);
  const s2 = Number(addSite.run('Acme Corp HQ', '45 Vitosha Blvd', 'Sofia', 'Elena (IT)', '+359 2 000 2000', 'Comms room on floor -1, key from security.').lastInsertRowid);
  const s3 = Number(addSite.run('Plovdiv Branch Office', '8 Main Sq', 'Plovdiv', 'Petar', '+359 32 000 300', null).lastInsertRowid);

  const day = (offset, hour) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const addJob = db.prepare(`INSERT INTO jobs (title, description, site_id, rack, ticket_ref, priority, status, assigned_to, scheduled_start, scheduled_end, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addItem = db.prepare('INSERT INTO checklist_items (job_id, label, position) VALUES (?, ?, ?)');
  const jobs = [
    ['Install core switch', 'Rack and stack new 48-port switch, patch ports 1-24 to patch panel PP-2.', s1, 'B3', 'INC-10422', 'high', 'assigned', fe1, day(0, 9), day(0, 12),
      ['Switch mounted and powered', 'Ports 1-24 patched to PP-2', 'Uplink tested', 'Cables labelled']],
    ['Replace failed PSU', 'PSU 2 on firewall FW-01 reports failure. Replacement part in the site cage.', s1, 'A1', 'INC-10430', 'urgent', 'assigned', fe1, day(0, 14), day(0, 15),
      ['Old PSU removed', 'New PSU installed', 'Both PSUs green']],
    ['Cable tidy and audit', 'Tidy rear cabling in comms rack and record all serials.', s2, 'COMMS-1', 'REQ-2211', 'normal', 'assigned', fe2, day(1, 10), day(1, 13),
      ['Rear cabling tidied', 'Serials recorded']],
    ['New branch router', 'Install and patch new branch router. Config is pre-loaded.', s3, 'R1', 'REQ-2230', 'normal', 'unassigned', null, day(2, 9), day(2, 11),
      ['Router mounted', 'WAN link up', 'LAN patched']],
  ];
  for (const [title, desc, site, rack, ticket, prio, status, fe, start, end, items] of jobs) {
    const id = Number(addJob.run(title, desc, site, rack, ticket, prio, status, fe, start, end, adminId).lastInsertRowid);
    db.prepare('UPDATE jobs SET ref = ? WHERE id = ?').run(`FE-${String(id).padStart(5, '0')}`, id);
    items.forEach((l, i) => addItem.run(id, l, i));
    db.prepare("INSERT INTO job_events (job_id, user_id, type, message) VALUES (?, ?, 'created', 'Created')").run(id, adminId);
  }
});
printAccounts();
