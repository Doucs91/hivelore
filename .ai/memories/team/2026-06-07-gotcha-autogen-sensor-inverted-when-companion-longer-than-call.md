---
id: 2026-06-07-gotcha-autogen-sensor-inverted-when-companion-longer-than-call
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/core/src/sensor-suggest.ts
  symbols:
    - suggestSensorFromMemory
    - pickDistinctiveToken
    - pickRequiredCompanion
sensor:
  kind: regex
  pattern: 'pattern\s*:\s*["'']?idempotencyKey["'']?'
  paths:
    - packages/core/src/sensor-suggest.ts
  message: >-
    Auto-generated "X without Y" sensors were INVERTED when the companion token
    outscored the call
  severity: warn
  autogen: true
  last_fired: null
tags:
  - sensors
  - quality
  - autogen
  - bug
created_at: '2026-06-07T18:50:19.712Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## Auto-generated "X without Y" sensors were INVERTED when the companion token outscored the call

**Reproduced v0.29.0 (dogfooding).** `mem_tried --what "calling createOrder without idempotencyKey"` produced a sensor with `pattern: idempotencyKey` and message "Avoid idempotencyKey; always pass idempotencyKey" — it fired on the **correct** line (idempotencyKey present) and stayed silent on the faulty call. Exactly inverted from the feature promise (commit 7748d76 "fire on the faulty call").

**Root cause** (`sensor-suggest.ts`): the discriminating branch did `trigger = pickDistinctiveToken(negativeText)`, which picks the single highest-scoring token across the whole text. Score ≈ token length, so when the required companion Y (`idempotencyKey`, 14 chars) is longer than the call X (`createOrder`, 11 chars), `trigger` came back = Y. The equality guard `trigger !== required` then bailed out of the companion branch, and the fallback `token = pickDistinctiveToken(negativeText)` re-picked Y → `pattern = Y`. The existing test passed only because its trigger (`stripe.paymentIntents.create`, 28 chars) happened to be longer than the companion — masking the bug.

**Fix:** pick the trigger and the fallback token EXCLUDING the required companion (`pickDistinctiveToken(text, [required])`). An un-isolable "X without Y" now returns null instead of an inverted sensor.

**Second latent bug uncovered while fixing:** `pickRequiredCompanion` treated `\bno\s+X` as a required-missing signal. But "No BigInt" (a title) means *avoid* BigInt, not "BigInt is required". Once the exclusion fix removed the masking bailout, this produced "JSON without BigInt". Removed the `\bno\s+X` pattern — it is irreducibly ambiguous; the unambiguous forms (without / missing / forgot / must-pass X) stay.

**Third (cosmetic) bug:** the tool's own name `hAIve` leaked into a sensor pattern because `mem_save` appends a `## Why\nRecorded in hAIve …` provenance section and the generator scanned it. Added `haive` to `SENSOR_STOPWORDS`.

Regression-guarded by 3 new cases in `core/test/sensor-suggest.test.ts` (longer-companion, hAIve-boilerplate, No-X-title). Related: [[2026-06-06-decision-harness-quality-batch-v0270]], [[2026-06-03-gotcha-regex-sensors-orphaned-from-precommit-gate]].
