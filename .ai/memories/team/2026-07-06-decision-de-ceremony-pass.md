---
id: 2026-07-06-decision-de-ceremony-pass
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/failure-coverage.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/init.ts
    - packages/mcp/src/prompts/post-task.ts
  symbols: []
tags:
  - de-ceremony
  - friction
  - passive-capture
  - bootstrap
  - v0.49.0
created_at: '2026-07-06T22:27:50.859Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision De Ceremony Pass

**What (v0.49.0):** cut ceremony/friction so effort concentrates on the un-copyable core (gate, prove-RED, guard-creation). Four changes, none touching the deterministic sensor path:

1. **Passive capture is silent until signal** (`distillFailureObservations`): expanded the noise denylist to navigation/setup builtins (cd, mkdir, echo, cp, mv, rm, test, …) which are ALWAYS dropped; and added a signal bar — a draft is kept only if the failure REPEATS (count ≥ 2, a retry loop) OR the command is substantive (test/build/typecheck/lint via SUBSTANTIVE_RE). A one-off ordinary failure now produces no draft (the `cd` that became a "lesson" no longer does).
2. **Decision-memory bar** (`post_task` prompt): added a "capture only what is UNGUESSABLE" section — for a routine change, capturing nothing is the correct outcome. Reduces box-ticking memories that make every briefing worse.
3. **Release papercut**: `.ai/.usage/` (machine-local tool-usage telemetry, never team truth — eval baselines already exclude local usage) is now gitignored by `init`, and untracked in this repo. It changed on every invocation and forced a `git stash` before every release.
4. **Bootstrap gate bound to sharing points**: `checkBootstrapComplete` now takes `stage`; the BLOCK only fires at pre-push / ci / finish (`enforcedStage`), and is a warn at pre-commit / local. The baseline still can't be SHARED without being filled, but quick local iteration and throwaway repos are no longer blocked (which trained `--no-verify`). Mirrors [[2026-07-02-decision-process-gates-bind-agents-not-humans]].
