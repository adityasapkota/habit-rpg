# STATUS

Live status of the 24-hour build. Updated by Claude Code after every meaningful change.

## Current

- **v1 shipped.** All six phases COMPLETE and APPROVED by both Codex and Gemini.
- **Last updated:** 2026-04-28 09:15 UTC
- **Live URL:** https://adityasapkota.github.io/habit-rpg/
- **Last deployed commit:** `13c2b55` (Phase 6 polish + harden; SW cache `habit-rpg-v10`)
- **Phase 1:** COMPLETE — Codex APPROVED, deploy green (commit `0a58e29`)
- **Phase 2:** COMPLETE — Codex + Gemini APPROVED (commit `c0f9549`)
- **Phase 3:** COMPLETE — Codex + Gemini APPROVED (commit `e5a1913`)
- **Phase 4:** COMPLETE — Codex + Gemini APPROVED (commit `f2ebfda`)
- **Phase 5:** COMPLETE — Codex + Gemini APPROVED (commit `c80385e`)
- **Phase 6:** COMPLETE — Codex + Gemini APPROVED FOR V1 SHIP (commit `13c2b55`)
- **Build process:** every phase ended with BOTH a Codex bug review and a Gemini bug review. Findings synthesized, fixed, redeployed, and re-reviewed until both passed. Phases 2–6 each took 2–3 review rounds. Hotfix `d5e0d0a` reverted an over-aggressive `crossorigin="anonymous"` on the Tailwind script after the user reported the live site rendering as plain text in Chrome (the CDN's redirect target lacks CORS headers — see memory `reference_tailwind_play_cdn_no_cors.md`).
- **What's documented:** `KNOWN_ISSUES.md` carries the V1 limitations (best-effort web reminders, single-jar v1, no edit/settings UI, V2 roadmap stub). README rewritten with feature summary + Android/iOS install instructions.

## Phase log

### Phase 1 — Skeleton + Deploy ✅
- [x] Repo skeleton scaffolded per 02_DESIGN_DAY1.md file layout
- [x] index.html, manifest.webmanifest, sw.js, src/app.js written
- [x] GitHub Actions deploy workflow written (with `enablement: true`)
- [x] Icons generated (192 + 512 PNG, slate bg, white H)
- [x] State files written (STATUS, DECISIONS, HANDOFF, README)
- [x] Initial deploy blocked on Pages enablement; user enabled Pages; re-trigger commit `0a58e29` deployed green (run 24990567278)
- [x] Verified live: index.html (200), sw.js (200, application/javascript), manifest (200, application/manifest+json), icons (200, image/png), build-tag footer renders `2026-04-27T10:46:05Z 0a58e29`
- [x] Codex review APPROVED (verified URL renders, manifest valid, icons present, SW handlers live, layout matches 02_DESIGN_DAY1.md)
- [x] PHASE_1_HUMAN_CHECK.md skipped per user override

### Phase 2 — Habit creation + Today list ✅
- [x] `db.js`: IDB wrapper with `habits`, `completions`, `userState`, `jars`, `jarDeposits` stores + `habitId-date` unique index; `ensureUserState`, `resetAllData` (rejects on blocked/error), `newId`
- [x] `habits.js`: `createHabit` (name+min validation, schedule + customDays), `listHabits`, `getHabit`, `archiveHabit`, `getHabitsScheduledForDate`, `getCompletionsForDate`, `setCompletion` with toggle/switch semantics
- [x] `render.js`: Today screen (empty state with FAB arrow, tomorrow state, habit cards), Add Habit form (radios, custom days, time input, validation). Atomic re-render via single `replaceChildren`. Single-flight buttons; spec-compliant disable. DOM-built only, no `innerHTML`
- [x] `app.js`: SW registration, screen routing via `.hidden`, FAB shows only on Today, Settings → reset-all with error surfacing
- [x] `sw.js`: SHELL + Tailwind CDN + idb CDN precached atomically via single `cache.addAll`; cache `habit-rpg-v4`. Install fails (and SW does not activate) if any required asset is unfetchable
- [x] Phase 2 first commit `13b4f0a` deployed green; first Codex review flagged Tailwind CDN miss → fix `56cfc76` deployed
- [x] Dual review (Codex + Gemini) on `56cfc76`: 2 P0 (race + flash), 3 P1 (N+1 fetch, silent reset, swallowed CDN error), 2 P2 (empty-state arrow, cancel race) → all fixed in `17f9283`
- [x] Re-review on `17f9283`: Gemini APPROVED all 8 items; Codex CHANGES REQUESTED only on STATUS staleness (this update closes it)
- [x] Phase 2 fully closed

### Phase 3 — Streaks + coins ✅
- [x] `dates.js` (new): pure date helpers + `isHabitScheduledOn` extracted from `habits.js` so streaks/coins/tests don't drag in the IDB layer
- [x] `coins.js` (new): `baseCoinsFor(status, schedule)` returns 10/12/15 for daily/weekdays/custom Done, 5 for Min, 0 for Skip; `COMEBACK_BONUS = 25`
- [x] `streaks.js`: `streakAsOf` walks back through scheduled days, completed=+1, minimum=alive-no-increment, missed/no-row-on-past=break, bounded by habit's createdDay; `crossedMilestone` returns highest-crossed of {3,7,30,90}; `priorMissedComeback` treats past no-row as missed; `SAFETY_DAYS=1200` (covers 90×7 weekly milestones)
- [x] `habits.js setCompletion`: one IDB transaction across `habits` / `completions` / `userState`; computes coinsEarned with comeback + milestone; updates userState by delta; rejects writes for unscheduled days; bounded per-habit history fetch
- [x] `habits.js rolloverMissed`: backfill on first run with existing habits (capped 30 days); single transaction; one range getAll + in-memory Set check (no nested per-day getFromIndex)
- [x] `habits.js getAllCompletionsByHabit`: bounded scan to last `SAFETY_DAYS` days
- [x] `app.js`: rollover at bootstrap; `visibilitychange` + `pageshow` re-trigger rollover and refresh on local-date roll; comeback + milestone toasts surfaced on completion; click handler error → toast
- [x] `render.js`: `🔥 N` streak badge always visible (slate at 0, amber at >0); `showToast` (top-center, stacks, aria-live)
- [x] `sw.js`: SHELL extended with `dates.js` + `coins.js`; cache `habit-rpg-v6`; CDN modules per-mode (cors for jsdelivr, no-cors+opaque for cdn.tailwindcss.com)
- [x] Three review passes — final at commit `e5a1913` with both Codex and Gemini APPROVED

### Phase 4 — Notifications ✅
- [x] `notifications.js`: feature detection (`isNotificationSupported`, `hasTriggersApi`), `requestPermission` persisted to userState, `scheduleForHabit` via Triggers API where supported, `cancelForHabit` with stable per-(habit, date) tag and `includeTriggered` fallback, `dueRemindersToday` returns scheduled+past+un-acted habits with `snoozesLeft`, `snoozeInApp` returns `{snoozed, remaining}`, `dismissForHabit` per-habit-per-day, `rescheduleAllReminders` re-primes all habits' next-occurrence
- [x] `render.js renderReminderBanner`: top-center amber banner with Snooze 10 min / Dismiss for today; snooze button auto-disables when every due habit is at the cap
- [x] `app.js`: permission flow on first habit save with reminderTime; reschedule on bootstrap and on every visibility/pageshow resume (not just date-changing); 60s banner polling while visible; cancel pending notification on Done/Min/Skip
- [x] `sw.js`: `notificationclick` handler with snoozeCount in `data` (cap at 3, action removed at last snooze, stable tag for cancel), uses `self.TimestampTrigger` and `self.clients.matchAll`; cache `habit-rpg-v8`
- [x] README + footer disclaim that browser scheduled notifications are best-effort and unsupported browsers see reminders only when the app is open
- [x] Three review passes — final at `f2ebfda` with both reviewers APPROVED

### Phase 5 — Savings jar ✅
- [x] `db.js`: bumped to v2 with `jarId-date` (unique) and `confirmedState` indexes on `jarDeposits`
- [x] `jar.js`: `computeJarTrigger` (pure, monthly cap keyed on completion date, never overshoots target, paused/funded gates), `getActiveJar`, `listPendingDeposits` via `confirmedState` index, `createJar` enforces single-jar v1 invariant in a tx + strict `Number.isInteger` validation, `setJarPaused`, `confirmDeposit` (atomic across `jarDeposits`+`jars`)
- [x] `habits.js setCompletion`: tx now spans jars + jarDeposits; jar trigger fires only when `resultRow.status === 'completed'`; deposits are deduped per `(jarId, dateStr)` so undo+redo never double-deposits; returns `{jarDeposit, jarFunded, jarCurrency}` for UI toasts
- [x] `render.js`: `jarCard` on Today (progress bar, currency-aware fmt, persistent funded banner inside card, pause/resume + confirm buttons), `renderConfirmTransfers` modal with Transferred/Partial(prompt)/Skipped per row, optional `jarFormSection` in Add Habit (auto-disabled inputs when collapsed so HTML5 `required` doesn't block normal habit save)
- [x] `app.js`: `showConfirmTransfers` switches to confirm screen and re-renders after each resolve; `onTogglePause` toast; jar-create errors re-throw so the Add Habit form re-opens with the message; currency-aware deposit toast
- [x] Three review passes — final at `c80385e` with both reviewers APPROVED

### Phase 6 — Polish + harden ✅
- [x] Phase 6 dual review against the 10 v1 acceptance criteria from `02_DESIGN_DAY1.md`
- [x] Real defects fixed: milestone bonus re-fire on streak reset (now persisted per-habit in `milestonesAwarded`); jar atomicity (permission prompt + jar input validation lifted before habit save); idb CDN promoted to required atomic precache (Tailwind stays best-effort); midnight refresh added to the 60s polling timer; Confirm modal auto-closes on empty; `prompt()` replaced with an inline partial-amount input; Confirm-Transfers button now follows the spec ("recorded > confirmed", not "pending > 0"); cache.put failures in fetch handler swallowed to avoid unhandled rejections
- [x] PWA polish: iOS apple-mobile-web-app-* meta tags; jar number inputs get `min="1" step="1"` to match the strict integer validator
- [x] `KNOWN_ISSUES.md` shipped (best-effort reminders, single-jar limit, no habit edit, no settings UI, V2 roadmap stub)
- [x] README rewritten with feature summary + install instructions for Android/iOS
- [x] SW cache `habit-rpg-v10`
- [x] Both Codex and Gemini APPROVED FOR V1 SHIP on commit `13c2b55`. v1 shipped.
