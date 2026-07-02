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
sensor:
  kind: regex
  pattern: require\.resolve\(.*@hiveai\/mcp\/package\.json
  paths:
    - packages/mcp/package.json
    - packages/cli/src/commands/mcp.ts
  message: >-
    require.resolve('@hiveai/mcp/package.json') throws unless `"./package.json":
    "./package.json"` is in the exports field of packages/mcp/package.json.
  severity: warn
  autogen: false
  last_fired: null
tags:
  - mcp
  - build
  - npm
  - exports
created_at: '2026-04-27T17:19:43.286Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.941Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Gotcha Mcp Exports Package Json

When `@hiveai/cli` resolves the MCP binary via `require.resolve("@hiveai/mcp/package.json")`, Node enforces the `exports` field. If `./package.json` is not explicitly listed, the call throws `Package subpath './package.json' is not defined by "exports"`. Fix: add `"./package.json": "./package.json"` to the exports of `packages/mcp/package.json`.
