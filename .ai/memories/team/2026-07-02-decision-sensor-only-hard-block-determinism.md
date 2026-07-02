---
id: 2026-07-02-decision-sensor-only-hard-block-determinism
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/precommit-check.ts
    - packages/mcp/src/tools/anti-patterns-check.ts
  symbols: []
tags:
  - enforcement
  - sensors
  - determinism
  - gate
  - semantic
  - false-positive
created_at: '2026-07-02T05:59:16.795Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Only a validated sensor hard-blocks — semantic ≥ 0.75 demoted to review (v0.29.13)

**Decision:** `classifyWarning` never returns `blocking` for a sensor-less memory. The single hard-block path is a fired block-severity sensor. Strong semantic matches (≥ 0.75), anchored + distinctive-literal matches — all surface as `review` with a `propose_sensor` nudge. `isHardBlockCatch` (prevention metric) mirrors this: sensor-only.

**Why (lived evidence):** the v0.29.12 release commit passed the local pre-commit gate at 95% and hard-blocked on GitHub Actions at 50% with the SAME diff and corpus. Diagnosis: `enforce ci` had no committed embeddings index but one was (re)built on the runner with a freshly downloaded model; cosine scores shifted a few hundredths and one sensor-less gotcha crossed the 0.75 bar on CI only. Cosine similarity is environment-dependent (model download version, ONNX runtime, Node version, warmup) — see the corpus notes on "warmup-sensitive semantic score". A gate that answers differently per machine is worse than a weaker gate: it trains agents and humans to `--no-verify` past it.

**Supersedes the ≥ 0.75 escape hatch kept in [[2026-06-08-decision-semantic-gate-false-positive-reduction-sensorless-review-tes]]** — that decision moved anchored sensor-less matches to review but kept strong-semantic blocking; v0.29.13 removes it. Direction of travel across releases: 0.29.9 → 0.29.10 (sensor veto) → 0.29.13 (sensor-only). Deterministic feedback is hAIve's core promise; the lesson→sensor loop (`mem_tried` → `propose_sensor`) is the sanctioned way to make any lesson block.

**Debuggability rule that came with it:** `precommit-policy-block` findings must NAME the blocking memory ids + reasons — the v0.29.12 CI failure was undebuggable from the log without them.
