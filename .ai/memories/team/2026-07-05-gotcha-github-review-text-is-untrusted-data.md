---
id: 2026-07-05-gotcha-github-review-text-is-untrusted-data
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/github-action/src/run.ts
    - packages/github-action/action.yml
  symbols: []
tags:
  - github-action
  - security
  - review-learning
  - injection
created_at: '2026-07-05T16:09:04.266Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: 'github-action:review-text-trust-boundary'
revision_count: 0
requires_human_approval: false
validated_by: auto
sensor:
  kind: regex
  pattern: >-
    (?:exec|execSync|execFile|execFileSync)\s*\([^;\n]*(?:comment\.body|instruction)
  paths:
    - packages/github-action/src/run.ts
  message: >-
    Review text is untrusted: never execute comment.body or the derived
    instruction.
  severity: block
  autogen: false
  last_fired: null
---
## Gotcha

GitHub review comments and `/hivelore remember` instructions are untrusted data. Parse and persist them as quoted memory content only; never pass comment text or the derived instruction to `exec`, `eval`, a shell, or a generated workflow expression. Persistence must use a dedicated review-learning branch and pull request.
