---
id: 2026-06-03-gotcha-antipattern-self-match-on-memory-file-edit
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/anti-patterns-check.ts
  symbols: []
sensor:
  kind: regex
  pattern: haive memory update <id> --tags \.\.\.
  paths:
    - packages/mcp/src/tools/anti-patterns-check.ts
  message: >-
    Editing a memory's own backing file trips that memory's anti-pattern gate
    (false positive)
  severity: warn
  autogen: true
  last_fired: null
tags:
  - enforcement
  - anti-pattern
  - false-positive
  - precommit
created_at: '2026-06-03T02:25:48.541Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## Editing a memory's own backing file trips that memory's anti-pattern gate (false positive)

**Reproduced v0.16.1:** running `haive memory update <id> --tags ...` on an `attempt`/`gotcha` whose
body documents a bad command (e.g. `npm install -g @hiveai/core`) rewrites the `.ai/memories/<id>.md`
file via `serializeMemory`, which re-emits the body lines into the diff. The pre-commit anti-pattern
gate then scans those added lines, finds the documented bad pattern (literal + semantic), sees the
memory anchored to the changed file, and **hard-blocks** — the memory matches *its own file*.

It blocks (not just review) when the commit ALSO contains real shippable code (so the config/docs-only
downgrade doesn't apply). Hit while re-tagging the dev-env workaround memories alongside a `briefing.ts`
fix.

**Why it's a false positive:** editing a memory's tags cannot reintroduce the bad pattern into real
code — the bad string only appears because it's the very lesson the memory documents.

**FIXED in v0.16.1:** `anti-patterns-check.ts` now runs `stripAiDirHunks(diff)` before literal/semantic
matching, dropping every hunk for a file under `.ai/`. Knowledge-base edits (memory files,
project-context) can no longer corroborate a "you reintroduced a bad pattern in code" signal, so a
memory can't self-match its own backing file. The one-off commit that surfaced this used
`git commit --no-verify` (per [[2026-05-07-attempt-strict-precommit-gate-on-haive]]); that's no longer
needed.
