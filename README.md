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

Reminders are best-effort on web. For 100%-reliable alarms, V2 will ship a
native wrapper.
