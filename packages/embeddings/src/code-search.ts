import type { HaivePaths } from "@hiveai/core";
import { cosine, Embedder, type EmbedderLike } from "./embedder.js";
import { loadCodeIndex, type CodeEmbeddingIndex } from "./code-index-cache.js";

export interface CodeSearchHit {
  file: string;
  name: string;
  kind: string;
  line: number;
  description?: string;
  score: number;
}

export async function codeSemanticSearch(
  paths: HaivePaths,
  query: string,
  options: {
    limit?: number;
    minScore?: number;
    embedder?: EmbedderLike;
    index?: CodeEmbeddingIndex;
  } = {},
): Promise<{ hits: CodeSearchHit[]; index: CodeEmbeddingIndex } | null> {
  const index = options.index ?? (await loadCodeIndex(paths));
  if (!index || index.entries.length === 0) return null;

  const embedder = options.embedder ?? (await Embedder.create(index.model));
  if (embedder.dimension !== index.dimension) {
    throw new Error(
      `Embedder dimension (${embedder.dimension}) differs from code index (${index.dimension}). Re-run \`haive index code-search\`.`,
    );
  }

  const queryVec = await embedder.encode(query);
  const minScore = options.minScore ?? 0;
  const limit = options.limit ?? 5;

  const scored = index.entries
    .map((e) => ({
      file: e.file,
      name: e.name,
      kind: e.kind,
      line: e.line,
      ...(e.description ? { description: e.description } : {}),
      score: cosine(queryVec, e.vector),
    }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { hits: scored, index };
}
