---
id: 2026-07-05-convention-ci-enforces-eval-regressions
scope: team
type: convention
status: validated
anchor:
  paths:
    - .github/workflows/ci.yml
  symbols: []
tags: []
created_at: '2026-07-05T06:40:40.920Z'
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
    node -e "const
    s=require('fs').readFileSync('.github/workflows/ci.yml','utf8');process.exit(s.includes('--regression-gate')&&s.includes('--fail-under-catch-rate
    100')?0:1)"
  paths:
    - .github/workflows/ci.yml
  message: Ci Enforces Eval Regressions
  incident: 'audit v0.42.1: green CI hid eval regression'
  red_proven: true
  severity: block
  autogen: false
  last_fired: null
---
# Ci Enforces Eval Regressions

## Guidance
CI must run the authored-case regression gate and require a 100% deterministic sensor catch rate; an overall score threshold alone can hide known misses.

## Why
Recorded in Hivelore so future agents can apply this project rule consistently.
