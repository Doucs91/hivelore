---
id: 2026-07-02-decision-command-sensors-behaviour-bridge
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/utils/command-sensors.ts
    - packages/mcp/src/tools/propose-sensor.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags:
  - sensors
  - behaviour
  - oracle
  - gate
  - v0.33.0
created_at: '2026-07-02T23:10:09.106Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Command sensors (v0.33.0) — the behaviour bridge and its honesty rules

**What:** a sensor can be `kind: shell|test` with a `command` (+ optional `timeout_ms`): the gate executes it when the diff touches the sensor's paths; non-zero exit fires the lesson at the sensor's severity. Hivelore never invents the oracle — it routes the team's existing test/invariant script to the lesson it protects.

**Non-negotiable rules encoded in code:**
1. **failed ≠ unrunnable.** Exit 127/126/ENOENT/timeout = `unrunnable` → `command-sensor-unrunnable` warn finding, NEVER a block. A broken harness must not masquerade as a failing test. Only a command that RAN and exited non-zero enforces severity.
2. **Validation = the oracle must PASS on the presumed-correct current tree** (`fails-on-current` rejection for block proposals). This is the behaviour analogue of the regex "silent on current". Caveat vs regex: validation runs on the WORKING TREE, not HEAD — running real test commands in a bare `git worktree` fails (no node_modules), so the HEAD-baseline trick doesn't transfer; the guidance tells the author to revert the faulty diff first.
3. **Opt-in per repo only** (`enforcement.runCommandSensors: true`) — executes repo-authored commands; Hivelore never enables it globally.
4. Executor is shared (`cli/utils/command-sensors.ts`); MCP propose-sensor has a minimal mirror (dependency direction cli→mcp forbids importing the full one). Sequential execution (specs may share ports/DBs).
5. Findings carry exit code, duration, and a 15-line output tail so the agent sees WHICH assertion broke without re-running.

**Deliberately NOT built:** test generation, sandbox runner, LLM-as-judge — the oracle problem stays with the team's test suite. README three-harness: Behaviour ⛔ → 🟡 Bridged.
