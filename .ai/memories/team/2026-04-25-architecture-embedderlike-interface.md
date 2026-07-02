---
id: 2026-04-25-architecture-embedderlike-interface
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/embeddings/src/embedder.ts
  symbols:
    - EmbedderLike
tags:
  - embeddings
  - testing
created_at: '2026-04-25T23:39:57.043Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.933Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Architecture Embedderlike Interface

Use the EmbedderLike interface (model, dimension, encode) instead of the concrete Embedder class anywhere downstream (indexer, semanticSearch). This lets tests inject a deterministic FakeEmbedder without downloading the 110MB bge-small model.
