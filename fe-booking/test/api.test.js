import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

let server, base, tmp, db;

// Smallest valid JPEG header bytes are enough for the type check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-test-'));
  const created = createApp({ dbPath: ':memory:', uploadDir: path.join(tmp, 'uploads'), maxPhotoBytes: 1024 * 1024, sessionDays: 1 });
  db = created.db;
  const add = db.prepare('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)');
  const pw = hashPassword('password1');
  add.run('Admin', 'admin@test', 'admin', pw);
  add.run('Dispatch', 'dispatch@test', 'dispatcher', pw);
  add.run('Eng One', 'eng1@test', 'engineer', pw);
  add.run('Eng Two', 'eng2@test', 'engineer', pw);
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function login(email) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fe-booking' },
    body: JSON.stringify({ email, password: 'password1' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body) => {
    const headers = { Cookie: cookie, 'X-Requested-With': 'fe-booking' };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const r = await fetch(base + url, { method, headers, body: payload });
    const text = await r.text();
    return { status: r.status, body: text && r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  return call;
}

function photoForm(category = 'rack_front', clientId) {
  const fd = new FormData();
  fd.append('category', category);
  if (clientId) fd.append('client_id', clientId);
  fd.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'rack.jpg');
  return fd;
}

const engId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

test('rejects wrong password and requests without the app header', async () => {
  const bad = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fe-booking' },
    body: JSON.stringify({ email: 'admin@test', password: 'nope' }),
  });
  assert.equal(bad.status, 401);
  const noHeader = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test', password: 'password1' }),
  });
  assert.equal(noHeader.status, 403);
  assert.equal((await fetch(`${base}/jobs`)).status, 401);
});

test('full job lifecycle: create, assign, check in, photos, complete, return, approve', async () => {
  const office = await login('dispatch@test');
  const eng = await login('eng1@test');

  const site = await office('POST', '/sites', { name: 'DC1', city: 'Sofia' });
  assert.equal(site.status, 201);

  const created = await office('POST', '/jobs', {
    title: 'Install switch',
    site_id: site.body.site.id,
    rack: 'B3',
    assigned_to: engId('eng1@test'),
    scheduled_start: '2030-01-01T09:00:00Z',
    scheduled_end: '2030-01-01T11:00:00Z',
    checklist: ['Mounted', 'Patched'],
  });
  assert.equal(created.status, 201);
  const job = created.body.job;
  assert.match(job.ref, /^FE-\d{5}$/);
  assert.equal(job.status, 'assigned');
  assert.equal(job.checklist.length, 2);

  // Engineer sees it in their list.
  const mine = await eng('GET', '/jobs');
  assert.deepEqual(mine.body.jobs.map((j) => j.id), [job.id]);

  // Engineer cannot approve; cannot complete before checking in.
  assert.equal((await eng('POST', `/jobs/${job.id}/actions`, { action: 'approve' })).status, 403);
  assert.equal((await eng('POST', `/jobs/${job.id}/actions`, { action: 'complete' })).status, 409);

  assert.equal((await eng('POST', `/jobs/${job.id}/actions`, { action: 'start_travel' })).body.job.status, 'en_route');
  const checkIn = await eng('POST', `/jobs/${job.id}/actions`, { action: 'check_in', lat: 42.7, lng: 23.3 });
  assert.equal(checkIn.body.job.status, 'on_site');
  assert.equal(checkIn.body.job.checkin_lat, 42.7);

  // Completing needs a photo and a finished checklist.
  let r = await eng('POST', `/jobs/${job.id}/actions`, { action: 'complete' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /photo/);

  r = await eng('POST', `/jobs/${job.id}/photos`, photoForm('rack_front', 'photo-1'));
  assert.equal(r.status, 201);
  assert.equal(r.body.job.photos.length, 1);
  // Re-sending the same offline upload doesn't create a duplicate.
  r = await eng('POST', `/jobs/${job.id}/photos`, photoForm('rack_front', 'photo-1'));
  assert.equal(r.status, 200);
  assert.equal(r.body.job.photos.length, 1);

  r = await eng('POST', `/jobs/${job.id}/actions`, { action: 'complete' });
  assert.match(r.body.error, /checklist/);
  for (const item of job.checklist) {
    assert.equal((await eng('PUT', `/jobs/${job.id}/checklist/${item.id}`, { done: true })).status, 200);
  }
  await eng('POST', `/jobs/${job.id}/assets`, { kind: 'Switch', serial: 'SN12345' });

  r = await eng('POST', `/jobs/${job.id}/actions`, { action: 'complete', note: 'All done', signed_by: 'Nikolay', client_id: 'act-1' });
  assert.equal(r.body.job.status, 'completed');
  assert.equal(r.body.job.signed_by, 'Nikolay');
  // Replay of the same queued action is a no-op.
  r = await eng('POST', `/jobs/${job.id}/actions`, { action: 'complete', client_id: 'act-1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);

  // Locked for the engineer while waiting for review.
  assert.equal((await eng('POST', `/jobs/${job.id}/photos`, photoForm())).status, 409);

  // Office sends it back with a reason, engineer fixes, office approves.
  assert.equal((await office('POST', `/jobs/${job.id}/actions`, { action: 'return' })).status, 400);
  r = await office('POST', `/jobs/${job.id}/actions`, { action: 'return', note: 'Need rear photo' });
  assert.equal(r.body.job.status, 'returned');
  await eng('POST', `/jobs/${job.id}/actions`, { action: 'check_in' });
  await eng('POST', `/jobs/${job.id}/photos`, photoForm('rack_rear'));
  await eng('POST', `/jobs/${job.id}/actions`, { action: 'complete' });
  r = await office('POST', `/jobs/${job.id}/actions`, { action: 'approve' });
  assert.equal(r.body.job.status, 'approved');

  // Search by serial number finds the job.
  r = await office('GET', '/jobs?q=SN123');
  assert.deepEqual(r.body.jobs.map((j) => j.id), [job.id]);

  // Photo file is served to the office.
  const photoId = r.body.jobs.length && (await office('GET', `/jobs/${job.id}`)).body.job.photos[0].id;
  const file = await office('GET', `/photos/${photoId}/file`);
  assert.equal(file.status, 200);

  const events = (await office('GET', `/jobs/${job.id}`)).body.job.events.map((e) => e.type);
  assert.deepEqual(events, ['created', 'start_travel', 'check_in', 'complete', 'return', 'check_in', 'complete', 'approve']);
});

test('engineers only see and change their own jobs', async () => {
  const office = await login('admin@test');
  const eng2 = await login('eng2@test');
  const { body } = await office('POST', '/jobs', { title: 'Other job', assigned_to: engId('eng1@test') });
  const id = body.job.id;
  assert.equal((await eng2('GET', `/jobs/${id}`)).status, 404);
  assert.equal((await eng2('POST', `/jobs/${id}/actions`, { action: 'check_in' })).status, 404);
  assert.equal((await eng2('POST', '/jobs', { title: 'x' })).status, 403);
  assert.equal((await eng2('GET', '/users')).status, 403);
});

test('rejects non-image uploads', async () => {
  const office = await login('admin@test');
  const { body } = await office('POST', '/jobs', { title: 'Upload test' });
  const fd = new FormData();
  fd.append('photo', new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), 'x.jpg');
  const r = await office('POST', `/jobs/${body.job.id}/photos`, fd);
  assert.equal(r.status, 400);
});

test('warns about double booking', async () => {
  const office = await login('admin@test');
  const eng = engId('eng2@test');
  await office('POST', '/jobs', { title: 'First', assigned_to: eng, scheduled_start: '2031-05-01T09:00:00Z', scheduled_end: '2031-05-01T12:00:00Z' });
  const r = await office('POST', '/jobs', { title: 'Second', assigned_to: eng, scheduled_start: '2031-05-01T11:00:00Z', scheduled_end: '2031-05-01T13:00:00Z' });
  assert.equal(r.status, 201);
  assert.equal(r.body.warnings.length, 1);
  assert.match(r.body.warnings[0], /First/);
});

test('admin manages users; deactivated user is signed out', async () => {
  const admin = await login('admin@test');
  const r = await admin('POST', '/users', { name: 'New FE', email: 'new@test', role: 'engineer', password: 'password1' });
  assert.equal(r.status, 201);
  const newbie = await login('new@test');
  assert.equal((await newbie('GET', '/me')).status, 200);
  await admin('PATCH', `/users/${r.body.user.id}`, { active: false });
  assert.equal((await newbie('GET', '/me')).status, 401);
  assert.equal((await admin('PATCH', `/users/${engId('admin@test')}`, { role: 'engineer' })).status, 409);
});
