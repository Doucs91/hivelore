---
id: 2026-05-28-decision-codemap-tracked-files-by-default
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/code-map.ts
    - packages/core/test/code-map.test.ts
  symbols:
    - buildCodeMap
tags:
  - code-map
  - autopilot
  - gitignore
created_at: '2026-05-28T21:47:10.014Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.275Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: codemap-tracked-files-by-default
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Code-map indexes tracked source files by default

`buildCodeMap()` should use `git ls-files` when the project is inside Git, then fall back to walking the filesystem only outside Git. This keeps autopilot refreshes from indexing gitignored worktrees, benchmark sandboxes, generated folders, or local test projects. Use `includeUntracked: true` only for explicit exploratory indexing.
