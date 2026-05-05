import type { LoadedMemory } from "./loader.js";

function tokenizeDoc(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

function memorySearchText(loaded: LoadedMemory): string {
  const fm = loaded.memory.frontmatter;
  return [
    fm.id,
    fm.type,
    fm.tags.join(" "),
    loaded.memory.body,
    fm.module ?? "",
    fm.topic ?? "",
    ...fm.anchor.paths,
    ...fm.anchor.symbols,
  ].join(" ");
}

export interface LexicalRankResult {
  ranked: LoadedMemory[];
  scores: number[];
}

/**
 * Okapi-BM25–style ranking over a small in-memory corpus (no extra index file).
 */
export function rankMemoriesLexical(
  loadedMemories: LoadedMemory[],
  query: string,
  limit: number,
): LexicalRankResult {
  const qTokens = tokenizeDoc(query);
  if (qTokens.length === 0 || loadedMemories.length === 0) {
    return { ranked: [], scores: [] };
  }

  const docs = loadedMemories.map((loaded) => ({
    loaded,
    tokens: tokenizeDoc(memorySearchText(loaded)),
  }));

  const N = docs.length;
  const df = new Map<string, number>();
  for (const { tokens } of docs) {
    const seen = new Set(tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const avgdl =
    docs.reduce((s, d) => s + d.tokens.length, 0) / Math.max(N, 1);
  const k1 = 1.2;
  const b = 0.75;

  function scoreDoc(tokens: string[]): number {
    if (tokens.length === 0) return 0;
    let score = 0;
    const len = tokens.length;
    const tfCounts = new Map<string, number>();
    for (const t of tokens) {
      tfCounts.set(t, (tfCounts.get(t) ?? 0) + 1);
    }

    for (const qt of qTokens) {
      const tf = tfCounts.get(qt) ?? 0;
      if (tf === 0) continue;
      const dfi = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - dfi + 0.5) / (dfi + 0.5));
      const denom = tf + k1 * (1 - b + (b * len) / avgdl);
      const okapiTf = (tf * (k1 + 1)) / denom;
      score += idf * okapiTf;
    }
    return score;
  }

  const scored = docs
    .map(({ loaded, tokens }) => ({ loaded, score: scoreDoc(tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    ranked: scored.map((x) => x.loaded),
    scores: scored.map((x) => x.score),
  };
}
