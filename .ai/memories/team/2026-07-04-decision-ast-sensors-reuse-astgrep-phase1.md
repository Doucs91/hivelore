---
id: 2026-07-04-decision-ast-sensors-reuse-astgrep-phase1
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/mcp/src/ast-sensors.ts
    - packages/mcp/src/tools/propose-sensor.ts
    - packages/cli/src/commands/enforce.ts
    - packages/core/src/schema.ts
  symbols: []
tags:
  - sensors
  - ast
  - ast-grep
  - excellence-plan
  - v0.40.0
created_at: '2026-07-04T21:50:42.097Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Phase 1 (excellence plan) — AST sensors: the non-obvious choices

1. **REUSE ast-grep, never build a matcher.** `@ast-grep/napi` is an optionalDependency of BOTH @hivelore/mcp AND @hivelore/cli — the cli bundles mcp's source (mcp is in cli dependencies but NOT in cli tsup externals), so the lazy `import("@ast-grep/napi")` resolves from the CLI package context at runtime. Trap hit live: with the dep only on mcp, the gate reported `ast-sensor-unrunnable` even though packages/mcp/node_modules had the engine. If you add a lazy-imported dep used inside mcp code, add it to cli's optionalDependencies AND both tsup externals (tsup-externals gotcha struck exactly as documented — native .node loaders cannot be bundled).
2. **`absent` for ast = structural sub-pattern first, TEXT fallback on the matched node.** A companion is often a property key (`idempotencyKey:`) which is a `property_identifier` node — an identifier pattern can't match it structurally, so pure `node.find(absent)` silently failed to suppress the CORRECT call. The fallback regex/substring test stays scoped to the matched node's text, so it can't reintroduce file-wide suppression.
3. **ast-grep parses patterns LENIENTLY** — garbage patterns often yield ok-with-zero-matches, not an error. Don't rely on `invalid-pattern` rejection; `missed-bad-example` is the effective net for useless patterns. Tests must accept either reason.
4. **Introduction, not presence**: gate hits require the matched node's line range to intersect `addedLineNumbersFromDiff` (core, pure hunk arithmetic) against the STAGED blob (`git show :path`, working-tree fallback). Full-file matching alone would fire on every touch of a file containing an old violation.
5. **Engine missing = the same honesty family**: block proposals rejected (`ast-engine-missing` — an unvalidatable guard must not claim to block), gate warns `ast-sensor-unrunnable`, doctor tells how to install. Never a hard dependency — cold installs stay light.
