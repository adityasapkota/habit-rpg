# Habit RPG

A 24-hour PWA build. Vanilla HTML + JS, IndexedDB for persistence, GitHub Pages
for deploy. See `01_KICKOFF.md` through `04_PHASE_PLAN.md` for the build plan
and `02_DESIGN_DAY1.md` for the day-1 spec.

## Run locally

Open `index.html` in any modern browser. There is no build step. For full PWA
behaviour (service worker, install prompt) you need HTTPS or `localhost` —
serve the directory with any static server, e.g.:

```
npx serve .
# or
python -m http.server
```

## Deploy

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Reminders

Reminders are best-effort on web. The app tries two paths in order:

1. **Notification Triggers API** — only available in some Chromium builds
   behind a flag. When it works, the OS fires the reminder at the
   scheduled time even if the PWA is closed. Snooze caps at 3 per habit
   per day.
2. **In-app banner fallback** — every browser. When you open the app, any
   habit whose reminder time has passed and that you haven't already
   acted on shows a top banner with Snooze 10 min / Dismiss buttons.

If your browser doesn't support the Triggers API, you only get
reminders **while the app is open or when you next open it**. There is
no background scheduler on the open web for arbitrary alarms — V2 will
ship a native wrapper for 100%-reliable alarms.
