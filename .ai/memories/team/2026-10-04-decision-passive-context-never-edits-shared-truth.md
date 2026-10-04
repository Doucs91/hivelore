---
id: 2026-10-04-decision-passive-context-never-edits-shared-truth
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/get-briefing.ts
    - packages/mcp/src/tools/mem-feedback.ts
    - packages/cli/src/commands/init.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags: []
created_at: '2026-10-04T04:54:03.879Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
evidence: tested
last_read_at: null
topic: passive-context-neutrality
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Passive context is not corpus maintenance

Field reports described Git noise and credibility loss when normal agent usage rewrote shared knowledge. In 0.64, briefing and feedback record local delivery/usage only, even when confirmed applications would qualify for promotion. Explicit maintenance owns shared status changes. Merge/rebase hooks likewise must not synchronize the corpus.

New repositories use draft captures, local completion, session handoffs and stable bridge navigation. Existing repository policies are preserved so adopting this release cannot silently weaken a team's release contract. Tests of release behavior must select release explicitly instead of relying on init defaults.

A synthetic GREEN/RED exercise proves integration plumbing, not customer productivity. Outcome logs distinguish delivery from self-reported utility; benchmark readiness checks completeness, not statistical superiority.
