---
id: 2026-07-05-decision-benchmark-claims-require-decision-ready-evidence
scope: team
type: decision
status: stale
anchor:
  paths:
    - benchmarks/agent-benchmark/RESULTS.md
    - packages/cli/src/commands/benchmark.ts
  symbols: []
tags:
  - benchmark
  - evidence
  - harness-engineering
created_at: '2026-07-05T16:09:03.946Z'
expires_when: null
verified_at: '2026-07-05T16:21:36.204Z'
stale_reason: 'anchor path(s) no longer exist: benchmarks/agent-benchmark/RESULTS.md'
related_ids: []
last_read_at: null
topic: 'benchmark:evidence-grade'
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Decision

Comparative Hivelore benchmark claims are allowed only when `hivelore benchmark report` returns `evidence_grade=decision-ready`: at least 10 paired tasks with complete correctness, tests, policy violations, duration, and token outcomes. Smaller samples remain explicitly `insufficient`; they can document observations but must not claim a proven advantage.
