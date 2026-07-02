<p align="center">
  <a href="https://github.com/Doucs91/hivelore">
    <img src="https://raw.githubusercontent.com/Doucs91/hivelore/main/packages/vscode/media/logo.svg" alt="Hivelore logo" width="96" />
  </a>
</p>

# @hivelore/embeddings

> **Optional add-on for Hivelore** — local semantic ranking for Hivelore briefings and memory search. No data leaves your machine.

When installed alongside `@hivelore/cli`, this package helps Hivelore surface the right policy context even when the agent's task wording does not match your memories exactly. It improves `get_briefing`, `mem_relevant_to`, and `mem_search`; it is not required for enforcement.

---

## Why optional?

This package pulls in heavy ML dependencies (`@xenova/transformers`, `onnxruntime-node`, `sharp`) and downloads a ~110MB model on first use. It is **not installed by default** so that the core Hivelore experience stays lightweight.

Install it explicitly when you want semantic search:

```bash
npm install -g @hivelore/embeddings
# or alongside the CLI:
npm install -g @hivelore/cli @hivelore/embeddings
```

---

## Quick start

```bash
# Build (or refresh) the index. First run downloads the model (~110MB, cached locally).
hivelore embeddings index

# Check index status
hivelore embeddings status

# Run a semantic search from the terminal
hivelore embeddings query "how do we handle retries on payment failures"
```

From an MCP client, pass `semantic: true` to `mem_search` or `get_briefing`:

```json
{ "task": "add a mobile payment provider", "semantic": true }
```

---

## Commands

### `hivelore embeddings index`

Build or refresh the embeddings index for all memories.

```bash
hivelore embeddings index              # Index all memories in the current project
hivelore embeddings index --dir /path  # Specify project root
hivelore embeddings index --force      # Force full rebuild (ignore content hashes)
```

The index is stored at `.ai/.cache/embeddings/embeddings-index.json`. Each entry is keyed by content hash, so only changed memories are re-embedded on subsequent runs.

### `hivelore embeddings status`

Show the current state of the embeddings index.

```bash
hivelore embeddings status
# Output:
# Index: .ai/.cache/embeddings/embeddings-index.json
# Entries: 24
# Model: Xenova/bge-small-en-v1.5 (384 dimensions)
# Last updated: 2025-01-20T14:32:00Z
```

### `hivelore embeddings query`

Run a semantic query against the local index.

```bash
hivelore embeddings query "payment retry logic"
hivelore embeddings query "JWT expiration handling" --limit 5
hivelore embeddings query "database migration" --dir /path/to/project
```

---

## How it works

1. **Model**: [`Xenova/bge-small-en-v1.5`](https://huggingface.co/BAAI/bge-small-en-v1.5) — a 33M-parameter sentence embedding model, 384 dimensions, optimized for retrieval tasks. Downloaded once and cached in `~/.cache/huggingface/` (or `TRANSFORMERS_CACHE`).

2. **Indexing**: Each memory's body is converted to a 384-dimensional vector and stored alongside its id and content hash.

3. **Search**: At query time, the query text is embedded and cosine similarity is computed against all indexed memories. The top-k results are returned ranked by score.

4. **Integration**: When `@hivelore/embeddings` is installed and the index exists, `get_briefing` and `mem_search` automatically use semantic ranking. If the package is missing or the index is empty, they fall back to literal (keyword) search transparently.

---

## Auto-rebuild on sync

Add `--embed` to `hivelore sync` to automatically rebuild the index after every sync:

```bash
hivelore sync --embed

# Or in your git hook / CI:
hivelore sync --quiet --embed
```

---

## Programmatic API

```typescript
import { rebuildIndex, semanticSearch } from "@hivelore/embeddings";
import { resolveHaivePaths, findProjectRoot } from "@hivelore/core";

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
import { Embedder, type EmbedderLike } from "@hivelore/embeddings";

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
