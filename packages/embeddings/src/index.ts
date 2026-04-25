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
