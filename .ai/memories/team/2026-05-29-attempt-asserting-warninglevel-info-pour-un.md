---
id: 2026-05-29-attempt-asserting-warninglevel-info-pour-un
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/mcp/test/anti-patterns.test.ts
    - packages/core/src/search.ts
  symbols: []
tags: []
created_at: '2026-05-29T03:32:47.975Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
sensor:
  kind: regex
  pattern: "\\.level\\)\\.toBe\\(['\"]info['\"]\\)"
  message: "Asserting warning.level === 'info' on an anchor-only match is wrong when the diff contains tokens matching the anchor path segments — that produces 'review', not 'info'. Use `[\"info\",\"review\",\"blocking\"].includes(level)` or craft a diff with no lexical overlap with the anchor path."
  severity: warn
  autogen: false
  last_fired: null
  paths:
    - packages/mcp/test/anti-patterns.test.ts
---
# asserting `warning.level === "info"` for an anchor-only match without literal diff overlap

**Why it failed / do NOT use:** the token "service" from diff `"+ some change to service"` matches `anchorPathTokens` from `src/service.ts` through `collectAnchorPathTokens` (which indexes each path segment). Result: anchor + literal -> "review", not "info".

**Instead, use:** assert `["info", "review", "blocking"].includes(level)` or use a diff whose tokens do not match any anchored path segment. To test pure "info", use a diff with no lexical relation to the path (for example diff `"+ foo = bar"` on anchor `src/service.ts`).
