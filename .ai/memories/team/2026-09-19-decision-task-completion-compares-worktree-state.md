---
id: 2026-09-19-decision-task-completion-compares-worktree-state
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/task-session.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/observe.ts
    - packages/cli/src/utils/file-context.ts
    - packages/cli/src/utils/rename-anchors.ts
  symbols: []
tags:
  - cli
  - core
created_at: '2026-09-19T20:09:59.610Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
evidence: tested
last_read_at: null
topic: task-completion-contract
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Task completion compares state, not just file names

The September 18 operations reports described finish blocking on unrelated dirty files. Capture a Git baseline before edits and exclude only byte/index-identical pre-existing work. If this task later changes the same file, include the entire file conservatively; do not claim line-level authorship in a shared worktree.

Use an explicit read/local/commit/release contract. Existing repositories keep release as their default. A missing or expired baseline must not infer that dirty files belong to somebody else, and a read task cannot pass after HEAD changed. Keep task snapshots optional for retrieval in repositories without Git.

For scripts, observe actual Git changes after the tool rather than guessing target files from command text. Consultation markers must credit only delivered context and remain isolated by session. Exact rename repair belongs in explicit sync, leaves staged/user-edited memories alone, and never stages the repair itself.
