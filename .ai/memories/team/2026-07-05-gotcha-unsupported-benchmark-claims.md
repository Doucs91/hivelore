---
id: 2026-07-05-gotcha-unsupported-benchmark-claims
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - benchmarks/agent-benchmark/RESULTS.md
    - packages/cli/src/commands/benchmark.ts
  symbols: []
tags:
  - benchmark
  - evidence
  - claims
created_at: '2026-07-05T16:09:14.160Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: 'benchmark:unsupported-claims'
revision_count: 0
requires_human_approval: false
validated_by: auto
sensor:
  kind: regex
  pattern: '\bproves?\b.{0,80}\b(?:advantage|superiority)\b'
  absent: '\b(?:does not|insufficient|pilot)\b'
  flags: i
  paths:
    - benchmarks/agent-benchmark/RESULTS.md
    - packages/cli/src/commands/benchmark.ts
  message: >-
    Do not claim a proven benchmark advantage until evidence_grade is
    decision-ready.
  severity: block
  autogen: false
  last_fired: null
---
## Gotcha

A small or incomplete paired benchmark can support observations, not a claim that Hivelore proves an advantage or superiority. Keep the report labelled `pilot`/`insufficient` until the benchmark command reports decision-ready evidence.
