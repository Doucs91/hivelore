---
id: 2026-07-06-decision-scaffold-red-ref-oracle-assist
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/test-scaffold.ts
    - packages/cli/src/commands/sensors.ts
    - packages/mcp/src/tools/scaffold-test.ts
  symbols: []
tags:
  - scaffold
  - behaviour
  - red-ref
  - oracle
  - v0.46.0
created_at: '2026-07-06T16:20:27.931Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Scaffold Red Ref Oracle Assist

**What (v0.46.0):** `sensors scaffold` and the `scaffold_test` MCP tool gained an optional `--red-ref` / `red_ref`. When given the pre-fix incident commit, the scaffold names the symbols the fix (`red_ref..HEAD`, scoped to the lesson's anchors) actually touched and pre-fills the commented example around them (`import { refund } …`, `expect(refund(/* incident input */)).toBe(/* post-fix expected */)`) instead of the generic `subjectUnderTest()`. Turns the "fill the assertion" step from a blank page into a targeted edit.

**Determinism & green-suite invariants (why it's honest, not an LLM):**
- Symbol extraction is a pure core function `incidentHintsFromDiff(diff)`. It tracks the ENCLOSING container definition (function/class/def/func) from context AND added lines and marks it "touched" when its hunk has any change — so it names a function whose BODY changed even though the signature line is unchanged context (the common fix shape, and the case a naive "added-definition-lines" scan gets wrong: it would surface an incidental new const instead). const/let/var additions rank second.
- The enriched example STAYS COMMENTED — no live import that might not resolve — so `hasPendingTestMarker` still holds and the suite stays green until the human writes the assertion. `propose_sensor` remains the sole validated arming path; the scaffold never arms anything.
- The git diff is I/O (CLI uses the module `exec`; MCP uses `execFile` with an argument array — no shell interpolation, per [[2026-07-05-convention-child-process-no-shell-interpolation]]). A bad/unknown ref or a diff with no definitions falls back to the generic template with a warning; it never aborts the scaffold.

Pairs with [[2026-07-06-decision-behaviour-coverage-metric]]: coverage measures the behaviour harness, this lowers the cost of filling it.
