---
id: 2026-07-03-decision-sensor-promoted-at-quarantine-reset
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/sensor-ledger.ts
    - packages/cli/src/commands/sensors.ts
    - packages/core/src/schema.ts
  symbols: []
tags:
  - sensors
  - quarantine
  - ledger
created_at: '2026-07-03T16:55:10.843Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: sensor-quarantine-promotion-reset
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# promoted_at is the quarantine reset boundary

## Decision
`sensors promote --severity block` stamps `sensor.promoted_at` (ISO) in the memory frontmatter, and
`assessSensorHealth` ignores ledger evaluations at or before that timestamp for the sensor. All four
health consumers (enforce gate, sensors check, sync quarantine pass, doctor) pass the map via
`sensorPromotedAtMap(frontmatters)`.

## Why
Found in the v0.35.0 verification e2e: quarantine is computed from the machine-local ledger's 30-day
window, so promoting a FIXED oracle back to block was instantly undone — the old flaps re-flagged
`sensor-flaky` on the next commit and the next `sync` re-demoted to warn, for up to 30 days. The
quarantine note literally promised "re-promote with sensors promote" — a broken promise kills trust
in blocks.

## How to apply
The boundary lives in the COMMITTED frontmatter (team truth), not the ledger: every machine and CI
sees the same reset even though ledgers are machine-local. Promotion is the human's assertion the
oracle was fixed; fresh post-promotion flaps still quarantine normally. Tests:
`packages/core/test/sensor-ledger.test.ts` (promoted_at cases).
