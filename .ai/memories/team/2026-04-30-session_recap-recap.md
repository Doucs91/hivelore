---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/prevention.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/sensors.ts
    - packages/cli/src/commands/eval.ts
    - packages/cli/src/commands/memory-tried.ts
    - packages/mcp/src/tools/anti-patterns-check.ts
    - packages/mcp/src/tools/mem-tried.ts
    - packages/core/test/prevention-recorder.test.ts
    - packages/mcp/test/mem-tried.test.ts
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-04T15:16:07.868Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 33
requires_human_approval: false
---
## Goal
Perfect hAIve's existing harness loop (capture→brief→block→measure) before adding anything new, driven by a code-verified harness-engineering audit that found the headline "measure" leg leaked in the installed gate.

## Accomplished
- Shipped v0.22.0 (core/cli/mcp/embeddings lockstep; tag pushed; CI + sonarqube green; enforce finish 100%).
- core: new `recordPreventionHits` — THE single prevention recorder; gate + `sensors check` + anti-pattern MCP all funnel through it (debounced).
- enforce: `runSensorGate` now records prevention for regex AND command sensors firing in the git-hook gate; shell/test command sensors run in-gate behind `enforcement.runCommandSensors`.
- mcp: `mem_tried` returns `sensor_generated` + a hint when the ratchet stays open (no paths / no token).
- cli: `haive eval` reports case provenance (synthesized vs authored) and warns when the score is purely self-referential.
- tests: prevention-recorder e2e regression guard + mem_tried ratchet-visibility. core 326 / mcp 126 / cli 67 green.
- docs: reconciled positioning + gotcha memories (the "ratchet fully wired" claim was half-true).

## Discoveries & surprises
- THE key finding: the installed git-hook gate recorded prevention only for ANTI-PATTERN catches (preCommitCheck→antiPatternsCheck recorded), NOT for regex/command SENSOR catches — runSensorGate blocked but never called appendPreventionEvent/recordPrevention. The earlier team memory claiming the ratchet was "fully wired (mem_tried→sensor→fires→appendPreventionEvent→impact)" was half-true. Lesson: verify a "verified" claim by tracing the INSTALLED path, not the component in isolation.
- Real-world confirmation during commit: the new runSensorGate fired the `typescript-no-any` sensor on the `: any` literal inside the new test file (warn, non-blocking) — proving the gate now both fires AND records.
- shell/test command sensors were already executable in `sensors check` but filtered out of the gate (kind===regex only).
- `haive eval --spec <file>` already supports independent ground-truth (no synthesis); the gap was transparency, not capability.
- P2-7 (dashboard gate precision) and several backlog items (failure-capture gate, eval trend, merge driver) were already done — re-verified rather than re-built.

## Files touched
- `packages/core/src/prevention.ts`
- `packages/cli/src/commands/enforce.ts`
- `packages/cli/src/commands/sensors.ts`
- `packages/cli/src/commands/eval.ts`
- `packages/cli/src/commands/memory-tried.ts`
- `packages/mcp/src/tools/anti-patterns-check.ts`
- `packages/mcp/src/tools/mem-tried.ts`
- `packages/core/test/prevention-recorder.test.ts`
- `packages/mcp/test/mem-tried.test.ts`

## Next steps
Remaining backlog (still open): D/P1-3 coverage-gap detection broadened to usage-log hot files; E/P2-5 conflict-candidates guided supersede into topic-upsert. Optional: consider auto-applying (not just surfacing) the antiPatternGate tuning suggestion behind a config flag. Human: npm publish v0.22.0 when ready (agents never publish).
