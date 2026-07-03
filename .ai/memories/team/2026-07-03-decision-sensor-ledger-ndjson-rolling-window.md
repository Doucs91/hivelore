---
id: 2026-07-03-decision-sensor-ledger-ndjson-rolling-window
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/sensor-ledger.ts
  symbols: []
tags:
  - enforcement
  - sensors
  - telemetry
  - v0.35.0
created_at: '2026-07-03T15:47:33.539Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: self-auditing-sensor-ledger-format
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Sensor ledger: local NDJSON rolling window

Sensor evaluations live in `.ai/.runtime/enforcement/sensor-ledger.ndjson`, one complete JSON object per sensor evaluation. NDJSON keeps appends atomic enough for best-effort telemetry and lets malformed rows be skipped independently. The ledger is machine-local and never committed. On append, more than 10,000 rows triggers a rewrite retaining the newest 8,000: this is a diagnostic rolling window, not an audit archive. Every read/write API swallows failures so telemetry cannot break a commit.
