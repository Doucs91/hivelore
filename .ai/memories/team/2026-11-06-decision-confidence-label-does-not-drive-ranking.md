---
id: 2026-11-06-decision-confidence-label-does-not-drive-ranking
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/confidence.ts
    - packages/mcp/src/tools/get-briefing.ts
  symbols:
    - deriveConfidence
tags:
  - ranking
  - confidence
  - eval
created_at: '2026-11-06T07:13:39.581Z'
evidence: tested
validated_by: auto
---
# The review label (confidence) is presentation; briefing relevance ranks on admission

Rule: when changing `deriveConfidence`, keep briefing ranking keyed on `status === "validated"`, not on the `low`/`trusted` label, and re-run `hivelore eval --regression-gate`.

Since 0.66 an auto-validated memory (`validated_by: auto`) without reproduced/tested evidence is labelled `low` so agents can see nobody reviewed it (field report #12 §4.5). The first version of that change also lowered its ranking score (confidenceScore 3 → 1) and the authored eval regressed 96 → 95: reviewed-but-less-relevant memories outranked the relevant one. `get-briefing.ts` now scores `low` + validated like `trusted`. The label still gates the anchored anti-pattern block (precommit-check `highConfidence`), on purpose: an unreviewed semantic match should not hard-block; deterministic sensors are unaffected.
