---
id: >-
  2026-06-08-decision-semantic-gate-false-positive-reduction-sensorless-review-tes
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/precommit-check.ts
    - packages/mcp/src/tools/anti-patterns-check.ts
  symbols: []
tags: []
created_at: '2026-06-08T21:32:20.996Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.296Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Semantic Gate False Positive Reduction Sensorless Review Tes

Reduced anti-pattern gate false positives (the class that hard-blocked the v0.29.9 release on a clean edit to a file a sensor-less gotcha was anchored to). Three changes in the MCP anti-pattern layer:

1. **Sensor-less anchored gotchas no longer hard-block on fuzzy relevance.** In `classifyWarning` (precommit-check.ts), the anchored gate now downgrades a sensor-less anti-pattern (matched only by anchor + distinctive token / moderate semantic < 0.75) to **review**, not blocking. Rationale: anchor + a shared distinctive token proves you are EDITING the documented file with related terms — not that you reintroduced the mistake (the token can be the gotcha's SUBJECT used correctly, e.g. the "serializeMemory crashes on undefined" gotcha says *always use serializeMemory()*). Deterministic hard-blocking now requires a **sensor** (or a strong semantic match ≥ 0.75). To make a gotcha block reliably, give it a sensor via `propose_sensor`. Sensor-bearing gotchas are unaffected (fired → block; not-fired → review veto).

2. **Test-file hunks are stripped from the scan diff** (`stripTestHunks`, anti-patterns-check.ts), like `.ai/` hunks already are. Tests deliberately reference the symbols/patterns gotchas describe (`expect(serializeMemory(x))`, `import lodash` in a "no lodash" test), so letting test edits corroborate a literal/semantic match was a recurring false positive.

3. **The semantic query embeds ADDED lines** (`addedLinesFromDiff(scanDiff)`), not the raw diff — consistent with the literal + sensor layers; the raw diff's context/removed lines/headers blurred the query.

**Why:** the deep root cause of the false positives was hard-blocking on probabilistic relevance signals without a deterministic check. This aligns the gate with the project's stance (sensors = the trusted hard-block layer) and with [[2026-06-08-decision-validated-by-provenance-human-agent-auto]] / [[2026-06-07-decision-first-agent-bootstrap-gate]] (propose_sensor is the path to a reliable block). **Tradeoff:** a clean anchored violation without a sensor (e.g. `import lodash` where a sensor-less gotcha forbids it) now surfaces as REVIEW, not a hard block — add a sensor to restore deterministic blocking. Validated by reproducing the real gate (`HAIVE_BASE_SHA`/`HAIVE_HEAD_SHA` + `enforce ci`) on the previously-blocking diff: 55% → 100%.
