// Offline support: always try the network first (so a new release shows up on the next open),
// fall back to the cached copy when offline. Bump CACHE when shipping so old files get cleared.
const CACHE = 'run-tracker-v4';
const FILES = ['./', 'index.html', 'app.js', 'plan.js', 'strava.js', 'reminders.js', 'seed.js', 'manifest.webmanifest', 'icon-v2-180.png', 'icon-v2-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache so a new release never caches last release's files.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
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
    try {
      const r = await fetch(e.request.url, { cache: 'no-cache' }); // by URL: page navigations can't take options
      if (r.ok) cache.put(key, r.clone());
      return r;
    } catch {
      return (await cache.match(key)) ?? Response.error();
    }
  }));
});

self.addEventListener('push', e => {
  const msg = e.data?.json() ?? { title: 'Run Tracker', body: 'Time to check today’s run.' };
  e.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, icon: 'icon-v2-180.png', tag: 'run-reminder' }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(wins =>
    wins.length ? wins[0].focus() : self.clients.openWindow('./#today')));
});
