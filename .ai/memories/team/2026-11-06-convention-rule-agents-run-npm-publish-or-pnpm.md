---
id: 2026-11-06-convention-rule-agents-run-npm-publish-or-pnpm
scope: team
type: convention
status: validated
anchor:
  paths: []
  symbols: []
sensor:
  kind: command
  pattern: '(?:(?<![\w-])npm(?:\s+-{1,2}[\w-]+(?:[= ][^\s-]\S*)?)*\s+publish(?![\w-]))|(?:(?<![\w-])pnpm(?:\s+-{1,2}[\w-]+(?:[= ][^\s-]\S*)?)*\s+publish(?![\w-]))|(?:(?<![\w-])publish:all(?![\w-]))'
  paths: []
  message: 'Agents never run `npm publish` (or `pnpm publish`) locally, and never read, print, store or ask for an npm token (CLAUDE.md:57)'
  severity: block
tags:
  - from-rules
created_at: '2026-11-06T20:13:12.278Z'
validated_by: agent
rule: 'Agents never run `npm publish` (or `pnpm publish`) locally, and never read, print, store or ask for an npm token'
source: 'CLAUDE.md:57'
---
# Agents never run `npm publish` (or `pnpm publish`) locally, and never read, print, store or ask for 

Agents never run `npm publish` (or `pnpm publish`) locally, and never read, print, store or ask for an npm token

From `CLAUDE.md:57`: BOUNDARY: publication goes only through the `release` workflow. Agents never run `npm publish` (or `pnpm publish`) locally, and never read, print, store or ask for an npm token — it lives only in the 

Armed by `hivelore rules arm` (names a command (npm publish, pnpm publish) — denied before the agent runs it).
