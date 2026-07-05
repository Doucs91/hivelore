---
id: 2026-07-05-convention-child-process-no-shell-interpolation
scope: team
type: convention
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/propose-sensor.ts
  symbols: []
tags:
  - mcp
created_at: '2026-07-05T06:40:10.996Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
sensor:
  kind: ast
  pattern: execSync($CMD)
  paths:
    - packages/mcp/src/tools/propose-sensor.ts
  message: >-
    Use execFileSync with an argument array; never interpolate untrusted values
    into a shell command.
  severity: block
  autogen: false
  last_fired: null
---
# Child Process No Shell Interpolation

## Guidance
Never interpolate git refs or repository paths into execSync command strings. Use execFileSync with an argument array so shell expansion is impossible.

## Why
Recorded in Hivelore so future agents can apply this project rule consistently.
