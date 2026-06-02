---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/findings.ts
    - packages/core/src/dashboard.ts
    - packages/core/src/eval.ts
    - packages/cli/src/commands/ingest.ts
    - packages/cli/src/commands/dashboard.ts
    - packages/cli/src/commands/init-stack-packs.ts
    - packages/cli/src/commands/sync.ts
    - packages/cli/src/commands/eval.ts
    - packages/mcp/src/tools/ingest-findings.ts
    - docs/HARNESS-ROADMAP-2026-06.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-02T05:08:21.838Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 18
requires_human_approval: false
---
## Goal
Execute the harness-engineering roadmap (docs/HARNESS-ROADMAP-2026-06.md) P1→P4 end-to-end after P0 (findings ingestion) shipped.

## Accomplished
All of P0–P4 shipped, each: pure core + thin CLI/MCP, tests, lockstep bump, tag, push, 4 green workflows.
- P0 v0.12.5 — findings ingestion (core/findings.ts, `haive ingest`, MCP `ingest_findings`): SARIF/Sonar → proposed memories + warn sensors.
- P1 v0.12.6 — observability: core/dashboard.ts + `haive dashboard` (+--json). Non-interactive rollup (tui already existed but needs TTY): inventory, impact tiers, sensors fired, health (stale/anchorless/pending/prune), decay, corpus tokens.
- P2 v0.12.7 — stack packs carry curated regex sensors (warn+autogen:false); sensors on nextjs/react packs; new fastapi/django/go backend packs with sensors.
- P3 v0.12.8 — AGENTS.md portable bridge: init emits AGENTS.md; sync --inject-bridge dual-writes CLAUDE.md + AGENTS.md.
- P4 v0.12.9 — eval baseline/compare: core compareEvalReports/EvalDelta + `haive eval --baseline/--compare/--fail-on-regression`.
365 tests green. Roadmap doc marked P0–P4 complete.

## Discoveries & surprises
- The external "9-point wishlist" was mostly already built; 6/9 existed before this effort. Always reconcile research against the real codebase before coding (table at top of HARNESS-ROADMAP-2026-06.md).
- `haive tui` was NOT a stub (PLAN.md §7.2 was stale) — it's an interactive Ink dashboard. The real gap was a non-interactive/scriptable view → `haive dashboard`.
- Each push triggers a haive-sync bot `chore: ... [skip ci]` commit; pulling it back is required every cycle. `enforce finish` shows "no runs for HEAD" if HEAD ends on that [skip ci] commit — run finish while HEAD is a content commit. (see [[2026-06-02-gotcha-decision-coverage-gate-needs-high-max-memories]])
- Broad multi-package commits need `haive briefing --files <all staged> --max-memories 40` before commit or the decision-coverage gate fails (caps at 8 by default).
- sonarqube workflow occasionally flakes (Connect timed out) — rerun, don't change code.

## Files touched
- `packages/core/src/findings.ts`
- `packages/core/src/dashboard.ts`
- `packages/core/src/eval.ts`
- `packages/cli/src/commands/ingest.ts`
- `packages/cli/src/commands/dashboard.ts`
- `packages/cli/src/commands/init-stack-packs.ts`
- `packages/cli/src/commands/sync.ts`
- `packages/cli/src/commands/eval.ts`
- `packages/mcp/src/tools/ingest-findings.ts`
- `docs/HARNESS-ROADMAP-2026-06.md`

## Next steps
Roadmap P0–P4 complete (v0.12.5→v0.12.9). Remaining wishlist items already existed in the codebase. If extending: (a) eval baseline could be wired into CI (haive eval --compare --fail-on-regression) to gate ranking regressions; (b) more stack packs / more curated sensors; (c) findings ingestion could grow a `haive ingest --from sonar` live-fetch via the configured SonarQube MCP. Human (Sady) still does npm publish for the shipped versions.
