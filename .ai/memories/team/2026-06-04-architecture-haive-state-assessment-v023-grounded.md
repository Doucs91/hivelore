---
id: 2026-06-04-architecture-haive-state-assessment-v023-grounded
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/core/src/sensor-suggest.ts
    - packages/mcp/src/tools/get-briefing.ts
  symbols: []
tags: []
created_at: '2026-06-04T16:57:04.305Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: haive-grounded-state-assessment
revision_count: 0
requires_human_approval: false
---
## hAIve state assessment (v0.23.0) — grounded in real dogfooding + benchmark, not surface

From a session that USED hAIve heavily, IMPROVED it (v0.22/0.23), and BENCHMARKED it (real sub-agent A/B).

**Proven value:** feedforward briefing delivers non-guessable repo policy at the right moment — benchmark
showed **0%→100% policy-correctness** vs plain agents (who reproduced 3 documented prod bugs 6/6). Enforcement
really blocks (the gate fired the `:any` sensor on a real commit this session). Measurement/eval infra is honest
(reads capped, prevention debounced).

**Proven cost:** hAIve adds **+25–32% tokens and is slower per task** (real telemetry). When a rule is locally
testable, a strong model infers it from the test → hAIve is **redundant overhead** (no flip; the "cheaper at
scale" claim is unproven/contradicted in the locally-testable case). hAIve's ROI is downstream (escaped-defect
prevention, human review, revert/refix), NOT the agent's token bill.

**Recurring structural smell (highest-value finding):** the SAME class of bug appeared twice — logic bolted onto
multiple entry points instead of one shared path, which then drifts: (1) regex sensors orphaned from the gate
(fixed pre-session), (2) prevention not recorded in the gate (I fixed via `recordPreventionHits`). Audit for more;
add an architectural guard. See [[2026-06-04-gotcha-prevention-not-recorded-in-precommit-gate]].

**Other real weaknesses observed:**
- Autogen sensor QUALITY is low — `mem_save` generated a nonsensical regex (line-number pattern) for a gotcha.
  Noisy autogen sensors risk the false-positive→ignored-gate existential failure. Consider default warn-only/review.
- Briefing surfaces NOISE — "Project Radar" leaked the PARENT repo's git history in a sub-fixture (findProjectRoot
  walks up for git even when .ai is local); one bench agent got distracted into "hAIve internals" and burned 24.9k tokens.
- Cold-start still weak — `haive init` project-context bootstrap produced "auto-generated/unfilled — skipping (low value)".
  The session-1 value (the #1 adoption lever) is the weakest part.
- Surface-area sprawl — ~60 CLI commands, ~40 MCP tools, many overlapping memory-* commands. High cognitive/maintenance load.
- `token_proxy` (report size) overstates the token gap ~3× vs real billing; even labeled, it's in the headline table.

**Top improvement priorities (perfect/sharpen, don't add):** (1) consolidate parallel paths + add an arch test;
(2) make autogen sensors safe-by-default; (3) tighten briefing relevance (fix radar parent-repo leak, default min-score);
(4) real cold-start bootstrap; (5) prune the command/tool surface behind --advanced; (6) surface a with-vs-without
value/cost line so users see when hAIve helped vs was overhead.
