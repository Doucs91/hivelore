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

**Verified strengths:** gate blocks for real (`enforce.ts` process.exit); no vanity metrics (reads
capped 0.35 in `impact.ts`); real context engineering (token budget + cascade truncation + skill activation).
The ratchet loop is real AND now fully closed in the installed gate (see correction below).

**⚠️ CORRECTION (v0.22.0):** the earlier claim "ratchet is real: mem_tried→auto-sensor→fires→
`appendPreventionEvent`→impact" was only HALF true. The fire→record link held for **anti-pattern**
catches (`preCommitCheck`→`antiPatternsCheck` recorded) but was **broken for regex/command sensors** in
the git-hook gate — they blocked but never recorded. Fixed via the single `recordPreventionHits` recorder
now called from `runSensorGate`. See [[2026-06-04-gotcha-prevention-not-recorded-in-precommit-gate]].
Lesson: re-verify a "verified" claim by tracing the *installed* path, not the component in isolation.

**Backlog status (v0.22.0 pass — perfect the existing before adding new):**
- A/P0-1 ✅ DONE: `kind: shell|test` sensors execute in `haive sensors check` AND now in the gate
  (`runSensorGate`, behind `enforcement.runCommandSensors`).
- P0 (new) ✅ DONE: gate now records prevention for sensor catches (the leak above).
- P1-4 (ratchet visibility) ✅ DONE: `mem_tried` returns `sensor_generated` + a hint when the loop stays open (no paths / no token).
- P1-5 (eval ground truth) ✅ DONE: `eval` now reports case provenance (synthesized vs authored) and warns when the score is purely self-referential; `--spec <file>` already gives an independent-only run.
- C/P2-6 (gate precision) ✅ DONE earlier: `haive dashboard` shows precision + tuning suggestion; `eval --fail-under-gate-precision` gates CI.
- B/P0-2 ✅ DONE earlier: `enforce finish` has `checkFailureCapture` (blocks on uncaptured detected failures).
- P1 (eval trend) ✅ DONE earlier: `eval --record`/`--trend`/`--regression-gate`.
- D/P1-3 ✅ DONE (v0.23.0): `haive coverage` crosses the corpus with git churn AND agent-edit hot files
  from `observations.jsonl` (`tallyHotFiles`/`mergeHotFiles`, `--source git|agent|both`, per-gap source tag).
- E/P2-5 ✅ DONE (v0.23.0): guided supersede — `applyConflictResolution` promotes the winner
  (revision_count++, adopts the loser's topic so future captures consolidate); `mem_conflict_candidates`
  attaches a `suggested_resolution` + apply command to every pair.
- F/P3-7: cold-start seeding — `seed-git` / `ingest` / stack packs shipped; keep widening. MOSTLY DONE.
- H/P3-8 ✅ DONE earlier: `.ai/` merge driver shipped (v0.15.0).

**As of v0.23.0 the entire original harness-positioning backlog (A–H) is closed except F (cold-start,
ongoing by nature). The existing loop is "perfected"; next work should be net-new, not gap-filling.**

**Out of scope (do NOT expand into):** Behaviour harness (test gen/verification) — that's a
different product; hAIve complements tests, never replaces them.

See full session analysis for source links.
