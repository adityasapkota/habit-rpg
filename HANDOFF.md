# HANDOFF — Phase 1 blocked on GitHub Pages enablement

Time: 2026-04-27 10:37 UTC
Phase: 1 (Skeleton + Deploy)
Block category: external dependency failure

## What happened

Phase 1 scaffold landed cleanly:
- Commit `82b1c3d` — initial PWA skeleton (index.html, manifest, sw.js, src/, icons, deploy.yml, state files)
- Commit `bf73465` — added `enablement: true` to `actions/configure-pages@v5` after the first deploy failed

Both deploy runs failed at the same step:

| run | conclusion | failed step |
| --- | --- | --- |
| 24990142360 (`82b1c3d`) | failure | `actions/configure-pages@v5` (1s) |
| 24990171017 (`bf73465`) | failure | `actions/configure-pages@v5` (1s) |

Job logs require auth and are not readable from this environment.

## Diagnostic evidence

```
$ curl https://api.github.com/repos/adityasapkota/habit-rpg/pages
404 Not Found
$ curl https://api.github.com/repos/adityasapkota/habit-rpg | jq .has_pages
false
```

Pages is not enabled on the repo. `enablement: true` should have created the
Pages site on first run, but it did not — most likely the repo's "Workflow
permissions" setting (Settings → Actions → General → Workflow permissions) is
restricting the default `GITHUB_TOKEN` to read-only despite our workflow-level
`permissions: pages: write` block, or the personal-account default for
Pages-by-Actions is gated.

## Two paths I considered

1. **Ask the user to enable Pages manually** — flip Settings → Pages → Source
   to "GitHub Actions". 30 seconds of user time. Unblocks the build cleanly.
   Risk: requires user attention before agents can continue.

2. **Switch to legacy `gh-pages` branch deploy** — rewrite deploy.yml to push
   built artifact to a `gh-pages` branch, then user enables Pages on that
   branch. Same chicken-and-egg: still needs user to enable Pages once. Adds
   a moving part for no gain.

Both end at "user must enable Pages once". Path 1 is strictly simpler.

## What I am NOT doing

- Not retrying configure-pages a third time without changing inputs (would be
  the third identical failure → blocked criterion #1).
- Not removing `enablement: true` (still wanted once Pages is enabled).
- Not reverting any code. The skeleton is correct.

## What I want from the decision

Confirmation of path 1 (user enables Pages, agents resume) vs anything else.
