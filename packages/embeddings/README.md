# @hiveai/embeddings

> **Optional add-on for hAIve** — local sentence embeddings and semantic search for your AI memory layer. No data leaves your machine.

When installed alongside `@hiveai/cli` and `@hiveai/mcp`, this package enables similarity-based memory retrieval: instead of keyword matching, `get_briefing` and `mem_search` can find memories that are *semantically* related to your task description, even if they share no common words.

---

## Why optional?

This package pulls in heavy ML dependencies (`@xenova/transformers`, `onnxruntime-node`, `sharp`) and downloads a ~110MB model on first use. It is **not installed by default** so that the core hAIve experience stays lightweight.

Install it explicitly when you want semantic search:

```bash
npm install -g @hiveai/embeddings
# or alongside the CLI:
npm install -g @hiveai/cli @hiveai/embeddings
```

---

## Quick start

```bash
# Build (or refresh) the index. First run downloads the model (~110MB, cached locally).
haive embeddings index

# Check index status
haive embeddings status

# Run a semantic search from the terminal
haive embeddings query "how do we handle retries on payment failures"
```

From an MCP client, pass `semantic: true` to `mem_search` or `get_briefing`:

```json
{ "task": "add a mobile payment provider", "semantic": true }
```

---

## Commands

### `haive embeddings index`

Build or refresh the embeddings index for all memories.

```bash
haive embeddings index              # Index all memories in the current project
haive embeddings index --dir /path  # Specify project root
haive embeddings index --force      # Force full rebuild (ignore content hashes)
```

The index is stored at `.ai/.cache/embeddings/embeddings-index.json`. Each entry is keyed by content hash, so only changed memories are re-embedded on subsequent runs.

### `haive embeddings status`

Show the current state of the embeddings index.

```bash
haive embeddings status
# Output:
# Index: .ai/.cache/embeddings/embeddings-index.json
# Entries: 24
# Model: Xenova/bge-small-en-v1.5 (384 dimensions)
# Last updated: 2025-01-20T14:32:00Z
```

### `haive embeddings query`

Run a semantic query against the local index.

```bash
haive embeddings query "payment retry logic"
haive embeddings query "JWT expiration handling" --limit 5
haive embeddings query "database migration" --dir /path/to/project
```

---

## How it works

1. **Model**: [`Xenova/bge-small-en-v1.5`](https://huggingface.co/BAAI/bge-small-en-v1.5) — a 33M-parameter sentence embedding model, 384 dimensions, optimized for retrieval tasks. Downloaded once and cached in `~/.cache/huggingface/` (or `TRANSFORMERS_CACHE`).

2. **Indexing**: Each memory's body is converted to a 384-dimensional vector and stored alongside its id and content hash.

3. **Search**: At query time, the query text is embedded and cosine similarity is computed against all indexed memories. The top-k results are returned ranked by score.

4. **Integration**: When `@hiveai/embeddings` is installed and the index exists, `get_briefing` and `mem_search` automatically use semantic ranking. If the package is missing or the index is empty, they fall back to literal (keyword) search transparently.

---

## Auto-rebuild on sync

Add `--embed` to `haive sync` to automatically rebuild the index after every sync:

```bash
haive sync --embed

# Or in your git hook / CI:
haive sync --quiet --embed
```

---

## Programmatic API

```typescript
import { rebuildIndex, semanticSearch } from "@hiveai/embeddings";
import { resolveHaivePaths, findProjectRoot } from "@hiveai/core";

const paths = resolveHaivePaths(findProjectRoot());

// Rebuild the full index
const report = await rebuildIndex(paths);
// report.added, report.updated, report.removed, report.skipped

// Search
const result = await semanticSearch(paths, "payment retry logic", { limit: 5 });
if (result) {
  for (const hit of result.hits) {
    console.log(hit.id, hit.score); // score: 0.0–1.0
  }
}

// Custom embedder (for testing or alternative models)
import { Embedder, type EmbedderLike } from "@hiveai/embeddings";

const embedder: EmbedderLike = {
  model: "Xenova/bge-small-en-v1.5",
  dimension: 384,
  encode: async (texts) => { /* ... */ return [[0.1, 0.2, ...]]; },
};
```

---

## Privacy

- The model runs **entirely locally** via [Transformers.js](https://huggingface.co/docs/transformers.js) + ONNX Runtime.
- No API keys required.
- No network calls during search or indexing (only on first model download).
- Memory content never leaves your machine.

---

## License

MIT
