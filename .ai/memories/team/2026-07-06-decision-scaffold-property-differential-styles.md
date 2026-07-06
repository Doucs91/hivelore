---
id: 2026-07-06-decision-scaffold-property-differential-styles
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
  - property-based
  - differential
  - oracle
  - behaviour
  - v0.48.0
created_at: '2026-07-06T21:14:24.666Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Scaffold Property Differential Styles

**What (v0.48.0):** `sensors scaffold` / `scaffold_test` gained a `--style` axis to lower the cost of EXPRESSING the invariant (the oracle-creation bottleneck the behaviour harness leaves to the human):
- `example` (default, unchanged) — one input → expected output.
- `property` — a fast-check (JS/TS) / Hypothesis (pytest) skeleton: state the invariant ONCE, checked over many generated inputs. Names the subject symbol from `--red-ref` hints and embeds the lesson's `instead` text as the invariant comment.
- `differential` — requires `--reference <import>`: assert the subject AGREES with a reference implementation for all inputs; NO invariant to state at all (the oracle is redundancy). Emits `import { <sym> as reference } from "<reference>"` + an fc property comparing them.

**Why / invariants:**
- These are the two deterministic ways to shrink oracle-creation cost that DON'T need an LLM: reduce to a property (weaker but one-line) or to differential redundancy. Chosen over LLM assertion generation (the self-grading trap, forbidden).
- Every style stays a **pending, fully-commented** stub (`it.todo`/`@pytest.mark.skip`, no live `import fc` / reference import) so `hasPendingTestMarker` holds and the suite stays green until the human fills it. Arming is unchanged — once written, propose_sensor validates GREEN-on-current + prove-RED exactly as for `example`.
- Pure core: `ScaffoldStyle`, `normalizeScaffoldStyle`, and per-language `propertyLines`/`differentialLines`/`bodyLines` in test-scaffold.ts; CLI/MCP only parse the flag + validate `differential` needs a reference. Go emits a gopter hint (property-based testing is niche there). Builds on [[2026-07-06-decision-scaffold-red-ref-oracle-assist]].
