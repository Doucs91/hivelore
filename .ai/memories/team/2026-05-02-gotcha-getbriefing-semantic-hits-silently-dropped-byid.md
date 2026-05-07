---
id: 2026-05-02-gotcha-getbriefing-semantic-hits-silently-dropped-byid
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/get-briefing.ts
  symbols:
    - getBriefing
tags: []
created_at: '2026-05-02T05:51:06.189Z'
expires_when: null
verified_at: '2026-05-07T16:05:00.000Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# get_briefing semantic hits silently dropped — byId populated AFTER the loop that uses it

**Where:** `packages/mcp/src/tools/get-briefing.ts` (`getBriefing`)

**Impact:** All semantic hits returned by trySemanticHits are dropped because byId.get(hit.id) is called against an empty map. search_mode reports "semantic" but no memory ever gets a semantic_score. Pure semantic ranking is non-functional from v0.4.5 onward (likely earlier).

**Fix/workaround:** Move `byId = new Map(allMemories.map((m) => [m.memory.frontmatter.id, m]))` to immediately after `allMemories` is computed (line ~217), before the semanticHits processing.
