---
id: 2026-06-08-decision-sensors-seed-not-autogen-propose-sensor-sole-writer
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/sensor-suggest.ts
    - packages/mcp/src/tools/mem-save.ts
    - packages/mcp/src/tools/mem-tried.ts
    - packages/cli/src/commands/memory-add.ts
    - packages/cli/src/commands/memory-tried.ts
  symbols: []
tags: []
created_at: '2026-06-08T13:24:41.336Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.297Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Decision Sensors Seed Not Autogen Propose Sensor Sole Writer

The heuristic sensor generator no longer writes live sensors. The agent-in-the-loop write paths (mem_save, mem_tried, CLI memory add/tried) stopped persisting `autogen:true` warn sensors onto frontmatter. Instead they expose a non-persisted **SensorSeed** (`suggestSensorSeed`) — a candidate `{pattern, absent?, message}` — plus `loop_open:true` and a directive to call `propose_sensor`. `propose_sensor` (which validates: not brittle, silent on current code, fires on the bad example) is now the **sole writer** of live sensors.

**Why:** regex-from-prose autogen was the most brittle subsystem (inverted sensors, degenerate patterns, dead sensors). Heuristics can't guarantee a sensor discriminates faulty from correct usage; only the validate-on-real-code path can. Making the heuristic a *seed* keeps its useful signal (a starting pattern for the agent) without ever trusting it as a guardrail.

**How to apply:** to add a guardrail, call `propose_sensor` (pre-fill from `proposed_sensor_seed` when present). `suggestSensorFromMemory` is retained as a deprecated warn-sensor wrapper ONLY for back-compat and the scanner-ingestion draft path (findings.ts), where the sensor lands on a human-reviewed `proposed` draft and can never hard-block. The bootstrap `sensor-coverage` gap already names propose_sensor as its fix, so not auto-writing makes the gate the forcing function automatically. Legacy `autogen:true` sensors still run as warn (never block). See [[2026-06-07-decision-first-agent-bootstrap-gate]].
