---
id: 2026-04-25-decision-esm-only
scope: team
type: decision
status: validated
anchor:
  paths:
    - tsconfig.base.json
  symbols:
    - verbatimModuleSyntax
    - isolatedModules
tags:
  - build
  - esm
created_at: '2026-04-25T23:39:56.766Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.938Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Decision Esm Only

All packages are ESM-only (type: module in package.json, format: esm in tsup). Imports must use .js extensions even for .ts source files (verbatimModuleSyntax + isolatedModules in tsconfig). Do not add CJS output.
