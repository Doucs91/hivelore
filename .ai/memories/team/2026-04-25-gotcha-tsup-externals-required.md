---
id: 2026-04-25-gotcha-tsup-externals-required
scope: team
type: gotcha
status: draft
anchor:
  paths:
    - packages/cli/tsup.config.ts
    - packages/mcp/tsup.config.ts
  symbols: []
tags:
  - build
  - tsup
created_at: '2026-04-25T23:39:56.939Z'
expires_when: null
---
Without explicit 'external' in tsup.config.ts, tsup will inline cross-package deps (notably @xenova/transformers + onnxruntime), exploding the CLI bundle to >5MB. Always list workspace deps and heavy native packages as external for any package that imports them.
