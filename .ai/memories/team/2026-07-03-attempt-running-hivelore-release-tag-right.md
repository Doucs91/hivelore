---
id: 2026-07-03-attempt-running-hivelore-release-tag-right
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags: []
created_at: '2026-07-03T20:42:12.778Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Running `hivelore release tag` right after the release commit

**Why it failed / do NOT use:** It aborts with "Working tree is not clean" because running `enforce check` at commit time (git hook) mutates `.ai/.usage/tool-usage.jsonl` as a telemetry side-effect — so the tree is dirty again immediately after the release commit lands.

**Instead, use:** Before `release tag`, `git add .ai/.usage/tool-usage.jsonl && git commit --amend --no-edit` (or stage+amend it into the release commit). Then the tree is clean and tagging proceeds. Applies to any commit-then-tag flow in this repo.
