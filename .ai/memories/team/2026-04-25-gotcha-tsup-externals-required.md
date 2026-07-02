---
id: 2026-04-25-gotcha-tsup-externals-required
scope: team
type: gotcha
status: validated
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
verified_at: '2026-07-02T05:42:00.266Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Gotcha Tsup Externals Required

Without explicit 'external' in tsup.config.ts, tsup will inline cross-package deps (notably @xenova/transformers + onnxruntime), exploding the CLI bundle to >5MB. Always list workspace deps and heavy native packages as external for any package that imports them.
