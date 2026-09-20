---
id: 2026-09-19-decision-evidence-is-independent-from-retrieval
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/confidence.ts
    - packages/core/src/verifier.ts
    - packages/mcp/src/tools/get-briefing.ts
    - packages/cli/src/commands/memory-approve.ts
  symbols: []
tags:
  - cli
  - core
  - mcp
created_at: '2026-09-19T20:09:58.035Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
evidence: tested
last_read_at: null
topic: evidence-confidence
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Exposure is not validation

Do not use read counts or last_read_at to establish correctness or refresh the age of a claim. The September 18 reports described a wrong migration claim labelled authoritative merely because it was frequently retrieved.

Preserve the public autoPromoteMinReads option for compatibility, but count explicit applications from mem_feedback. Hypotheses, planned knowledge and human-confirmation requirements cannot auto-promote. Keep validated_by provenance distinct from evidence; a CLI command can also be invoked by an agent.

For facts about current code, anchor existence is insufficient. Attach bounded literal checks against the current contract, and mark explicit replacement with supersedes. Do not hide both sides of a supersession cycle or silently remove an executable gate when retiring its prose.
