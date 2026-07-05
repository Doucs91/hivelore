---
id: 2026-07-05-convention-root-verify-is-release-chain
scope: team
type: convention
status: validated
anchor:
  paths:
    - package.json
  symbols: []
tags: []
created_at: '2026-07-05T06:40:57.655Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
sensor:
  kind: test
  command: >-
    node -e "const p=require('./package.json');const
    v=p.scripts?.verify||'';process.exit(v.includes('pnpm
    build')&&v.includes('pnpm typecheck')&&v.includes('pnpm
    test')&&v.includes('check:artifacts')&&v.includes('--fail-under-catch-rate
    100')&&p.scripts?.['publish:all']?.includes('pnpm verify')?0:1)"
  paths:
    - package.json
  message: Root Verify Is Release Chain
  incident: 'audit v0.42.1: stale dist broke the documented root workflow'
  red_proven: true
  severity: block
  autogen: false
  last_fired: null
---
# Root Verify Is Release Chain

## Guidance
The root verify script must rebuild workspace dist before typecheck/tests, verify artifacts, and run the strict Hivelore evaluation gate. Release publishing must call verify.

## Why
Recorded in Hivelore so future agents can apply this project rule consistently.
