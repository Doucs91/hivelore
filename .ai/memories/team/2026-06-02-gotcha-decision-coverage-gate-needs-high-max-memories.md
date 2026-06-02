---
id: 2026-06-02-gotcha-decision-coverage-gate-needs-high-max-memories
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/cli/src/commands/briefing.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
sensor:
  kind: regex
  pattern: decision-coverage
  paths:
    - packages/cli/src/commands/briefing.ts
    - packages/cli/src/commands/enforce.ts
  message: >-
    Avoid decision-coverage; before committing a broad change, run the briefing
    with a high cap covering every staged file, e.g.
  severity: warn
  autogen: true
  last_fired: null
tags:
  - enforcement
  - briefing
  - decision-coverage
  - commit
created_at: '2026-06-02T04:17:39.074Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Gotcha Decision Coverage Gate Needs High Max Memories

When a commit touches many files anchored to many decisions/architecture memories (e.g. a multi-package feature touching core+cli+mcp+package.jsons), the pre-commit `decision-coverage` gate fails with `decision-coverage-missing: N/M relevant anchored decisions were not present in the latest briefing`.

**Why:** `haive briefing` defaults to `--max-memories 8`. If 14 anchored decisions are relevant, a default briefing surfaces only 8, so the gate (which requires ALL relevant anchored decisions to have been surfaced in the latest briefing marker) blocks.

**Instead, use:** before committing a broad change, run the briefing with a high cap covering every staged file, e.g.
`FILES=$(git diff --cached --name-only | tr '\n' ',' | sed 's/,$//'); haive briefing --files "$FILES" --max-memories 40 --max-tokens 30000 --task "..."`
then commit. The gate passes once the marker records 14/14.
