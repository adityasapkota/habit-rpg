// Habit RPG service worker.
// Strategy: cache the shell on install. Network-first for navigations,
// cache-first for everything else (including the cross-origin idb CDN).

const CACHE_NAME = 'habit-rpg-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.js',
  './src/db.js',
  './src/habits.js',
  './src/streaks.js',
  './src/jar.js',
  './src/notifications.js',
  './src/render.js',
  './src/styles.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const IDB_URL = 'https://cdn.jsdelivr.net/npm/idb@8/+esm';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL);
    try {
      const req = new Request(IDB_URL, { mode: 'cors', credentials: 'omit' });
      const res = await fetch(req);
      if (res && res.ok) await cache.put(req, res);
    } catch (err) {
      console.warn('[sw] failed to cache idb CDN module:', err);
    }
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
