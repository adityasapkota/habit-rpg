# PHASE PLAN — 6 phases × 4 hours = 24 hours

Each phase ends with a working, deployed app. Codex verifies exit criteria before next phase begins.

---

## PHASE 1 — Skeleton + Deploy (hours 0–4)

**Goal:** A blank PWA installed on the user's phone, with the deploy pipeline working end-to-end.

**Tasks:**
1. Initialize repo structure per `02_DESIGN_DAY1.md` (file layout section).
2. Write `index.html` with: Tailwind CDN script, manifest link, "Habit RPG" h1, visible "build {timestamp}" footer (so deploys are verifiable).
3. Write `manifest.webmanifest` per spec.
4. Generate `icons/icon-192.png` and `icons/icon-512.png`. Solid color (#0f172a) with white "H" centered. Don't perfect them.
5. Write `sw.js` with install handler that caches the shell. Register in `app.js`.
6. Write `.github/workflows/deploy.yml` to deploy to GitHub Pages on push to main.
7. Push. Verify Actions run is green. Verify URL loads.
8. Write `STATUS.md` with Phase 1 marked complete.

**Exit criteria (Codex verifies):**
- [ ] GitHub Pages URL returns 200 and renders the h1
- [ ] Lighthouse PWA audit passes "installable" check (manifest valid, SW registered, HTTPS)
- [ ] `manifest.webmanifest` validates
- [ ] Service worker visible in DevTools Application tab
- [ ] Repo has all files from layout in `02_DESIGN_DAY1.md`, even if mostly empty

**STOP and notify user:** End of Phase 1 is the human checkpoint. The user must verify they can install on their phone before agents continue. Claude Code writes `PHASE_1_HUMAN_CHECK.md` with: the live URL, install instructions, and "agents will continue automatically in 30 minutes unless this file is deleted." If the file is still present after 30 min, agents proceed. (User deletes the file to abort.)

---

## PHASE 2 — Habit creation + Today list (hours 4–8)

**Goal:** User can add a habit and see it on the Today screen with completion buttons. Data persists.

**Tasks:**
1. Write `db.js` — open IndexedDB, define stores (`habits`, `completions`, `userState`, `jars`, `jarDeposits`), helpers for CRUD.
2. On first load, seed `userState` singleton.
3. Build Add Habit screen per spec (name, schedule, reminder time, minimum version). Validation: name and minimum version required.
4. Build Today screen: header with coin balance (placeholder 0 for now), identity line, list of today's scheduled habits.
5. Wire up `Done` / `Min` / `Skip` buttons. Each writes a completion row, updates UI optimistically. Tapping the active button again undoes (deletes the completion row).
6. Handle "no habits yet" empty state: show "Add your first habit" with arrow to + button.
7. Handle "no habits scheduled today" state: show what's coming up tomorrow.
8. Floating + button → Add Habit screen.

**Exit criteria:**
- [ ] Add 3 habits with different schedules (daily, weekdays, custom). All save.
- [ ] Reload page. Habits still there. Today screen shows the right ones.
- [ ] Tap `Done` on one. Refresh. Status persisted, button shows "completed" state.
- [ ] Tap `Done` again on the same one. Reverts to uncompleted.
- [ ] Open in airplane mode (after first load) → app still works.

---

## PHASE 3 — Streaks + coins (hours 8–12)

**Goal:** Streaks tick up correctly, coins accumulate, milestone bonuses fire, comeback bonus works.

**Tasks:**
1. Write `streaks.js` — pure functions: given a habit and its completions, return current streak count.
2. Streak rules per spec: `Done` increments, `Min` keeps alive but doesn't increment milestone counter, `Skip` or no-entry-by-end-of-day resets, only scheduled days count.
3. Write `coins.js` (or extend habits.js) — pure functions for coin calculation per the spec table.
4. On any completion event: compute coin delta, update `userState.coinBalance` and `totalCoinsEarned`, write to DB.
5. Detect milestone crossings (3, 7, 30, 90 days). On crossing, add the bonus AND show a toast/banner: "🎉 7-day streak! +50 coins."
6. Comeback bonus: when writing a `completed` row, check if yesterday's scheduled status was `missed`. If so, +25 bonus.
7. Today screen updates: show streak count next to each habit (`🔥 5`), show coin balance in header.
8. Handle midnight rollover: on every app open, check `lastOpenDate` in localStorage; if new day, mark yesterday's incomplete scheduled habits as `missed`.

**Exit criteria:**
- [ ] Complete a habit 3 days in a row (mock dates by manipulating completion records via DevTools). Streak shows `3`. Milestone toast fired.
- [ ] On day 4, mark `missed`. Streak resets to 0.
- [ ] On day 5, mark `Done`. Coin balance increases by 10 + 25 (comeback). UI shows the bonus.
- [ ] `Min` completion adds 5 coins, streak stays at 1 instead of incrementing.
- [ ] Coin balance survives reload.

---

## PHASE 4 — Notifications (hours 12–16)

**Goal:** Reminder fires on the user's phone at the scheduled time, with snooze support.

**Tasks:**
1. Write `notifications.js` — feature-detect `Notification`, `Notification.requestPermission`, `Notification Triggers API` (`new TimestampTrigger`).
2. On first habit creation with a reminderTime, prompt for notification permission.
3. If granted and Triggers API supported: schedule via `registration.showNotification` with `showTrigger`. Schedule for the next occurrence of the reminder time.
4. If Triggers API not supported: fall back to in-app banner when app is opened past the reminder time and habit not completed.
5. Notification action button: "Snooze 10 min". Tapping reschedules a single follow-up notification 10 min later, max 3 snoozes per habit per day (track in localStorage by date).
6. Tapping the notification body opens the app to the Today screen.
7. After completing a habit, cancel any pending notifications for it that day.
8. Document the limits in README and a small in-app footer: "Reminders are best-effort on web."

**Exit criteria:**
- [ ] On a real Android device: permission prompt appears. Granting it persists.
- [ ] Schedule a reminder 2 minutes in the future on a phone. Close the app. Notification fires (or in-app fallback fires on next open with a clear message).
- [ ] Snooze button works once. Test.
- [ ] After 3 snoozes, snooze button is hidden / no-op.
- [ ] Marking habit done before reminder fires cancels the reminder.

**Phase 4 is the highest-risk phase.** If 3 hours in this phase has produced no working notifications and feature detection shows the API isn't supported on the user's browser, Codex calls it: ship the polling fallback only, document the limitation loudly, move on. Reliable cross-browser scheduled notifications are a V2 native-wrapper problem. Don't burn the run on this.

---

## PHASE 5 — Savings jar (hours 16–20)

**Goal:** User can create one jar linked to a habit. Streak completion auto-records a deposit. User can confirm transfers.

**Tasks:**
1. Extend Add Habit form: "Link to savings jar" optional section. Dropdown of existing jars + "Create new". Inline new-jar form: name, target amount, currency picker (₹/$/€/£), deposit rule ("Every {N}-day streak → {amount}"), monthly cap (optional).
2. Write `jar.js` — pure functions: `checkJarTrigger(habit, oldStreak, newStreak, jar)` returns deposit amount or 0. Triggers when crossing the rule's streak length and respecting the monthly cap (sum of recordedBalance deltas this calendar month must not exceed cap).
3. On completion that increments streak: for each jar linked to that habit, run trigger check. If positive, write a `jarDeposits` row with `confirmedState: 'pending'`, increment `jar.recordedBalance`.
4. Show "Active jar" card on Today screen: name, progress bar (`recordedBalance / targetAmount`), "Confirmed: {confirmedBalance}". If recorded > confirmed, show "Confirm transfers (N pending)" button.
5. Build Confirm Transfers modal: list of pending deposits with [Transferred] [Partial: input] [Skipped] buttons. On click, update the deposit's confirmedState/confirmedAmount/confirmedAt and add to jar.confirmedBalance accordingly.
6. When jar.recordedBalance reaches targetAmount, show a celebration banner: "🎯 Jar funded! Your reward is fully saved."
7. Pause/resume jar: simple toggle on the jar card. Paused jars do not trigger deposits.

**Exit criteria:**
- [ ] Create a jar: "Test Jar", ₹1000, every 3-day streak → ₹100, linked to a habit.
- [ ] Complete the habit 3 days. A deposit appears in Confirm Transfers.
- [ ] Confirm `Transferred`. confirmedBalance becomes ₹100.
- [ ] After 7 more deposits (real or mocked), jar reaches target. Banner fires.
- [ ] Pause the jar. Next streak doesn't trigger a deposit.
- [ ] Monthly cap: set cap ₹150, complete 3-day streaks twice in same month. Second deposit blocked.

---

## PHASE 6 — Polish + harden (hours 20–24)

**Goal:** Fix bugs from Codex's hour-20 review. No new features.

**Tasks (priority order):**
1. Codex runs full review at hour 20, produces prioritized bug list in `BUGS.md`.
2. Claude Code works the bug list top-down.
3. Manual smoke test of all acceptance criteria in `02_DESIGN_DAY1.md`.
4. README: install instructions, screenshots if time permits, known limitations, V2 roadmap stub.
5. KNOWN_ISSUES.md: anything that didn't ship clean.
6. Final commit, final deploy.

**Exit criteria (the final gate):**
- [ ] All 10 acceptance criteria from `02_DESIGN_DAY1.md` pass on the user's phone.
- [ ] No console errors on app open.
- [ ] No unhandled promise rejections.
- [ ] App opens offline (after first online load).
- [ ] STATUS.md says "v1 shipped"
- [ ] Last commit is on main, deployed, green.

If any acceptance criterion fails at hour 23:30, log it to KNOWN_ISSUES.md and ship anyway. The user's morning is the deadline, not perfection.

---

## What Codex checks at hour 20 (the freeze review)

Codex compares the current state against the 10 acceptance criteria. Output format:

```
PHASE 6 BUG LIST (prioritized)

P0 (must fix):
1. ...
2. ...

P1 (should fix):
1. ...

P2 (document and ship):
1. ...
```

P0s are bugs that violate acceptance criteria. P1s are rough edges. P2s become KNOWN_ISSUES entries.

Hours 20–24: P0 first, P1 if time, P2 just gets documented.
