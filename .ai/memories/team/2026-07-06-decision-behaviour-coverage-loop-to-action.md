---
id: 2026-07-06-decision-behaviour-coverage-loop-to-action
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/behaviour-coverage.ts
    - packages/cli/src/commands/doctor.ts
  symbols: []
tags:
  - behaviour
  - coverage
  - doctor
  - scaffold
  - loop
  - v0.47.0
created_at: '2026-07-06T16:39:44.711Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Behaviour Coverage Loop To Action

**What (v0.47.0):** doctor's `behaviour-coverage` finding now closes the loop measure→action — for each UNCOVERED area it prints the exact next command, not just a count.

- `assessBehaviourCoverage` gained `uncoveredAreaSuggestions: { area, candidateLessonId? }[]`. For each uncovered area it finds a scaffoldable lesson = an anchored (validated/proposed) `attempt`/`gotcha` that is NOT already a shell/test oracle; prefers `attempt` (incident-shaped → has a natural red_ref), then most recent.
- doctor's `fix` becomes concrete per area: with a lesson → `hivelore sensors scaffold <id> --red-ref <pre-fix-commit>   # guard <area>`; without → `hivelore memory tried --paths <area>/ …   # then scaffold`. These render in doctor's "Suggested commands" section (built by `nextActions` from every finding's `fix`).

**Gotcha for future edits of a doctor `fix`:** the default doctor view does NOT print a finding's `fix` inline (only `doctor --fix` does, as `$ <line>`). Instead `nextActions` splits every finding's `fix` on `\n`, dedupes, and the caller shows the top 5 as "Suggested commands" — and a line is prefixed `$` only if it matches `/^(hivelore|haive|git|npm|pnpm|npx|node|gh|rm|code|cd)\b/` from column 0. So a multi-line `fix` must be **bare command lines with no leading indentation and no prose intro** (a leading-space or prose line renders behind `→` and reads wrong). Chains with [[2026-07-06-decision-behaviour-coverage-metric]] and [[2026-07-06-decision-scaffold-red-ref-oracle-assist]].
