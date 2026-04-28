// Habit RPG service worker.
// Strategy: cache the shell on install. Network-first for navigations,
// cache-first for everything else (including the cross-origin idb CDN).

const CACHE_NAME = 'habit-rpg-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.js',
  './src/db.js',
  './src/dates.js',
  './src/habits.js',
  './src/streaks.js',
  './src/coins.js',
  './src/jar.js',
  './src/notifications.js',
  './src/render.js',
  './src/styles.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/idb@8/+esm',
  'https://cdn.tailwindcss.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cdnRequests = CDN_URLS.map((url) =>
      new Request(url, { mode: 'cors', credentials: 'omit' })
    );
    // Atomic precache: if any required asset (local or CDN) fails, install
    // fails and the new SW does not activate. The browser will retry on the
    // next visit, which is correct: a partial cache would silently break
    // offline reload of layout (Tailwind) or the DB layer (idb).
    await cache.addAll([...SHELL, ...cdnRequests]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isNavigation =
    req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((m) => m || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
