---
id: 2026-07-02-decision-surface-reduction-one-verb-per-job
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/index.ts
    - packages/mcp/src/server.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags:
  - surface
  - cli
  - mcp
  - deprecation
  - v0.32.0
created_at: '2026-07-02T22:20:28.920Z'
expires_when: null
verified_at: '2026-07-02T22:21:22.002Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# v0.32.0 surface reduction — rules that govern what stayed, went, or merged

**Deletion bar:** a command/tool went only if (a) zero inbound imports outside its registry, (b) zero external contract (hooks, VS Code extension `--json` calls, generated repo content, fix-hints), and (c) zero-to-negligible real usage (`.ai/.usage/tool-usage.jsonl`). Removed: snapshot, playback, welcome, hub, tui (+ ink/react deps), runtime-journal, and the 7 experimental MCP tools (1 call total in 2 months). `benchmark` KEPT deliberately — it's the tool for the planned public "Hivelore vs static CLAUDE.md" benchmark.

**Merge pattern:** survivor verb gains a flag; the old file keeps its implementation as an `export async function runX(opts)`; the old command re-registers `{ hidden: true }` calling the same function. Zero behavior change, one advertised name. Examples: `enforce install` (absorbed install-hooks — the dual hook-generator gotcha is now structurally impossible), `memory conflicts [<a> <b>]` (candidates+resolve), `index memories|query|status` (embeddings family), `memory import --changelog`, `seed --git`, `stats --hot`, `update --edit`, `list --pending`.

**Compat invariants:** `HAIVE_TOOL_PROFILE=experimental|full` are aliases of `maintenance`; every old CLI spelling still executes (hidden); VS Code extension contract (dashboard/stats/eval/memory impact/memory lint/sensors list `--json`) untouched; MCP enforcement profile untouched; `mem_timeline` MCP stays although the CLI `memory timeline` went.

**Gotcha for future extractions:** commander maps `--from` to `opts.from`, but `ImportChangelogOptions` reads `fromChangelog` — when extracting an action body into a run function, verify the option-name→field mapping (the hidden alias needed an explicit `{ ...opts, fromChangelog: opts.from }`).
