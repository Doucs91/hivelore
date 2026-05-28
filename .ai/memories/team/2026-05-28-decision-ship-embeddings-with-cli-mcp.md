---
id: 2026-05-28-decision-ship-embeddings-with-cli-mcp
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/package.json
    - packages/mcp/package.json
    - packages/cli/src/commands/doctor.ts
  symbols:
    - registerDoctor
tags:
  - embeddings
  - packaging
  - doctor
  - semantic-search
created_at: '2026-05-28T22:13:25.040Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: ship-embeddings-with-cli-mcp
revision_count: 0
requires_human_approval: false
---
# Ship embeddings with CLI/MCP installs

`@hiveai/embeddings` must be a real dependency of `@hiveai/cli` and `@hiveai/mcp`, not only an optional peer. Otherwise `npm install -g @hiveai/cli` succeeds but `haive embeddings status`, semantic `get_briefing`, and MCP `code_search` fail at runtime.

How to apply: keep embeddings external in tsup so the CLI bundle stays small, but include the package in npm dependencies so normal global installs get the semantic layer. `haive doctor` should warn when embeddings or semantic indexes are unavailable.
