# DESIGN — Day 1 Scope

The complete spec for the 24-hour build. Everything not in this doc is V2.

---

## Tech stack (locked, no substitutions)

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Vanilla HTML + JS (ES modules) | No build step, instant iteration |
| Styling | Tailwind via CDN (`<script src="https://cdn.tailwindcss.com">`) | No build step |
| Persistence | IndexedDB via `idb` library (CDN: `https://cdn.jsdelivr.net/npm/idb@8/+esm`) | Works offline, ~5KB |
| PWA | Manifest + service worker (vanilla, no Workbox) | Minimal moving parts |
| Notifications | Web Notifications API + Notification Triggers API where supported | Best-effort, document degradation |
| Deploy | GitHub Pages via GitHub Actions | HTTPS, free, agent-friendly |

**No npm, no bundler, no React, no TypeScript, no preprocessor.** Everything runs in the browser as-is.

## File layout

```
/
├── index.html              # entry point
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # service worker
├── icons/                  # 192 + 512 PNG, can be plain colored squares for v1
│   ├── icon-192.png
│   └── icon-512.png
├── src/
│   ├── app.js              # bootstraps the app, mounts screens
│   ├── db.js               # IndexedDB wrapper (open, get, put, query)
│   ├── habits.js           # habit CRUD + completion logic
│   ├── streaks.js          # streak + coin calculation
│   ├── jar.js              # savings jar logic
│   ├── notifications.js    # permission + scheduling
│   ├── render.js           # render functions for each screen
│   └── styles.css          # any non-Tailwind custom CSS
├── .github/workflows/
│   └── deploy.yml          # auto-deploy to Pages on push to main
├── STATUS.md               # agent status log
├── HANDOFF.md              # written when blocked
├── DECISIONS.md            # Codex decisions, append-only
└── README.md
```

## Data model (IndexedDB object stores)

### `habits`
```
{
  id: string (uuid),
  name: string,
  schedule: 'daily' | 'weekdays' | 'custom',
  customDays: number[] | null,   // 0=Sun..6=Sat, only when schedule='custom'
  reminderTime: string | null,    // 'HH:mm' or null
  minimumVersion: string,         // free text, e.g. "1 pushup"
  createdAt: number,              // epoch ms
  archived: boolean
}
```

### `completions`
```
{
  id: string,
  habitId: string,
  date: string,                   // 'YYYY-MM-DD' local
  status: 'completed' | 'minimum' | 'missed',
  coinsEarned: number,
  completedAt: number
}
```

### `userState` (single record, id='singleton')
```
{
  id: 'singleton',
  totalCoinsEarned: number,
  coinBalance: number,
  streakFreezesAvailable: number,  // start at 0, V2 mechanic; ship the field, ignore it
  notificationsEnabled: boolean,
  createdAt: number
}
```

### `jars`
```
{
  id: string,
  name: string,                    // "Mac Studio"
  targetAmount: number,            // in user's currency, integer
  currency: string,                // '₹', '$', etc — user picks at creation
  recordedBalance: number,         // what the app says they owe themselves
  confirmedBalance: number,        // what they say they actually transferred
  monthlyCap: number | null,
  linkedHabitId: string,
  depositRule: {
    trigger: 'streak',             // only 'streak' in v1
    streakLength: number,          // e.g. 7
    amount: number                 // e.g. 500
  },
  paused: boolean,
  createdAt: number
}
```

### `jarDeposits`
```
{
  id: string,
  jarId: string,
  amount: number,
  triggeredByStreak: number,       // which streak length triggered it
  recordedAt: number,
  confirmedState: 'pending' | 'transferred' | 'partial' | 'skipped',
  confirmedAmount: number | null,  // for 'partial'
  confirmedAt: number | null
}
```

## Screens (3 total, one HTML file with screen switching)

### 1. Today (default screen)
- Header: app name, total coins, settings icon
- Identity line (static for v1): "Showing up today."
- "Today's habits" section:
  - For each habit scheduled today, a card with:
    - Habit name + current streak ("🔥 5 days")
    - Three buttons: `Done` `Min` `Skip`
    - Buttons disable after one is tapped; tapping the active one again undoes it
- "Active jar" section (if any jar exists):
  - Jar name, progress bar, "Recorded ₹X / Target ₹Y"
  - If `recordedBalance > confirmedBalance`, show a "Confirm transfers" button
- Floating "+" button → Add Habit screen

### 2. Add Habit
- Name (required)
- Schedule: daily / weekdays / custom (with day-of-week toggles)
- Reminder time (optional, time picker)
- Minimum version (required, free text)
- "Link to savings jar" (optional, dropdown of existing jars + "Create new")
  - If "Create new": expand inline form for jar (name, target amount, currency, deposit rule: every N-day streak → ₹X, monthly cap)
- Save → returns to Today

### 3. Confirm Transfers (modal)
- List of pending jar deposits
- Per row: amount, date, [Transferred] [Partial: amount] [Skipped] buttons
- Updates `confirmedState` and `confirmedBalance`

That is the entire UI for v1. No settings screen, no calendar, no charts. A Settings link in the header opens a `prompt()` for "Reset all data?" — that's it.

## Coin earning rules (lock these)

Per completion:
- `Done` on a `daily` habit = 10 coins
- `Done` on a `weekdays` habit = 12 coins
- `Done` on a `custom` habit = 15 coins (rarer schedule = higher reward)
- `Min` = 5 coins flat
- `Skip` = 0 coins
- Comeback bonus: first `Done` after a `missed` day = +25 coins

Streak milestone bonuses (one-time, when crossed):
- 3 days: +15
- 7 days: +50
- 30 days: +300
- 90 days: +1500

No multipliers, no impact/urgency in v1. Keep it simple.

## Streak rules

- Streak counter increments each time a habit is `Done` on a scheduled day.
- `Min` keeps the streak alive (counts as a partial completion) but does not increment the milestone counter.
- `Skip` or no entry by end-of-day on a scheduled day = streak resets to 0.
- For weekday/custom schedules, only scheduled days affect the streak.
- Streak rollover happens on first app open after midnight (lazy evaluation, no background job needed).

## Notifications (best-effort, document the limits)

- On first habit creation, prompt for notification permission.
- For each habit with a `reminderTime`, attempt to schedule via `Notification Triggers API` (`showTrigger: new TimestampTrigger(...)`).
- If the API is unavailable, fall back to: when the app is opened, check if any habit's reminder time has passed today and the habit isn't completed → show an in-app banner.
- Snooze: tapping a notification opens the app and reschedules a single follow-up 10 min later. Max 3 snoozes per habit per day.
- Add a one-line disclaimer in the README and in-app: "Reminders are best-effort on web. For 100% reliable alarms, V2 will ship a native wrapper."

## Service worker

- Cache the shell on install (HTML, CSS, JS, manifest, icons).
- Network-first for `/`, cache-first for `/src/*` and assets.
- No fancy strategies. Goal is "app opens offline."

## PWA manifest

```json
{
  "name": "Habit RPG",
  "short_name": "Habits",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Icons can be solid color squares with the letter "H" centered. Generate via canvas at build time or commit static PNGs. Don't spend more than 15 min on icons.

## Acceptance criteria for "v1 complete"

By end of hour 24, all of the following must be true on a clean install on the user's phone:

1. Open URL on phone, "Add to Home Screen" works, opens fullscreen.
2. Can add a habit with name, daily schedule, reminder time, minimum version.
3. Habit appears on Today screen.
4. Tapping `Done` increments streak and coins; persists across reload and across PWA close/reopen.
5. Tapping `Min` adds 5 coins, keeps streak alive.
6. Reminder fires at the scheduled time (with permission granted) — or shows graceful fallback.
7. Can create a savings jar linked to a habit with rule "every 7-day streak → ₹500".
8. When a 7-day streak triggers, a deposit appears in `Confirm Transfers` modal.
9. Confirming the transfer updates `confirmedBalance`.
10. App works offline (turn off wifi, open from home screen, all features still work except new notification scheduling).

If even one of these fails at hour 24, that's a bug to fix before declaring done.

## Out of scope for day 1 (DO NOT BUILD)

- Multiple jars per user (limit to 1 jar in v1)
- Templates
- Categories
- Impact / urgency / difficulty / priority score
- Levels
- App modes (RPG / Minimal / Professional / Reflective)
- Reward contracts other than the savings jar
- Charts, calendar, heatmap, insights
- Backup / export / import
- App lock
- Themes
- WOOP planning
- Habit health score
- Edit habit (only add + archive in v1)
- Multiple reminders per habit

If an agent suggests adding any of these mid-run, refuse and continue with the planned scope.
