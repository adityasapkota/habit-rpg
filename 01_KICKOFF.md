# KICKOFF — 24-hour Habit RPG Build

## What you do (≈ 15 min, before launching agents)

1. **Create a new GitHub repo.** Name it `habit-rpg` or whatever. Public is fine. Empty.
2. **Clone locally** to a working directory. Open it in your terminal.
3. **Enable GitHub Pages** in repo settings → Pages → Source: "GitHub Actions". This lets the agents deploy via workflow.
4. **Confirm CLIs are installed and authed:**
   - `claude` (Claude Code) — logged in
   - `codex` — OpenAI Codex CLI, logged in
   - `gemini` — Gemini CLI, logged in
   - `git` with push access to the repo
5. **Drop the four planning docs into the repo root:** `01_KICKOFF.md`, `02_DESIGN_DAY1.md`, `03_ORCHESTRATION.md`, `04_PHASE_PLAN.md`. Commit and push. (The agents will read these.)

## The kickoff prompt — paste this into Claude Code

```
You are the lead builder for a 24-hour PWA build. Read these four files in order before doing anything else:

1. ./01_KICKOFF.md
2. ./02_DESIGN_DAY1.md
3. ./03_ORCHESTRATION.md
4. ./04_PHASE_PLAN.md

After reading, follow ./04_PHASE_PLAN.md sequentially. Phase 1 first, Phase 6 last.

Hard rules you must obey for the entire 24h:
- Every phase ends with a successful `git push` to main and a green deploy. Never end a phase with broken code committed.
- If a feature can't land cleanly within the phase budget, REVERT it and move on. A working app missing one feature beats a broken app with all features.
- After each phase, invoke `codex` with the review prompt in 03_ORCHESTRATION.md and apply its feedback before starting the next phase.
- If you become BLOCKED (definition in 03_ORCHESTRATION.md), write HANDOFF.md and invoke `codex` with the decision prompt. Apply its decision verbatim and continue.
- If `codex` and you have disagreed on the same issue twice, invoke `gemini` as tiebreaker.
- Update STATUS.md after every meaningful change.
- Hour 20 is feature freeze. Hours 20–24 are bug fixes and polish only.
- Do not add dependencies after Phase 1.
- Do not refactor.

Begin Phase 1 now.
```

## What you verify before sleeping (Phase 1 exit, ~4h in)

Before you go to bed, the repo must show:

- [ ] `STATUS.md` says "Phase 1 complete"
- [ ] GitHub Pages URL loads on your phone
- [ ] You tapped "Add to Home Screen" and the icon appeared
- [ ] You opened the installed PWA and it rendered (even just "Hello, habit RPG")
- [ ] Service worker registered (check DevTools or trust the agent's STATUS log)

If any of those is false, **kill the run.** Don't let agents work overnight on a broken foundation.

If all true, you're safe to sleep. Phases 2–6 will run autonomously.

## What you wake up to

Best case: a working PWA on your phone with habit creation, completion tracking, streaks, coins, notifications, and one savings jar.

Realistic case: 4–5 of the 6 phases shipped cleanly, last 1–2 partially done. Whatever shipped will be deployed and usable.

Worst case (mitigated): the agents got stuck on something at hour 14 and stopped. The repo's last successful deploy is what you have. Read STATUS.md and HANDOFF.md to understand where it died, then resume manually.

## Morning checklist

1. Open the PWA on your phone.
2. Add one habit you actually want to track today.
3. Skim STATUS.md and DECISIONS.md to see what the agents shipped and what they punted.
4. Use the app for 10 days before touching the code again. Take notes on friction.
5. After day 10, V2 planning.
