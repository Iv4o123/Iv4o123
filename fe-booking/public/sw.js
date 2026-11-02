// Service worker: keeps the app shell available offline and caches photos
// the user has already viewed. API data is cached by the app itself (IndexedDB).
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const PHOTOS = 'photos';

const SHELL_FILES = [
  '/', '/index.html', '/css/app.css', '/icon.svg', '/icons.svg', '/manifest.webmanifest', '/icon-192.png',
  '/js/app.js', '/js/api.js', '/js/store.js', '/js/ui.js', '/js/media.js',
  '/js/views/components.js', '/js/views/login.js', '/js/views/my-jobs.js', '/js/views/job.js',
  '/js/views/board.js', '/js/views/job-form.js', '/js/views/calendar.js', '/js/views/sites.js',
  '/js/views/users.js', '/js/views/account.js', '/js/views/sync.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'clear-private') caches.delete(PHOTOS);
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Photos never change once uploaded: cache-first.
  if (/^\/api\/photos\/\d+\/file$/.test(url.pathname)) {
    e.respondWith(
      caches.open(PHOTOS).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) await cache.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // App shell: network first so updates arrive, cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(e.request)) ?? (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())),
  );
});
