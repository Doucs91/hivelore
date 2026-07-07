---
id: 2026-07-07-decision-behaviour-honesty-inverted-sensor-guard
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/propose-sensor.ts
    - packages/core/src/sensors.ts
    - packages/core/src/sensor-suggest.ts
    - packages/cli/src/commands/doctor.ts
  symbols: []
tags: []
created_at: '2026-07-07T12:47:13.322Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Behaviour Honesty Inverted Sensor Guard

Four behaviour-branch hardening fixes (post-v0.51.0). The non-obvious choices future agents must not re-litigate:

1. **prove-RED: a crash is not a RED.** `proveRedOnIncident` now runs the red_ref failure output through `isHarnessErrorOutput` (core, pure: matches "Cannot find module"/ERR_MODULE_NOT_FOUND/SyntaxError/no-tests-found/collected-0/ImportError/go-no-files). A match → `red-unrunnable` (proves nothing), not `red_proven`. **Why the narrow classification was the bug:** `runCommandForValidation` only flagged 127/126/ENOENT/timeout as unrunnable, so a `node t.js` exiting 1 for a missing module at the pre-fix ref (where the guarded code/test often doesn't exist yet) was recorded `red_proven: true` — a fabricated guarantee. Reproduced: red-ref at a commit lacking refund.js/the test → false red_proven.
2. **Risk asymmetry — apply the harness-error net ONLY at prove-RED, NEVER the gate executor** (`cli/utils/command-sensors.ts` unchanged). At prove-RED, over-classifying as unrunnable is SAFE (you fail to claim proof — conservative). At the gate, it would demote a real `block` to a warn (a false negative — misses a repeat). Do not "unify" the two classifiers.
3. **Inverted-sensor guard.** `SensorSelfCheck.fires_on_correct` + `extractCorrectApproachExamples` (the `**Instead, use:**` snippet). `judgeProposedSensor` rejects a `block` whose pattern fires on the recommended fix (`fires-on-correct`), before the weaker missed-bad-example check. Wired in propose_sensor (regex path), CLI `sensors propose` (its own judge call, NOT the mcp one — ast/shell/test delegate to mcp, regex is local at ~L582), and `sensors promote`. Flagship moment→date-fns unaffected.
4. **Seed never suggests the recommended tool.** `suggestSensorSeed` excludes `recommendedTokens(body)` (from the Instead clause) on the fallback/assignment/lowercase picks — but NOT the "X without Y" companion trigger, because the recommendation sentence ("always pass Y to X") legitimately names the faulty call X (the createOrder regression test proves this). When exclusion leaves no faulty token, the seed is honestly null.
5. **doctor behaviour-coverage never vanishes when oracles exist.** Return `[]` only when `mainAreas===0 && totalOracles===0`; else report armed/red-proven counts (a single-package `src/` under MIN_COMPONENT_FILES=3 derives 0 areas). Guard the coverage_percent divide-by-zero.

Chains with [[2026-07-04-decision-prove-red-and-env-scrub-phase4]] (rule 2: unrunnable≠proof — this fixes the too-narrow classification behind it), [[2026-07-02-decision-command-sensors-behaviour-bridge]], [[2026-06-08-decision-sensors-seed-not-autogen-propose-sensor-sole-writer]], [[2026-07-06-decision-behaviour-coverage-metric]].
