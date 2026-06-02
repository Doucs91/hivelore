---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/prevention.ts
    - packages/core/src/index.ts
    - packages/core/src/dashboard.ts
    - packages/cli/src/commands/dashboard.ts
    - packages/cli/src/commands/sensors.ts
    - packages/mcp/src/tools/anti-patterns-check.ts
    - packages/core/test/prevention.test.ts
    - packages/cli/test/cli.test.ts
    - CHANGELOG.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-02T21:06:40.616Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 24
requires_human_approval: false
---
## Goal
Complete the outcome-measurement story: record prevention from the anti-pattern path (not just regex sensors), add a prevention trend over time, and a recurrence metric (lessons re-introduced after capture).

## Accomplished
Shipped v0.13.9 (CI-green, enforce finish 100%):
- anti_patterns_check (MCP, used by the pre-commit gate) now records a prevention event for STRONG diff-corroborated matches (fired sensor / distinctive_literal / anchor+literal); weak semantic-only matches stay advisory and are not counted.
- New pure core/prevention.ts: appendPreventionEvent / loadPreventionEvents + computePreventionTrend + computeRecurrence. Event log lives in .ai/.cache/prevention-log.jsonl (gitignored telemetry).
- sensors check also appends to the event log.
- dashboard shows a Prevention trend (last 7d/30d + weekly sparkline) and a Recurrence section (lessons caught on >= 2 distinct days = re-introduced after capture). buildDashboard stays pure (events via options).
- Tests: core 192 (+4 prevention pure fns), cli 61 (dashboard trend assertion), mcp 112 (anti-patterns unchanged).

## Discoveries & surprises
- noUncheckedIndexedAccess: weekly[idx] += 1 fails DTS build; use weekly[idx] = (weekly[idx] ?? 0) + 1.
- Recurrence is defined as catches on >= 2 distinct UTC days (not raw count) so multiple catches of the same diff in one session don't look like recurrence — complements the 5-min debounce on the counter.
- Honest scoping: only strong/diff-corroborated anti-pattern matches count as prevention; weak semantic matches are review noise, not catches. Keeps the outcome metric trustworthy.
- The prevention log is gitignored (.ai/.cache), so it never churns a release or triggers the sync-tip — and buildDashboard stays pure by taking events through options rather than reading disk.

## Files touched
- `packages/core/src/prevention.ts`
- `packages/core/src/index.ts`
- `packages/core/src/dashboard.ts`
- `packages/cli/src/commands/dashboard.ts`
- `packages/cli/src/commands/sensors.ts`
- `packages/mcp/src/tools/anti-patterns-check.ts`
- `packages/core/test/prevention.test.ts`
- `packages/cli/test/cli.test.ts`
- `CHANGELOG.md`

## Next steps
Outcome measurement is now end-to-end (sensor + anti-pattern catches, counter + event log, impact + dashboard trend + recurrence). Possible future: surface the prevention trend/recurrence in the VS Code cockpit; a periodic digest of recurring lessons; correlate recurrence with whether a stronger fix (lint rule) was added.
