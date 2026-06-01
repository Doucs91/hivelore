import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { memFeedback } from "../src/tools/mem-feedback.js";

async function writeMemory(dir: string, id: string): Promise<void> {
  const lines = [
    "---",
    `id: ${id}`,
    "scope: team",
    "type: gotcha",
    "status: validated",
    `created_at: ${new Date().toISOString()}`,
    "anchor:",
    "  paths: []",
    "  symbols: []",
    "tags: []",
    "---",
    "Body.",
    "",
  ];
  await writeFile(path.join(dir, `${id}.md`), lines.join("\n"), "utf8");
}

describe("memFeedback", () => {
  let workDir: string;
  let ctx: HaiveContext;
  const id = "2026-01-01-gotcha-sample";

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-feedback-test-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.teamDir, { recursive: true });
    await writeMemory(paths.teamDir, id);
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("records an applied outcome and returns updated impact", async () => {
    const r1 = await memFeedback({ id, outcome: "applied", reason: undefined }, ctx);
    expect(r1.ok).toBe(true);
    expect(r1.usage?.applied_count).toBe(1);
    const r2 = await memFeedback({ id, outcome: "applied", reason: undefined }, ctx);
    expect(r2.usage?.applied_count).toBe(2);
    // Applied outcomes are a strong positive signal — tier should climb above low.
    expect(r2.impact?.tier === "medium" || r2.impact?.tier === "high").toBe(true);
    expect(r2.impact?.signals.join(" ")).toContain("applied 2×");
  });

  it("records a rejection with reason", async () => {
    const r = await memFeedback({ id, outcome: "rejected", reason: "outdated" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.usage?.rejected_count).toBe(1);
    expect(r.usage?.applied_count).toBe(0);
  });

  it("returns an error for an unknown memory id", async () => {
    const r = await memFeedback({ id: "does-not-exist", outcome: "applied", reason: undefined }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No memory/);
  });

  it("persists across calls (usage written to disk)", async () => {
    await memFeedback({ id, outcome: "applied", reason: undefined }, ctx);
    // Fresh context pointing at the same dir reads the persisted usage index.
    const fresh: HaiveContext = { paths: resolveHaivePaths(workDir) };
    const r = await memFeedback({ id, outcome: "applied", reason: undefined }, fresh);
    expect(r.usage?.applied_count).toBe(2);
  });
});
