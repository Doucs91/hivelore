---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/sensors.ts
    - packages/core/test/sensors.test.ts
    - packages/cli/src/commands/sensors.ts
    - packages/cli/src/commands/enforce.ts
    - STABILITY.md
    - CONTRIBUTING.md
    - README.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.271Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 40
requires_human_approval: false
validated_by: null
---
## Goal
Audit hAIve, raise it toward 1.0 maturity: freeze the stable core, harden peripheral paths, document the behaviour harness as out-of-scope, reduce bus-factor. Behaviour harness implementation deferred to future.

## Accomplished
- Centralized the sensor scannable-path guard in core/sensors.ts (isSensorScannablePath, HAIVE_OWNED_FILES, scannableSensorTargets); enforce.ts now imports it (dropped local copy).
- Fixed `sensors check` self-match on staged .ai/ files (false positive).
- `enforce check --stage local` now emits `antipattern-gate-deferred` so a bare preview no longer reads as a passed sensor gate.
- +8 core tests (666 total green), typecheck/build/artifacts clean.
- Added STABILITY.md (frozen 1.0 surface vs experimental), CONTRIBUTING.md (build/test/release + how to extend), README "Scope & boundaries — three harnesses" + "Try it on your repo".
- Released v0.29.11: bumped 4 packages in lockstep, committed on main, tag pushed, all 5 GitHub Actions green, enforce finish passed.

## Discoveries & surprises
- Two real frictions confirmed by E2E testing: (1) standalone `sensors check` lacked the .ai/ self-match guard the gate already had — captured as 2026-06-09-gotcha-sensors-check-self-match-on-ai-files; (2) `enforce check` defaults to --stage local which SKIPS the anti-pattern+sensor diff scan, so a manual preview misleadingly reads as "passed". Both fixed.
- The scannable-path guard now exists in 3 diff scanners (gate, CLI, MCP anti-pattern); any 4th entry point must reuse scannableSensorTargets or it silently reintroduces self-match.
- Point 2 (external third-party adoption) and the behaviour harness are NOT code-implementable now: adoption needs real users (added a "Try it on your repo" enabler instead); behaviour harness deferred by user decision.

## Files touched
- `packages/core/src/sensors.ts`
- `packages/core/test/sensors.test.ts`
- `packages/cli/src/commands/sensors.ts`
- `packages/cli/src/commands/enforce.ts`
- `STABILITY.md`
- `CONTRIBUTING.md`
- `README.md`

## Next steps
- Behaviour harness: design the opt-in command/test sensor lane (enforcement.runCommandSensors is scaffolded) as the bridge toward functional-correctness feedback.
- Consider aligning the MCP anti-pattern check's isHaiveOwnedPath with the new core helper to fully dedupe (left untouched this session to limit blast radius).
- The new gotcha memory has a proposed_sensor_seed; refine + propose_sensor if worth enforcing.
