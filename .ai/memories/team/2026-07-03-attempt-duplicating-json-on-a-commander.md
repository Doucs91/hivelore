---
id: 2026-07-03-attempt-duplicating-json-on-a-commander
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/cli/src/commands/stats.ts
  symbols: []
tags:
  - commander
  - cli
  - options
  - stats
created_at: '2026-07-03T15:54:51.911Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# duplicating --json on a Commander parent command and its receipt subcommand

**Why it failed / do NOT use:** `hivelore stats receipt --json` rendered human output. In the current chained Commander registration, the duplicate option name on `stats` and `stats receipt` was resolved on the parent while the receipt action read only its local opts object, so `opts.json` remained false.

**Instead, use:** In nested command actions, merge local opts with `command.optsWithGlobals()` (or give the subcommand distinct option ownership) before reading flags duplicated on the parent.
