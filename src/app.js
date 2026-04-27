// Habit RPG bootstrap.
// Phase 1: register the service worker. Future phases mount screens here.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        console.info('[habit-rpg] service worker registered, scope:', reg.scope);
      })
      .catch((err) => {
        console.error('[habit-rpg] service worker registration failed:', err);
      });
  });
}
