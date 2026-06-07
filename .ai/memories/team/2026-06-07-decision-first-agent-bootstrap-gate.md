---
id: 2026-06-07-decision-first-agent-bootstrap-gate
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/bootstrap-state.ts
    - packages/cli/src/commands/enforce.ts
    - packages/mcp/src/tools/get-briefing.ts
    - packages/mcp/src/prompts/bootstrap-repo.ts
  symbols: []
tags:
  - bootstrap
  - enforcement
  - gate
  - sensors
  - cold-start
created_at: '2026-06-07T20:14:58.067Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## First-agent bootstrap gate — force the cold-corpus baseline so later agents can rely on it

`haive init` stays untouched (no new command, no API key). Instead the **cold state of the corpus itself** forces the very first agent to fill the knowledge layer before its commit/`enforce finish` can pass. Once the baseline exists the gate is silent for every later agent — stateless and self-clearing (the trigger is corpus state, not an agent identity).

**Mechanism (3 coordinated layers, all reusing existing plumbing):**
1. **Detect** — `assessBootstrapState()` in `core/bootstrap-state.ts` (pure; callers pass project-context, memories, code-map files, module dirs). Turns "fill everything" into a FINITE repo-derived checklist. State = `cold | partial | ready`. **Exhaustive bar (chosen by the user):** ready ⇔ project-context filled + a module context per component (≥2 components) + an anchored memory per main code area + a **sensor per main code area**. A "main code area" = a component (top-level dir, or `packages/<x>` etc.) with ≥3 production files (test/config/.d.ts excluded).
2. **Direct** — `get_briefing` unshifts a top-priority `__bootstrap_required__` action_required with the concrete checklist, ONLY when `mainAreas > 0` (so the "your commit will be blocked" message stays truthful).
3. **Force** — `checkBootstrapComplete()` adds a `bootstrap-incomplete` finding to `buildEnforcementReport` (local/pre-commit/ci) and `buildFinishReport`. Blocks (error) only when `bootstrapGate=block` AND `mainAreas>0` AND production code is in play; otherwise `warn` (areas exist) or `info` (no areas, no score penalty). All inputs are COMMITTED artifacts so the assessment is identical locally and in CI.

**Fill flow:** new `bootstrap_repo` MCP prompt (always registered) computes the live assessment and walks the agent through `bootstrap_project_save` → `mem_save` → `propose_sensor` (LLM generates, core validates) until ready.

**Config:** `enforcement.bootstrapGate: off | warn | block`, default **block** in both DEFAULT_CONFIG and AUTOPILOT_DEFAULTS. Override per-repo or `git commit --no-verify`.

**Why `mainAreas>0` guards blocking:** without genuine code areas there is nothing for later coding agents to rely on; a tiny/docs/config repo must not be trapped. This also kept two pre-existing CLI enforce tests green (their fixtures have <3 source files → 0 areas).

Tests: `core/test/bootstrap-state.test.ts` (7), MCP directive tests (3) and a CLI block→clear integration test. Suite 621 green. Related: [[2026-05-31-gotcha-enforcement-is-process-not-violation]], [[2026-06-03-gotcha-regex-sensors-orphaned-from-precommit-gate]].
