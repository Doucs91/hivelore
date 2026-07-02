import type { HaivePaths } from "@hivelore/core";
import { cosine, Embedder, type EmbedderLike } from "./embedder.js";
import { loadIndex, type EmbeddingIndex } from "./index-cache.js";

export interface SemanticHit {
  id: string;
  file_path: string;
  score: number;
}

export async function semanticSearch(
  paths: HaivePaths,
  query: string,
  options: {
    limit?: number;
    minScore?: number;
    embedder?: EmbedderLike;
    index?: EmbeddingIndex;
  } = {},
): Promise<{ hits: SemanticHit[]; index: EmbeddingIndex } | null> {
  const index = options.index ?? (await loadIndex(paths));
  if (!index || index.entries.length === 0) return null;

  const embedder = options.embedder ?? (await Embedder.create(index.model));
  if (embedder.dimension !== index.dimension) {
    throw new Error(
      `Embedder dimension (${embedder.dimension}) differs from index (${index.dimension}). Re-run \`hivelore embeddings index\`.`,
    );
  }

  const queryVec = await embedder.encode(query);
  const minScore = options.minScore ?? 0;
  const limit = options.limit ?? 10;

  const scored = index.entries
    .map((e) => ({ id: e.id, file_path: e.file_path, score: cosine(queryVec, e.vector) }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { hits: scored, index };
}
