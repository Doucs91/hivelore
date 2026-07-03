---
id: 2026-07-03-decision-scaffold-detection-in-mcp-monorepo-basedir
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/scaffold-test.ts
    - packages/core/src/test-scaffold.ts
    - packages/cli/src/commands/sensors.ts
  symbols: []
tags: []
created_at: '2026-07-03T23:23:05.124Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Decision
Two-layer split for post-incident scaffolding so BOTH the CLI (`sensors scaffold`) and the MCP tool (`scaffold_test`) share one impl:
- **Pure decision in core** (`test-scaffold.ts`): `pickTestFramework(pkg, {goMod,pySignal})`, `normalizeFramework(str)`, and `scaffoldPostIncidentTest(..., { baseDir })` — deterministic, no I/O, unit-tested without a repo.
- **FS walking in MCP** (`scaffold-test.ts`): `detectTestFrameworkForPaths(root, anchorPaths)` walks up from each anchor path's dir to the repo root, using the NEAREST enclosing manifest (package.json / go.mod / py signal), and returns `{ framework, baseDir }`. The CLI imports it from `@hivelore/mcp` (the CLI already depends on mcp for `readPresumedCorrectTargets`).

## Why
- **Monorepo correctness:** the framework + test location must come from the package that OWNS the incident's anchor paths, not the repo root. A lesson anchored to `packages/api/src/` scaffolds a vitest test in `packages/api/tests/incidents/…` even if the root uses jest. `baseDir` (repo-relative package dir, "" for root) is threaded into the core generator's default path + run command.
- **No duplication + core purity:** detection is I/O so it can't live in core ([[2026-06-02-architecture-core-pure-domain-layer]]); it can't live in the CLI either because the MCP tool needs it and mcp must not import cli (cli→mcp is the dependency direction). MCP is the shared I/O layer. The pure facts→framework decision stays in core.
- **MCP mirrors the CLI** so agents get the same on-ramp in-session; `scaffold_test` is in the ENFORCEMENT profile (default), writes a pending stub, and — like the CLI — NEVER arms a sensor (see [[2026-07-03-decision-scaffold-generates-pending-test-never-arms]]).

## How to apply
`outPath` (explicit) wins over `baseDir` (detected). Detection falls back to `{ vitest, "" }` so scaffolding never dead-ends. Adding a framework = extend `normalizeFramework`/`pickTestFramework` (core) + the template switch in `scaffoldPostIncidentTest`.
