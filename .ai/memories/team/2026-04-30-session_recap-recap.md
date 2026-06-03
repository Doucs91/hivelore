---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/priority.ts
    - packages/core/src/index.ts
    - packages/core/test/priority.test.ts
    - packages/mcp/src/tools/briefing-helpers.ts
    - packages/cli/src/commands/briefing.ts
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-03T04:16:24.880Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 30
requires_human_approval: false
---
## Goal
Implement the strong recommendation: a single shared briefing-priority classifier so the CLI (haive briefing) and MCP (get_briefing) can never drift again.

## Accomplished
Shipped v0.17.0. Extracted the must_read/useful/background classifier into a new pure @hiveai/core `priority` module (classifyMemoryPriority(signals) + priorityRank + PrioritySignals). Both call sites now map their evidence into the normalized signals and call the same function:
- MCP briefing-helpers.classifyMemoryPriority → builds signals from BriefingMemory (semantic scores), delegates. Behavior byte-for-byte preserved (the get_briefing priority tests pass unchanged).
- CLI briefing.classifyCliPriority → builds signals from lexical evidence, delegates. Gains the consistency wins it lacked (requires_human_approval, direct symbol, skill-exact now → must_read).
8 unit tests in core/test/priority.test.ts. Verified live: all 3 env-workaround memories render [background] in the CLI via the shared classifier. All tests pass (core 240 / mcp 115 / cli 67 / embeddings 17). Committed de85edc, tagged v0.17.0, pushed. All 4 CI workflows green (sonarqube recovered). enforce finish 100%.

## Discoveries & surprises
- The down-rank (stack-pack / env-workaround) correctly applies ONLY to soft (semantic/tag) matches: an exact task hit or a direct anchor on such a memory still ranks must_read/useful, because the must_read branch runs before the down-rank. My first test got this wrong and caught it.
- Preserving MCP behavior exactly required mapping match_quality==="exact" → exactTaskMatch, semantic≥0.65 → strongSemantic, semantic≥0.35 → usefulSemantic, reasons module/domain → moduleOrDomainMatch, and tagTaskMatch=false (MCP never had a separate tag-token signal).
- This closes the drift that bit three times now (recap renderer, env-workaround rank, and the original stack-pack rank): the dual-implementation pattern is the root cause class.

## Files touched
- `packages/core/src/priority.ts`
- `packages/core/src/index.ts`
- `packages/core/test/priority.test.ts`
- `packages/mcp/src/tools/briefing-helpers.ts`
- `packages/cli/src/commands/briefing.ts`

## Next steps
Human runs `npm publish` for 0.17.0. Remaining dual-renderer to consider unifying: the recap presentation still lives in both get_briefing and haive briefing (only the compaction is shared via core) — a shared recap renderer would close the last known drift surface.
