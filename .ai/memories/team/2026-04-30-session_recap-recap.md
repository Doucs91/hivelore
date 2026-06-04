---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/specificity.ts
    - packages/cli/src/commands/init-stack-packs.ts
    - packages/cli/test/seed-quality.test.ts
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-04T20:27:14.978Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 36
requires_human_approval: false
---
## Goal
Test the cold-start seed quality in real conditions (installed v0.24.0) and raise it, inspired by repo-native tools — no low-quality seeds.

## Accomplished
- Tested cold-start on a fresh Next/Nest/Prisma project; scored all 19 seeds with hAIve's OWN specificityScore: mean 0.55, only 3/19 below threshold, none flagged generic-advice. Seeds are concrete framework traps, not garbage.
- Shipped v0.25.0 (CI+sonar green, enforce finish 100%): core meetsSeedQualityFloor + SEED_QUALITY_FLOOR(0.2); seed time skips sub-floor packs; new cli/test/seed-quality.test.ts audits the WHOLE pack library and fails the build on any low-value seed.
- Upgraded the 6 sub-floor seeds: added enforceable sensors to flask (SQL f-string injection), prisma ($disconnect in serverless), zustand (whole-store subscribe), nestjs (ORM-in-controller scoped to *.controller.ts); enriched the mongoose .lean() note. Cold-start now ships 4 active sensors on that stack (was 2).
- Tests: core 334 / mcp 126 / cli 69 green.

## Discoveries & surprises
- specificityScore conflates "concrete" with "team-specific": framework facts with identifiers score >0.3 even though a model already knows them. So the real seed-quality axis is enforceable-sensor vs prose, not raw specificity. That's why the floor accepts sensor-backed seeds unconditionally.
- init ALREADY runs git-revert seeding by default (the non-guessable, high-value tier) — stack packs are the thin background supplement, honestly labeled "generic guidance, not repo-specific" with an anchor-or-replace footer. Cold-start was in better shape than my earlier assessment implied.
- The 0.3 GUESSABLE_THRESHOLD (for linting claimed team knowledge) is too strict for seeds (background framework reference) — hence the separate 0.2 SEED_QUALITY_FLOOR.
- Process: `grep -c` returns exit 1 on zero matches and silently broke an && chain before a git commit (commit didn't run, log showed the old HEAD). Watch for this in scripted commits.

## Files touched
- `packages/core/src/specificity.ts`
- `packages/cli/src/commands/init-stack-packs.ts`
- `packages/cli/test/seed-quality.test.ts`

## Next steps
Consider sensors for the remaining sensorless conventions (mongoose .lean() absence, go ctx-first) if a low-false-positive pattern emerges. Extend the seed-quality floor/audit to ingested findings (haive ingest) and seed-git drafts. Make the flaky embeddings CLI test resilient (still outstanding).
