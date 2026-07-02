---
id: 2026-07-02-decision-review-warnings-aggregated-and-head-baseline
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/mcp/src/tools/propose-sensor.ts
  symbols: []
tags:
  - enforcement
  - sensors
  - gate
  - false-positive
  - dogfooding
created_at: '2026-07-02T05:40:52.006Z'
expires_when: null
verified_at: '2026-07-02T22:21:22.000Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Gate visibility: aggregated review finding + HEAD as the presumed-correct baseline (v0.29.12)

Two non-obvious design choices made when fixing the "gate swallows review warnings" gap:

1. **One aggregated `anti-pattern-review` warn finding, NOT one finding per warning.**
   `runPrecommitPolicy` (enforce.ts) now emits a single warn (impact 5, never blocks) listing the
   top review-tier anti-pattern ids, pointing to `haive precommit` for detail. Per-warning findings
   were rejected deliberately: each warn finding costs score, so a seeded corpus (6–8 background
   memories) could push a clean commit below the 85% threshold — recreating exactly the noise
   documented in [[2026-05-07-attempt-strict-precommit-gate-on-haive]]. Sensor-driven review
   warnings are excluded from the aggregate (runSensorGate already emits a per-hit finding —
   counting them twice would double-penalize).

2. **Sensor self-checks validate against HEAD, not the working tree** (`readPresumedCorrectTargets`
   in propose-sensor.ts, exported from @hiveai/mcp, shared by CLI sensors propose/promote).
   Rationale: the realistic agent sequence is write bad code → hit failure → `mem_tried` →
   `propose_sensor` → revert. At that moment the working tree contains the very bad pattern the
   sensor targets, so validating against it rejected every honest proposal with `fires-on-current`.
   HEAD is the last state that passed the gate — the correct "presumed-correct" baseline. Non-git
   dirs and files not yet committed fall back to the working tree (keeps the pure-tmpdir tests and
   fresh-file flows working).
