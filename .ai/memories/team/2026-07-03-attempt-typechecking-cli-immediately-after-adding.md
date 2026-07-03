---
id: 2026-07-03-attempt-typechecking-cli-immediately-after-adding
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/core/src/index.ts
    - packages/cli/tsconfig.json
  symbols: []
tags:
  - typescript
  - workspace
  - dist
  - typecheck
created_at: '2026-07-03T15:46:23.168Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# typechecking CLI immediately after adding a new core export

**Why it failed / do NOT use:** The CLI TypeScript project resolves @hivelore/core through packages/core/dist/index.d.ts. `ensure-workspace-dists.mjs` only ensures a dist exists; it does not rebuild an already-present stale dist, so every new sensor-ledger export appeared missing even though core source typechecked.

**Instead, use:** After adding or changing public @hivelore/core exports, run `pnpm --filter @hivelore/core build` before `pnpm --filter @hivelore/cli typecheck`.
