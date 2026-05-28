---
id: 2026-04-25-architecture-pure-tool-handlers
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/mcp/src/tools
  symbols: []
tags:
  - mcp
  - testability
created_at: '2026-04-25T23:39:56.850Z'
expires_when: null
verified_at: '2026-04-27T17:21:21.328Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Architecture Pure Tool Handlers

MCP tool implementations under packages/mcp/src/tools/ are pure async functions that take (input, ctx) and return a JSON-serializable result. The McpServer in server.ts is a thin wrapper that registers them with the SDK. This lets us unit-test handlers without going through stdio.
