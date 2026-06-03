---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/sensors.ts
    - packages/core/src/failure-coverage.ts
    - packages/core/src/coverage.ts
    - packages/core/src/eval-history.ts
    - packages/core/src/conflict-resolve.ts
    - packages/core/src/gate-precision.ts
    - packages/core/src/seed-git.ts
    - packages/core/src/merge-memory.ts
    - packages/core/src/dashboard.ts
    - packages/core/src/config.ts
    - packages/cli/src/commands/sensors.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/eval.ts
    - packages/cli/src/commands/coverage.ts
    - packages/cli/src/commands/merge-driver.ts
    - packages/cli/src/commands/memory-resolve-conflict.ts
    - packages/cli/src/commands/memory-seed-git.ts
    - packages/cli/src/commands/dashboard.ts
    - packages/cli/src/commands/init.ts
    - packages/cli/src/index.ts
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-03T00:51:26.621Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 27
requires_human_approval: false
---
## Goal
Implement all 8 harness-engineering gap-closure features (P0-P3) identified in the grounded analysis, perfecting the existing hAIve before adding anything new.

## Accomplished
Shipped v0.15.0 closing 8 verified gaps:
- P0-1 executable shell/test sensors (core selectCommandSensors + CLI `sensors check --commands`)
- P0-2 failure-capture gate in `enforce finish` (core failure-coverage + config failureCaptureGate)
- P1-3 `haive coverage` (core coverage: hot files × anchor coverage)
- P1-4 eval `--record`/`--trend` + CI score trending (core eval-history)
- P2-5 `haive memory resolve-conflict` (core conflict-resolve)
- P2-6 gate precision rollup + auto-tune hint in dashboard (core gate-precision)
- P3-7 `haive memory seed-git` (core seed-git: revert/hotfix → draft attempts)
- P3-8 `haive merge-driver` (core merge-memory: deterministic .ai/ merge)
7 new pure core modules + 29 unit tests (all 223 core / 112 mcp / 62 cli pass). Built, bumped 0.14.0→0.15.0 lockstep, committed 442edd8, tagged + pushed. Core CI green; enforce finish passed 100%.

## Discoveries & surprises
- The decision-coverage pre-commit gate re-blocked on a broad 38-file commit (5/22 decisions uncovered) — confirms the known gotcha: broad changes need `haive briefing --files <all-staged> --max-memories 60` BEFORE committing. Doing so flipped it to 22/22.
- SonarQube CI workflow failed with `Connect timed out` to the self-hosted SONAR_HOST_URL — external infra outage, NOT code. `enforce finish` correctly classified it `github-actions-external-transient` (non-blocking). Good signal that the external-workflow advisory path works.
- Failure-detection (`observe` failure_hint) has false positives (grep exit-1 = "failure"), which is exactly why the new failureCaptureGate defaults to `warn`, not `block`. Don't make it default-block.
- Prior agents already built most of the A–H harness reconciliation (impact, eval, conflict-candidates); the 8 implemented here were the genuinely-remaining gaps, verified against code first to avoid surface duplication.

## Files touched
- `packages/core/src/sensors.ts`
- `packages/core/src/failure-coverage.ts`
- `packages/core/src/coverage.ts`
- `packages/core/src/eval-history.ts`
- `packages/core/src/conflict-resolve.ts`
- `packages/core/src/gate-precision.ts`
- `packages/core/src/seed-git.ts`
- `packages/core/src/merge-memory.ts`
- `packages/core/src/dashboard.ts`
- `packages/core/src/config.ts`
- `packages/cli/src/commands/sensors.ts`
- `packages/cli/src/commands/enforce.ts`
- `packages/cli/src/commands/eval.ts`
- `packages/cli/src/commands/coverage.ts`
- `packages/cli/src/commands/merge-driver.ts`
- `packages/cli/src/commands/memory-resolve-conflict.ts`
- `packages/cli/src/commands/memory-seed-git.ts`
- `packages/cli/src/commands/dashboard.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/index.ts`

## Next steps
Human runs `npm publish` for 0.15.0 (agents never publish). Optional follow-ups: add CLI-level integration test for shell-sensor execution; consider surfacing coverage gaps inside the briefing/finish output; re-run sonarqube once the server is reachable.
