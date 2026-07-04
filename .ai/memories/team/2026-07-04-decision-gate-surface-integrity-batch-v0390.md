---
id: 2026-07-04-decision-gate-surface-integrity-batch-v0390
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/sensors.ts
    - packages/core/src/test-scaffold.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/utils/post-incident-scan.ts
    - packages/mcp/src/tools/mem-tried.ts
    - packages/mcp/src/tools/scaffold-test.ts
  symbols: []
tags:
  - sensors
  - enforcement
  - gate
  - behaviour
  - v0.39.0
created_at: '2026-07-04T03:02:46.054Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Gate-surface integrity batch (v0.39.0) — the non-obvious choices

Six hardening steps from the 2026-07-03 full harness audit. The choices future agents must not re-litigate:

1. **`sensor-weakened` is REVIEW-only (warn), never a block, and runs even when `antiPatternGate=off`.** Blocking would make legitimate demotions (the fix messages themselves say "demote it") impossible without --no-verify, and the check guards the ENFORCEMENT SURFACE, not anti-patterns — so it is computed from the diff snapshot BEFORE the gate-off early return in `runPrecommitPolicy`. Direction of asymmetry matters: ADDING/CHANGING `absent` broadens suppression (weakening, flags); REMOVING `absent` tightens the sensor (never flags). Additions of new sensors never flag.
2. **`post-incident-test-unarmed` has impact 0** — pure nudge at doctor + `enforce finish`; it must never move the score or block. The collector only scans directories named `incidents/` (the generator's fixed shape) and matches the provenance marker `SCAFFOLD_MARKER_RE`; a custom `--out` scaffold outside such a dir is deliberately out of scope. "Armed" means shell/test sensor — a regex sensor does NOT close a behaviour loop.
3. **Multi-package scaffolds share ONE propose command** because a memory carries a single `sensor` block — there is no per-package sensor. Implementation: pass 1 renders per-group scaffolds to collect run commands, pass 2 re-renders with `proposeCommandOverride` = `buildProposeCommand(lesson, "run1 && run2")` so every file header shows the SHARED arming command (a per-file propose line would arm a sensor covering only one package). An explicit `out_path` pins the first group (single file).
4. **`mem_tried` with a one-shot sensor defaults `scope` to team** (schema `scope` became `.optional()`; the handler computes `input.scope ?? (input.sensor ? "team" : "personal")`). Rationale: a sensor on a personal (gitignored) memory guards only the capturing machine. Explicit scope always wins; the CLI `--scope` commander default was removed so undefined can flow through.
5. **`runSensorGate` fail-visible**: the top-level catch now returns a `sensor-gate-errored` warn finding instead of `[]` — a silent catch turned off ALL sensor protection with zero signal (fail-open). Still never blocks on harness breakage (same doctrine as unrunnable ≠ failed).
6. **Score explanation**: `enforcement-score-below-threshold` appends `top penalties: code (−N), …` computed from effective findings' impact (error default 25, warn default 8) — mirrors `buildScore`, keep the two in sync if defaults change.
