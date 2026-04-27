# ORCHESTRATION v3 - Agent Coordination + Two-Phase Checkpoints (Max plan)

How Claude Code, Codex, and Gemini work together over 24 hours, with user checkpoints every 2 phases.

---

## What changed in v3

- **User plan: Claude Max.** Usage caps are not the bottleneck.
- **Pauses every 2 phases**, not every phase. Three checkpoints total:
  - End of Phase 1: deploy verification (existing, kept)
  - End of Phase 2: mid-build review checkpoint (new)
  - End of Phase 4: late-build review checkpoint (new)
  - End of Phase 6: natural finish, no pause
- Pauses use a sentinel file (WAITING_FOR_USER.md) so Claude can keep its session alive while waiting.

---

## Roles (unchanged)

| Agent | Role | When invoked |
| --- | --- | --- |
| **Claude Code** | Builder. Owns the codebase. | Continuously |
| **Codex** | Reviewer + tiebreaker. | End of each phase + when blocked |
| **Gemini** | Final tiebreaker. | When Claude and Codex disagree twice |

---

## The pause schedule

| After phase | Pause type | Why |
| --- | --- | --- |
| 1 | Human deploy check (existing) | Verify PWA installs on phone before agents continue overnight |
| 2 | User checkpoint | First real features shipped (habit CRUD + Today screen). Last chance to catch direction problems cheaply. |
| 3 | No pause | Phase 3 (streaks/coins) builds directly on Phase 2 logic. Splitting is artificial. |
| 4 | User checkpoint | Notifications phase done. This is the riskiest phase technically; verify it actually works on your phone before the build burns more time. |
| 5 | No pause | Phase 5 (jar) is a direct extension of Phase 3 (streaks trigger deposits). Splitting is artificial. |
| 6 | None - natural end | Build complete. Final acceptance check is the deliverable. |

**Total wall-clock with pauses:** 24h Claude work + 2 user pauses (length up to you) = roughly 24-30h total.

---

## State files (in repo root, all committed)

| File | Written by | Read by | Purpose |
| --- | --- | --- | --- |
| STATUS.md | Claude | All | Live status |
| HANDOFF.md | Claude | Codex | Decision request |
| DECISIONS.md | Codex/Gemini | All | Decision log |
| DISAGREEMENTS.md | Claude | Gemini | Tiebreak escalation |
| WAITING_FOR_USER.md | Claude | User | Pause sentinel (post-Phase 2 and post-Phase 4) |
| RATE_LIMITED.md | Claude | User | Usage-limit pause (rare on Max but possible) |
| ABANDONED.md | Claude | User | 12h no-response exit |
| PHASE_1_HUMAN_CHECK.md | Claude | User | Existing deploy verification gate |

---

## The pause protocol

After Phase 2 ends (and again after Phase 4), Claude does the following before starting the next phase:

1. Verify own exit criteria from `04_PHASE_PLAN.md`
2. Commit and push, verify Actions deploy is green
3. Update STATUS.md with phase summary
4. Invoke Codex with the review prompt
5. Apply Codex feedback if any
6. **Write WAITING_FOR_USER.md with the template below**
7. Commit and push the sentinel
8. Enter polling loop (every 60 seconds, check if file exists, sleep)
9. When user deletes the file, log to STATUS.md, start next phase

After Phase 1, 3, 5, 6: skip steps 6-9. Move directly to next phase (or finish).

---

## WAITING_FOR_USER.md template

```
# WAITING FOR USER (Checkpoint after Phase {N})

Time: 2025-XX-XX HH:MM:SS
Just completed: Phase {N}
Next phase: Phase {N+1}

## What shipped this checkpoint (Phases {N-1} and {N})
- (bullet summary of what was built across the two phases)
- Last commit: abc1234, deployed green to Pages

## Codex review summary
- Phase {N-1}: APPROVED / changes applied
- Phase {N}: APPROVED / changes applied

## What I want you to verify before continuing
- (specific things to test on your phone or in the deploy)
- (any flags Claude wants the user to check)

## Why I am pausing
Mid-build checkpoint per orchestration v3 protocol (every 2 phases).

## To resume
Delete this file from the repo root. Claude detects within 60 seconds and starts Phase {N+1}.

## To stop the build cleanly
Write the word STOP anywhere in this file before deleting it. Claude will exit cleanly without starting the next phase. Resume any time later by re-running the kickoff prompt.

## Polling status
I am polling every 60s. POLL_HEARTBEAT.log shows I am alive.
12h timeout will write ABANDONED.md and exit.
```

---

## Polling loop (Claude implements via bash tool)

```bash
SECONDS=0
while [ -f WAITING_FOR_USER.md ]; do
    # Check for STOP signal
    if grep -q "^STOP" WAITING_FOR_USER.md 2>/dev/null; then
        echo "STOP signal received. Exiting cleanly."
        exit 0
    fi

    # Heartbeat every 30 minutes so user knows Claude is alive
    if [ $((SECONDS % 1800)) -lt 60 ]; then
        date "+%Y-%m-%d %H:%M:%S still polling" >> POLL_HEARTBEAT.log
    fi

    # 12-hour safety timeout
    if [ $SECONDS -gt 43200 ]; then
        echo "12h timeout - abandoning" > ABANDONED.md
        git add ABANDONED.md
        git commit -m "Abandoned after 12h no-response"
        git push
        exit 0
    fi

    sleep 60
done

# File deleted - resume
echo "Sentinel deleted, resuming next phase" >> STATUS.md
```

---

## "Blocked" definition (unchanged)

Claude declares blocked only when:
1. Same error 3 consecutive attempts
2. Two reasonable design paths with no clear winner
3. External dependency failure

Not blocked: a hard problem that needs more thinking. Try harder before declaring blocked.

---

## Codex review prompt (per phase)

```
codex exec --full-auto "Review the work just completed for Phase {N}.
Read STATUS.md, 04_PHASE_PLAN.md, and 02_DESIGN_DAY1.md.
Compare against the exit criteria in 04_PHASE_PLAN.md for this phase.

Output exactly one of:
1. APPROVED - list what you verified.
2. CHANGES REQUESTED - list specific fixes, in priority order.

Do not request features beyond what the phase exit criteria specify.
Do not suggest refactors.
Do not request features from later phases or V2.

Time budget: under 5 minutes."
```

---

## Decision prompt (when Claude is blocked)

```
codex exec --full-auto "Claude Code is blocked. Read HANDOFF.md for the problem.
Make a decision and write it to DECISIONS.md.
Be decisive - pick one option, give a one-paragraph rationale, and stop.
Do not propose additional options.
If both options seem equally bad, pick the simpler one. Shipping beats perfecting."
```

---

## Gemini tiebreak prompt (when escalating)

```
gemini -p "Claude Code and Codex have disagreed twice on the same issue.
Read DISAGREEMENTS.md latest entry and 02_DESIGN_DAY1.md.
Pick a side and write your decision to DECISIONS.md.
One paragraph max. Be decisive."
```

---

## Hard time-budget rules (per phase)

| Phase | Budget | If overrun by 30 min |
| --- | --- | --- |
| 1-5 | 4h each | Codex calls "ship it." Whatever works ships. Broken code reverted. Move to next phase or pause. |
| 6 | 4h | Hard stop. No new fixes after that. |

Pause time does NOT count against any phase budget. Only Claude work time counts.

---

## Hour 20 feature freeze (unchanged)

After 20 hours of Claude work time (excluding pauses):
- No new feature work
- Hours 20-24 are bug fixes only
- Codex review at hour 20 produces prioritized bug list
- Claude works the bug list top-down
- Unfixed bugs at hour 24 documented in KNOWN_ISSUES.md

---

## What Claude Code never does

- Add dependencies after Phase 1
- Refactor working code
- Skip the Codex review at phase end
- Skip the WAITING_FOR_USER pause after Phase 2 or Phase 4
- Continue past a "BLOCKED" without a DECISIONS.md entry
- Commit code that does not deploy green
- Retry indefinitely on rate-limit errors

---

## Failure modes

| Failure | What happens |
| --- | --- |
| Claude crashes mid-phase | Session ends. Resume with kickoff prompt. STATUS.md says where it died. |
| Claude hits rate limit | Writes RATE_LIMITED.md, pauses. You resume after window clears. (Rare on Max for a 24h build.) |
| Codex unreachable | Claude continues solo, logs to DECISIONS.md as "auto-decided due to Codex unavailable" |
| User does not delete sentinel | After 12h, ABANDONED.md written, Claude exits cleanly |
| Deploy fails | Retries 3x, then declares phase blocked, escalates |
| Phase ships broken | Codex catches at review, requests revert |

---

## Total elapsed time math

| Scenario | Phase work | Pauses | Total wall clock |
| --- | --- | --- | --- |
| You delete sentinel within 30 min each time | 24h | 1h | 25h |
| You sleep through one pause (8h) and respond fast to other | 24h | 8.5h | 32.5h |
| You sleep through both pauses | 24h | 16h | 40h |

The build will not run faster than 24 hours of Claude work. Pauses extend total wall-clock but do not consume Claude usage.

---

## Practical timing recommendation

Start the build at a time that puts the Phase 2 pause when you are awake. Example:

- Start 8am Saturday
- Phase 1 finishes ~12pm (you verify deploy on phone)
- Phase 2 finishes ~4pm (first checkpoint - you review on your phone, delete sentinel)
- Phases 3-4 run 4pm-12am (you sleep through this)
- Phase 4 pause hits ~12am - sentinel sits overnight
- You wake up 8am Sunday, review notifications phase, delete sentinel
- Phases 5-6 run 8am-4pm Sunday
- Build complete Sunday afternoon

This is the natural rhythm: two awake checkpoints, one overnight pause where the sentinel just sits.