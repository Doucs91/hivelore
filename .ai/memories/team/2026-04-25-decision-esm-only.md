---
id: 2026-04-25-decision-esm-only
scope: team
type: decision
status: draft
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
---
All packages are ESM-only (type: module in package.json, format: esm in tsup). Imports must use .js extensions even for .ts source files (verbatimModuleSyntax + isolatedModules in tsconfig). Do not add CJS output.
