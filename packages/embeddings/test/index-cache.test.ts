import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths, type HaivePaths } from "@hiveai/core";
import {
  buildEntryText,
  emptyIndex,
  hashContent,
  indexStat,
  loadIndex,
  saveIndex,
} from "../src/index-cache.js";

describe("hashContent", () => {
  it("returns a stable hex digest", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).not.toBe(hashContent("world"));
    expect(hashContent("hello")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildEntryText", () => {
  it("repeats tags so they weight more in the embedding", () => {
    const text = buildEntryText("id-1", ["tooling", "setup"], "body");
    expect(text).toContain("tooling setup tooling setup");
    expect(text).toContain("body");
    expect(text).toContain("id-1");
  });

  it("works with empty tags", () => {
    const text = buildEntryText("id-2", [], "body only");
    expect(text).toContain("id-2");
    expect(text).toContain("body only");
  });
});

describe("loadIndex / saveIndex / indexStat", () => {
  let workDir: string;
  let paths: HaivePaths;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-emb-cache-"));
    paths = resolveHaivePaths(workDir);
    await mkdir(paths.haiveDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("loadIndex returns null when no index exists", async () => {
    expect(await loadIndex(paths)).toBeNull();
    const stat = await indexStat(paths);
    expect(stat.exists).toBe(false);
    expect(stat.count).toBe(0);
  });

  it("saveIndex round-trips with loadIndex", async () => {
    const idx = emptyIndex("test-model", 4);
    idx.entries.push({
      id: "id-1",
      file_path: "/x.md",
      hash: "abc",
      vector: [0.1, 0.2, 0.3, 0.4],
    });
    await saveIndex(paths, idx);
    const loaded = await loadIndex(paths);
    expect(loaded?.entries.length).toBe(1);
    expect(loaded?.entries[0]?.id).toBe("id-1");
    expect(loaded?.model).toBe("test-model");
    expect(loaded?.dimension).toBe(4);
  });

  it("indexStat reports counts and updated_at after a save", async () => {
    const idx = emptyIndex("m", 2);
    idx.entries.push({ id: "a", file_path: "/a.md", hash: "h", vector: [1, 0] });
    idx.entries.push({ id: "b", file_path: "/b.md", hash: "h", vector: [0, 1] });
    await saveIndex(paths, idx);
    const stat = await indexStat(paths);
    expect(stat.exists).toBe(true);
    expect(stat.count).toBe(2);
    expect(stat.model).toBe("m");
    expect(stat.updatedAt).toBeTruthy();
    expect(stat.sizeBytes).toBeGreaterThan(0);
  });
});
