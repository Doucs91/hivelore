---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - src/repo.js
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-05-31T15:58:15.595Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 11
requires_human_approval: false
---
## Goal
Implement findByRole(ctx, role) in src/repo.js for the multitenant bench repo.

## Accomplished
- Implemented findByRole filtering USERS by ctx.tenantId, role, and deletedAt === null per the team tenant-isolation security gotcha.
- npm test passes (smoke test green).

## Discoveries & surprises
The team gotcha 2026-05-31-gotcha-tenant-isolation mandates every finder in src/repo.js filter by ctx.tenantId AND exclude soft-deleted rows (deletedAt !== null). The smoke test only checks tenant+role, not soft-delete exclusion, so the policy (not the test) is the source of truth for excluding soft-deleted Adam.

## Files touched
- `src/repo.js`

## Next steps
Apply the same tenant-isolation + soft-delete filter to any future finders added to src/repo.js.
