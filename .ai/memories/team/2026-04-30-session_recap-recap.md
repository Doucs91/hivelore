---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/sensors.ts
    - packages/cli/src/commands/dashboard.ts
    - packages/core/src/usage.ts
    - packages/core/src/impact.ts
    - packages/core/src/dashboard.ts
    - packages/cli/test/cli.test.ts
    - packages/core/test/impact.test.ts
    - CHANGELOG.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-02T20:35:11.200Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 23
requires_human_approval: false
---
## Goal
Implement the two remaining hardening items before any new feature: a commit-msg hook that PREVENTS the skip-ci footgun, and the first real OUTCOME metric (prevention events), not just retrieval.

## Accomplished
Shipped v0.13.8 (CI-green, enforce finish 100%):
- commit-msg hook + `haive enforce commit-msg <file>`: blocks a CI-skip directive in a commit message when the commit changes shippable code; allows .ai-only sync commits; ignores # comment lines. Installed by `haive enforce install`. Preventive counterpart to 0.13.7's post-hoc detection.
- Outcome measurement: usage.prevented_count/last_prevented_at; `haive sensors check` records a prevention event (debounced 5 min) when a sensor fires on a real diff; computeImpact folds it in as a top-tier signal (3 catches reach 'high' alone); `haive dashboard` shows a Prevention section.
- Tests: core 188 (recordPrevention debounce, impact prevented signal), cli 61 (commit-msg block/allow/comment/ai-only; end-to-end sensors check -> prevented_count -> dashboard).

## Discoveries & surprises
- Fix A (0.13.7) re-validated under a new edge: the pre-commit repair modifies .ai/code-map.json + project-context.md, which become 'changed files', pulling in decisions anchored to them (e.g. git-sync-protocol). The CLI briefing must include those .ai files — and the gate's fix hint now lists them, so running the exact suggested command unblocks (12/13 -> 13/13). Lesson: when filtering files for a coverage briefing, do NOT pre-filter .ai/ — the repair can make them changed.
- prevented_count lives in usage.json (telemetry, excluded from atomic staging by fix B), so recording catches does not churn memory frontmatter files.
- Sensor prevention is the cleanest computational OUTCOME proxy (regex fired on added diff lines). anti-pattern/semantic prevention recording is a possible follow-up.

## Files touched
- `packages/cli/src/commands/enforce.ts`
- `packages/cli/src/commands/sensors.ts`
- `packages/cli/src/commands/dashboard.ts`
- `packages/core/src/usage.ts`
- `packages/core/src/impact.ts`
- `packages/core/src/dashboard.ts`
- `packages/cli/test/cli.test.ts`
- `packages/core/test/impact.test.ts`
- `CHANGELOG.md`

## Next steps
Possible follow-ups (all enhancements to existing): record prevention from the anti-pattern/pre_commit_check path too (semantic catches), surface prevention trend over time in the VS Code cockpit, and a defect-recurrence metric (a gotcha re-introduced after capture).
