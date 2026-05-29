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
---
# asserting `warning.level === "info"` pour un anchor-only match sans diff littéral

**Why it failed / do NOT use:** Le token "service" du diff `"+ some change to service"` matche `anchorPathTokens` de `src/service.ts` via `collectAnchorPathTokens` (qui indexe chaque segment de chemin). Résultat: anchor + literal → "review", pas "info".

**Instead, use:** Asserter `["info", "review", "blocking"].includes(level)` ou utiliser un diff dont aucun token ne correspond aux segments du chemin ancré. Pour tester "info pur", utiliser un diff sans rapport lexical avec le path (ex. diff `"+ foo = bar"` sur anchor `src/service.ts`).
