---
id: 2026-07-06-gotcha-github-action-bundle-must-be-tracked
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/github-action/action.yml
    - packages/github-action/dist/run.js
    - scripts/verify-build-artifacts.mjs
  symbols: []
tags:
  - github-action
  - release
  - packaging
created_at: '2026-07-06T06:40:03.843Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: github-action-tracked-bundle
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Composite GitHub Action bundle must be tracked

## Guidance
GitHub executes packages/github-action/action.yml directly from a repository tag, and that manifest invokes dist/run.js. A local build or CI build does not make the file exist in the published tag. Keep packages/github-action/dist/run.js committed and have check:artifacts verify it with git ls-files; otherwise source tests pass while consumers fail at runtime.

## Why
Recorded in Hivelore so future agents can apply this project rule consistently.
