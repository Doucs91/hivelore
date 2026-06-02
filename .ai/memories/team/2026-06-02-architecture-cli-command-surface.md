---
id: 2026-06-02-architecture-cli-command-surface
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/cli/src
  symbols: []
tags:
  - cli
  - architecture
  - ux
created_at: '2026-06-02T02:00:00.000Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids:
  - 2026-06-02-architecture-core-pure-domain-layer
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# CLI Is Orchestration And User-Facing UX

`@hiveai/cli` should keep command files thin: parse Commander options, resolve the project root, call core/MCP helpers, then print actionable output. Heavy ranking, scoring, parsing, and matching logic belongs in `@hiveai/core` where tests can exercise it directly.

Default help intentionally exposes only the core harness workflow. New maintenance or experimental commands may exist, but must stay behind `--advanced` unless they are part of day-to-day `init -> briefing -> enforce -> session end` usage.

Doctor findings should be concrete and fixable. Prefer a specific code such as `pnpm-not-on-path`, `workspace-dist-version-mismatch`, or `code-search-index-outdated` with an exact command over a vague setup warning.
