---
id: 2026-04-27-gotcha-mcp-exports-package-json
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/package.json
    - packages/cli/src/commands/mcp.ts
  symbols: []
tags:
  - mcp
  - build
  - npm
  - exports
created_at: '2026-04-27T17:19:43.286Z'
expires_when: null
verified_at: '2026-05-07T16:05:00.000Z'
stale_reason: null
---
When `@hiveai/cli` resolves the MCP binary via `require.resolve("@hiveai/mcp/package.json")`, Node enforces the `exports` field. If `./package.json` is not explicitly listed, the call throws `Package subpath './package.json' is not defined by "exports"`. Fix: add `"./package.json": "./package.json"` to the exports of `packages/mcp/package.json`.
