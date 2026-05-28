---
id: 2026-04-25-convention-always-run-tests-before-commit
scope: team
type: convention
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - workflow
created_at: '2026-04-25T23:40:07.968Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Convention Always Run Tests Before Commit

Personal habit: pnpm test from the root before any commit. Catches the cross-package breakage that local watch mode misses.
