---
id: 2026-04-28-attempt-installing-hiveaicore-via-npm-install
scope: team
type: attempt
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - npm
  - install
  - dev-workflow
  - hotswap
  - debugging
  - tooling-debt
created_at: '2026-04-28T04:18:02.296Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# installing @hiveai/core via npm install -g without nested node_modules awareness

**Why it failed / do NOT use:** when @hiveai/cli is installed globally, npm creates a nested node_modules/@hiveai/cli/node_modules/@hiveai/core with the pinned version from npm registry — hot-swapping only the top-level dist doesn't update this nested copy, so schema changes (new types, fields) are silently ignored

**Instead, use:** always copy to ALL three locations: (1) dist/ of each package, (2) nested node_modules under @hiveai/cli, (3) nested under @hiveai/mcp. Use: cp -r packages/core/dist/* $NODE_BASE/lib/node_modules/@hiveai/cli/node_modules/@hiveai/core/dist/
