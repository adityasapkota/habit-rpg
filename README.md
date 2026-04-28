# Habit RPG

A 24-hour PWA build. Vanilla HTML + JS, IndexedDB for persistence, GitHub Pages
for deploy. Live at https://adityasapkota.github.io/habit-rpg/.

See `01_KICKOFF.md` through `04_PHASE_PLAN.md` for the build plan and
`02_DESIGN_DAY1.md` for the day-1 spec. `KNOWN_ISSUES.md` lists what
intentionally didn't ship in v1 and the V2 roadmap stub.

## What it does

- Add habits with daily / weekdays / custom-day schedules, an optional
  reminder time, and a "minimum version" of the habit you can fall back
  to on hard days.
- Done / Min / Skip buttons on the Today screen. Done increments the
  streak; Min keeps it alive without incrementing; Skip resets it.
- Coins per completion (10 / 12 / 15 for daily / weekdays / custom Done,
  5 for Min) plus one-time milestone bonuses at 3 / 7 / 30 / 90 days
  (+15 / +50 / +300 / +1500) and a +25 comeback bonus for the first
  Done after a missed day.
- A single savings jar with a "every N-day streak → ₹X" rule, optional
  monthly cap, pause/resume, and a Confirm Transfers modal so the
  recorded balance can be reconciled with the money you actually moved.
- Best-effort reminders (see *Reminders* below).
- Works offline after the first online load; everything persists in
  IndexedDB.

## Run locally

Open `index.html` in any modern browser. There is no build step. For full PWA
behaviour (service worker, install prompt) you need HTTPS or `localhost` —
serve the directory with any static server, e.g.:

```
npx serve .
# or
python -m http.server
```

## Install on a phone

Open the live URL in Chrome (Android) or Safari (iOS), then:

- **Android / Chromium:** menu → "Install app" or "Add to Home Screen".
- **iOS Safari:** share sheet → "Add to Home Screen".

The app opens fullscreen with a dark theme. All data lives locally on
the device — there is no server, no account, no sync.

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
