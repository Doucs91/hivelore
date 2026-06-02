---
id: 2026-06-02-architecture-core-pure-domain-layer
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/core/src
  symbols: []
tags:
  - core
  - architecture
  - boundaries
created_at: '2026-06-02T02:00:00.000Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids:
  - 2026-04-25-architecture-pure-tool-handlers
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Core Is The Pure Domain Layer

`@hiveai/core` owns schemas, scoring, ranking primitives, path resolution, parsers, usage math, sensors, eval math, and code-map structures. Keep it free of CLI concerns, MCP transport concerns, prompts, stdout/stderr formatting, and network calls.

When adding quality logic, put pure deterministic functions in `packages/core/src` first, then have CLI/MCP orchestrate I/O around them. This is why `computeImpact`, `scoreRetrievalCase`, `aggregateSensors`, `runSensors`, and code-map helpers are unit-testable without stdio or a Git repo.

Do not import `@hiveai/mcp` or `@hiveai/cli` from core. If a feature needs tool execution, expose a small core type/function and wire the side effects in the caller package.
