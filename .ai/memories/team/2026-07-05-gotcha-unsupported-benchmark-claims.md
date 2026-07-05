---
id: 2026-07-05-gotcha-unsupported-benchmark-claims
scope: team
type: gotcha
status: stale
anchor:
  paths:
    - benchmarks/agent-benchmark/RESULTS.md
    - packages/cli/src/commands/benchmark.ts
  symbols: []
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
tags:
  - benchmark
  - evidence
  - claims
created_at: '2026-07-05T16:09:14.160Z'
expires_when: null
verified_at: '2026-07-05T16:21:36.267Z'
stale_reason: 'anchor path(s) no longer exist: benchmarks/agent-benchmark/RESULTS.md'
related_ids: []
last_read_at: null
topic: 'benchmark:unsupported-claims'
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Gotcha

A small or incomplete paired benchmark can support observations, not a claim that Hivelore proves an advantage or superiority. Keep the report labelled `pilot`/`insufficient` until the benchmark command reports decision-ready evidence.
