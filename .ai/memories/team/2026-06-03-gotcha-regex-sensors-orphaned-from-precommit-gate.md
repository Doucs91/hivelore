---
id: 2026-06-03-gotcha-regex-sensors-orphaned-from-precommit-gate
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/sensors.ts
    - packages/mcp/src/tools/precommit-check.ts
  symbols: []
sensor:
  kind: regex
  pattern: 'catch_rate\s*=\s*["'']?1\.0["'']?'
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/sensors.ts
    - packages/mcp/src/tools/precommit-check.ts
  message: >-
    Deterministic regex sensors do NOT run in the pre-commit gate — they are
    orphaned
  severity: warn
  autogen: true
  last_fired: null
tags:
  - sensors
  - enforcement
  - precommit
  - quality
  - gap
created_at: '2026-06-03T23:51:26.770Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.288Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Deterministic regex sensors do NOT run in the pre-commit gate — they are orphaned

> ✅ **FIXED in v0.20.0** — `runPrecommitPolicy` (`packages/cli/src/commands/enforce.ts`) now calls
> a `runSensorGate` helper that runs ALL regex sensors (any memory type, not just attempt/gotcha) on
> the staged diff: a `block` sensor → error (fails the gate), a `warn` sensor → warn finding (visible,
> non-blocking). It excludes `.ai/` + hAIve-owned files to avoid self-match, and is read-only/best-effort.
> Verified: `enforce check` now surfaces `sensor-warn: …typescript-no-any…` on a `: any` diff.
> Kept as history/regression guard. Separately, `pre_commit_check` precision was tightened (#2):
> non-anchored memories whose sensor did not fire → info; uncorroborated semantic review floor 0.6→0.65.

**Reproduced v0.19.0 (deep corpus test).** Two independent diff-scan layers exist and don't converge:

1. `haive sensors check` — runs the regex sensors (`runSensors`). On a diff adding `function bad(x: any)`, it fires **1 precise hit**: the `typescript-no-any` convention (pattern `:\s*any\b`), 12 regex sensors loaded. HIGH precision, exactly right.
2. `haive enforce check --stage pre-commit` (what the **installed git hook actually runs**) — uses the *fuzzy* anti-pattern matcher (`pre_commit_check`), NOT the regex sensors. On the same `: any` diff it surfaced **20 anti-pattern matches** (11 review / 9 info), almost all irrelevant (mcp-exports, npm-install, git-pull, embeddings…) on weak literal+semantic ~0.55–0.65, and **the `: any` convention was absent**. should_block=false.

**The gap:** the installed `.git/hooks/pre-commit` is only `haive enforce check --stage pre-commit`; it never calls `sensors check`. So the precise, deterministic sensors that work in isolation (and that `haive eval` reports at catch_rate=1.0) **never execute on a real commit**. This is why eval (which exercises `runSensors`) looks perfect while the deployed gate misses the actual issue and emits low-precision noise instead.

**Impact:** a real `: any` (or any regex-sensor pattern) slips through with zero signal unless a human manually runs `haive sensors check`. The eval score (97) overstates real-world protection.

**Fix direction (not yet applied):** wire `runSensors` into `runPrecommitPolicy`/`enforce check` (surface warn-sensor hits as review, block-sensor hits per `antiPatternGate`), and/or add `sensors check` to the generated pre-commit hook. Separately, tighten `pre_commit_check` precision on small generic diffs (20 fuzzy matches for a 3-line add is noise → trains agents to ignore the gate). See [[2026-05-31-gotcha-enforcement-is-process-not-violation]].
