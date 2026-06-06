export {
  Embedder,
  cosine,
  DEFAULT_MODEL,
  DEFAULT_DIMENSION,
  type EmbedderLike,
} from "./embedder.js";

export {
  buildEntryText,
  cacheDir,
  emptyIndex,
  hashContent,
  indexPath,
  indexStat,
  loadIndex,
  saveIndex,
  type EmbeddingEntry,
  type EmbeddingIndex,
} from "./index-cache.js";

export {
  rebuildIndex,
  type IndexUpdateReport,
} from "./indexer.js";

export {
  semanticSearch,
  type SemanticHit,
} from "./search.js";

export {
  buildCodeEntryText,
  codeIndexPath,
  emptyCodeIndex,
  isCodeIndexStale,
  loadCodeIndex,
  saveCodeIndex,
  type CodeEmbeddingEntry,
  type CodeEmbeddingIndex,
} from "./code-index-cache.js";

export {
  rebuildCodeIndex,
  type CodeIndexUpdateReport,
} from "./code-indexer.js";

export {
  codeSemanticSearch,
  type CodeSearchHit,
} from "./code-search.js";
