import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  resolveHaivePaths,
  serializeMemory,
  type HaivePaths,
} from "@haive/core";
import type { EmbedderLike } from "../src/embedder.js";
import { rebuildIndex } from "../src/indexer.js";
import { loadIndex } from "../src/index-cache.js";
import { semanticSearch } from "../src/search.js";

class FakeEmbedder implements EmbedderLike {
  readonly model = "fake";
  readonly dimension = 4;
  // Maps a substring keyword to a unit vector — tests get deterministic similarity.
  encode(text: string): Promise<Float32Array> {
    const lower = text.toLowerCase();
    if (lower.includes("pnpm")) return Promise.resolve(new Float32Array([1, 0, 0, 0]));
    if (lower.includes("lodash")) return Promise.resolve(new Float32Array([0, 1, 0, 0]));
    if (lower.includes("transaction")) return Promise.resolve(new Float32Array([0, 0, 1, 0]));
    return Promise.resolve(new Float32Array([0, 0, 0, 1]));
  }
}

async function writeMemory(
  paths: HaivePaths,
  type: "convention" | "decision" | "gotcha" | "architecture" | "glossary",
  slug: string,
  body: string,
  scope: "personal" | "team" = "personal",
): Promise<string> {
  const fm = buildFrontmatter({ type, slug, scope });
  const dir = scope === "personal" ? paths.personalDir : paths.teamDir;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${fm.id}.md`);
  await writeFile(file, serializeMemory({ frontmatter: fm, body }), "utf8");
  return fm.id;
}

describe("rebuildIndex + semanticSearch", () => {
  let workDir: string;
  let paths: HaivePaths;
  const embedder = new FakeEmbedder();

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-emb-indexer-"));
    paths = resolveHaivePaths(workDir);
    await mkdir(paths.personalDir, { recursive: true });
    await mkdir(paths.teamDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("indexes all memories on first run", async () => {
    await writeMemory(paths, "convention", "use-pnpm", "Always use pnpm in this project.");
    await writeMemory(paths, "decision", "no-lodash", "Decided to drop lodash.");
    const { report, index } = await rebuildIndex(paths, embedder);
    expect(report.total).toBe(2);
    expect(report.added).toBe(2);
    expect(report.unchanged).toBe(0);
    expect(index.entries.length).toBe(2);
  });

  it("re-uses cached entries when content is unchanged", async () => {
    await writeMemory(paths, "convention", "use-pnpm", "Always use pnpm.");
    await rebuildIndex(paths, embedder);
    const second = await rebuildIndex(paths, embedder);
    expect(second.report.unchanged).toBe(1);
    expect(second.report.added).toBe(0);
    expect(second.report.updated).toBe(0);
  });

  it("semanticSearch ranks by cosine similarity", async () => {
    await writeMemory(paths, "convention", "use-pnpm", "Always use pnpm.");
    await writeMemory(paths, "decision", "no-lodash", "Decided to drop lodash.");
    await writeMemory(paths, "architecture", "tx-flow", "Transaction flow overview.");
    await rebuildIndex(paths, embedder);

    const result = await semanticSearch(paths, "transaction handling", {
      embedder,
      limit: 10,
    });
    expect(result).not.toBeNull();
    expect(result!.hits[0]?.id).toContain("tx-flow");
    expect(result!.hits[0]?.score).toBeCloseTo(1.0, 5);
  });

  it("semanticSearch returns null when no index exists", async () => {
    const result = await semanticSearch(paths, "anything", { embedder });
    expect(result).toBeNull();
  });

  it("rebuildIndex resets entries when the model changes", async () => {
    await writeMemory(paths, "convention", "use-pnpm", "Always use pnpm.");
    await rebuildIndex(paths, embedder);
    const otherEmbedder: EmbedderLike = {
      model: "other",
      dimension: 4,
      encode: async () => new Float32Array([1, 1, 1, 1]),
    };
    const { report } = await rebuildIndex(paths, otherEmbedder);
    expect(report.added).toBe(1);
    expect(report.unchanged).toBe(0);
    const idx = await loadIndex(paths);
    expect(idx?.model).toBe("other");
  });
});
