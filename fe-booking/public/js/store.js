// Tiny IndexedDB wrapper with two stores:
//  - cache:  last good copy of API GET responses, for viewing jobs offline
//  - outbox: changes made offline, replayed in order when back online

const DB_NAME = 'fe-booking';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('cache');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const cache = {
  get: (key) => run('cache', 'readonly', (s) => s.get(key)),
  set: (key, value) => run('cache', 'readwrite', (s) => s.put(value, key)),
  clear: () => run('cache', 'readwrite', (s) => s.clear()),
};

export const outbox = {
  add: (item) => run('outbox', 'readwrite', (s) => s.add(item)),
  all: () => run('outbox', 'readonly', (s) => s.getAll()),
  put: (item) => run('outbox', 'readwrite', (s) => s.put(item)),
  remove: (seq) => run('outbox', 'readwrite', (s) => s.delete(seq)),
  clear: () => run('outbox', 'readwrite', (s) => s.clear()),
};
