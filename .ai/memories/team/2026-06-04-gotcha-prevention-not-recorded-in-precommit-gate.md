---
id: 2026-06-04-gotcha-prevention-not-recorded-in-precommit-gate
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/mcp/src/tools/precommit-check.ts
    - packages/core/src/prevention.ts
  symbols: []
sensor:
  kind: regex
  pattern: 'enforce\.ts\s*:\s*["'']?1131-1186["'']?'
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/mcp/src/tools/precommit-check.ts
    - packages/core/src/prevention.ts
  message: The prevention/impact "measure" leg leaks in the real enforcement path
  severity: warn
  autogen: true
  last_fired: null
tags: []
created_at: '2026-06-04T14:25:25.119Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.988Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: prevention-recording-gate-gap
revision_count: 0
requires_human_approval: false
validated_by: null
---
## The prevention/impact "measure" leg leaks in the real enforcement path

> ✅ **FIXED in v0.22.0.** Introduced `recordPreventionHits(paths, ids, source)` in `core/prevention.ts`
> — THE single recorder for every gate path. `runSensorGate` (`enforce.ts`) now records prevention for
> regex AND command sensors that fire in the installed git-hook gate (debounced, so it can't double-count
> with a prior `sensors check` / `anti_patterns_check` on the same diff). `sensors.ts` and
> `anti-patterns-check.ts` were refactored to funnel through the same recorder. Regression-guarded by
> `core/test/prevention-recorder.test.ts` (sensor fires on a known-bad diff → prevention event recorded).
> NOTE: the anti-pattern leg was actually fine even before the fix — `preCommitCheck` calls
> `antiPatternsCheck`, which already recorded; the real leak was the **regex/command sensor** path.

**Surprising, verified-in-code (2026-06-04, pre-fix):** the installed git-hook gate records ZERO prevention events for **sensor** catches. `appendPreventionEvent` / `recordPrevention` were called in EXACTLY two places:
- `packages/mcp/src/tools/anti-patterns-check.ts:~387-392` (standalone `anti_patterns_check` MCP tool, source `anti-pattern`)
- `packages/cli/src/commands/sensors.ts:~139-144` (standalone `haive sensors check` CLI, source `sensor`)

The real gate path is `git hook → haive enforce check → runPrecommitPolicy() → preCommitCheck() + runSensorGate()` (enforce.ts:1131-1186). Neither `preCommitCheck` (precommit-check.ts — grep confirms NO prevention refs) nor `runSensorGate` (enforce.ts:1215) calls `appendPreventionEvent`/`recordPrevention`. So when a regex/anti-pattern sensor BLOCKS a commit through the hook, the block happens but `prevented_count` never increments and no event is logged.

**Consequence:** the headline metric — `briefingProofLine` ("prevented N mistakes") and `impact` tiers — is undercounted in normal use. Prevention only accrues if an agent explicitly calls the `anti_patterns_check` MCP tool, or someone manually runs `haive sensors check`. The centerpiece demo ("blocked → prevention count goes up") does NOT happen through the default git-hook gate.

**This contradicts** `[[2026-06-02-architecture-harness-engineering-positioning-gaps]]` which asserts the ratchet is "real (mem_tried→auto-sensor→fires→appendPreventionEvent→impact)". The fire→appendPreventionEvent link is broken in the gate.

**Also:** shell/test command sensors execute ONLY in `haive sensors check` (sensors.ts:300, behind `--commands`/`runCommandSensors`), not in `runSensorGate` (which filters `kind === "regex"`, enforce.ts:1226).

**Fix shape (perfect existing before adding new):** record prevention inside the shared gate path (runSensorGate + preCommitCheck), debounced (PREVENTION_DEBOUNCE_MS already exists) so re-running the hook on the same diff can't inflate. Centralize so hook + MCP + CLI all funnel through one recorder.
