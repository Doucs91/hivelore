---
id: 2026-04-28-architecture-adding-new-mcp-tool
scope: team
type: architecture
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - mcp
  - architecture
  - dev-workflow
created_at: '2026-04-28T04:18:16.056Z'
expires_when: null
verified_at: null
stale_reason: null
---
# How to add a new MCP tool

Three-step process:

### 1. Create `packages/mcp/src/tools/<tool-name>.ts`


### 2. Register in `packages/mcp/src/server.ts`


### 3. Mirror in CLI if user-facing
Create `packages/cli/src/commands/my-command.ts` and register in `packages/cli/src/index.ts`.

**Key rule**: tool description in server.ts is read by the LLM — make it action-oriented ('Use when X to do Y') not technical ('Calls the myTool function').
