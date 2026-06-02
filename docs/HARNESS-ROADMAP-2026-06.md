# Harness-engineering roadmap — reconciliation & execution plan (2026-06)

> **Purpose.** A cold-start handoff doc. An external "harness engineering" research pass produced a
> 9-point wishlist for hAIve (memory `2026-06-02-decision-harness-engineering-positioning-roadmap`).
> When checked against the **actual** codebase (v0.12.4, ~270 tests), most points were already built.
> This file maps wishlist → reality, then lists the genuine gaps in execution order so any agent can
> pick up cleanly. Follow `2026-05-31-decision-git-sync-protocol-multi-agent` (pull, lockstep bump on
> the 4 publishable packages + tag, push; never `npm publish` — Sady does that).

## Wishlist → reality

| # | Wishlist idea | State | Where in code |
|---|---------------|-------|---------------|
| 1 | Memory → executable guardrail (feedforward from feedback) | ✅ DONE | `core/sensors.ts`, `core/sensor-suggest.ts`, `cli sensors list/check/export/promote`, `mcp anti-patterns-check.ts`, `core/schema.ts SensorSchema` |
| 2 | Auto-capture from CI / Sonar / PR review | ❌ **GAP (feature B)** | not started — this doc's main deliverable |
| 3 | Harness templates by topology | 🟡 PARTIAL | `cli/init-stack-packs.ts` exists; could grow more packs + per-pack seed sensors |
| 4 | Behaviour harness / repeatable evals | ✅ MOSTLY | `core/eval.ts` (recall/MRR + sensor catch-rate → 0..100), `cli eval`, `.ai/eval/spec.json`, `cli benchmark` |
| 5 | Memory lifecycle (decay, dedup, contradiction) | ✅ DONE | `core/memory-lifecycle.ts`, `core/conflict-candidates.ts`, `mcp mem-conflicts.ts`, `cli memory-lint.ts`, dedup+similarity in `mcp mem-save.ts` |
| 6 | Observability of memory value | 🟡 PARTIAL | `core/impact.ts`, `cli memory-impact.ts`, `core/runtime-journal.ts`, `cli stats.ts`; `haive tui` still a stub |
| 7 | Hard guardrails / phase-gating | ✅ DONE | `core/enforcement.ts`, `cli install-hooks.ts`, `cli enforce.ts` (`enforce finish`), `mcp precommit-check.ts` (PreToolUse hook) |
| 8 | `.ai/` as portable cross-harness standard | 🟡 PARTIAL | bridge files (CLAUDE.md / .cursorrules / copilot) via `haive sync --inject-bridge`; no AGENTS.md adapter yet |
| 9 | Progressive / JIT context loading | ✅ DONE | `core/token-budget.ts`, `core/briefing-preset.ts`, `core/skill-activation.ts` (activation triggers) |

**Conclusion:** the only fully-unbuilt, high-leverage item is **#2 — findings ingestion (feature B)**.
The rest are polish on existing layers. Execution order below reflects value/effort.

## Execution order

### P0 — Feature B: findings ingestion (CI/Sonar/SARIF → proposed memories + sensors)  ✅ DONE (v0.12.5)
Closes the review↔memory loop and kills cold-start: a real defect found by a scanner becomes an
anchored `gotcha`/`convention` memory, pre-filled with an autogen `warn` sensor, so the *next* agent
is steered away from it. This is the self-feeding half of the sensors story (Phase 1/2 made sensors;
B makes them self-populating).

- `packages/core/src/findings.ts` (pure): `Finding` type, `parseSarif`, `parseSonar`,
  `normalizeFindingSeverity`, `findingToDraft`, `draftsFromFindings`, `filterNewDrafts`. No I/O.
- `packages/core/test/findings.test.ts`.
- `packages/cli/src/commands/ingest.ts`: `haive ingest --from sonar|sarif <file> [--dry-run]
  [--scope team] [--type gotcha|convention] [--limit N]`. Dedup by `topic = ingest:<key>`.
- `packages/mcp/src/tools/ingest-findings.ts` + register in `server.ts` (maintenance profile).
- Safety: drafts are `status: proposed`, sensors `severity: warn` + `autogen: true`. **Never**
  auto-validate, never auto-block (safety rules + `2026-05-07-attempt-strict-precommit-gate-on-haive`).

### P1 — Observability completion (#6)  ✅ DONE (v0.12.6)
Note: `haive tui` turned out to be already implemented (interactive Ink dashboard, needs a TTY).
The real gap was a **non-interactive** rollup an agent/CI can read. Delivered `haive dashboard`
(+ `--json`), backed by pure `core/dashboard.ts` (`buildDashboard`): inventory, impact tiers + top
memories, sensors (and which fired via `last_fired`), health (stale / anchorless / pending / prune),
decay, and corpus token weight.

### P2 — Harness templates by topology (#3)  ✅ DONE (v0.12.7)
`init-stack-packs.ts` now lets a pack memory carry a curated regex `sensor`, so seeded templates are
feedforward+feedback (the lesson fires on the user's diff, not just when surfaced). Added crisp
sensors to high-signal existing packs (Next.js `NEXT_PUBLIC_*SECRET`, React `key={index}`) and three
new backend packs — **fastapi**, **django**, **go** — with sensors (django `DEBUG = True`, hardcoded
`SECRET_KEY`, fastapi `uvicorn reload=True`, bare `except:`). Seeded via `haive init --stack <names>`;
seed sensors are `warn` + `autogen:false` (vetted, never auto-block).

### P3 — Portable standard (#8)  ✅ DONE (v0.12.8)
`haive init` now emits `AGENTS.md` (the emerging cross-harness convention) alongside CLAUDE.md /
.cursorrules / copilot-instructions.md, and `haive sync --inject-bridge` injects the memory
breadcrumbs into both CLAUDE.md and AGENTS.md by default (explicit `--bridge-file` still targets a
single file). The `.ai/` corpus is now consumable by any AGENTS.md-aware agent (Codex, etc.).

### P4 — Eval delta reporting (#4 polish)
`haive eval --baseline` to record a score snapshot and `haive eval --compare` to print the +X%/−X%
delta vs the recorded baseline, making the "hAIve improves agent retrieval by N%" claim reproducible.

## Done-criteria each step
`pnpm -r build && pnpm -r test && pnpm check:artifacts` green; CHANGELOG entry; lockstep version bump
+ tag if shippable code changed; `haive enforce finish` passes; targeted `haive briefing --files`
before editing/committing so the PreToolUse gate doesn't block.
