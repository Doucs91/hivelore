---
id: 2026-07-03-decision-command-sensor-flap-identical-content
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/sensor-ledger.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/sync.ts
  symbols: []
tags:
  - enforcement
  - sensors
  - flaky
  - v0.35.0
created_at: '2026-07-03T15:47:33.569Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: self-auditing-flap-definition
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Command sensor flap definition

A flap is a transition between `fired` and `silent` for the same memory id and the exact same `scope_hash`, within the rolling last 30 days. Rows are ordered by timestamp and transitions are counted per hash, so pass→fail→pass is two flaps. Different content hashes never contradict each other and `unrunnable` is excluded because a broken harness says nothing about the code. At two flaps, a block command sensor is treated as warn immediately and `hivelore sync` persists the demotion plus one quarantine note.
