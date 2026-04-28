# Known issues — v1

Things the dual-review process flagged but that did not block the v1 ship.
Each entry has a brief explanation of the user-visible impact and what
would close it.

---

## Reminders are best-effort on the open web

The Notification Triggers API (`new TimestampTrigger(...)`) is currently
gated behind a flag in Chromium and unavailable on most browsers. When
the API isn't supported, scheduled reminders only fire once you next open
the app — the in-app banner on the Today screen surfaces any reminder
whose time has passed and that you haven't acted on yet, with a Snooze
10 min / Dismiss controls. The 60s polling timer makes that banner
appear even if the time crosses while the app is open.

A V2 native wrapper (e.g. Capacitor) would close this for 100% reliable
alarms.

## "Min" days don't trigger jar deposits

Jar deposits fire when a `Done` pushes the streak across an integer
multiple of the rule's streak length. A `Min` day keeps the streak alive
but doesn't increment its value, so a stretch of all-Min days never
crosses a milestone and never moves money toward the jar. This is
intentional in v1 — the jar is meant to reward the harder commitment of
a real Done streak — but it can surprise someone using Min as a daily
fallback.

## Undo is forward-only for jar deposits and milestone bonuses

If you complete a habit, trigger a deposit (or a milestone bonus) and
then undo the completion, the deposit row stays in the jar and the
bonus stays on your coin balance. Re-doing the same date will not
re-trigger the deposit (we dedupe by `(jarId, date)`) and will not
re-pay the milestone (we track awarded lengths per habit), so there's
no abuse path — the user just sees a one-way ratchet. V2 can revisit if
the asymmetry feels weird in practice.

## Multiple jars

V1 enforces a single savings jar globally, linked to one habit, both
in the Add Habit form and in `createJar`. V2 will likely allow several
named jars per user.

## Habit edit

V1 supports add and archive; you can't rename a habit, change its
schedule, or change its reminder time after creation. The workaround
is archive + re-add. V2 should ship in-place edit.

## Settings UI

There is no Settings screen. The header gear icon opens a `confirm()`
dialog for "Reset all data?" — that's it. V2 will likely add at least:
- import / export
- per-habit edit
- theme toggle (light mode)

## V2 roadmap stub

Beyond the items above, design notes already outside v1 scope:
multiple jars, templates, categories, impact / urgency / difficulty
scoring, levels, app modes (RPG / Minimal / Professional / Reflective),
reward contracts other than the jar, charts / calendar / heatmap /
insights, app lock, themes, WOOP planning, habit health score, multiple
reminders per habit.
