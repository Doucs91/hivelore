---
id: 2026-05-02-attempt-crosspackage-deps-with-xyz-ranges
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/embeddings/package.json
    - packages/mcp/package.json
    - packages/cli/package.json
  symbols: []
sensor:
  kind: regex
  pattern: '"@hiveai\/[^"]+"\s*:\s*"\^[0-9]+\.[0-9]+\.[0-9]+"'
  paths:
    - packages/embeddings/package.json
    - packages/mcp/package.json
    - packages/cli/package.json
  message: >-
    Use `workspace:*` for cross-package @hiveai deps, not `^X.Y.Z` ranges. pnpm
    resolved semver ranges to the npm store instead of the local workspace,
    causing TS build failures.
  severity: warn
  autogen: false
  last_fired: null
tags:
  - dev-workflow
  - tooling-debt
  - npm
  - monorepo
created_at: '2026-05-02T06:02:50.683Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Cross-package deps with `^X.Y.Z` ranges relying on pnpm to auto-link the workspace version

**Why it failed / do NOT use:** pnpm resolved `@hiveai/core: ^0.4.5` to the npm-published 0.4.5 in the store instead of the local workspace, so source changes weren't visible to dependent packages. Caused TS DTS build failures (missing exports added locally but not in published 0.4.5). Worse: package.json in embeddings had `^0.2.9` so even by version match pnpm chose npm.

**Instead, use:** Always use `"workspace:*"` for cross-package deps inside the monorepo. pnpm publish auto-converts `workspace:*` to the actual version at publish time. Touched package.json files: packages/{core,cli,mcp,embeddings}.
