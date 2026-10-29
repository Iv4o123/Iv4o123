// Creates the first admin account from .env (ADMIN_EMAIL / ADMIN_PASSWORD).
// With --demo, also adds sample engineers, sites and jobs for trying the app.
import { loadConfig } from '../src/config.js';
import { openDb, tx } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const demo = process.argv.includes('--demo');

function ensureUser(name, email, role, password, phone = null) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, phone, role, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, phone, role, hashPassword(password));
  console.log(`Created ${role} ${email}`);
  return Number(lastInsertRowid);
}

const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD || (demo ? 'demo1234' : null);
if (!adminPassword) {
  console.error('Set ADMIN_PASSWORD in .env (at least 8 characters) before running the seed.');
  process.exit(1);
}
const adminId = ensureUser(process.env.ADMIN_NAME || 'Administrator', adminEmail, 'admin', adminPassword);

if (demo) {
  if (db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n > 0) {
    console.log('Jobs already exist, skipping demo data.');
    process.exit(0);
  }
  tx(db, () => {
    ensureUser('Dana Dispatcher', 'dispatch@example.com', 'dispatcher', 'demo1234', '+359 88 000 0001');
    const fe1 = ensureUser('Georgi Petrov', 'georgi@example.com', 'engineer', 'demo1234', '+359 88 000 0002');
    const fe2 = ensureUser('Maria Ivanova', 'maria@example.com', 'engineer', 'demo1234', '+359 88 000 0003');

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
  console.log('\nDemo data ready. All demo accounts use password: demo1234');
  console.log(`  Admin:      ${adminEmail}${process.env.ADMIN_PASSWORD ? ' (password from .env)' : ''}`);
  console.log('  Dispatcher: dispatch@example.com');
  console.log('  Engineers:  georgi@example.com, maria@example.com');
}
