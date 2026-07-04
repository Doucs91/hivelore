---
id: 2026-07-04-decision-prove-red-and-env-scrub-phase4
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/propose-sensor.ts
    - packages/core/src/sensors.ts
    - packages/cli/src/utils/command-sensors.ts
    - packages/core/src/prevention.ts
  symbols: []
tags:
  - sensors
  - behaviour
  - oracle
  - security
  - excellence-plan
  - v0.39.3
created_at: '2026-07-04T21:31:09.583Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Phase 4 (excellence plan) — prove-RED + env scrubbing: the non-obvious choices

1. **RED replay runs in a `git worktree` with the main tree's `node_modules` symlinked in** (top-level only). This is the workaround for the documented reason the HEAD-baseline trick never transferred to command sensors (bare worktree = no deps). Nested workspace `packages/*/node_modules` are NOT symlinked — pnpm hoists enough for the common case; if a monorepo oracle needs nested modules, the replay reports `red-unrunnable`, which honestly proves nothing rather than blocking.
2. **`unrunnable` on the incident state is NOT proof of RED** (`red-unrunnable` rejection for block) — same honesty family as `unrunnable ≠ failed` at the gate. Only a command that RAN and exited non-zero on the incident proves the oracle catches it.
3. **`red_proven` lives on the sensor frontmatter** (committed team truth, like `incident`), never on the prevention log; the receipt derives it by memory lookup (`row.red_proven`), consistent with 2026-07-03-decision-sensor-incident-provenance-on-frontmatter.
4. **Env scrubbing is a pure core allowlist** (`scrubbedCommandEnv`): exact {PATH, HOME, LANG, TMPDIR/TMP/TEMP, TERM, SHELL, USER, LOGNAME, PWD, CI, COLORTERM, TZ} + prefixes {LC_, NODE_, NVM_, npm_, HIVELORE_, HAIVE_}. Both executors (cli gate executor AND the mcp validation mirror) spread it — if you add an env var a test runner legitimately needs, add it to the allowlist in core, do NOT re-widen an executor locally. Trap discovered while testing: HIVELORE_-prefixed test secrets are allowlisted by design, so containment tests must use a non-prefixed name.
5. **No quarantine exemption for red_proven** — sensor health tracking never consults frontmatter flags; proving RED once must not shield a later-flaky oracle. Deliberately no code path (and therefore no test hook) links red_proven to assessSensorHealth.
