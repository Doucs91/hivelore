---
id: 2026-04-25-architecture-pure-tool-handlers
scope: team
type: architecture
status: draft
anchor:
  paths:
    - packages/mcp/src/tools
  symbols: []
tags:
  - mcp
  - testability
created_at: '2026-04-25T23:39:56.850Z'
expires_when: null
---
MCP tool implementations under packages/mcp/src/tools/ are pure async functions that take (input, ctx) and return a JSON-serializable result. The McpServer in server.ts is a thin wrapper that registers them with the SDK. This lets us unit-test handlers without going through stdio.
