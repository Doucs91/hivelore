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
verified_at: '2026-07-06T02:20:00.000Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: ship-embeddings-with-cli-mcp
revision_count: 1
requires_human_approval: false
validated_by: null
---
# Keep embeddings optional while preserving semantic discovery

The original decision to install `@hivelore/embeddings` transitively made the nominally optional semantic layer add roughly 380 MB to every global CLI install. That contradicts the documented lean lexical fallback.

Keep `@hivelore/embeddings` as an optional peer plus workspace dev dependency. All runtime access must remain dynamic imports: the base CLI and MCP work lexically without it, while users opt into local semantic ranking with `npm install -g @hivelore/embeddings`. `hivelore doctor` must state whether the semantic layer or index is absent without treating that supported configuration as corruption.
