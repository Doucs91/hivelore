---
id: 2026-06-04-decision-precommit-autobrief-and-briefing-json
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/briefing.ts
    - packages/core/src/config.ts
  symbols: []
tags:
  - enforcement
  - decision-coverage
  - briefing
  - friction
  - dx
created_at: '2026-06-04T04:45:02.635Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.987Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Pre-commit gate auto-briefs (no manual briefing step); `haive briefing --json` added

Friction-removal pass (v0.21.0), from accumulated dogfooding pain:

### Auto-brief — the decision-coverage gate no longer requires a manual briefing first
`verifyDecisionCoverage` (pre-commit/pre-push) used to BLOCK when relevant anchored decisions weren't in
the latest briefing marker, forcing a manual `haive briefing --files … --max-memories 60` before every
broad commit. Now the gate **surfaces those decisions itself and records them in the session marker at
commit time** (feedforward without a manual step — the harness iterates the loop, not the human), then
passes with a `decision-coverage-autosurfaced` finding listing what it surfaced. Gated by new config
`enforcement.autoBrief` (default **true**); set **false** for the strict legacy "must brief before commit".
Complements the self-authored exemption from [[2026-06-04-decision-stack-pack-dedup-by-signature-and-coverage-self-exempt]].

### `haive briefing --json`
The CLI briefing had no machine-readable output (only the MCP get_briefing tool did) — `--json` silently
emitted nothing. Added `--json`: emits the ranked memories (id, scope, type, status, priority, score, file,
summary) + briefing_quality + counts, suppressing the formatted text. Parity with get_briefing for scripting/CI.

### Already-covered frictions (audited, no code needed)
- MCP staleness after a rebuild → `haive doctor` already flags `global-haive-version-mismatch` / checks
  `haive-mcp --version`.
- Re-import duplicates → `memory import-changelog` already upserts by `topic`; `memory import` delegates to
  the `import_docs` prompt → `mem_save` (which dedups). Stack-pack seeds fixed in v0.20.1 (signature/topic).
- Stack-pack titles → seeds now carry a clean `<Stack>: <Rule>` H1 so the corpus normalizer stops
  synthesizing ugly `Convention <slug>` titles.

Verified: 323 core + 124 mcp + 67 cli tests green; tsc clean; `briefing --json` emits valid JSON;
seeded titles read "Typescript: No Any Prefer Unknown".
