---
id: 2026-06-02-decision-ci-decision-coverage-local-marker
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - .github/workflows/haive-enforcement.yml
  symbols: []
tags:
  - ci
  - enforcement
  - decision-coverage
created_at: '2026-06-02T03:20:00.000Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.285Z'
stale_reason: null
related_ids:
  - 2026-05-31-gotcha-enforcement-is-process-not-violation
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# CI Decision Coverage Cannot Require Local Briefing Markers

`haive enforce ci` runs on GitHub Actions after push. The agent's `.ai/.runtime/enforcement/briefings` marker is local runtime state and is not committed, so CI must not fail merely because `readRecentBriefingMarker` returns nothing.

Decision: local, pre-commit, and pre-push gates can require the real briefing marker. CI reconstructs coverage from the committed base/head diff and surfaces the matched anchored policies as `decision-coverage-ci-pass`; deterministic checks such as stale anchors and anti-patterns still block.

Regression that exposed this: release `0.12.2` passed local `enforce finish`, but the `haive-enforcement` GitHub Actions job failed with `decision-coverage-missing` for all relevant policies because the runner had no local marker.
