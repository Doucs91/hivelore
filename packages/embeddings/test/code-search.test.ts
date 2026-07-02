import { describe, expect, it } from "vitest";
import type { HaivePaths } from "@hivelore/core";
import type { EmbedderLike } from "../src/embedder.js";
import type { CodeEmbeddingIndex } from "../src/code-index-cache.js";
import { codeSemanticSearch } from "../src/code-search.js";
import { isCodeIndexStale } from "../src/code-index-cache.js";

// codeSemanticSearch only touches paths when no index is injected; tests inject one.
const paths = {} as HaivePaths;

/** Query vector is keyword-driven so each test controls the semantic side deterministically. */
class FakeEmbedder implements EmbedderLike {
  readonly model = "fake";
  readonly dimension = 4;
  encode(text: string): Promise<Float32Array> {
    const lower = text.toLowerCase();
    if (lower.includes("parse")) return Promise.resolve(new Float32Array([1, 0, 0, 0]));
    if (lower.includes("date")) return Promise.resolve(new Float32Array([0, 0, 0, 1]));
    return Promise.resolve(new Float32Array([0, 0, 0, 1]));
  }
}

function indexOf(entries: Array<{ name: string; file: string; vector: number[] }>): CodeEmbeddingIndex {
  return {
    model: "fake",
    dimension: 4,
    updated_at: "",
    source_generated_at: "",
    entries: entries.map((e) => ({
      id: `${e.file}#${e.name}`,
      file: e.file,
      name: e.name,
      kind: "function",
      line: 1,
      hash: "h",
      vector: e.vector,
    })),
  };
}

describe("codeSemanticSearch hybrid ranking", () => {
  const embedder = new FakeEmbedder();

  it("promotes an exact symbol-name match above a higher-cosine but unrelated symbol", async () => {
    // Query "parseConfig" is semantically closer to formatDate (cosine 0.6) than to parseConfig
    // (cosine 0.5). The exact-name lexical bonus (+0.30) must flip the order.
    const index = indexOf([
      { name: "formatDate", file: "utils/date.ts", vector: [0.6, 0.8, 0, 0] },
      { name: "parseConfig", file: "config/parse.ts", vector: [0.5, Math.sqrt(0.75), 0, 0] },
    ]);

    const result = await codeSemanticSearch(paths, "parseConfig", { embedder, index, minScore: 0 });
    expect(result).not.toBeNull();
    expect(result!.hits[0]?.name).toBe("parseConfig");
    // Hybrid score = 0.5 semantic + 0.30 exact-name bonus.
    expect(result!.hits[0]?.score).toBeCloseTo(0.8, 5);
    expect(result!.hits[1]?.name).toBe("formatDate");
  });

  it("keeps min_score a pure-semantic floor: a filename-only match below the floor is still dropped", async () => {
    // Query "date" is orthogonal to this symbol (semantic 0). Its only overlap is the filename
    // token "date" (+0.05 path bonus). With minScore 0.2 it must NOT sneak past the noise floor.
    const index = indexOf([{ name: "helperThing", file: "utils/date.ts", vector: [1, 0, 0, 0] }]);

    const result = await codeSemanticSearch(paths, "date", { embedder, index, minScore: 0.2 });
    expect(result).not.toBeNull();
    expect(result!.hits).toHaveLength(0);
  });
});

describe("isCodeIndexStale", () => {
  it("is stale when the index was built from a different code-map generation", () => {
    expect(isCodeIndexStale("2026-06-01T00:00:00.000Z", "2026-06-05T00:00:00.000Z")).toBe(true);
  });

  it("is fresh when generations match", () => {
    expect(isCodeIndexStale("2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z")).toBe(false);
  });

  it("never false-alarms on unknown timestamps", () => {
    expect(isCodeIndexStale("", "2026-06-05T00:00:00.000Z")).toBe(false);
    expect(isCodeIndexStale("2026-06-05T00:00:00.000Z", "")).toBe(false);
  });
});
