---
id: 2026-07-03-decision-sensor-incident-provenance-on-frontmatter
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/schema.ts
    - packages/core/src/sensors.ts
    - packages/core/src/prevention.ts
  symbols: []
tags: []
created_at: '2026-07-03T20:18:14.689Z'
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
The optional `incident` provenance (a ticket/prod ref like `prod #442`) lives on the **sensor block in the committed memory frontmatter**, NOT on the `PreventionEvent` in the gitignored `.cache/prevention-log.jsonl`. The receipt derives `row.incident` by looking the memory up by id (`sensor?.incident ?? null`), the same way it already derives `message`.

The rendered suffix (`↩ guards incident: <ref>` at the gate, `↩ incident: <ref>` in the receipt) comes from one exported helper `incidentSuffix()` in `core/sensors.ts` — every call site (regex block/warn + command block/warn in enforce.ts, receipt render) reuses it instead of re-deriving the copy.

## Why
- The incident is **team truth about the lesson** — it must travel with the sensor to every machine and into CI, and survive `rm -rf .ai/.cache`. The prevention log is machine-local rolling telemetry; putting provenance there would lose it on rotation and desync across agents.
- Deriving-by-lookup keeps `PreventionEvent` unchanged (backward-compatible with logs written before this change) and means a corrected incident ref updates every past receipt row automatically.
- This is the concrete behaviour-harness increment: it does NOT try to solve the oracle (still the team's test), it makes the incident→test link first-class — the story "tests-in-CI" can't tell.

## How to apply
Add provenance-bearing fields to the sensor frontmatter (source of truth = `schema.ts`), thread through `CommandSensorSpec`/`CommandSensorRun`, and render via `incidentSuffix()`. Never put lesson-level truth on the prevention event log. See [[2026-07-03-decision-sensor-promoted-at-quarantine-reset]] for the other frontmatter-as-team-truth boundary.
