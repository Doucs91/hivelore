---
id: 2026-07-05-convention-hivelore-mcp-package-export
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
  pattern: require\.resolve\(.*@hivelore\/mcp\/package\.json
  paths:
    - packages/mcp/package.json
    - packages/cli/src/commands/mcp.ts
  message: Keep ./package.json exported by @hivelore/mcp before resolving it.
  severity: warn
  autogen: false
  last_fired: null
tags:
  - packaging
  - mcp
created_at: '2026-07-05T00:00:00.000Z'
expires_when: null
verified_at: '2026-07-05T00:00:00.000Z'
stale_reason: null
related_ids:
  - 2026-04-27-gotcha-mcp-exports-package-json
last_read_at: null
revision_count: 0
---

# Keep the Hivelore MCP package manifest exported

The CLI resolves `@hivelore/mcp/package.json` at runtime. Keep `./package.json` in the MCP package exports so the installed integration remains discoverable.
