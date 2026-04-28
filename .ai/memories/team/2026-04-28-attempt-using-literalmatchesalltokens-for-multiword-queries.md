---
id: 2026-04-28-attempt-using-literalmatchesalltokens-for-multiword-queries
scope: team
type: attempt
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - search
  - tokens
created_at: '2026-04-28T04:01:17.544Z'
expires_when: null
verified_at: null
stale_reason: null
---
# using literalMatchesAllTokens for multi-word queries

**Why it failed / do NOT use:** AND semantics returns 0 results when even one token is missing — agents give up and retry with broader queries, wasting tokens

**Instead, use:** use literalMatchesAnyToken as OR fallback when AND returns 0
