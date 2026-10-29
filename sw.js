// Offline support: serve the app from cache, refresh the cache in the background.
// Bump CACHE when shipping so old files get cleared.
const CACHE = 'run-tracker-v1';
const FILES = ['./', 'index.html', 'app.js', 'plan.js', 'strava.js', 'seed.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const key = url.pathname; // ignore ?code= and ?today= so the app shell always matches
    const hit = await cache.match(key);
    const fresh = fetch(e.request).then(r => { if (r.ok) cache.put(key, r.clone()); return r; });
    if (hit) { fresh.catch(() => {}); return hit; }
    return fresh;
  }));
});
