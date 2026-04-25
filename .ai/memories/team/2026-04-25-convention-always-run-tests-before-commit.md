---
id: 2026-04-25-convention-always-run-tests-before-commit
scope: team
type: convention
status: proposed
anchor:
  paths: []
  symbols: []
tags:
  - workflow
created_at: '2026-04-25T23:40:07.968Z'
expires_when: null
---
Personal habit: pnpm test from the root before any commit. Catches the cross-package breakage that local watch mode misses.
