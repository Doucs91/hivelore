import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths, type HaivePaths } from "../src/paths.js";
import {
  bumpRead,
  emptyUsageIndex,
  getUsage,
  loadUsageIndex,
  recordRejection,
  saveUsageIndex,
  trackReads,
  usagePath,
} from "../src/usage.js";

describe("usage tracking", () => {
  let workDir: string;
  let paths: HaivePaths;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-usage-"));
    paths = resolveHaivePaths(workDir);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("loadUsageIndex returns an empty index when file is missing", async () => {
    const idx = await loadUsageIndex(paths);
    expect(idx.version).toBe(1);
    expect(Object.keys(idx.by_id)).toEqual([]);
  });

  it("getUsage returns zeros for unknown ids", () => {
    const idx = emptyUsageIndex();
    const u = getUsage(idx, "missing");
    expect(u.read_count).toBe(0);
    expect(u.rejected_count).toBe(0);
  });

  it("bumpRead increments counters and timestamps", () => {
    const idx = emptyUsageIndex();
    bumpRead(idx, ["a", "b", "a"]);
    expect(idx.by_id["a"]?.read_count).toBe(2);
    expect(idx.by_id["b"]?.read_count).toBe(1);
    expect(idx.by_id["a"]?.last_read_at).toBeTruthy();
  });

  it("recordRejection bumps rejection counter and stores reason", () => {
    const idx = emptyUsageIndex();
    recordRejection(idx, "a", "outdated by PR #42");
    expect(idx.by_id["a"]?.rejected_count).toBe(1);
    expect(idx.by_id["a"]?.rejection_reason).toBe("outdated by PR #42");
  });

  it("saveUsageIndex + loadUsageIndex round-trip", async () => {
    const idx = emptyUsageIndex();
    bumpRead(idx, ["x"]);
    await saveUsageIndex(paths, idx);
    expect(existsSync(usagePath(paths))).toBe(true);
    const loaded = await loadUsageIndex(paths);
    expect(loaded.by_id["x"]?.read_count).toBe(1);
  });

  it("trackReads is a no-op when ids is empty", async () => {
    const idx = await trackReads(paths, []);
    expect(idx.by_id).toEqual({});
    expect(existsSync(usagePath(paths))).toBe(false);
  });

  it("trackReads persists incremented counts", async () => {
    await trackReads(paths, ["a", "b"]);
    await trackReads(paths, ["a"]);
    const idx = await loadUsageIndex(paths);
    expect(idx.by_id["a"]?.read_count).toBe(2);
    expect(idx.by_id["b"]?.read_count).toBe(1);
  });
});
