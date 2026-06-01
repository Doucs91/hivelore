---
id: 2026-06-01-decision-phase2-sensors-continuation
scope: team
type: decision
status: validated
anchor:
  paths:
    - docs/PHASE-2-HANDOFF.md
    - packages/core/src/sensors.ts
  symbols: []
tags:
  - sensors
  - phase2
  - roadmap
  - handoff
  - core
created_at: '2026-06-01T12:57:53.591Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Phase 2 plan: memory sensors continuation

## Guidance
Next planned work after v0.10.3 (Phase 1 sensors shipped). The full, self-contained continuation plan lives in docs/PHASE-2-HANDOFF.md — read it before starting.

Phase 2 (=feature A complete): 2.1 assisted sensor generation in mem_tried/mem_save (suggestSensorFromMemory in core, suggestion-only, autogen+warn, never auto-block/auto-validate); 2.2 new 'haive sensors list/check/export' CLI command group (deterministic git-hook/CI gate, no embeddings needed); 2.3 optional gate wiring of sensor.severity=block via enforcement.antiPatternGate.

Then Phase 3/4 (=feature B): ingest CI/Sonar/SARIF findings -> auto-propose anchored memories pre-filled with a sensor (haive ingest, MCP ingest_findings).

WHY: hAIve owned only the feedforward layer; Phase 1 added feedback-computational (sensors). Phase 2 makes sensors easy to create+operate; B makes them self-feeding. HOW TO APPLY: follow [[2026-05-31-decision-git-sync-protocol-multi-agent]] (pull, commit+tag lockstep, push; human publishes npm).

## Why
Recorded in hAIve so future agents can apply this project rule consistently.
