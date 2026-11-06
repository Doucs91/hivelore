---
id: 2026-11-06-gotcha-mcp-sdk-stdio-transport-filters-env
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/cli/src/utils/mcp-check.ts
  symbols: []
tags:
  - cli
created_at: '2026-11-06T17:41:22.608Z'
evidence: reproduced
validated_by: auto
rule: 'When spawning our MCP server with StdioClientTransport, pass env explicitly (getDefaultEnvironment() + HIVELORE_*/HAIVE_*, XDG_CACHE_HOME) — the SDK drops every other variable.'
verified_by: 'agent setup diagnostic wrote its cache to ~/.cache/hivelore while HIVELORE_CACHE_DIR was set (CLI test run, 2026-11-06)'
cannot_detect: 'MCP clients (Claude Code, Cursor) have their own env rules; this covers only servers we spawn ourselves'
sensor:
  kind: regex
  pattern: new StdioClientTransport\(
  absent: \benv\b
  paths:
    - packages/cli/src/**
    - packages/mcp/src/**
  message: 'StdioClientTransport forwards only an env allow-list: pass env (getDefaultEnvironment() + HIVELORE_*/HAIVE_*) or the server loses Hivelore settings.'
  severity: warn
---
# MCP SDK StdioClientTransport forwards only an env allow-list

Without an `env` option, `StdioClientTransport` starts the child with `getDefaultEnvironment()` only (HOME, PATH, USER, SHELL, TERM, LOGNAME…). Any Hivelore setting exported in the parent — `HIVELORE_CACHE_DIR`, session ids, `HIVELORE_TOOL_PROFILE` — silently disappears, so the diagnostic server read a different cache than the CLI. The durable opt-out for real MCP clients is `cacheDir` in `.ai/hivelore.config.json`, which every process reads.
