---
id: 2026-06-05-attempt-running-pnpm-r-build-and
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/embeddings/tsup.config.ts
    - packages/core/tsup.config.ts
    - scripts/ensure-workspace-dists.mjs
  symbols: []
tags:
  - workflow
  - build
  - release
  - pnpm
created_at: '2026-06-05T19:45:05.943Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.290Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Running pnpm -r build and pnpm -r typecheck in parallel after version bump

**Why it failed / do NOT use:** `pnpm -r build` failed in @hiveai/embeddings DTS generation with TS7016 for @hiveai/core because the parallel `pnpm -r typecheck` invoked ensure-workspace-dists and rebuilt/cleaned packages/core/dist while the build process was reading it.

**Instead, use:** Run release verification commands sequentially when workspace dist artifacts are involved: `pnpm -r build`, then `pnpm -r typecheck`, then `pnpm -r test`, then `pnpm check:artifacts`.
