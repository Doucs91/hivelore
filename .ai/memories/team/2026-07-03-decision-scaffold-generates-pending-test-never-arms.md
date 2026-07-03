---
id: 2026-07-03-decision-scaffold-generates-pending-test-never-arms
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/test-scaffold.ts
    - packages/cli/src/commands/sensors.ts
  symbols: []
tags: []
created_at: '2026-07-03T22:18:20.546Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Decision
`hivelore sensors scaffold <memory-id>` turns a lesson (attempt/gotcha) into a **pending** test file (vitest/jest → `it.todo`, pytest → `@pytest.mark.skip`, go → `t.Skip`) and PRINTS the `sensors propose --kind test --command "<runner> <path>"` line — but it **never arms a sensor**. The generator (`scaffoldPostIncidentTest` in `core/test-scaffold.ts`) is pure (no I/O); framework detection + file writing live in the CLI command.

## Why
- **`propose_sensor` must stay the sole validated writer of live sensors** (see [[2026-06-08-decision-sensors-seed-not-autogen-propose-sensor-sole-writer]]). Scaffolding removes the friction of *writing* the oracle; it must not short-circuit the validate-on-real-code gate (silent-on-current / fires-on-bad). So it stops at "here's the test + the exact command to arm it."
- **Pending, not failing.** A stub is `it.todo`/`skip` so the suite stays green and an empty stub can't masquerade as a passing oracle. If it were armed while empty it would enforce nothing — arming is a deliberate step AFTER the assertion is written.
- **Provenance travels into the header** (memory id, incident, why, expected) so the test explains itself; when armed, the sensor's `incident` links back — see [[2026-07-03-decision-sensor-incident-provenance-on-frontmatter]].
- Core-pure split follows [[2026-06-02-architecture-core-pure-domain-layer]]: detection/writing is I/O → CLI; template generation is deterministic → core (unit-tested without a repo).

## How to apply
Flow: `mem_tried` (records the incident) → `sensors scaffold` (writes the pending test + prints the arming command) → developer writes the assertion → `sensors propose --kind test` (validates + arms). The `memory tried` CLI output nudges toward scaffold when a regex can't express the mistake.
