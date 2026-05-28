---
id: 2026-04-27-gotcha-embeddings-load-error-double-print
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/cli/src/commands/embeddings.ts
  symbols:
    - loadEmbeddings
tags:
  - cli
  - ux
  - embeddings
  - error-handling
created_at: '2026-04-27T17:21:09.038Z'
expires_when: null
verified_at: '2026-04-27T17:21:21.339Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Gotcha Embeddings Load Error Double Print

`loadEmbeddings()` prints a friendly error then re-throws. The re-thrown error bubbles to `program.parseAsync().catch()` which prints the raw `Cannot find package` message a second time. Fix: after `ui.error(...)`, call `process.exit(1)` directly instead of `throw err`, so only the friendly message appears.
