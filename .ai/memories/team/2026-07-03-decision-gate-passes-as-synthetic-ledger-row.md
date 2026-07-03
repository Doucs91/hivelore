---
id: 2026-07-03-decision-gate-passes-as-synthetic-ledger-row
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/sensor-ledger.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags:
  - enforcement
  - gate-pass
  - git-watch
  - v0.35.0
created_at: '2026-07-03T15:47:33.602Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: self-auditing-gate-pass-recording
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Gate passes use a synthetic ledger row

A successful deterministic pre-commit or CI enforcement report appends a sensor-ledger row with `memory_id: "__gate__"`, `kind: "shell"`, empty scope hash, the evaluated stage, and current HEAD SHA. Reusing the ledger avoids a second runtime format/file and makes gate-miss cross-reference a simple exact SHA lookup. Health analysis always excludes `__gate__`, so the synthetic row cannot affect flaky or never-fired sensor decisions.
