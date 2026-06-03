---
id: 2026-06-02-architecture-harness-engineering-positioning-gaps
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/core/src/sensors.ts
    - packages/core/src/impact.ts
    - packages/core/src/eval.ts
    - packages/core/src/prevention.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags: []
created_at: '2026-06-02T22:52:09.791Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: harness-engineering-positioning
revision_count: 0
requires_human_approval: false
---
## hAIve vs Harness Engineering — positioning + improvement backlog

Grounded analysis (verified in code, not surface) of hAIve against the harness-engineering
framework (Fowler/Böckeler, LangChain, Addy Osmani, awesome-harness-engineering).

**Framework:** Agent = Model + Harness. Guides (feedforward) + Sensors (feedback);
computational vs inferential; 3 categories: Maintainability → Architecture-fitness → Behaviour.
The "ratchet": every mistake becomes a permanent rule. Open challenges Fowler lists:
incoherence at scale, measuring harness coverage/quality, drift, behavioural confidence.

**hAIve owns the Maintainability / repo-policy slice** and is AHEAD of the field on two of
Fowler's open challenges: outcome measurement (`prevention.ts` + `impact.ts`) and harness
self-eval (`eval.ts` recall/MRR/catch-rate + baseline/compare).

**Verified strengths:** ratchet loop is real (`mem_tried`→auto-sensor→fires→`appendPreventionEvent`→impact);
gate blocks for real (`enforce.ts` process.exit); no vanity metrics (reads capped 0.35 in `impact.ts`);
real context engineering (token budget + cascade truncation + skill activation).

**Verified gaps → improvement backlog (perfect the existing before adding new):**
- A/P0-1: sensor `kind: shell|test` is in `schema.ts` but "reserved", not executed → implement in CLI.
- B/P0-2: capture depends on agent discipline; runtime-journal "N failures detected" is advisory → make `enforce finish` block on uncaptured detected failures.
- D/P1-3: no coverage-gap detection; `eval` synthesizes cases from EXISTING memories only → cross usage-log hot files × anchorless to surface uncovered hot files.
- P1-4: `eval` score not trended in CI → make `eval --compare` a default CI gate + trend the score.
- E/P2-5: `conflict-candidates` only surfaces, no guided supersede → wire into topic-upsert/revision_count.
- C/P2-6: inferential gate precision not surfaced → dashboard precision line + auto-tune antiPatternGate.
- F/P3-7: cold-start; seed sensors/decisions at bootstrap from git revert history / lint / CI.
- H/P3-8: `.ai/` multi-agent merge conflicts → merge driver / append-only writes.

**Out of scope (do NOT expand into):** Behaviour harness (test gen/verification) — that's a
different product; hAIve complements tests, never replaces them.

See full session analysis for source links.
