---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/precommit.ts
    - packages/cli/src/commands/session-end.ts
    - packages/mcp/src/tools/mem-session-end.ts
    - packages/mcp/src/tools/precommit-check.ts
    - packages/mcp/test/tools.test.ts
    - CHANGELOG.md
    - package.json
    - packages/cli/package.json
    - packages/core/package.json
    - packages/embeddings/package.json
    - packages/mcp/package.json
    - .ai/project-context.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-05-27T23:30:14.402Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 2
requires_human_approval: false
---
## Goal
Release v0.9.13 false-positive enforcement fixes

## Accomplished
Fixed session recap freshness by refreshing verified_at on recap updates; changed enforce freshness to use verified_at before created_at; made pre_commit_check block only anchored or literal+semantic high-confidence anti-patterns; updated precommit output, tests, changelog, and package versions.

## Files touched
- `packages/cli/src/commands/enforce.ts`
- `packages/cli/src/commands/precommit.ts`
- `packages/cli/src/commands/session-end.ts`
- `packages/mcp/src/tools/mem-session-end.ts`
- `packages/mcp/src/tools/precommit-check.ts`
- `packages/mcp/test/tools.test.ts`
- `CHANGELOG.md`
- `package.json`
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/embeddings/package.json`
- `packages/mcp/package.json`
- `.ai/project-context.md`

## Next steps
Push v0.9.13 and publish @hiveai/core, @hiveai/embeddings, @hiveai/mcp, and @hiveai/cli to npm.
