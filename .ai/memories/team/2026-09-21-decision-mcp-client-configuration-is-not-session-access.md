---
id: 2026-09-21-decision-mcp-client-configuration-is-not-session-access
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/codex-mcp.ts
    - packages/cli/src/commands/init-mcp-setup.ts
    - packages/cli/src/commands/doctor.ts
    - packages/cli/src/commands/agent.ts
    - packages/cli/src/commands/mcp.ts
    - packages/mcp/src/context.ts
  symbols: []
tags:
  - mcp
  - cli
  - codex
created_at: '2026-09-21T17:08:12.946Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
evidence: tested
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# MCP setup must survive client-specific configuration and project selection

Repeated September reports of unavailable MCP persisted despite a working globally installed server: a separate Codex helper still wrote the removed haive command and pinned global HAIVE_PROJECT_ROOT to a previous project. JSON-only migration and doctor missed it. Use the native Codex CLI for effective TOML parsing/migration; register the replacement before removing a dead entry, preserve user-disabled and customized servers, and never set one global project root. JSONC edits must target only Hivelore entries.

A CLI handshake verifies a separate server instance, not the current conversation tool registry. Keep session_connection unverified until the client actually exposes and calls a tool. Project config passes an explicit --dir; the MCP entrypoint must honor root environment variables when CLI root is absent.
