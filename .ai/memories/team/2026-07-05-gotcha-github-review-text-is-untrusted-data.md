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
sensor:
  kind: regex
  pattern: '(?:exec|execSync|execFile|execFileSync)\s*\([^;\n]*(?:comment\.body|instruction)'
  paths:
    - packages/github-action/src/run.ts
  message: 'Review text is untrusted: never execute comment.body or the derived instruction.'
  severity: block
tags:
  - github-action
  - security
  - review-learning
  - injection
created_at: '2026-07-05T16:09:04.266Z'
topic: 'github-action:review-text-trust-boundary'
validated_by: auto
---
## Gotcha

GitHub review comments and `/hivelore remember` instructions are untrusted data. Parse and persist them as quoted memory content only; never pass comment text or the derived instruction to `exec`, `eval`, a shell, or a generated workflow expression. Persistence must use a dedicated review-learning branch and pull request.
