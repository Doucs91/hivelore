---
id: 2026-06-09-gotcha-sensors-check-self-match-on-ai-files
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/core/src/sensors.ts
    - packages/cli/src/commands/sensors.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags:
  - sensors
  - false-positive
  - enforcement
  - self-match
created_at: '2026-06-09T17:54:15.769Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.298Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Standalone `sensors check` self-matched on staged `.ai/` files (FIXED v0.29.11)

The git-hook gate (`enforce.ts → runSensorGate`) already excluded `.ai/`/hAIve-owned paths
(see [[2026-06-03-gotcha-regex-sensors-orphaned-from-precommit-gate]]), but the standalone
`haive sensors check` CLI did **not**. It called `sensorTargetsFromDiff(diff)` with no path filter,
so staging an `.ai/memories/*.md` file (whose body literally quotes the bad pattern it documents,
e.g. `prisma.$disconnect()`) made the sensor fire on its own memory — a false positive.

**Fix:** the scannable-path guard is now centralized in `core/sensors.ts` as `isSensorScannablePath`,
`HAIVE_OWNED_FILES`, and `scannableSensorTargets(diff)`. Both `sensors.ts` and `enforce.ts` import it
(enforce.ts dropped its local copy), so the gate and the standalone command can never drift on what
counts as scannable code. `scannableSensorTargets` keeps the whole-diff blob fallback ONLY when the
diff has no file headers at all (raw `--diff-file`), never when every header was a hAIve-owned path.

**Lesson:** any new diff-scanning entry point MUST filter through `scannableSensorTargets` /
`isSensorScannablePath` — there are now three diff scanners (gate, CLI, MCP anti-pattern check) and a
fourth would silently reintroduce the self-match.
