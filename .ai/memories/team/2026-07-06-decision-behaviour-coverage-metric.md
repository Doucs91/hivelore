---
id: 2026-07-06-decision-behaviour-coverage-metric
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/behaviour-coverage.ts
    - packages/cli/src/commands/doctor.ts
  symbols: []
tags:
  - behaviour
  - coverage
  - doctor
  - receipt
  - metric
  - v0.45.0
created_at: '2026-07-06T15:58:00.990Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Behaviour Coverage Metric

**What (v0.45.0):** the behaviour harness — the branch Hivelore leads (command/test sensors routing a real oracle, optionally red-proven) — now has a VISIBLE coverage metric, so its progress is measurable instead of invisible.

- Pure core module `packages/core/src/behaviour-coverage.ts` → `assessBehaviourCoverage({ memories, codeFiles })`. Per canonical main area (shared `deriveMainAreas`, so the "N areas" count matches the bootstrap gate everywhere), it answers: guarded by any behavioural oracle? armed (block)? red-proven? An oracle = a `kind: shell|test` sensor on a validated/proposed memory; it credits an area by anchor OR by sensor `paths` scope (incl. globs) — the same credit rule the bootstrap gate uses for block sensors.
- Surfaced as an **info** finding `behaviour-coverage` in doctor's Protection section ("Behaviour harness: X/N area(s) guarded (K armed, P red-proven)"; names uncovered areas) and as a one-line footer on the human `stats receipt`. Always info — the behaviour harness is opt-in and the hardest to fill, so this measures without nagging (unarmed-scaffold / command-sensors-disabled already nag the actionable gaps).

**Why a new pure module, not extending bootstrap-state:** bootstrap answers "is the knowledge layer filled enough to gate?" (block decision); behaviour-coverage answers "how much behaviour is guarded/proven?" (a measure). Different questions, different consumers. Refactored `deriveMainAreas` / `anchorMatchesComponent` / `isProductionCodeFile` out of bootstrap-state and exported them so both share one area-derivation (no divergence). Deliberately did NOT thread coverage into the core receipt object (`buildPreventionReceipt` stays pure over events/memories/usage) — the receipt footer is computed at the CLI layer from the code-map, best-effort.
