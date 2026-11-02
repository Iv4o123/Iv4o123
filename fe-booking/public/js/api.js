import { cache, outbox } from './store.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Thrown when the device can't reach the server at all.
export class OfflineError extends Error {
  constructor() {
    super('You are offline');
  }
}

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const offChange = (fn) => listeners.delete(fn);
const emit = () => listeners.forEach((fn) => fn());

let unauthorizedHandler = () => {};
export const onUnauthorized = (fn) => {
  unauthorizedHandler = fn;
};

async function request(method, url, body) {
  const headers = { 'X-Requested-With': 'fe-booking' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new OfflineError();
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && url !== '/auth/login') unauthorizedHandler();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data;
}

// GET with offline fallback: returns { data, offline } and refreshes the cache.
export async function get(url) {
  try {
    const data = await request('GET', url);
    cache.set(url, data).catch(() => {});
    return { data, offline: false };
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;
    const data = await cache.get(url);
    if (data === undefined) throw err;
    return { data, offline: true };
  }
}

export const post = (url, body) => request('POST', url, body);
export const put = (url, body) => request('PUT', url, body);
export const patch = (url, body) => request('PATCH', url, body);
export const del = (url) => request('DELETE', url);

// ---- Offline outbox -------------------------------------------------------
//
// Field work goes through `send`: it is tried right away and, if the server
// can't be reached, kept on the device and retried later. Every item carries
// a client_id so the server ignores duplicates if a retry already landed.

function toFormData(fields, blob) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, v);
  fd.append('photo', blob, `${fields.client_id}.jpg`);
  return fd;
}

const exec = (item) => (item.blob ? request(item.method, item.url, toFormData(item.body, item.blob)) : request(item.method, item.url, item.body));

// Returns { data } when it reached the server, or { queued: true }.
export async function send(item) {
  const pending = (await outbox.all()).filter((i) => !i.error);
  // Keep order: if anything is already waiting, queue behind it.
  if (pending.length === 0) {
    try {
      return { data: await exec(item) };
    } catch (err) {
      if (!(err instanceof OfflineError) && !(err.status >= 500)) throw err;
    }
  }
  await outbox.add({ ...item, created: new Date().toISOString() });
  emit();
  scheduleSync();
  return { queued: true };
}

let syncing = false;
let timer;

function scheduleSync(ms = 15000) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

export async function syncNow() {
  if (syncing) return;
  syncing = true;
  let synced = 0;
  try {
    for (const item of await outbox.all()) {
      if (item.error) continue;
      try {
        await exec(item);
        await outbox.remove(item.seq);
        synced++;
      } catch (err) {
        if (err instanceof OfflineError || err.status >= 500 || err.status === 401) {
          scheduleSync(30000);
          break;
        }
        // The server refused it (e.g. job was reassigned); keep it for the user to review.
        await outbox.put({ ...item, error: err.message });
      }
    }
  } finally {
    syncing = false;
    emit();
  }
  return synced;
}

export const pendingItems = () => outbox.all();

export async function discard(seq) {
  await outbox.remove(seq);
  emit();
}

export async function retry(seq) {
  const item = (await outbox.all()).find((i) => i.seq === seq);
  if (item) {
    delete item.error;
    await outbox.put(item);
  }
  return syncNow();
}

window.addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow();
});
