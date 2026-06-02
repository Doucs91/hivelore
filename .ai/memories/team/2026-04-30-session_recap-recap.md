---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/findings.ts
    - packages/core/test/findings.test.ts
    - packages/core/src/index.ts
    - packages/cli/src/commands/ingest.ts
    - packages/cli/src/index.ts
    - packages/mcp/src/tools/ingest-findings.ts
    - packages/mcp/src/server.ts
    - packages/mcp/test/ingest.test.ts
    - docs/HARNESS-ROADMAP-2026-06.md
    - CHANGELOG.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-02T04:21:12.822Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 17
requires_human_approval: false
---
## Goal
Research "harness engineering", position hAIve against it, then implement the resulting roadmap from highest to lowest priority.

## Accomplished
- Researched harness engineering (Fowler, Anthropic, Faros 5-layer, awesome-harness-engineering, NxCode, RedHat, Augment) and wrote a positioning analysis (strengths/weaknesses/wishlist) saved as decision `2026-06-02-decision-harness-engineering-positioning-roadmap`.
- Reconciled the 9-point wishlist against the ACTUAL codebase (v0.12.4): 6 already shipped (sensors, lifecycle, hard guardrails, JIT context, eval, impact), 3 partial. Only genuine gap = feature B (findings ingestion). Documented in `docs/HARNESS-ROADMAP-2026-06.md`.
- Implemented feature B end-to-end (v0.12.5): core `findings.ts` (parseSarif/parseSonar/parseFindings/normalizeFindingSeverity/findingToDraft/draftsFromFindings/filterNewDrafts), CLI `haive ingest --from sarif|sonar`, MCP `ingest_findings` tool. Drafts are status=proposed, sensors warn-only autogen (never auto-validate/block). Cross-run dedup via topic=ingest:<tool>:<rule>:<path>.
- +14 tests (353 green), lockstep bump 0.12.4→0.12.5, tag v0.12.5 pushed, all 4 GH workflows green on both content commits.

## Discoveries & surprises
- Most of the externally-derived "wishlist" already existed in the codebase — external research must be reconciled against the real code before building, or you duplicate work.
- pnpm is not on PATH in this env (node v26 via nvm, pnpm 9.14.2 only in the standalone store). Workaround: wrapper script execing the store shim with node on PATH.
- sonarqube CI workflow flakes with transient "Connect timed out" to the self-hosted Sonar server; re-run with `gh run rerun <id> --failed`, don't change code. (saved as gotcha)
- decision-coverage pre-commit gate fails on broad multi-package commits because `haive briefing` defaults to --max-memories 8; run with --max-memories 40 over all staged files. (saved as gotcha)
- `haive enforce finish` ends red ("no runs for HEAD") whenever the haive-sync bot appends a `chore: haive sync [skip ci]` commit as HEAD — structural quirk; real verification is the content commits' runs.

## Files touched
- `packages/core/src/findings.ts`
- `packages/core/test/findings.test.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/commands/ingest.ts`
- `packages/cli/src/index.ts`
- `packages/mcp/src/tools/ingest-findings.ts`
- `packages/mcp/src/server.ts`
- `packages/mcp/test/ingest.test.ts`
- `docs/HARNESS-ROADMAP-2026-06.md`
- `CHANGELOG.md`

## Next steps
Continue the roadmap in docs/HARNESS-ROADMAP-2026-06.md in order: P1 observability completion (haive tui is a stub — non-interactive dashboard of impact/sensors-fired/stale/decay/token-budget), P2 harness templates by topology (grow init-stack-packs.ts with seed memories+sensors per stack), P3 AGENTS.md portable-standard adapter in sync --inject-bridge, P4 `haive eval --baseline/--compare` for reproducible +X% delta. Each step: lockstep bump only if shippable code changes; use --max-memories 40 briefing before broad commits.
