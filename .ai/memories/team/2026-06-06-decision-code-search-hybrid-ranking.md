---
id: 2026-06-06-decision-code-search-hybrid-ranking
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/embeddings/src/code-search.ts
  symbols: []
tags:
  - code-search
  - ranking
  - embeddings
  - hybrid-retrieval
created_at: '2026-06-06T02:14:55.520Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.291Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## `code_search` uses hybrid ranking: semantic cosine + small deterministic lexical bonus

`codeSemanticSearch` (packages/embeddings/src/code-search.ts) ranks by `min(1, cosine + lexicalBoost)`,
not cosine alone (v0.26.5). The boost (≤ 0.30) reuses only data already in the code index entry:
- exact symbol-name match (normalized query == name): **+0.30**
- partial name-token match (camelCase-split): proportional, up to **+0.20**
- filename-token match: **+0.05**

`tokenize()` here splits on camelCase AND non-alphanumeric so a query like `parse config` matches a
symbol named `parseConfig`.

**Design invariants (do not break):**
- `min_score` stays a **pure-semantic** floor: filtering is on the raw cosine, NOT the boosted score,
  so incidental filename tokens cannot leak weak hits past the noise gate. (See the broader trap that
  over-broad token matching causes noise: [[2026-04-28-attempt-using-literalmatchesalltokens-for-multiword-queries]].)
- Ties break deterministically: `score → semantic → file → line` for stable output across runs.

**Why not reuse `core/src/lexical-rank.ts`?** That `rankMemoriesLexical` is **BM25 over memories**
(`LoadedMemory[]`), coupled to memory frontmatter/body, and its tokenizer keeps underscores without a
camelCase split — wrong corpus and wrong tokenization for code symbols. Keeping the code boost local
to the embeddings package avoids an embeddings→core memory-internals dependency.

Related: [[2026-06-05-convention-briefing-breadcrumbs-are-pointers-not-copies]].
