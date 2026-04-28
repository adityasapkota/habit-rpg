// Habit RPG service worker.
// Strategy: cache the shell on install. Network-first for navigations,
// cache-first for everything else (including the cross-origin idb CDN).

const CACHE_NAME = 'habit-rpg-v10';
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

// idb is the IndexedDB layer — without it the app can't boot at all,
// even online. It's served from jsdelivr with proper CORS headers, so
// we treat it as a required atomic precache entry alongside SHELL.
const IDB_URL = 'https://cdn.jsdelivr.net/npm/idb@8/+esm';

// Tailwind Play CDN 302-redirects to a versioned URL that lacks
// Access-Control-Allow-Origin headers, so it can't ride along on the
// atomic addAll (would TypeError on URL mismatch / opaque rejection). We
// fetch it as no-cors and store opaque, best-effort. If the network is
// unreachable on first install, online use still works (browser will
// load it directly the next time) and offline use degrades to unstyled
// — but install must NOT fail just because Tailwind didn't precache.
const TAILWIND_URL = 'https://cdn.tailwindcss.com';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const idbReq = new Request(IDB_URL, { mode: 'cors', credentials: 'omit' });
    await cache.addAll([...SHELL, idbReq]);
    try {
      const tailwindReq = new Request(TAILWIND_URL, { mode: 'no-cors', credentials: 'omit' });
      const res = await fetch(tailwindReq);
      if (res && (res.ok || res.type === 'opaque')) {
        await cache.put(tailwindReq, res);
      }
    } catch (err) {
      console.warn('[sw] failed to precache Tailwind:', err);
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

// Notification interaction. Snooze action re-schedules a follow-up 10 min
// later (Triggers API only — best effort) and respects the 3-snooze daily
// cap by tracking the count in notification.data. Tapping the body focuses
// an existing app window or opens a new one.
const MAX_SNOOZES_PER_DAY = 3;

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action;
  notification.close();

  if (action === 'snooze' && data.habitId && typeof self.TimestampTrigger !== 'undefined') {
    const newCount = (Number(data.snoozeCount) || 0) + 1;
    if (newCount > MAX_SNOOZES_PER_DAY) {
      // Cap reached — do nothing. The user already saw three reminders.
      return;
    }
    event.waitUntil((async () => {
      try {
        const opts = {
          body: data.minimum ? `Time to: ${data.minimum}` : 'Reminder',
          // Reuse the stable per-(habit, date) tag so cancelForHabit() can
          // close the entire reminder chain (original + every snooze
          // re-schedule) in one call.
          tag: `habit-rpg-${data.habitId}-${data.date}`,
          data: { ...data, snoozeCount: newCount },
          // eslint-disable-next-line no-undef
          showTrigger: new self.TimestampTrigger(Date.now() + 10 * 60 * 1000),
        };
        // Hide the snooze action once the user has used the last allowed
        // snooze — they should tap the body or act in-app instead.
        if (newCount < MAX_SNOOZES_PER_DAY) {
          opts.actions = [{ action: 'snooze', title: 'Snooze 10 min' }];
        }
        await self.registration.showNotification(data.name || 'Habit reminder', opts);
      } catch (err) {
        console.warn('[sw] snooze schedule failed:', err);
      }
    })());
    return;
  }

  // Default tap: focus or open the Today screen.
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.includes('habit-rpg')) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow('./');
  })());
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
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(req, copy))
            .catch((err) => console.warn('[sw] nav cache.put failed:', err));
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
        // Cache same-origin and CORS responses. Also cache opaque (no-cors)
        // for cross-origin scripts whose CDNs do not send CORS headers
        // (e.g. cdn.tailwindcss.com): the browser still executes opaque
        // scripts loaded from cache, which keeps offline reload working.
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(req, copy))
            // QuotaExceeded or storage-pressure failures must not bubble
            // up as an unhandled rejection.
            .catch((err) => console.warn('[sw] cache.put failed:', err));
        }
        return res;
      });
    })
  );
});
