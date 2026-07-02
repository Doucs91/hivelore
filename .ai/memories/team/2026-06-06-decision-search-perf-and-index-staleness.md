---
id: 2026-06-06-decision-search-perf-and-index-staleness
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/embeddings/src/embedder.ts
    - packages/embeddings/src/code-index-cache.ts
    - packages/mcp/src/tools/code-search.ts
    - packages/cli/src/commands/index-code.ts
  symbols: []
tags:
  - code-search
  - embeddings
  - performance
  - staleness
  - index
created_at: '2026-06-06T03:01:31.329Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.292Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Search perf (embedder caching) + index staleness transparency (v0.26.6)

**Perf:** `Embedder.create()` caches the initialized embedder per model (`cachedEmbedders` map in
embedder.ts). The ONNX pipeline was already cached, but each `create()` re-ran a "dimension probe"
inference — so every `code_search` / `semanticSearch` call paid TWO inferences. Now calls 2..N in a
session skip the probe. Behaviour unchanged; FakeEmbedder tests unaffected (they don't call create()).

**Staleness:** the code index could silently go stale. Now made visible:
- pure helper `isCodeIndexStale(indexSourceGeneratedAt, codeMapGeneratedAt)` in code-index-cache.ts
  (string compare; empty timestamps → not stale, no false alarms). The indexer stamps the index's
  `source_generated_at` with the code-map `generated_at` it built from.
- `code_search` MCP tool returns `stale: true` + an actionable notice when index vs code-map differ
  (best-effort; never fails the search over it).
- `haive index code --status` reports a fresh/stale verdict for BOTH the code-map (any listed file
  newer than `generated_at` → stale, stat-only) and the search index (vs code-map), incl. `--json`
  (`code_map.stale`, `code_search_index.stale`). Exit code unchanged (only absent map → 1) to stay
  non-breaking for existing CI.

**Cascade is intentional:** if the code-map is stale vs source, fix it first (`haive index code`);
the search index then shows stale vs the new code-map and you rebuild it (`haive index code-search`).

**Do NOT "de-noise" the `unknown option` failure_hint** in observe.ts to silence the
`uncaptured-failures` advisory: that class is a legitimate signal (cf. the `haive init --name`/`--yes`
attempt memories). The gate is advisory-only and explicitly says exploratory false positives can be
ignored. Tuning the shared failure classifier to hide it would regress a real signal.

Related: [[2026-06-06-decision-code-search-hybrid-ranking]], [[2026-06-05-convention-briefing-breadcrumbs-are-pointers-not-copies]].
