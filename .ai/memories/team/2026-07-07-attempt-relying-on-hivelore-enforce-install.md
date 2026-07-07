---
id: 2026-07-07-attempt-relying-on-hivelore-enforce-install
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags: []
created_at: '2026-07-07T17:39:20.491Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Relying on `hivelore enforce install` to fix stale pre-rename git hooks

**Why it failed / do NOT use:** After the v0.51.0 `haive`→`hivelore` rename, an already-installed repo kept legacy `.git/hooks/{pre-commit,pre-push,commit-msg}` that call the REMOVED `haive` binary directly (no probe), so every commit died with `.git/hooks/pre-commit: haive: not found` (exit 1). Worse, `hivelore enforce install` APPENDED the new `_hivelore` probe block instead of REPLACING the legacy unmanaged block — leaving a broken two-block hook where the stale `haive` line still runs first and aborts.

**Instead, use:** Rewrite each `.git/hooks/{pre-commit,pre-push,commit-msg}` with a single `_hivelore()` probe block (`command -v hivelore … else return 0`). Real fix for enforce install: the hook writer should detect and replace a legacy `# hAIve enforcement hook` block, not append below it (idempotent hook regeneration).
