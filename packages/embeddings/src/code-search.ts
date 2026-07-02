import type { HaivePaths } from "@hivelore/core";
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
      `Embedder dimension (${embedder.dimension}) differs from code index (${index.dimension}). Re-run \`hivelore index code-search\`.`,
    );
  }

  const queryVec = await embedder.encode(query);
  const minScore = options.minScore ?? 0;
  const limit = options.limit ?? 5;

  const queryTokens = tokenize(query);
  const normalizedQuery = query.trim().toLowerCase();

  const scored = index.entries
    .map((e) => {
      const semantic = cosine(queryVec, e.vector);
      const boost = lexicalBoost(queryTokens, normalizedQuery, e.name, e.file);
      return {
        file: e.file,
        name: e.name,
        kind: e.kind,
        line: e.line,
        ...(e.description ? { description: e.description } : {}),
        // Hybrid score: semantic cosine is the base, a small deterministic lexical bonus
        // promotes exact/partial symbol-name and filename matches above merely-similar neighbours.
        score: Math.min(1, semantic + boost),
        semantic,
      };
    })
    // Keep min_score a pure-semantic noise floor (its documented meaning) so the lexical bonus
    // re-ranks the relevant set without letting incidental filename tokens leak noise past the gate.
    .filter((h) => h.semantic >= minScore)
    .sort((a, b) => b.score - a.score || b.semantic - a.semantic || a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, limit)
    .map(({ semantic: _semantic, ...hit }) => hit);

  return { hits: scored, index };
}

/** Split a query or symbol name into lowercase tokens, breaking on camelCase and any non-alphanumeric run. */
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2);
}

/**
 * Small additive bonus (≤ 0.30) layered on top of the semantic cosine so that exact symbol-name
 * matches outrank distant-but-similar code. Reuses only data already in the index entry — no new
 * index, model, or dependency.
 */
function lexicalBoost(queryTokens: string[], normalizedQuery: string, name: string, file: string): number {
  if (queryTokens.length === 0) return 0;

  let nameComponent: number;
  if (normalizedQuery === name.toLowerCase()) {
    nameComponent = 0.3; // exact symbol name typed verbatim
  } else {
    const nameTokens = new Set(tokenize(name));
    const matched = queryTokens.filter((t) => nameTokens.has(t)).length;
    nameComponent = (matched / queryTokens.length) * 0.2; // proportional partial-name match
  }

  const fileTokens = new Set(tokenize(file.split("/").pop() ?? ""));
  const pathComponent = queryTokens.some((t) => fileTokens.has(t)) ? 0.05 : 0;

  return Math.min(0.3, nameComponent + pathComponent);
}
