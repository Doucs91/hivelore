---
id: 2026-06-02-gotcha-commit-message-body-skip-ci-skips-whole-push
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - .github/workflows/ci.yml
  symbols: []
sensor:
  kind: regex
  pattern: 'Fallback\s*:\s*["'']?ci\.yml["'']?'
  paths:
    - .github/workflows/ci.yml
  message: Commit Message Body Skip Ci Skips Whole Push
  severity: warn
  autogen: true
  last_fired: null
tags: []
created_at: '2026-06-02T17:17:58.585Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Commit Message Body Skip Ci Skips Whole Push

## Guidance
GitHub scans the ENTIRE commit message (subject AND body) for [skip ci] / [ci skip] / [no ci], not just the subject line. A release/code commit whose body merely *mentions* or *quotes* '[skip ci]' (e.g. when describing the skip-ci problem) will skip CI for the WHOLE push — no workflow runs are created for that HEAD. Real case: commit 8d8bee5 (v0.13.4) fix that quoted '[skip ci]' in its body got zero CI runs. How to apply: never put the literal substring '[skip ci]' (or [ci skip]/[no ci]) anywhere in a commit message that contains code you want CI to run. Write it as 'skip-ci' or 'skip CI' instead. Fallback: ci.yml has workflow_dispatch to trigger manually.

## Why
Recorded in hAIve so future agents can apply this project rule consistently.
