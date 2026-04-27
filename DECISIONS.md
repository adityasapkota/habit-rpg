# DECISIONS

Append-only log. Each entry is a decision made by Codex (or Gemini as tiebreaker)
when Claude Code was blocked or when reviewers ruled on a phase.

Format:
```
## YYYY-MM-DD HH:MM — Phase N — {topic}
Source: codex | gemini
Decision: ...
Rationale: ...
```

## 2026-04-27 05:40 — Phase 1 — GitHub Pages enablement
Source: codex
Decision: Ask the user to enable GitHub Pages manually with Source set to "GitHub Actions", then resume the existing deploy workflow.
Rationale: Both considered paths still require the user to enable Pages once, but keeping the current GitHub Actions Pages deploy avoids adding a `gh-pages` branch, branch-push permissions, and another deployment convention that does not remove the external dependency. The existing skeleton and workflow are already the intended shape, so the fastest shippable path is to unblock Pages directly and continue.
