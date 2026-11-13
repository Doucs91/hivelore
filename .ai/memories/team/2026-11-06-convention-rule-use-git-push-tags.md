---
id: 2026-11-06-convention-rule-use-git-push-tags
scope: team
type: convention
status: validated
anchor:
  paths: []
  symbols: []
sensor:
  kind: command
  pattern: '(?:(?<![\w-])git(?:\s+-{1,2}[\w-]+(?:[= ][^\s-]\S*)?)*\s+push\s+--tags(?![\w-]))'
  paths: []
  message: 'Do not use `git push --tags` (CLAUDE.md:50)'
  severity: block
tags:
  - from-rules
created_at: '2026-11-06T20:13:12.269Z'
validated_by: agent
rule: Do not use `git push --tags`
source: 'CLAUDE.md:50'
---
# Do not use `git push --tags`

Do not use `git push --tags`

From `CLAUDE.md:50`: `git push` code and the new tag (`git push && git push origin vX.Y.Z`). Do not use `git push --tags` — it tries to push every local tag and fails if an old one (e.g. `v0.4.0`) already differs on the r

Armed by `hivelore rules arm` (names a command (git push --tags) — denied before the agent runs it).
