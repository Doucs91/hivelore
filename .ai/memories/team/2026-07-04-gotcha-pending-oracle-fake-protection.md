---
id: 2026-07-04-gotcha-pending-oracle-fake-protection
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/propose-sensor.ts
    - packages/core/src/test-scaffold.ts
  symbols: []
tags:
  - sensors
  - behaviour
  - oracle
  - validation
  - v0.39.1
created_at: '2026-07-04T04:09:29.167Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# A pending test stub is an oracle that passes on ANYTHING — arming it as block = fake protection

## Trap
`sensors propose --kind test` validated only that the command PASSES on the current tree. A freshly scaffolded stub (`it.todo` / `pytest.mark.skip` / `t.Skip`) passes trivially, so an agent could arm a block sensor around an EMPTY oracle right after `sensors scaffold` — the gate then reports deterministic protection that enforces nothing. Found live in the v0.39.0 gauntlet (the propose printed "Command oracle passes on the current tree" for a pure `it.todo` stub). Aggravating factor: `npx vitest run` auto-downloads vitest in repos where it isn't even installed, so "the command ran" proves very little by itself.

## Fix (v0.39.1)
`proposeSensor` (command path) extracts test-file tokens from the command (`extractTestFilePathsFromCommand`, core) and checks them for pending markers (`hasPendingTestMarker`, core — same markers as `assessScaffoldLoop`). A block proposal referencing a pending stub is REJECTED with reason `oracle-pending`; warn is accepted but carries a pending-stub note. Regression-guarded in `packages/mcp/test/propose-sensor.test.ts`.

## How to apply
Any future oracle-ish validation ("the check passed") must ask *what the check can actually distinguish*: a passing run of a vacuous check is not evidence. Reuse the shared pending markers from core rather than re-deriving them.
