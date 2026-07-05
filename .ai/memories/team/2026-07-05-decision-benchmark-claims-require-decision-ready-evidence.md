---
id: 2026-07-05-decision-benchmark-claims-require-decision-ready-evidence
scope: team
type: decision
status: validated
anchor:
  paths:
    - .ai/modules/benchmarks/context.md
    - packages/cli/src/commands/benchmark.ts
  symbols: []
tags:
  - benchmark
  - evidence
  - harness-engineering
created_at: '2026-07-05T16:09:03.946Z'
expires_when: null
verified_at: '2026-07-05T16:49:08.042Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: 'benchmark:evidence-grade'
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Decision

Comparative Hivelore benchmark claims are allowed only when `hivelore benchmark report` returns `evidence_grade=decision-ready`: at least 10 paired tasks with complete correctness, tests, policy violations, duration, and token outcomes. Smaller samples remain explicitly `insufficient`; they can document observations but must not claim a proven advantage.
