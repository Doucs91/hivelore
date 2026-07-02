---
id: 2026-06-02-architecture-mcp-tool-contract
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/mcp/src
  symbols: []
tags:
  - mcp
  - architecture
  - tool-contract
created_at: '2026-06-02T02:00:00.000Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.283Z'
stale_reason: null
related_ids:
  - 2026-04-25-architecture-pure-tool-handlers
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# MCP Tools Are Pure Handlers Plus Thin Registration

MCP tool implementations live under `packages/mcp/src/tools/` and take `(input, ctx)` so tests can call them without JSON-RPC stdio. `packages/mcp/src/server.ts` should stay as registration glue.

Tool output is LLM-facing API. Keep field names stable, include compact machine-readable facts, and add human explanation fields such as `why`, `hints`, `notice`, or `setup_warnings` when they reduce agent guesswork.

Never log to stdout from the MCP server; stdout is the JSON-RPC channel. Diagnostics belong on stderr or in structured tool results.
