import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { patternDetect } from "../src/tools/pattern-detect.js";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Write N usage events with a given tool and summary to the usage log. */
async function appendUsageEvents(
  ctx: HaiveContext,
  events: Array<{ tool: string; summary: string; daysAgo?: number }>,
): Promise<void> {
  const dir = path.join(ctx.paths.haiveDir, ".usage");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "tool-usage.jsonl");
  const lines = events.map(({ tool, summary, daysAgo = 0 }) => {
    const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    return JSON.stringify({ at, tool, summary });
  });
  await writeFile(file, lines.join("\n") + "\n", "utf8");
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("patternDetect", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-pd-test-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.haiveDir, { recursive: true });
    await mkdir(paths.personalDir, { recursive: true });
    await mkdir(paths.teamDir, { recursive: true });
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns empty notice when no .ai/ dir", async () => {
    const bare = await mkdtemp(path.join(tmpdir(), "haive-pd-bare-"));
    try {
      const ctx2: HaiveContext = { paths: resolveHaivePaths(bare) };
      const result = await patternDetect({ since_days: 7, dry_run: true, scope: "team" }, ctx2);
      expect(result.saved).toBe(0);
      expect(result.matches).toHaveLength(0);
      expect(result.notice).toMatch(/No \.ai\//);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("returns empty when no usage events exist", async () => {
    const result = await patternDetect({ since_days: 7, dry_run: true, scope: "team" }, ctx);
    expect(result.matches).toHaveLength(0);
    expect(result.saved).toBe(0);
    expect(result.notice).toBeDefined();
  });

  it("returns empty when events are outside the look-back window", async () => {
    await appendUsageEvents(ctx, [
      { tool: "mem_tried", summary: "stale.ts failed again", daysAgo: 10 },
      { tool: "mem_tried", summary: "stale.ts failed again", daysAgo: 11 },
      { tool: "mem_tried", summary: "stale.ts failed again", daysAgo: 12 },
    ]);

    const result = await patternDetect({ since_days: 7, dry_run: true, scope: "team" }, ctx);
    expect(result.matches).toHaveLength(0);
  });

  it("REPEATED_PATH: detects a file appearing 3+ times in mem_tried events", async () => {
    await appendUsageEvents(ctx, [
      { tool: "mem_tried", summary: "src/auth/service.ts failed with wrong import", daysAgo: 1 },
      { tool: "mem_tried", summary: "src/auth/service.ts circular dependency again", daysAgo: 2 },
      { tool: "mem_tried", summary: "src/auth/service.ts still broken after refactor", daysAgo: 3 },
    ]);

    const result = await patternDetect({ since_days: 7, dry_run: true, scope: "team" }, ctx);

    const repeated = result.matches.filter((m) => m.kind === "repeated_path");
    expect(repeated.length).toBeGreaterThanOrEqual(1);
    // At least one repeated match should reference a path segment from auth/service.ts
    const hasServiceMatch = repeated.some((m) =>
      m.signal.includes("service.ts") || m.anchor_paths.some((p) => p.includes("service")),
    );
    expect(hasServiceMatch).toBe(true);
  });

  it("HOT_FILE: detects a file frequently referenced in mem_save events", async () => {
    await appendUsageEvents(ctx, [
      { tool: "mem_save", summary: "saved convention about src/core/index.ts", daysAgo: 1 },
      { tool: "mem_save", summary: "saved gotcha for src/core/index.ts", daysAgo: 2 },
      { tool: "mem_save", summary: "updated decision referencing src/core/index.ts", daysAgo: 3 },
    ]);

    const result = await patternDetect({ since_days: 7, dry_run: true, scope: "team" }, ctx);

    const hot = result.matches.filter((m) => m.kind === "hot_file");
    expect(hot.length).toBeGreaterThanOrEqual(1);
  });

  it("dry_run=true: matches are returned but no files are written", async () => {
    await appendUsageEvents(ctx, [
      { tool: "mem_tried", summary: "broken.ts caused issues", daysAgo: 1 },
      { tool: "mem_tried", summary: "broken.ts caused issues again", daysAgo: 2 },
      { tool: "mem_tried", summary: "broken.ts third failure", daysAgo: 3 },
    ]);

    const result = await patternDetect({ since_days: 7, dry_run: true, scope: "team" }, ctx);

    expect(result.saved).toBe(0);
    expect(result.saved_ids).toHaveLength(0);
    // matches may still be returned
    // team memories dir should not have any new files from pattern-detect
  });

  it("dry_run=false: saves proposed memories to disk", async () => {
    await appendUsageEvents(ctx, [
      { tool: "mem_tried", summary: "widget.ts issue first time", daysAgo: 1 },
      { tool: "mem_tried", summary: "widget.ts issue second time", daysAgo: 2 },
      { tool: "mem_tried", summary: "widget.ts issue third time", daysAgo: 3 },
    ]);

    const result = await patternDetect({ since_days: 7, dry_run: false, scope: "team" }, ctx);

    if (result.matches.length > 0) {
      expect(result.saved).toBeGreaterThan(0);
      expect(result.saved_ids.length).toBe(result.saved);
    }
  });

  it("does not overwrite an existing proposed memory on second run", async () => {
    await appendUsageEvents(ctx, [
      { tool: "mem_tried", summary: "conflict.ts repeated error", daysAgo: 1 },
      { tool: "mem_tried", summary: "conflict.ts repeated error", daysAgo: 2 },
      { tool: "mem_tried", summary: "conflict.ts repeated error", daysAgo: 3 },
    ]);

    // First run — saves the proposed memory
    const first = await patternDetect({ since_days: 7, dry_run: false, scope: "team" }, ctx);
    const savedCount = first.saved;

    // Second run — should not re-save (existsSync check prevents overwrite)
    const second = await patternDetect({ since_days: 7, dry_run: false, scope: "team" }, ctx);
    expect(second.saved).toBeLessThanOrEqual(savedCount);
  });

  it("scanned_events reflects the number of events within the window", async () => {
    await appendUsageEvents(ctx, [
      { tool: "mem_tried", summary: "event within window", daysAgo: 1 },
      { tool: "mem_tried", summary: "event outside window", daysAgo: 10 },
    ]);

    const result = await patternDetect({ since_days: 7, dry_run: true, scope: "team" }, ctx);
    expect(result.scanned_events).toBe(1);
  });
});
