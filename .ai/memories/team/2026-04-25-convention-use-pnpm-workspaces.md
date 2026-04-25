---
id: 2026-04-25-convention-use-pnpm-workspaces
scope: team
type: convention
status: draft
anchor:
  paths:
    - package.json
    - pnpm-workspace.yaml
  symbols: []
tags:
  - tooling
  - monorepo
created_at: '2026-04-25T23:39:56.680Z'
expires_when: null
---
This monorepo uses pnpm workspaces (not npm/yarn workspaces, not turborepo). Run pnpm install at the repo root to install everything. Run pnpm -r build / pnpm -r test to act on every package. Cross-package deps use 'workspace:*'.
