---
id: 2026-07-04-decision-stack-pack-rescue-strong-task-evidence
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/priority.ts
    - packages/core/src/relevance.ts
  symbols: []
tags:
  - briefing
  - ranking
  - stack-packs
  - priority
  - v0.39.2
created_at: '2026-07-04T16:02:22.284Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Stack-pack seeds are rescued to `useful` ONLY on strong task evidence

## Decision
In `classifyMemoryPriority` (core/priority.ts — THE shared classifier for CLI and MCP), a `stack-pack` tagged memory with `exactTaskMatch || strongSemantic (cosine ≥ 0.65)` now ranks **useful** instead of being hard-capped at background. Never must_read. Env-workaround memories keep the unconditional cap.

## Why
The down-rank's documented escape hatch ("a direct anchor already promoted them") was DEAD for stack packs: they ship `anchor.paths: []` (needs_anchor), so `directAnchor` could never fire. Result observed live on a seeded Nest+Next+Prisma repo: task "add a prisma migration" left `prisma-migrations-never-modify` in background with briefing_quality=thin/useful=0 — the single most relevant lesson hidden by its own origin tag. Measured cosine calibration justified reusing the existing strongSemantic threshold: the on-topic pack memory scored 0.688–0.755 while off-topic neighbours peaked at ~0.60, so 0.65 discriminates cleanly with zero new constants.

## Rejected alternatives
- Anchoring stack packs at init (copying sensor globs into anchor.paths): drags glob anchors into staleness detection and every anchor mechanism; larger blast radius, separate decision.
- Rescuing on usefulSemantic (≥0.35) or tagTaskMatch: exactly the weak-evidence noise class the down-rank exists to smother (a `nextjs` tag matching "next" in a task).
- Relaxing env workarounds too: their documented fix is repairing the environment, not surfacing the note.

## How to apply
Any future "category X never ranks above Y" rule must keep a LIVE escape hatch — verify the promoting signal is actually reachable for that category (here the anchor hatch was structurally unreachable). Regression tests: core/test/priority.test.ts + mcp/test/adaptive-briefing.test.ts (literal path, anchor-less stack seed → useful; unrelated seed stays background).
