---
id: 2026-07-05-decision-eval-golden-set-tier-contract-phase5
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/eval.ts
    - packages/cli/src/commands/eval.ts
    - packages/cli/src/commands/sync.ts
  symbols: []
tags:
  - eval
  - golden-set
  - gate-miss
  - excellence-plan
  - v0.42.1
created_at: '2026-07-05T02:57:16.248Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Phase 5 (excellence plan) — golden-set eval: the non-obvious choices

1. **Proposed golden cases live in `.ai/eval/spec.json` under `proposed_retrieval` and are NEVER scored until `eval --approve-cases`** — the whole point is independent ground truth, so a machine-proposed case must pass a human eye before it counts. The loader ignores the key naturally (typed as EvalSpec); eval WARNS about waiting cases so they can't rot silently.
2. **The case template is the gate-miss inversion**: task = the gate-miss lesson's `# heading` (which carries the reverted commit's subject), expected = the lesson id. This is the labeled case self-synthesis can't produce (it would be self-referential).
3. **`runTierContract` runs the INSTALLED classifier at eval time** — corpus-independent, 5 fixed checks (stack-pack rescue alive / crowding guard / env hard cap / anchors win / attempts first). It intentionally duplicates unit-test territory: the value is failing the USER-REPO CI when a shipped binary regresses, not protecting this repo alone. A violated check exits non-zero regardless of --fail-under.
4. Trap avoided: `report`+`gate_precision` object literals appear TWICE in eval.ts (JSON output AND BaselineSnapshot) — a broad textual patch added tier_contract to the baseline snapshot type by accident. When patching eval.ts output, target the `opts.json` block specifically.
5. Golden-set plumbing in sync is best-effort (try/catch, dryRun-guarded) — spec.json writing must never break a sync.
